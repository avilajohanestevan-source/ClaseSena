// Selector desplegable de rol (login). Un botón muestra el rol elegido con
// su ícono; al tocarlo, la lista se despliega con un resorte suave y las
// opciones entran escalonadas. Accesible como listbox: flechas, Inicio/Fin,
// Enter/Espacio para elegir, Escape para cerrar y clic fuera para cerrar.
import { h, icono } from './dom.js';

const DESCRIPCION = {
  instructor: 'Recibe el ambiente con QR',
  portero: 'Revisa y entrega ambientes',
  administrativo: 'Coordinación y reportes',
  aprendiz: 'Registra tu asistencia',
};

/**
 * @param {{opciones:{clave:string, etiqueta:string}[], valor:string, etiqueta?:string, alCambiar?:(v:string)=>void}} p
 * @returns {{el:HTMLElement, boton:HTMLButtonElement, valor:()=>string, fijar:(v:string)=>void}}
 */
export function crearSelectorRol({ opciones, valor, etiqueta = 'Ingresar como', alCambiar }) {
  let actual = valor, activo = 0, abierto = false;
  const idLista = 'rol-lista', idEtiqueta = 'rol-etiqueta';

  const iconoBoton = h('span', { class: 'rol-icono' });
  const textoBoton = h('span', { class: 'rol-texto' });
  const boton = h('button', {
    class: 'rol-boton', type: 'button', id: 'rol-boton',
    'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-controls': idLista, 'aria-labelledby': `${idEtiqueta} rol-boton`,
    onclick: () => (abierto ? cerrar() : abrir()),
    onkeydown: (e) => {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); abrir(); }
    },
  }, iconoBoton, textoBoton, h('span', { class: 'rol-chevron', 'aria-hidden': 'true' }, icono('abajo')));

  const items = opciones.map((o, i) => h('li', {
    class: 'rol-opcion', role: 'option', id: `rol-op-${o.clave}`, 'aria-selected': 'false', style: `--i:${i}`,
    onclick: () => elegir(o.clave),
    onpointermove: () => marcarActivo(i),
  },
    h('span', { class: 'rol-icono' }, icono(o.clave)),
    h('span', { class: 'rol-texto' }, h('strong', {}, o.etiqueta), h('span', {}, DESCRIPCION[o.clave] || '')),
    h('span', { class: 'rol-check', 'aria-hidden': 'true' }, icono('check'))));

  const lista = h('ul', {
    class: 'rol-lista', id: idLista, role: 'listbox', tabindex: '-1', 'aria-labelledby': idEtiqueta,
    onkeydown: teclado,
  }, items);

  const el = h('div', { class: 'rol-selector' },
    h('span', { class: 'rol-etiqueta', id: idEtiqueta }, etiqueta),
    boton,
    h('div', { class: 'rol-panel' }, lista));

  function pintar() {
    const o = opciones.find((x) => x.clave === actual) || opciones[0];
    iconoBoton.replaceChildren(icono(o.clave));
    textoBoton.replaceChildren(h('strong', {}, o.etiqueta), h('span', {}, DESCRIPCION[o.clave] || ''));
    el.dataset.rol = o.clave;
    items.forEach((li, i) => li.setAttribute('aria-selected', String(opciones[i].clave === actual)));
  }

  function marcarActivo(i) {
    activo = (i + items.length) % items.length;
    items.forEach((li, j) => li.classList.toggle('rol-opcion--activa', j === activo));
    lista.setAttribute('aria-activedescendant', items[activo].id);
    items[activo].scrollIntoView?.({ block: 'nearest' });
  }

  function abrir() {
    if (abierto) return;
    abierto = true;
    el.classList.add('rol-selector--abierto');
    boton.setAttribute('aria-expanded', 'true');
    marcarActivo(Math.max(0, opciones.findIndex((o) => o.clave === actual)));
    lista.focus({ preventScroll: true });
    document.addEventListener('pointerdown', fuera, true);
  }

  function cerrar({ devolverFoco = true } = {}) {
    if (!abierto) return;
    abierto = false;
    el.classList.remove('rol-selector--abierto');
    boton.setAttribute('aria-expanded', 'false');
    lista.removeAttribute('aria-activedescendant');
    document.removeEventListener('pointerdown', fuera, true);
    if (devolverFoco) boton.focus({ preventScroll: true });
  }

  function fuera(e) { if (!el.contains(e.target)) cerrar({ devolverFoco: false }); }

  function elegir(clave) {
    const cambio = clave !== actual;
    actual = clave;
    pintar();
    cerrar();
    if (cambio) {
      // Pequeño "pop" del ícono al cambiar de rol.
      iconoBoton.classList.remove('rol-icono--pop');
      void iconoBoton.offsetWidth;
      iconoBoton.classList.add('rol-icono--pop');
      alCambiar?.(clave);
    }
  }

  function teclado(e) {
    const mover = { ArrowDown: activo + 1, ArrowUp: activo - 1, Home: 0, End: items.length - 1 }[e.key];
    if (mover !== undefined) { e.preventDefault(); marcarActivo(mover); return; }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); elegir(opciones[activo].clave); return; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(); return; }
    if (e.key === 'Tab') { cerrar({ devolverFoco: false }); return; }
    // Escribir la primera letra salta al rol (p. ej. "p" → Portero).
    const i = opciones.findIndex((o) => o.etiqueta.toLowerCase().startsWith(e.key.toLowerCase()));
    if (e.key.length === 1 && i >= 0) marcarActivo(i);
  }

  pintar();
  return { el, boton, valor: () => actual, fijar: (v) => { actual = v; pintar(); } };
}
