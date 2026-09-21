// Componentes reutilizados entre vistas: badge del semáforo, chips de
// estado, filtro de fechas, tabla de asistencias y exportes simulados.
import { h, icono, formato, descargar, vaciar } from './dom.js';
import { calcularSemaforo, fechaIso } from '../reglas.js';
import { anim } from './anim.js';
import { toast } from './avisos.js';

/* ---------------- semáforo ---------------- */

/** Badge de color con tooltip que muestra el conteo de faltas. */
export function badgeSemaforo(datos, { compacto = false } = {}) {
  const s = calcularSemaforo(datos);
  const tip = h('span', { class: 'tooltip', role: 'tooltip' },
    h('strong', {}, s.etiqueta),
    h('span', {}, `Consecutivas: ${s.faltasConsecutivas}`),
    h('span', {}, `Totales: ${s.faltasTotales}`),
    datos.ultimaFalta && h('span', {}, `Última: ${formato.fecha(datos.ultimaFalta)}`));
  return h('span', { class: `semaforo semaforo--${s.clave}${compacto ? ' semaforo--compacto' : ''}`, tabindex: '0', 'aria-label': `${s.etiqueta}: ${s.faltasConsecutivas} consecutivas, ${s.faltasTotales} totales` },
    h('span', { class: 'semaforo-punto' }), compacto ? null : s.etiqueta, tip);
}

const ESTADOS_ASISTENCIA = {
  presente: ['Presente', 'in'], tarde: ['Tarde', 'out'], falla: ['Falla', 'error'], cancelada: ['Cancelada', 'neutro'],
};
export function chipAsistencia(estado) {
  const [texto, clase] = ESTADOS_ASISTENCIA[estado] || [estado, 'neutro'];
  return h('span', { class: `status-chip ${clase}` }, texto);
}

const ESTADOS_ACTIVO = {
  operativo: ['Operativo', 'in'], danado: ['Dañado', 'error'], 'en-reparacion': ['En reparación', 'out'], baja: ['De baja', 'neutro'],
};
export function chipActivo(estado) {
  const [texto, clase] = ESTADOS_ACTIVO[estado] || [estado, 'neutro'];
  return h('span', { class: `status-chip ${clase}` }, texto);
}

/* ---------------- filtro de fechas ---------------- */

/** FiltroFechas: rango desde/hasta con atajos. Llama alCambiar({desde, hasta}). */
export function filtroFechas({ desde, hasta, alCambiar }) {
  const inDesde = h('input', { type: 'date', value: desde, max: fechaIso() });
  const inHasta = h('input', { type: 'date', value: hasta, max: fechaIso() });
  const avisar = () => {
    if (inDesde.value && inHasta.value && inDesde.value > inHasta.value) {
      inHasta.setCustomValidity('La fecha final no puede ser anterior a la inicial.');
      inHasta.reportValidity();
      return;
    }
    inHasta.setCustomValidity('');
    alCambiar({ desde: inDesde.value, hasta: inHasta.value });
  };
  inDesde.addEventListener('change', avisar);
  inHasta.addEventListener('change', avisar);
  const atajo = (texto, dias) => h('button', {
    class: 'chip-boton', type: 'button',
    onclick: () => {
      const d = new Date(); d.setDate(d.getDate() - dias);
      inDesde.value = fechaIso(d); inHasta.value = fechaIso();
      avisar();
    },
  }, texto);
  return h('div', { class: 'filtro-fechas' },
    h('div', { class: 'campo' }, h('label', {}, 'Desde'), inDesde),
    h('div', { class: 'campo' }, h('label', {}, 'Hasta'), inHasta),
    h('div', { class: 'filtro-atajos' }, atajo('Hoy', 0), atajo('7 días', 7), atajo('30 días', 30)));
}

/* ---------------- tabla de asistencias ---------------- */

/**
 * TablaAsistencias con paginación. `registros` son Asistencia[].
 * @returns {{el:HTMLElement, mostrar:(registros:any[])=>void}}
 */
export function tablaAsistencias({ columnasAprendiz = true, porPagina = 20 } = {}) {
  // Sin columnas de aprendiz (historial personal) la tabla es angosta: se
  // omiten ficha y ambiente, que son siempre los mismos.
  const completa = columnasAprendiz;
  let registros = [], pagina = 0;
  const cuerpo = h('tbody');
  const pie = h('div', { class: 'paginacion' });
  const el = h('div', {},
    h('div', { class: `table-wrap${completa ? '' : ' table-wrap--compacta'}` }, h('table', {},
      h('thead', {}, h('tr', {},
        h('th', {}, 'Fecha'), completa && h('th', {}, 'Aprendiz'), completa && h('th', {}, 'Documento'),
        completa && h('th', {}, 'Ficha'), h('th', {}, 'Competencia'), completa && h('th', {}, 'Ambiente'), h('th', {}, 'Registro'), h('th', {}, 'Estado'))),
      cuerpo)),
    pie);

  function pintar() {
    const total = Math.max(1, Math.ceil(registros.length / porPagina));
    pagina = Math.min(pagina, total - 1);
    const visibles = registros.slice(pagina * porPagina, (pagina + 1) * porPagina);
    vaciar(cuerpo, visibles.length ? visibles.map((r) => h('tr', {},
      h('td', { class: 'celda-fecha' }, formato.fecha(r.fecha)),
      completa && h('td', {}, r.aprendiz),
      completa && h('td', { class: 'mono' }, r.documento),
      completa && h('td', {}, r.ficha),
      h('td', { class: completa ? 'celda-larga' : '' }, r.competencia),
      completa && h('td', {}, r.ambiente),
      h('td', {}, r.hora ? formato.hora(r.hora) : '—'),
      h('td', {}, chipAsistencia(r.estado)),
    )) : h('tr', {}, h('td', { colspan: 8, class: 'empty-state' }, 'No hay registros con esos filtros.')));
    vaciar(pie,
      h('span', { class: 'text-muted' }, `${registros.length} registros · página ${pagina + 1} de ${total}`),
      h('div', { class: 'paginacion-botones' },
        h('button', { class: 'btn btn-outline btn-sm', type: 'button', disabled: pagina === 0, onclick: () => { pagina--; pintar(); } }, 'Anterior'),
        h('button', { class: 'btn btn-outline btn-sm', type: 'button', disabled: pagina >= total - 1, onclick: () => { pagina++; pintar(); } }, 'Siguiente')));
    anim.lista(cuerpo.children, { autoAlpha: 0, x: -6 });
  }

  return { el, mostrar: (lista) => { registros = lista; pagina = 0; pintar(); } };
}

/* ---------------- exportes simulados ---------------- */

function aCsv(filas, columnas) {
  const celda = (v) => {
    const t = String(v ?? '');
    return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return '\uFEFF' + [columnas.map((c) => c[1]).join(';'), ...filas.map((f) => columnas.map(([k, , fmt]) => celda(fmt ? fmt(f[k]) : f[k])).join(';'))].join('\n');
}

/** ExportMock: botones CSV y JSON que descargan lo que hay en pantalla. */
export function exportMock({ nombre, obtenerFilas, columnas }) {
  const exportar = (tipo) => {
    const filas = obtenerFilas();
    if (!filas.length) { toast('aviso', 'Nada para exportar', 'Ajusta los filtros para incluir registros.'); return; }
    const sello = fechaIso();
    if (tipo === 'csv') descargar(`${nombre}-${sello}.csv`, aCsv(filas, columnas), 'text/csv;charset=utf-8');
    else descargar(`${nombre}-${sello}.json`, JSON.stringify(filas, null, 2), 'application/json');
    toast('exito', `Exportado ${tipo.toUpperCase()}`, `${filas.length} registros (exporte simulado en el navegador).`);
  };
  return h('div', { class: 'exportar-mock' },
    h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => exportar('csv') }, icono('descargar'), 'CSV'),
    h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => exportar('json') }, icono('descargar'), 'JSON'));
}

export const COLUMNAS_ASISTENCIA = [
  ['fecha', 'Fecha', (v) => fechaIso(v)], ['aprendiz', 'Aprendiz'], ['documento', 'Documento'], ['ficha', 'Ficha'],
  ['competencia', 'Competencia'], ['ambiente', 'Ambiente'], ['hora', 'Hora registro', (v) => (v ? formato.hora(v) : '')], ['estado', 'Estado'],
];

/* ---------------- varios ---------------- */

export function cargando(texto = 'Cargando…') {
  return h('div', { class: 'cargando', role: 'status' }, h('span', { class: 'cargando-punto' }), h('span', { class: 'cargando-punto' }), h('span', { class: 'cargando-punto' }), h('span', { class: 'sr-only' }, texto));
}

export function tarjetaError(error, reintentar) {
  return h('div', { class: 'banner error' }, error.message || 'Ocurrió un error.',
    reintentar && h('button', { class: 'btn btn-outline btn-sm', type: 'button', style: { marginLeft: '12px' }, onclick: reintentar }, icono('reintentar'), 'Reintentar'));
}

export function encabezado(titulo, subtitulo, ...acciones) {
  return h('div', { class: 'vista-cabecera', 'data-anim': '' },
    h('div', {}, h('h2', { class: 'vista-titulo' }, titulo), subtitulo && h('p', { class: 'section-sub' }, subtitulo)),
    acciones.length ? h('div', { class: 'vista-acciones' }, acciones) : null);
}
