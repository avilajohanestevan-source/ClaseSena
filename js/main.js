// Arranque: cabecera, menú por rol y enrutador por hash (#/ruta?param=x).
// Cada vista exporta render(raiz, { params, alSalir }); alSalir registra
// lo que hay que detener al cambiar de vista (cámaras, intervalos).
import { h, icono, vaciar } from './ui/dom.js';
import { anim } from './ui/anim.js';
import { toast } from './ui/avisos.js';
import { tarjetaError, cargando } from './ui/componentes.js';
import { estado, escuchar, cerrarSesion } from './estado.js';
import { CONFIG } from './config.js';
import { api } from './api/contratos.js';

const RUTAS = {
  login: { vista: () => import('./vistas/login.js'), publica: true },
  instructor: { vista: () => import('./vistas/instructor.js'), roles: ['instructor'], titulo: 'Mis clases', corto: 'Clases', icono: 'qr' },
  admin: { vista: () => import('./vistas/administrativo.js'), roles: ['administrativo'], titulo: 'Panel', icono: 'inicio' },
  p004: { vista: () => import('./vistas/p004.js'), roles: ['administrativo'], titulo: 'Gestión P004', corto: 'P004', icono: 'archivo' },
  aprendiz: { vista: () => import('./vistas/aprendiz.js'), roles: ['aprendiz'], titulo: 'Registrar asistencia', corto: 'Asistencia', icono: 'escanear' },
  inventario: { vista: () => import('./vistas/inventario.js'), roles: ['instructor', 'administrativo'], titulo: 'Inventario', icono: 'caja' },
  danos: { vista: () => import('./vistas/danos.js'), roles: ['instructor', 'administrativo'], titulo: 'Reportar daño', corto: 'Daños', icono: 'herramienta' },
  historial: { vista: () => import('./vistas/historial.js'), roles: ['instructor', 'administrativo'], titulo: 'Historial', icono: 'historial' },
};
// `corto` es la etiqueta de la barra de navegación inferior en móvil.
const INICIO = { instructor: 'instructor', administrativo: 'admin', aprendiz: 'aprendiz' };
const ETIQUETA_ROL = { instructor: 'Instructor', administrativo: 'Administrativo', aprendiz: 'Aprendiz' };

const app = document.getElementById('app');
const cabecera = h('header', { class: 'site-header' });
const principal = h('main', { class: 'content' });
const raiz = h('div', { class: 'content-inner wide' });
principal.append(raiz);
app.replaceChildren(cabecera, principal);

let limpiezas = [];
let navegacion = 0;
let insigniaNotis = null;
let vieneDeLogin = false;

// Ripple sutil en todos los botones (520 ms, out-cúbico; ver css/movil.css).
document.addEventListener('pointerdown', (e) => {
  const btn = e.target.closest('.btn');
  if (!btn || btn.disabled || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const r = btn.getBoundingClientRect();
  const d = Math.max(r.width, r.height) * 2;
  const onda = h('span', { class: 'ripple', style: { width: `${d}px`, height: `${d}px`, left: `${e.clientX - r.left - d / 2}px`, top: `${e.clientY - r.top - d / 2}px` } });
  btn.append(onda);
  onda.addEventListener('animationend', () => onda.remove());
});

function pintarCabecera(ruta) {
  const u = estado.usuario;
  insigniaNotis = h('span', { class: 'insignia', hidden: true });
  vaciar(cabecera,
    h('div', { class: 'topbar' },
      h('div', { class: 'brand' },
        h('img', { class: 'brand-logo', src: 'img/sena-logo-verde.png', alt: 'SENA' }),
        h('div', { class: 'brand-divider' }),
        h('div', { class: 'brand-text' }, h('span', { class: 'eyebrow' }, 'Centro de formación'), h('h1', {}, 'Asistencia y ambientes'))),
      h('div', { class: 'topbar-derecha' },
        CONFIG.usarMock && h('span', { class: 'pill total', title: 'Las respuestas vienen del servidor simulado (js/api/mock)' }, h('span', { class: 'dot' }), h('span', { class: 'pill-texto' }, 'Datos simulados')),
        u && u.rol === 'administrativo' && h('a', { class: 'campana', href: '#/admin', 'aria-label': 'Notificaciones' }, icono('campana'), insigniaNotis),
        u && h('div', { class: 'sesion' },
          h('div', { class: 'sesion-datos' }, h('span', { class: 'sesion-nombre' }, u.nombre), h('span', { class: 'sesion-punto' }, ETIQUETA_ROL[u.rol])),
          h('button', { class: 'sesion-salir', type: 'button', 'aria-label': 'Salir', onclick: () => cerrarSesion() }, icono('salir'), h('span', { class: 'sesion-salir-texto' }, 'Salir'))))),
    // En móvil esta barra se fija abajo (navegación inferior); en escritorio va bajo la cabecera.
    u && h('nav', { class: 'tabs', 'aria-label': 'Secciones' },
      Object.entries(RUTAS).filter(([, r]) => r.roles?.includes(u.rol)).map(([clave, r]) =>
        h('a', { class: `tab-btn${clave === ruta ? ' active' : ''}`, href: `#/${clave}`, 'aria-label': r.titulo, 'aria-current': clave === ruta ? 'page' : false },
          h('span', { class: 'tab-icono-caja' }, icono(r.icono, 'icon tab-icono')),
          h('span', { class: 'tab-texto' }, r.titulo),
          h('span', { class: 'tab-texto-corto', 'aria-hidden': 'true' }, r.corto || r.titulo)))));
  if (u?.rol === 'administrativo') actualizarInsignia();
}

async function actualizarInsignia(cantidad) {
  if (!insigniaNotis) return;
  if (cantidad === undefined) {
    try { cantidad = (await api.notificaciones()).filter((n) => !n.leida).length; } catch { return; }
  }
  const antes = insigniaNotis.textContent;
  insigniaNotis.textContent = cantidad;
  insigniaNotis.hidden = !cantidad;
  if (antes && String(cantidad) !== antes) anim.latido(insigniaNotis);
}
escuchar('notificaciones', actualizarInsignia);
setInterval(() => { if (estado.usuario?.rol === 'administrativo') actualizarInsignia(); }, 15_000);

async function navegar() {
  const id = ++navegacion;
  limpiezas.forEach((fn) => { try { fn(); } catch { /* nada que limpiar */ } });
  limpiezas = [];

  const [ruta, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const u = estado.usuario;
  let clave = RUTAS[ruta] ? ruta : '';
  if (!u) clave = 'login';
  else if (!clave || clave === 'login' || !RUTAS[clave].roles.includes(u.rol)) {
    if (clave && clave !== 'login') toast('aviso', 'Sin acceso', 'Esa sección no está disponible para tu rol.');
    location.replace(`#/${INICIO[u.rol]}`);
    return;
  }
  if (!u && ruta !== 'login') history.replaceState(null, '', '#/login');

  document.body.dataset.vista = clave;
  pintarCabecera(clave);
  if (vieneDeLogin && clave !== 'login') {
    vieneDeLogin = false;
    anim.entrarShell(cabecera.querySelector('.topbar'), cabecera.querySelector('.tabs'));
  }
  document.title = `${RUTAS[clave].titulo || 'Ingreso'} · Asistencia SENA`;
  vaciar(raiz, cargando());
  try {
    const modulo = await RUTAS[clave].vista();
    if (id !== navegacion) return;
    vaciar(raiz);
    await modulo.render(raiz, { params: new URLSearchParams(query), alSalir: (fn) => limpiezas.push(fn) });
  } catch (e) {
    console.error(e);
    if (id !== navegacion) return;
    if (e.status === 401) { await cerrarSesion(); return; }
    vaciar(raiz, tarjetaError(e, navegar));
  }
  window.scrollTo({ top: 0 });
}

escuchar('sesion', (u) => {
  vieneDeLogin = !!u;
  if (u) toast('exito', `Bienvenido, ${u.nombre.split(' ')[0]}`, `Ingresaste como ${ETIQUETA_ROL[u.rol].toLowerCase()}.`);
  const destino = u ? `#/${INICIO[u.rol]}` : '#/login';
  if (location.hash === destino) navegar(); else location.hash = destino;
});
window.addEventListener('hashchange', navegar);
navegar();
