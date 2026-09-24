// Inicio según el rol:
//  · Instructor: revisar el ambiente (o continuarlo), escanear el QR del portero y lo que ha recibido.
//  · Portero: ambientes por entregar (generar o mostrar el QR) y sus ambientes asignados.
//  · Administrativo: indicadores del día y estado de los ambientes.
//  · Aprendiz: estado de los ambientes y acceso a registrar asistencia.
import { h, anexar, icono, vaciar } from '../ui/dom.js';
import { anim } from '../ui/anim.js';
import { cargando, tarjetaError } from '../ui/componentes.js';
import { cabecera, tarjetaInspeccion, chipInspeccion, fecha, esHoy, vacio } from '../ui/ambientes-ui.js';
import { apiAmb } from '../api/ambientes.js';
import { estado, escuchar } from '../estado.js';
import { escanearEntrega } from '../ui/recibir.js';
import { fechaIso } from '../reglas.js';

const fmtDia = new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });

export async function render(raiz, { alSalir }) {
  const u = estado.usuario;
  const hoy = fmtDia.format(new Date());
  const cuerpo = h('div', { class: 'inicio' }, cargando());
  anexar(raiz,
    cabecera({ eyebrow: hoy[0].toUpperCase() + hoy.slice(1), titulo: `Hola, ${u.nombre.split(' ')[0]}`, subtitulo: SUBTITULO[u.rol] }),
    cuerpo);

  let primera = true;
  async function cargar() {
    try {
      vaciar(cuerpo, ...await ({ instructor, portero, administrativo, aprendiz })[u.rol](u));
      if (primera) { anim.entrarVista(raiz); primera = false; }
    } catch (e) { vaciar(cuerpo, tarjetaError(e, cargar)); }
  }
  alSalir(escuchar('bandeja', cargar));
  await cargar();
}

const SUBTITULO = {
  instructor: 'Revisa el salón al entrar y recíbelo escaneando el QR del portero.',
  portero: 'Entrega los ambientes con un QR cuando el instructor termine la revisión.',
  administrativo: 'Así van las entregas de ambientes hoy.',
  aprendiz: 'Consulta el estado de los ambientes de formación.',
};

/** Estado de hoy de un ambiente, para las listas. */
function estadoHoy(a) {
  const ult = a.ultimaInspeccion;
  if (!ult || !esHoy(ult.iniciadaEn)) return h('span', { class: 'status-chip neutro' }, 'Sin revisión hoy');
  return chipInspeccion(ult.estado);
}

function listaAmbientes(ambientes, accion) {
  return h('ul', { class: 'lista-ambientes' }, ambientes.map((a) => h('li', { class: 'fila-ambiente' },
    h('span', { class: 'amb-numero' }, a.codigo),
    h('div', { class: 'fila-ambiente-datos' }, h('strong', {}, a.nombre),
      h('span', { class: 'text-muted' }, `${a.itemsTotal} ítems${a.itemsNovedad ? ` · ${a.itemsNovedad} con novedad` : ''}`)),
    estadoHoy(a),
    accion?.(a))));
}

async function instructor() {
  const [mias, ambientes] = await Promise.all([apiAmb.inspecciones(), apiAmb.ambientes()]);
  const actual = mias.find((s) => s.estado === 'en_curso');
  const porRecibir = mias.find((s) => s.estado === 'pendiente_recepcion');
  const cta = porRecibir
    ? h('button', { class: 'accion-grande accion-grande--alerta', type: 'button', onclick: escanearEntrega },
      h('span', { class: 'accion-grande-icono' }, icono('escanear')),
      h('span', {}, h('strong', {}, `Escanear QR del portero · ambiente ${porRecibir.ambiente.codigo}`),
        h('span', {}, porRecibir.qrGeneradoEn ? 'El QR de entrega ya está listo' : 'Pide al portero que genere el QR de entrega')),
      icono('flecha'))
    : actual
      ? h('a', { class: 'accion-grande accion-grande--continuar', href: `#/inspeccion?id=${actual.id}` },
        h('span', { class: 'accion-grande-icono' }, icono('inspeccion')),
        h('span', {}, h('strong', {}, `Continuar revisión · ambiente ${actual.ambiente.codigo}`),
          h('span', {}, `Iniciada ${fecha.relativa(actual.iniciadaEn)}`)),
        icono('flecha'))
      : h('a', { class: 'accion-grande', href: '#/inspecciones' },
        h('span', { class: 'accion-grande-icono' }, icono('inspeccion')),
        h('span', {}, h('strong', {}, 'Revisar el ambiente'), h('span', {}, 'Verifica cada elemento antes de recibir el salón')),
        icono('flecha'));
  const recientes = mias.filter((s) => s.estado === 'recibida').slice(0, 3);
  return [
    h('div', { 'data-anim': '' }, cta),
    h('section', { class: 'card', 'data-anim': '' },
      h('h3', { class: 'bloque-titulo' }, 'Estado de los ambientes hoy'),
      listaAmbientes(ambientes, (a) => !actual && !porRecibir && !['en_curso', 'pendiente_recepcion'].includes(a.ultimaInspeccion?.estado)
        && h('a', { class: 'btn btn-outline btn-sm', href: `#/inspecciones?ambiente=${a.id}`, 'aria-label': `Revisar ambiente ${a.codigo}` }, 'Revisar'))),
    h('section', { 'data-anim': '' },
      h('h3', { class: 'bloque-titulo bloque-titulo--fuera' }, 'Ambientes que he recibido'),
      recientes.length ? h('div', { class: 'insp-lista' }, recientes.map((s) => tarjetaInspeccion(s)))
        : vacio('Aún no has recibido ambientes', 'Cuando escanees el QR de un portero, aparecerán aquí.', 'inspeccion')),
  ];
}

async function portero() {
  const [pendientes, ambientes] = await Promise.all([
    apiAmb.inspecciones({ estado: 'pendiente_recepcion', asignados: 1 }), apiAmb.ambientes({ asignados: 1 }),
  ]);
  return [
    h('a', { class: `accion-grande${pendientes.length ? ' accion-grande--alerta' : ''}`, href: '#/inspecciones', 'data-anim': '' },
      h('span', { class: 'accion-grande-numero' }, String(pendientes.length)),
      h('span', {}, h('strong', {}, pendientes.length === 1 ? 'Ambiente por entregar' : 'Ambientes por entregar'),
        h('span', {}, pendientes.length ? 'Genera el QR de entrega para el instructor' : 'No tienes pendientes por ahora')),
      icono('flecha')),
    pendientes.length ? h('div', { class: 'insp-lista', 'data-anim': '' }, pendientes.map((s) => tarjetaInspeccion(s, {
      accion: h('a', { class: 'btn btn-primary btn-sm insp-tarjeta-ir', href: `#/planilla?id=${s.id}` }, icono('qr'), s.qrGeneradoEn ? 'Mostrar QR' : 'Generar QR'),
    }))) : null,
    h('section', { class: 'card', 'data-anim': '' },
      h('h3', { class: 'bloque-titulo' }, 'Mis ambientes asignados'),
      ambientes.length ? listaAmbientes(ambientes) : vacio('No tienes ambientes asignados', 'Coordinación te los asigna en Ambientes.', 'ambiente')),
  ];
}

async function administrativo() {
  const hoy = fechaIso();
  const [rep, ambientes, recientes] = await Promise.all([
    apiAmb.reporte({ desde: hoy, hasta: hoy }), apiAmb.ambientes(), apiAmb.inspecciones(),
  ]);
  const r = rep.resumen;
  const kpi = (valor, etiqueta, clase, ic) => h('div', { class: `adm-kpi adm-kpi--${clase}` },
    h('span', { class: 'adm-kpi-icono' }, icono(ic)), h('span', { class: 'adm-kpi-etiqueta' }, etiqueta),
    h('strong', { class: 'adm-kpi-valor', 'data-valor': valor }, '0'));
  const kpis = h('section', { class: 'adm-kpis', 'data-anim': '', 'aria-label': 'Indicadores de hoy' },
    kpi(r.total, 'Revisiones hoy', 'notis', 'inspeccion'),
    kpi(r.pendientes, 'Por entregar', 'canceladas', 'portero'),
    kpi(r.conDanos, 'Con novedades', 'riesgo', 'alerta'),
    kpi(r.danos, 'Daños reportados', 'total', 'herramienta'));
  setTimeout(() => kpis.querySelectorAll('[data-valor]').forEach((el) => anim.contar(el, Number(el.dataset.valor))), 0);
  return [
    kpis,
    h('section', { class: 'card', 'data-anim': '' },
      h('div', { class: 'adm-bloque-cabecera' }, h('h3', { class: 'bloque-titulo' }, 'Ambientes'), h('a', { class: 'btn btn-outline btn-sm', href: '#/ambientes' }, 'Gestionar')),
      listaAmbientes(ambientes)),
    h('section', { 'data-anim': '' },
      h('div', { class: 'adm-bloque-cabecera' }, h('h3', { class: 'bloque-titulo' }, 'Últimas entregas'), h('a', { class: 'btn btn-outline btn-sm', href: '#/reportes' }, icono('reporte'), 'Reportes')),
      recientes.length ? h('div', { class: 'insp-lista' }, recientes.slice(0, 4).map((s) => tarjetaInspeccion(s))) : vacio('Sin inspecciones registradas', '', 'inspeccion')),
  ];
}

async function aprendiz() {
  const ambientes = await apiAmb.ambientes();
  return [
    h('a', { class: 'accion-grande', href: '#/asistencia', 'data-anim': '' },
      h('span', { class: 'accion-grande-icono' }, icono('escanear')),
      h('span', {}, h('strong', {}, 'Registrar asistencia'), h('span', {}, 'Escanea el QR que proyecta tu instructor')),
      icono('flecha')),
    h('section', { class: 'card', 'data-anim': '' }, h('h3', { class: 'bloque-titulo' }, 'Ambientes de formación'), listaAmbientes(ambientes)),
  ];
}
