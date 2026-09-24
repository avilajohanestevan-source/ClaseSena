// Piezas de interfaz compartidas por las vistas de entrega y revisión de
// ambientes: chips de estado, QR, tiempo relativo y estados vacíos.
import { h, icono } from './dom.js';
import { ESTADOS_INSPECCION, ESTADOS_ITEM, TIPOS_DANO, PRIORIDADES } from '../reglas.js';
import { svgCode128 } from './codigo128.js';

export function chipInspeccion(estado) {
  const [texto, clase] = ESTADOS_INSPECCION[estado] || [estado, 'neutro'];
  return h('span', { class: `status-chip ${clase}` }, texto);
}

export function chipResultado(resultado) {
  if (!resultado) return null;
  return resultado === 'ok'
    ? h('span', { class: 'status-chip in' }, icono('check'), 'Sin novedad')
    : h('span', { class: 'status-chip error' }, icono('alerta'), 'Con novedades');
}

export function chipItem(estado) {
  const [texto, clase] = ESTADOS_ITEM[estado] || [estado, 'neutro'];
  return h('span', { class: `status-chip ${clase}` }, texto);
}

export function chipSeveridad(severidad) {
  const clase = { leve: 'neutro', moderada: 'out', grave: 'error' }[severidad] || 'neutro';
  return h('span', { class: `status-chip ${clase}` }, PRIORIDADES.find((p) => p.clave === severidad)?.etiqueta || severidad);
}

export const etiquetaTipoDano = (clave) => TIPOS_DANO.find((t) => t.clave === clave)?.etiqueta || clave;

const fmtHora = new Intl.DateTimeFormat('es-CO', { hour: 'numeric', minute: '2-digit' });
const fmtDia = new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtCompleto = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' });

export const fecha = {
  hora: (v) => (v ? fmtHora.format(new Date(v)) : '—'),
  completa: (v) => (v ? fmtCompleto.format(new Date(v)) : '—'),
  /** "hoy 7:05 a. m.", "ayer 6:48 a. m." o "mié, 22 sept 6:52 a. m." */
  corta(v) {
    if (!v) return '—';
    const d = new Date(v), hoy = new Date();
    const dias = Math.round((new Date(hoy.toDateString()) - new Date(d.toDateString())) / 86_400_000);
    const dia = dias === 0 ? 'hoy' : dias === 1 ? 'ayer' : fmtDia.format(d);
    return `${dia} ${fmtHora.format(d)}`;
  },
  /** "hace 5 min", "hace 2 h", o la fecha corta si pasó más de un día. */
  relativa(v) {
    if (!v) return '—';
    const min = Math.round((Date.now() - new Date(v)) / 60_000);
    if (min < 1) return 'hace un momento';
    if (min < 60) return `hace ${min} min`;
    if (min < 24 * 60) return `hace ${Math.round(min / 60)} h`;
    return fecha.corta(v);
  },
};

export const esHoy = (v) => v && new Date(v).toDateString() === new Date().toDateString();

/** Dibuja un QR con qrcode.js dentro de un contenedor nuevo. */
export function qr(texto, tamano = 180, etiqueta = 'Código QR') {
  const caja = h('div', { class: 'qr-caja', role: 'img', 'aria-label': `${etiqueta}: ${texto}` });
  if (window.QRCode) {
    new window.QRCode(caja, { text: texto, width: tamano, height: tamano, colorDark: '#00304D', colorLight: '#ffffff', correctLevel: window.QRCode.CorrectLevel.M });
    caja.removeAttribute('title');
  } else {
    caja.textContent = texto;
  }
  return caja;
}

export function vacio(texto, detalle = '', ic = 'check') {
  return h('div', { class: 'vacio-estado' },
    h('span', { class: 'vacio-icono', 'aria-hidden': 'true' }, icono(ic)),
    h('strong', {}, texto), detalle && h('p', {}, detalle));
}

/** Encabezado de vista con eyebrow. */
export function cabecera({ eyebrow, titulo, subtitulo, acciones = [] }) {
  return h('div', { class: 'vista-cabecera', 'data-anim': '' },
    h('div', {},
      eyebrow && h('span', { class: 'eyebrow eyebrow-verde' }, eyebrow),
      h('h2', { class: 'vista-titulo' }, titulo),
      subtitulo && h('p', { class: 'section-sub' }, subtitulo)),
    acciones.length ? h('div', { class: 'vista-acciones' }, acciones) : null);
}

/** Tarjeta resumen de una entrega (listas del portero, instructor y administrativo). */
export function tarjetaInspeccion(s, { accion } = {}) {
  return h('article', { class: `card insp-tarjeta insp-tarjeta--${s.estado}` },
    h('div', { class: 'insp-tarjeta-cab' },
      h('span', { class: 'amb-numero', 'aria-hidden': 'true' }, s.ambiente.codigo),
      h('div', { class: 'insp-tarjeta-datos' },
        h('strong', {}, `Ambiente ${s.ambiente.codigo} · ${s.ambiente.nombre}`),
        h('span', { class: 'text-muted' }, `Revisó ${s.instructor.nombre}${s.portero ? ` · entregó ${s.portero.nombre}` : ''} · ${fecha.corta(s.iniciadaEn)}`)),
      chipInspeccion(s.estado)),
    h('div', { class: 'insp-tarjeta-pie' },
      chipResultado(s.resultado),
      s.danos ? h('span', { class: 'status-chip error' }, `${s.danos} daño${s.danos === 1 ? '' : 's'}${s.danosGraves ? ` (${s.danosGraves} grave)` : ''}`) : null,
      s.recibidaEn ? h('span', { class: 'text-muted insp-tarjeta-hora' }, `Recibido ${fecha.relativa(s.recibidaEn)}`)
        : s.qrGeneradoEn ? h('span', { class: 'text-muted insp-tarjeta-hora' }, `QR generado ${fecha.relativa(s.qrGeneradoEn)}`)
          : s.confirmadaEn && h('span', { class: 'text-muted insp-tarjeta-hora' }, `Revisión terminada ${fecha.relativa(s.confirmadaEn)}`),
      accion || h('a', { class: 'btn btn-outline btn-sm insp-tarjeta-ir', href: `#/planilla?id=${s.id}` }, icono('archivo'), 'Ver planilla')));
}

/** Código de barras Code 128 del código del ítem (lo leen los lectores USB y la cámara). */
export function codigoBarras(codigo, etiqueta = 'Código de barras') {
  const caja = h('span', { class: 'barras-caja', role: 'img', 'aria-label': `${etiqueta}: ${codigo}` });
  caja.innerHTML = svgCode128(codigo, { modulo: 1.4, alto: 44 }); // svgCode128 escapa el texto
  caja.firstElementChild?.removeAttribute('role');
  caja.firstElementChild?.setAttribute('aria-hidden', 'true');
  return caja;
}

/** Pegatina de un ítem: QR (SENA-INV:<código>) + código de barras + nombre. */
export function pegatina(it) {
  return h('figure', { class: 'etiqueta' },
    h('div', { class: 'etiqueta-codigos' }, qr(it.qr, 96, `QR de ${it.nombre}`), codigoBarras(it.codigo, `Código de barras de ${it.nombre}`)),
    h('figcaption', {},
      h('strong', {}, it.nombre),
      h('span', {}, `SENA · Ambiente ${it.ambiente} · ${it.categoria}`)));
}
