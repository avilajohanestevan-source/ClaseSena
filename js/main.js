// Arranque: menú lateral por rol, barra superior con notificaciones y
// enrutador por hash (#/ruta?param=x). Cada vista exporta
// render(raiz, { params, alSalir }); alSalir registra lo que hay que
// detener al cambiar de vista (cámaras, intervalos).
import { h, vaciar } from './ui/dom.js';
import { anim } from './ui/anim.js';
import { toast } from './ui/avisos.js';
import { tarjetaError, cargando } from './ui/componentes.js';
import { crearShell } from './ui/drawer.js';
import { crearBandeja } from './ui/bandeja.js';
import { aplicarPreferencias, movimientoReducido } from './ui/preferencias.js';
import { estado, escuchar, cerrarSesion, restaurarSesion, alCerrarSesion } from './estado.js';
import { alVencerSesion } from './api/cliente.js';
import { apiAmb } from './api/ambientes.js';
import { ETIQUETA_ROL } from './reglas.js';

const TODOS = ['instructor', 'portero', 'administrativo', 'aprendiz'];
const PERSONAL = ['instructor', 'portero', 'administrativo'];

// grupo: dónde aparece en el menú (sin grupo = no aparece, p. ej. pantallas de detalle).
// activa: qué ítem del menú se marca cuando la ruta no está en el menú.
const RUTAS = {
  login: { vista: () => import('./vistas/login.js'), publica: true, titulo: 'Ingreso' },
  inicio: { vista: () => import('./vistas/inicio.js'), roles: TODOS, titulo: 'Inicio', icono: 'inicio', grupo: 'general' },
  perfil: { vista: () => import('./vistas/perfil.js'), roles: TODOS, titulo: 'Mi perfil', icono: 'perfil', grupo: 'general' },
  ambientes: { vista: () => import('./vistas/ambientes.js'), roles: TODOS, titulo: 'Ambientes', icono: 'ambiente', grupo: 'ambientes' },
  inspecciones: { vista: () => import('./vistas/inspecciones.js'), roles: PERSONAL, titulo: 'Inspecciones', icono: 'inspeccion', grupo: 'ambientes' },
  inspeccion: { vista: () => import('./vistas/inspeccion.js'), roles: ['portero'], titulo: 'Revisión del ambiente', activa: 'inspecciones' },
  planilla: { vista: () => import('./vistas/planilla.js'), roles: PERSONAL, titulo: 'Planilla de entrega', activa: 'inspecciones' },
  inventario: { vista: () => import('./vistas/inventario.js'), roles: PERSONAL, titulo: 'Inventario', icono: 'caja', grupo: 'ambientes' },
  etiquetas: { vista: () => import('./vistas/etiquetas.js'), roles: PERSONAL, titulo: 'Etiquetas QR', activa: 'inventario' },
  reportes: { vista: () => import('./vistas/reportes.js'), roles: ['administrativo'], titulo: 'Reportes', icono: 'reporte', grupo: 'ambientes' },
  // Asistencia a clases (datos simulados, js/api/mock).
  clases: { vista: () => import('./vistas/instructor.js'), roles: ['instructor'], titulo: 'Asistencia a clases', icono: 'qr', grupo: 'asistencia' },
  asistencia: { vista: () => import('./vistas/aprendiz.js'), roles: ['aprendiz'], titulo: 'Registrar asistencia', icono: 'escanear', grupo: 'asistencia' },
  semaforo: { vista: () => import('./vistas/administrativo.js'), roles: ['administrativo'], titulo: 'Semáforo de faltas', icono: 'alerta', grupo: 'asistencia' },
  p004: { vista: () => import('./vistas/p004.js'), roles: ['administrativo'], titulo: 'Gestión P004', icono: 'archivo', grupo: 'asistencia' },
  historial: { vista: () => import('./vistas/historial.js'), roles: ['instructor', 'administrativo'], titulo: 'Historial de asistencia', icono: 'historial', grupo: 'asistencia' },
  ajustes: { vista: () => import('./vistas/ajustes.js'), roles: TODOS, titulo: 'Ajustes', icono: 'ajustes', grupo: 'cuenta' },
};
const GRUPOS = [
  { clave: 'general', titulo: '' },
  { clave: 'ambientes', titulo: 'Ambientes' },
  { clave: 'asistencia', titulo: 'Asistencia · datos simulados' },
  { clave: 'cuenta', titulo: 'Cuenta' },
];

aplicarPreferencias();

const raiz = h('div', { class: 'content-inner wide' });
const contenido = h('main', { class: 'content', id: 'contenido' }, raiz);
const shell = crearShell({ contenido, alSalir: () => cerrarSesion() });
const bandeja = crearBandeja();
document.getElementById('app').replaceChildren(shell.el);

let limpiezas = [];
let navegacion = 0;
let vieneDeLogin = false;
let vieneDeSalida = false;

// Cierre de sesión con animación (inversa a la del ingreso). El login la completa
// trayendo de vuelta las piezas del fondo (anim.entradaLogin).
alCerrarSesion(async () => {
  vieneDeSalida = true;
  shell.cerrar({ devolverFoco: false });
  await anim.salidaSesion({ contenido, barra: shell.el.querySelector('.barra'), menu: shell.el.querySelector('.drawer') });
});

// Ripple sutil en todos los botones (520 ms, out-cúbico; ver css/movil.css).
document.addEventListener('pointerdown', (e) => {
  const btn = e.target.closest('.btn');
  if (!btn || btn.disabled || movimientoReducido()) return;
  const r = btn.getBoundingClientRect();
  const d = Math.max(r.width, r.height) * 2;
  const onda = h('span', { class: 'ripple', style: { width: `${d}px`, height: `${d}px`, left: `${e.clientX - r.left - d / 2}px`, top: `${e.clientY - r.top - d / 2}px` } });
  btn.append(onda);
  onda.addEventListener('animationend', () => onda.remove());
});

function pintarMenu(u) {
  shell.pintar({
    usuario: u,
    etiquetaRol: ETIQUETA_ROL[u.rol],
    grupos: GRUPOS.map((g) => ({
      ...g,
      items: Object.entries(RUTAS).filter(([, r]) => r.grupo === g.clave && r.roles.includes(u.rol))
        .map(([ruta, r]) => ({ ruta, etiqueta: r.titulo, icono: r.icono })),
    })).filter((g) => g.items.length),
  });
  shell.campana.replaceChildren(u.rol === 'aprendiz' ? '' : bandeja.el);
}

/** Insignia de Inspecciones: entregas esperando al instructor (portero y administrativo). */
async function actualizarInsignias() {
  const u = estado.usuario;
  if (!u || u.rol === 'aprendiz' || u.rol === 'instructor') return;
  try {
    const n = (await apiAmb.inspecciones({ estado: 'pendiente_recepcion', asignados: u.rol === 'portero' ? 1 : undefined })).length;
    shell.insignia('inspecciones', n, 'esperando al instructor');
  } catch { /* la insignia es informativa */ }
}
escuchar('bandeja', actualizarInsignias);
escuchar('inspecciones', actualizarInsignias);

async function navegar() {
  const id = ++navegacion;
  limpiezas.forEach((fn) => { try { fn(); } catch { /* nada que limpiar */ } });
  limpiezas = [];

  const [ruta, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const u = estado.usuario;
  let clave = RUTAS[ruta] ? ruta : '';
  if (!u) {
    clave = 'login';
    if (ruta !== 'login') history.replaceState(null, '', '#/login');
  } else if (!clave || clave === 'login' || !RUTAS[clave].roles.includes(u.rol)) {
    if (clave && clave !== 'login') toast('aviso', 'Sin acceso', 'Esa sección no está disponible para tu rol.');
    location.replace('#/inicio');
    return;
  }

  const r = RUTAS[clave];
  document.body.dataset.vista = clave;
  document.title = `${r.titulo} · Ambientes SENA`;
  if (u) {
    shell.activar(r.activa || clave, r.titulo);
    if (vieneDeLogin) {
      vieneDeLogin = false;
      anim.entrarShell(shell.el.querySelector('.barra'), shell.el.querySelector('.drawer'));
    }
  }
  vaciar(raiz, cargando());
  try {
    const modulo = await r.vista();
    if (id !== navegacion) return;
    // Contenedor propio por navegación: si el usuario cambia de sección antes de
    // que termine esta vista, lo que siga pintando queda en un nodo ya retirado.
    const vista = h('div', { class: 'vista' });
    vaciar(raiz, vista);
    const desdeSalida = clave === 'login' && vieneDeSalida;
    if (desdeSalida) {
      vieneDeSalida = false;
      anim.limpiar([contenido, shell.el.querySelector('.barra'), shell.el.querySelector('.drawer')]);
    }
    await modulo.render(vista, { params: new URLSearchParams(query), alSalir: (fn) => limpiezas.push(fn), desdeSalida });
    if (desdeSalida) toast('info', 'Sesión cerrada', 'Hasta pronto.');
  } catch (e) {
    console.error(e);
    if (id !== navegacion) return;
    // Solo un 401 del backend real cierra la sesión; los de asistencia (simulada) no.
    if (e.status === 401 && e.origen !== 'asistencia') { await cerrarSesion({ avisarServidor: false }); return; }
    vaciar(raiz, tarjetaError(e, navegar));
  }
  window.scrollTo({ top: 0 });
  if (u) actualizarInsignias();
}

escuchar('sesion', (u) => {
  vieneDeLogin = !!u;
  if (u) {
    pintarMenu(u);
    if (u.rol !== 'aprendiz') bandeja.iniciar();
    toast('exito', `Bienvenido, ${u.nombre.split(' ')[0]}`, `Ingresaste como ${ETIQUETA_ROL[u.rol].toLowerCase()}.`);
  } else {
    bandeja.detener();
  }
  const destino = u ? '#/inicio' : '#/login';
  if (location.hash === destino) navegar(); else location.hash = destino;
});
escuchar('usuario', (u) => pintarMenu(u));

alVencerSesion(() => {
  if (!estado.usuario) return;
  toast('aviso', 'Tu sesión venció', 'Ingresa de nuevo para continuar.');
  cerrarSesion({ avisarServidor: false });
});

window.addEventListener('hashchange', navegar);

// Retoma la sesión de esta pestaña (si el backend aún la acepta) antes de pintar.
if (await restaurarSesion()) {
  pintarMenu(estado.usuario);
  if (estado.usuario.rol !== 'aprendiz') bandeja.iniciar();
}
navegar();
