// Toasts y modales compartidos por todas las vistas.
import { h, icono } from './dom.js';
import { anim } from './anim.js';

/* ---------------- toasts ---------------- */

let pila;
const ICONO_TOAST = { exito: 'check', error: 'alerta', aviso: 'reloj', info: 'campana' };

/**
 * @param {'exito'|'error'|'aviso'|'info'} tipo
 */
export function toast(tipo, titulo, detalle = '', duracion = 4500) {
  if (!pila) {
    // popover: así los toasts quedan en la capa superior, también encima de un <dialog> modal abierto.
    pila = h('div', { class: 'toasts', role: 'region', 'aria-label': 'Notificaciones', popover: 'manual' });
    document.body.append(pila);
  }
  if (pila.showPopover) {
    if (pila.matches(':popover-open')) pila.hidePopover();
    pila.showPopover();
  }
  const el = h('div', { class: `toast toast--${tipo}`, role: tipo === 'error' ? 'alert' : 'status' },
    h('span', { class: 'toast-icono' }, icono(ICONO_TOAST[tipo] || 'campana')),
    h('div', { class: 'toast-texto' }, h('strong', {}, titulo), detalle && h('span', {}, detalle)),
    h('button', { class: 'toast-cerrar', type: 'button', 'aria-label': 'Cerrar', onclick: () => cerrar() }, icono('cerrar')),
    h('span', { class: 'toast-barra', style: { animationDuration: `${duracion}ms` } }),
  );
  let cerrado = false;
  const cerrar = async () => {
    if (cerrado) return;
    cerrado = true;
    await anim.toastSale(el);
    el.remove();
  };
  pila.append(el);
  anim.toastEntra(el);
  const t = setTimeout(cerrar, duracion);
  el.addEventListener('mouseenter', () => { clearTimeout(t); el.classList.add('toast--fijo'); }, { once: true });
  el.addEventListener('mouseleave', () => setTimeout(cerrar, 1500), { once: true });
  return cerrar;
}

/* ---------------- modales ---------------- */

/**
 * Abre un <dialog> modal. `contenido` puede ser un nodo o una función que
 * recibe { cerrar } y devuelve el nodo. Devuelve { cerrar, dialogo }.
 */
export function abrirModal({ titulo, subtitulo, contenido, acciones = [], ancho = 'normal', alCerrar }) {
  let cerrado = false;
  const cerrar = async (valor) => {
    if (cerrado) return;
    cerrado = true;
    await anim.modalSale(panel);
    dialogo.close();
    dialogo.remove();
    alCerrar?.(valor);
  };
  const cuerpo = typeof contenido === 'function' ? contenido({ cerrar }) : contenido;
  const panel = h('div', { class: 'modal-panel' },
    h('header', { class: 'modal-cabecera' },
      h('div', {}, h('h2', { class: 'modal-titulo' }, titulo), subtitulo && h('p', { class: 'modal-sub' }, subtitulo)),
      h('button', { class: 'modal-x', type: 'button', 'aria-label': 'Cerrar', onclick: () => cerrar() }, icono('cerrar')),
    ),
    h('div', { class: 'modal-cuerpo' }, cuerpo),
    acciones.length ? h('footer', { class: 'modal-pie' }, acciones.map((a) => (typeof a === 'function' ? a({ cerrar }) : a))) : null,
  );
  const dialogo = h('dialog', { class: `modal modal--${ancho}` }, panel);
  dialogo.addEventListener('cancel', (e) => { e.preventDefault(); cerrar(); });
  dialogo.addEventListener('click', (e) => { if (e.target === dialogo) cerrar(); });
  document.body.append(dialogo);
  dialogo.showModal();
  // Un toast que ya estaba visible debe quedar por encima del modal nuevo.
  if (pila?.matches(':popover-open')) { pila.hidePopover(); pila.showPopover(); }
  anim.modalEntra(panel);
  return { cerrar, dialogo };
}

/** Confirmación con promesa: resuelve true si el usuario acepta. */
export function confirmar({ titulo, mensaje, textoAceptar = 'Confirmar', peligro = false, detalle }) {
  return new Promise((resolver) => {
    let resultado = false;
    abrirModal({
      titulo,
      ancho: 'angosto',
      contenido: h('div', {}, typeof mensaje === 'string' ? h('p', { class: 'modal-texto' }, mensaje) : mensaje, detalle),
      acciones: [
        ({ cerrar }) => h('button', { class: 'btn btn-outline', type: 'button', onclick: () => cerrar() }, 'Cancelar'),
        ({ cerrar }) => h('button', { class: `btn ${peligro ? 'btn-peligro' : 'btn-primary'}`, type: 'button', autofocus: true, onclick: () => { resultado = true; cerrar(); } }, textoAceptar),
      ],
      alCerrar: () => resolver(resultado),
    });
  });
}
