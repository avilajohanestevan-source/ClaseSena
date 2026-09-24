// Inicio según el rol:
//  · Instructor: botón grande "Recibir ambiente" (escanea el QR del portero) y lo que ha recibido.
//  · Portero: entregar un ambiente (o continuar la revisión), entregas esperando al instructor y sus ambientes.
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
  instructor: 'Recibe el ambiente escaneando el QR del portero antes de empezar la formación.',
  portero: 'Revisa los ambientes con el instructor y entrégalos con un QR.',
  administrativo: 'Así van las entregas de ambientes hoy.',
  aprendiz: 'Consulta el estado de los ambientes de formación.',
};

/** Estado de hoy de un ambiente, para las listas. */
function estadoHoy(a) {
  const ult = a.ultimaInspeccion;
  if (!ult || !esHoy(ult.iniciadaEn)) return h('span', { class: 'status-chip neutro' }, 'Sin entrega hoy');
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
  const listos = ambientes.filter((a) => a.ultimaInspeccion?.estado === 'pendiente_recepcion');
  const recientes = mias.slice(0, 3);
  return [
    h('button', { class: `accion-grande${listos.length ? ' accion-grande--alerta' : ''}`, type: 'button', onclick: escanearEntrega, 'data-anim': '' },
      h('span', { class: 'accion-grande-icono' }, icono('escanear')),
      h('span', {}, h('strong', {}, 'Recibir ambiente'),
        h('span', {}, listos.length ? `${listos.map((a) => a.codigo).join(', ')} listo${listos.length === 1 ? '' : 's'} para recibir · escanea el QR del portero` : 'Escanea el QR que te muestra el portero')),
      icono('flecha')),
    h('section', { class: 'card', 'data-anim': '' },
      h('h3', { class: 'bloque-titulo' }, 'Estado de los ambientes hoy'),
      listaAmbientes(ambientes, (a) => a.ultimaInspeccion?.estado === 'pendiente_recepcion'
        && h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: escanearEntrega, 'aria-label': `Recibir ambiente ${a.codigo}` }, icono('escanear'), 'Recibir'))),
    h('section', { 'data-anim': '' },
      h('h3', { class: 'bloque-titulo bloque-titulo--fuera' }, 'Ambientes que he recibido'),
      recientes.length ? h('div', { class: 'insp-lista' }, recientes.map((s) => tarjetaInspeccion(s)))
        : vacio('Aún no has recibido ambientes', 'Cuando escanees el QR de un portero, aparecerá aquí.', 'inspeccion')),
  ];
}

async function portero(u) {
  const [abiertas, ambientes] = await Promise.all([
    apiAmb.inspecciones({ asignados: 1 }), apiAmb.ambientes({ asignados: 1 }),
  ]);
  const enCurso = abiertas.find((s) => s.estado === 'en_curso' && s.portero.id === u.id);
  const esperando = abiertas.filter((s) => s.estado === 'pendiente_recepcion');
  const cta = enCurso
    ? h('a', { class: 'accion-grande accion-grande--continuar', href: `#/inspeccion?id=${enCurso.id}` },
      h('span', { class: 'accion-grande-icono' }, icono('inspeccion')),
      h('span', {}, h('strong', {}, `Continuar revisión · ambiente ${enCurso.ambiente.codigo}`),
        h('span', {}, `Iniciada ${fecha.relativa(enCurso.iniciadaEn)}`)),
      icono('flecha'))
    : h('a', { class: 'accion-grande', href: '#/inspecciones' },
      h('span', { class: 'accion-grande-icono' }, icono('inspeccion')),
      h('span', {}, h('strong', {}, 'Entregar un ambiente'), h('span', {}, 'Revísalo con el instructor y genera el QR')),
      icono('flecha'));
  return [
    h('div', { 'data-anim': '' }, cta),
    esperando.length ? h('section', { 'data-anim': '' },
      h('h3', { class: 'bloque-titulo bloque-titulo--fuera' }, 'Esperando al instructor'),
      h('div', { class: 'insp-lista' }, esperando.map((s) => tarjetaInspeccion(s, s.portero.id === u.id ? {
        accion: h('a', { class: 'btn btn-primary btn-sm insp-tarjeta-ir', href: `#/planilla?id=${s.id}` }, icono('qr'), 'Mostrar QR'),
      } : {})))) : null,
    h('section', { class: 'card', 'data-anim': '' },
      h('h3', { class: 'bloque-titulo' }, 'Mis ambientes asignados'),
      ambientes.length ? listaAmbientes(ambientes, (a) => !['en_curso', 'pendiente_recepcion'].includes(a.ultimaInspeccion?.estado)
        && h('a', { class: 'btn btn-outline btn-sm', href: `#/inspecciones?ambiente=${a.id}`, 'aria-label': `Entregar ambiente ${a.codigo}` }, 'Entregar'))
        : vacio('No tienes ambientes asignados', 'Coordinación te los asigna en Ambientes.', 'ambiente')),
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
    kpi(r.total, 'Entregas hoy', 'notis', 'inspeccion'),
    kpi(r.pendientes, 'Esperando instructor', 'canceladas', 'portero'),
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
