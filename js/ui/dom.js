// Utilidades de DOM: creación de elementos, íconos de línea y formatos.

/**
 * h('button', { class: 'btn', onclick }, 'Texto', otroNodo)
 * Props especiales: class, style (objeto), dataset, on* (eventos). Los
 * valores false/null/undefined no se agregan; true agrega el atributo vacío.
 */
export function h(tag, props = {}, ...hijos) {
  const el = document.createElementNS(tag === 'svg' || props?.__svg ? 'http://www.w3.org/2000/svg' : 'http://www.w3.org/1999/xhtml', tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === false || v === null || v === undefined || k === '__svg') continue;
    if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value' && 'value' in el) el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden') el[k] = !!v;
    else el.setAttribute(k === 'className' ? 'class' : k, v === true ? '' : v);
  }
  agregar(el, hijos);
  return el;
}

function agregar(el, hijos) {
  for (const hijo of hijos.flat(Infinity)) {
    if (hijo === null || hijo === undefined || hijo === false) continue;
    el.append(hijo instanceof Node ? hijo : document.createTextNode(String(hijo)));
  }
}

/** Como el append nativo, pero ignora false/null/undefined (para hijos condicionales). */
export function anexar(el, ...hijos) {
  agregar(el, hijos);
  return el;
}

export function vaciar(el, ...hijos) {
  el.replaceChildren();
  agregar(el, hijos);
  return el;
}

const RUTAS_ICONOS = {
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2zM16 16h2v2h-2z',
  escanear: 'M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16',
  camara: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  caja: 'M3 7l9-4 9 4-9 4-9-4zM3 7v10l9 4 9-4V7M12 11v10',
  alerta: 'M12 3l10 18H2L12 3zM12 10v5M12 18v.5',
  historial: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
  salir: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11',
  campana: 'M6 16V11a6 6 0 1 1 12 0v5l2 2H4l2-2zM10 20a2 2 0 0 0 4 0',
  cerrar: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12l5 5L20 7',
  descargar: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  subir: 'M12 16V5M7 10l5-5 5 5M5 20h14',
  reloj: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  prohibido: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM5.6 5.6l12.8 12.8',
  ojo: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  herramienta: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4 2.5-2.5z',
  usuarios: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a7 7 0 0 1 14 0v1M16 3.1a4 4 0 0 1 0 7.8M22 21v-1a7 7 0 0 0-4-6.3',
  filtro: 'M3 5h18l-7 8v6l-4 2v-8L3 5z',
  archivo: 'M6 3h8l4 4v14H6zM14 3v4h4M9 13h6M9 17h6',
  reintentar: 'M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5',
  flecha: 'M5 12h14M13 6l6 6-6 6',
  abajo: 'M6 9l6 6 6-6',
  // Rediseño móvil v1: roles, inicio y búsqueda (mismo trazo lineal).
  instructor: 'M8 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2.5 20v-1.5A4.5 4.5 0 0 1 7 14h2a4.5 4.5 0 0 1 4.5 4.5V20M13 3.5h8.5v7H13zM15.5 13.5l1.5-3',
  aprendiz: 'M2 9l10-4.5L22 9l-10 4.5L2 9zM6 11v4.5c0 1.5 2.7 3 6 3s6-1.5 6-3V11M22 9v5',
  administrativo: 'M5.5 3.5h13A2.5 2.5 0 0 1 21 6v12a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18V6a2.5 2.5 0 0 1 2.5-2.5zM7 8.5h10M7 12.5h6M7 16.5h4',
  calendario: 'M5.5 5h13A2.5 2.5 0 0 1 21 7.5v11a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18.5v-11A2.5 2.5 0 0 1 5.5 5zM3 10h18M8 3v4M16 3v4',
  inicio: 'M5 3h3.5a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM15.5 3H19a2 2 0 0 1 2 2v1.5a2 2 0 0 1-2 2h-3.5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM15.5 11.5H19a2 2 0 0 1 2 2V19a2 2 0 0 1-2 2h-3.5a2 2 0 0 1-2-2v-5.5a2 2 0 0 1 2-2zM5 15h3.5a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 1 2-2z',
  buscar: 'M11 17.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM20 20l-4.2-4.2',
  ambiente: 'M3 21V8l9-5 9 5v13M9 21v-6h6v6M3 21h18',
  // Entrega y revisión de ambientes.
  perfil: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  portero: 'M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3zM9 12l2 2 4-4',
  inspeccion: 'M9 4h6v3H9zM7 5.5H5.5A1.5 1.5 0 0 0 4 7v12.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V7a1.5 1.5 0 0 0-1.5-1.5H17M8 13l2.5 2.5L16 10',
  reporte: 'M4 20V11M10 20V5M16 20v-6M21 20H3',
  ajustes: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  imprimir: 'M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-2M6 14h12v7H6z',
  lapiz: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
  basura: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  mas: 'M12 5v14M5 12h14',
};

export function icono(nombre, clase = 'icon') {
  const svg = h('svg', { class: clase, viewBox: '0 0 24 24', 'aria-hidden': 'true' });
  svg.append(h('path', { __svg: true, d: RUTAS_ICONOS[nombre] || '' }));
  return svg;
}

const fmtFecha = new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
const fmtHora = new Intl.DateTimeFormat('es-CO', { hour: 'numeric', minute: '2-digit' });
const fmtFechaHora = new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' });

export const formato = {
  fecha: (v) => (v ? fmtFecha.format(new Date(v)) : '—'),
  hora: (v) => (v ? fmtHora.format(new Date(v)) : '—'),
  fechaHora: (v) => (v ? fmtFechaHora.format(new Date(v)) : '—'),
};

/** Crea un Blob y dispara la descarga en el navegador (exportes simulados). */
export function descargar(nombre, contenido, tipo) {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  const a = h('a', { href: url, download: nombre });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Muestra un error de campo debajo del control (o lo quita si no hay mensaje). */
export function errorCampo(control, mensaje) {
  const contenedor = control.closest('.campo') || control.parentElement;
  contenedor.querySelector(':scope > .field-error')?.remove();
  control.toggleAttribute('aria-invalid', !!mensaje);
  if (mensaje) contenedor.append(h('div', { class: 'field-error', role: 'alert' }, mensaje));
}
