// Menú lateral izquierdo (drawer), con el comportamiento del prototipo
// (diseno/prototipo.html):
//  · Escritorio (≥ 900 px): persistente a la izquierda (256 px). El botón
//    hamburguesa lo pliega a un riel de íconos (76 px); se recuerda.
//  · Móvil (< 900 px): fuera de pantalla; la hamburguesa de la esquina
//    superior lo abre (min(280px, 86vw), 320 ms out-cúbico) con un velo.
//    También se abre deslizando desde el borde izquierdo y se cierra
//    deslizando a la izquierda, tocando el velo, con Escape o al navegar.
//  · Indicador activo que se desliza hasta la sección actual.
// Accesibilidad: aria-expanded/aria-controls, foco atrapado mientras está
// abierto en móvil, contenido detrás inerte y áreas táctiles de 44 px.
import { h, icono } from './dom.js';

const ESCRITORIO = '(min-width: 900px)';
const CLAVE_RIEL = 'sena-ambientes.menu-plegado';
const BORDE_GESTO = 24;   // px desde el borde izquierdo donde empieza el gesto de abrir
const UMBRAL = 0.35;      // fracción del ancho para decidir abrir/cerrar al soltar

function leerRiel() { try { return localStorage.getItem(CLAVE_RIEL) === '1'; } catch { return false; } }
function guardarRiel(v) { try { localStorage.setItem(CLAVE_RIEL, v ? '1' : '0'); } catch { /* sin almacenamiento */ } }

export function iniciales(nombre = '') {
  return nombre.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
}

/**
 * @param {{contenido:HTMLElement, alSalir:()=>void, alBuscarBandeja?:()=>void}} opciones
 * @returns shell con: el, pintar({usuario, grupos, etiquetaRol}), activar(ruta, titulo), insignia(ruta, n), campana
 */
export function crearShell({ contenido, alSalir }) {
  const mq = window.matchMedia(ESCRITORIO);
  let abierto = false;       // solo aplica en móvil
  let riel = leerRiel();     // solo aplica en escritorio
  let enlaces = new Map();   // ruta → <a>

  /* --- estructura --- */
  const indicador = h('span', { class: 'drawer-indicador', 'aria-hidden': 'true' });
  const nav = h('nav', { class: 'drawer-nav', 'aria-label': 'Secciones' });
  const perfil = h('a', { class: 'drawer-perfil', href: '#/perfil' });
  const salir = h('button', { class: 'drawer-item drawer-salir', type: 'button', onclick: () => alSalir() },
    h('span', { class: 'drawer-icono' }, icono('salir')), h('span', { class: 'drawer-texto' }, 'Cerrar sesión'));
  const cerrarMovil = h('button', { class: 'drawer-cerrar', type: 'button', 'aria-label': 'Cerrar menú', onclick: () => cerrar() }, icono('cerrar'));
  const drawer = h('aside', { class: 'drawer', id: 'menu-lateral', 'aria-label': 'Menú principal' },
    h('div', { class: 'drawer-cabecera' },
      h('img', { class: 'drawer-logo', src: 'img/sena-logo-verde.png', alt: 'SENA' }),
      h('div', { class: 'drawer-marca' }, h('strong', {}, 'Ambientes'), h('span', {}, 'Entrega y revisión')),
      cerrarMovil),
    perfil,
    h('div', { class: 'drawer-scroll' }, nav),
    h('div', { class: 'drawer-pie' }, salir));
  const velo = h('div', { class: 'drawer-velo', 'aria-hidden': 'true', onclick: () => cerrar() });

  const hamburguesa = h('button', {
    class: 'barra-menu', type: 'button', 'aria-controls': 'menu-lateral', 'aria-expanded': 'false', 'aria-label': 'Abrir menú',
    onclick: () => (mq.matches ? alternarRiel() : (abierto ? cerrar() : abrir())),
  }, h('span', { class: 'hamburguesa', 'aria-hidden': 'true' }, h('span'), h('span'), h('span')));
  const titulo = h('h1', { class: 'barra-titulo', tabindex: '-1' }, '');
  const campana = h('div', { class: 'barra-acciones' });
  const barra = h('header', { class: 'barra' }, hamburguesa, titulo, campana);
  const principal = h('div', { class: 'shell-principal' }, barra, contenido);
  const el = h('div', { class: 'shell' }, drawer, velo, principal);

  /* --- estado visual --- */
  function aplicar() {
    const escritorio = mq.matches;
    el.dataset.modo = escritorio ? (riel ? 'riel' : 'fijo') : (abierto ? 'abierto' : 'cerrado');
    hamburguesa.setAttribute('aria-expanded', String(escritorio ? !riel : abierto));
    hamburguesa.setAttribute('aria-label', escritorio ? (riel ? 'Expandir menú' : 'Plegar menú') : (abierto ? 'Cerrar menú' : 'Abrir menú'));
    // En móvil, lo que no está a la vista no debe recibir foco.
    drawer.inert = !escritorio && !abierto;
    principal.inert = !escritorio && abierto;
    document.documentElement.classList.toggle('sin-scroll', !escritorio && abierto);
    // En riel, los textos se ocultan: el nombre accesible va en title/aria-label.
    enlaces.forEach((a) => { if (riel && escritorio) a.title = a.dataset.etiqueta; else a.removeAttribute('title'); });
    requestAnimationFrame(moverIndicador);
  }

  function abrir() {
    if (mq.matches || abierto) return;
    abierto = true;
    aplicar();
    (nav.querySelector('[aria-current="page"]') || nav.querySelector('a'))?.focus({ preventScroll: true });
  }
  function cerrar({ devolverFoco = true } = {}) {
    if (!abierto) return;
    abierto = false;
    aplicar();
    if (devolverFoco) hamburguesa.focus({ preventScroll: true });
  }
  function alternarRiel() { riel = !riel; guardarRiel(riel); aplicar(); }
  mq.addEventListener('change', () => { abierto = false; aplicar(); });

  // Escape cierra y Tab queda dentro del menú mientras está abierto en móvil.
  document.addEventListener('keydown', (e) => {
    if (mq.matches || !abierto) return;
    if (e.key === 'Escape') { e.preventDefault(); cerrar(); return; }
    if (e.key !== 'Tab') return;
    const focos = [...drawer.querySelectorAll('a[href], button:not([disabled])')].filter((x) => x.offsetParent !== null);
    const primero = focos[0], ultimo = focos.at(-1);
    if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
  });

  /* --- gesto de deslizar (solo táctil, móvil) --- */
  let gesto = null;
  document.addEventListener('touchstart', (e) => {
    if (mq.matches || e.touches.length !== 1 || document.body.dataset.vista === 'login') return;
    if (document.querySelector('dialog[open]')) return;
    const t = e.touches[0];
    const desdeBorde = !abierto && t.clientX <= BORDE_GESTO;
    const sobreMenu = abierto && (drawer.contains(e.target) || e.target === velo);
    if (!desdeBorde && !sobreMenu) return;
    gesto = { x0: t.clientX, y0: t.clientY, t0: performance.now(), ancho: drawer.offsetWidth, dx: 0, horizontal: null };
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (!gesto) return;
    const t = e.touches[0];
    const dx = t.clientX - gesto.x0, dy = t.clientY - gesto.y0;
    if (gesto.horizontal === null && Math.abs(dx) + Math.abs(dy) > 8) gesto.horizontal = Math.abs(dx) > Math.abs(dy);
    if (!gesto.horizontal) return;
    gesto.dx = dx;
    const base = abierto ? 0 : -gesto.ancho;
    const x = Math.max(-gesto.ancho, Math.min(0, base + dx));
    el.classList.add('arrastrando');
    drawer.style.transform = `translateX(${x}px)`;
    velo.style.opacity = String(1 + x / gesto.ancho);
  }, { passive: true });
  document.addEventListener('touchend', () => {
    if (!gesto) return;
    const { dx, ancho, t0, horizontal } = gesto;
    gesto = null;
    el.classList.remove('arrastrando');
    drawer.style.transform = '';
    velo.style.opacity = '';
    if (!horizontal) return;
    const velocidad = dx / Math.max(1, performance.now() - t0); // px/ms
    if (!abierto && (dx > ancho * UMBRAL || velocidad > 0.45)) abrir();
    else if (abierto && (-dx > ancho * UMBRAL || velocidad < -0.45)) cerrar({ devolverFoco: false });
  });
  document.addEventListener('touchcancel', () => {
    gesto = null; el.classList.remove('arrastrando'); drawer.style.transform = ''; velo.style.opacity = '';
  });

  /* --- indicador activo --- */
  function moverIndicador() {
    const activo = nav.querySelector('[aria-current="page"]');
    if (!activo) { indicador.style.opacity = '0'; return; }
    indicador.style.opacity = '1';
    indicador.style.transform = `translateY(${activo.offsetTop}px)`;
    indicador.style.height = `${activo.offsetHeight}px`;
  }

  /* --- API --- */
  function pintar({ usuario, grupos, etiquetaRol }) {
    perfil.replaceChildren(
      h('span', { class: 'avatar-iniciales', 'aria-hidden': 'true' }, iniciales(usuario.nombre)),
      h('span', { class: 'drawer-perfil-datos' }, h('strong', {}, usuario.nombre), h('span', {}, etiquetaRol)));
    perfil.setAttribute('aria-label', `Mi perfil: ${usuario.nombre}, ${etiquetaRol}`);
    enlaces = new Map();
    nav.replaceChildren(indicador, ...grupos.flatMap((g) => [
      g.titulo && h('p', { class: 'drawer-grupo', id: `grupo-${g.clave}` }, g.titulo),
      h('ul', { class: 'drawer-lista', 'aria-labelledby': g.titulo ? `grupo-${g.clave}` : false }, g.items.map((it) => {
        const a = h('a', { class: 'drawer-item', href: `#/${it.ruta}`, 'data-etiqueta': it.etiqueta, onclick: () => { if (!mq.matches) cerrar({ devolverFoco: false }); } },
          h('span', { class: 'drawer-icono' }, icono(it.icono)),
          h('span', { class: 'drawer-texto' }, it.etiqueta),
          h('span', { class: 'drawer-insignia', hidden: true }));
        enlaces.set(it.ruta, a);
        return h('li', {}, a);
      })),
    ].filter(Boolean)));
    aplicar();
  }

  function activar(ruta, textoTitulo) {
    enlaces.forEach((a, r) => {
      if (r === ruta) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    titulo.textContent = textoTitulo;
    requestAnimationFrame(moverIndicador);
  }

  function insignia(ruta, n, etiqueta = '') {
    const a = enlaces.get(ruta);
    if (!a) return;
    const b = a.querySelector('.drawer-insignia');
    b.textContent = n > 99 ? '99+' : String(n);
    b.hidden = !n;
    b.setAttribute('aria-label', n ? `${n} ${etiqueta}` : '');
  }

  aplicar();
  return { el, pintar, activar, insignia, campana, titulo, cerrar };
}
