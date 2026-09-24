// Estado de la aplicación: usuario con sesión, catálogos y un bus de
// eventos sencillo entre vistas. La sesión se guarda en sessionStorage
// (solo esta pestaña) para no perderla al recargar o al dar permiso a la
// cámara; el token real se vuelve a validar con GET /me al arrancar.
import { api } from './api/contratos.js';
import { apiAmb } from './api/ambientes.js';
import { usarToken, usarTokenAmbientes } from './api/cliente.js';

const CLAVE_SESION = 'sena-ambientes.sesion';
const oyentes = new Map();

export const estado = {
  usuario: null,
  // Usuario de la sesión simulada de asistencia (js/api/mock): sus ids son
  // los que entienden los módulos de clases, semáforo y P004. null si no hay.
  usuarioAsistencia: null,
  catalogos: null,
  // Último QR generado en esta pestaña: en modo demostración el aprendiz
  // puede "escanearlo" sin cámara.
  ultimoQr: null,
};

export function emitir(evento, datos) {
  (oyentes.get(evento) || []).forEach((fn) => fn(datos));
}

export function escuchar(evento, fn) {
  if (!oyentes.has(evento)) oyentes.set(evento, new Set());
  oyentes.get(evento).add(fn);
  return () => oyentes.get(evento).delete(fn);
}

function guardar(sesion) {
  try {
    if (sesion) sessionStorage.setItem(CLAVE_SESION, JSON.stringify(sesion));
    else sessionStorage.removeItem(CLAVE_SESION);
  } catch { /* sin almacenamiento: la sesión vive solo en memoria */ }
}

/**
 * @param {{token:string, usuario:object, tokenMock?:string|null, usuarioMock?:object|null}} sesion
 *   token/usuario: backend real; tokenMock/usuarioMock: servidor simulado de asistencia (opcional).
 */
export function iniciarSesion({ token, usuario, tokenMock = null, usuarioMock = null }) {
  usarTokenAmbientes(token);
  usarToken(tokenMock);
  estado.usuario = usuario;
  estado.usuarioAsistencia = tokenMock ? usuarioMock : null;
  guardar({ token, usuario, tokenMock, usuarioMock: estado.usuarioAsistencia });
  emitir('sesion', usuario);
}

/** Restaura la sesión guardada si el backend la sigue aceptando. */
export async function restaurarSesion() {
  let sesion = null;
  try { sesion = JSON.parse(sessionStorage.getItem(CLAVE_SESION)); } catch { /* nada guardado */ }
  if (!sesion?.token) return false;
  usarTokenAmbientes(sesion.token);
  usarToken(sesion.tokenMock);
  estado.usuarioAsistencia = sesion.tokenMock ? sesion.usuarioMock || null : null;
  try {
    estado.usuario = await apiAmb.yo();
    guardar({ ...sesion, usuario: estado.usuario });
    return true;
  } catch {
    usarTokenAmbientes(null);
    usarToken(null);
    guardar(null);
    return false;
  }
}

export function actualizarUsuario(usuario) {
  estado.usuario = usuario;
  try {
    const s = JSON.parse(sessionStorage.getItem(CLAVE_SESION));
    if (s) guardar({ ...s, usuario });
  } catch { /* sin almacenamiento */ }
  emitir('usuario', usuario);
}

// Lo registra main.js: la animación de salida corre mientras se avisa al servidor.
let antesDeSalir = null;
export function alCerrarSesion(fn) { antesDeSalir = fn; }

/** avisarServidor=false cuando la sesión ya venció (sin animación ni logout remoto). */
export async function cerrarSesion({ avisarServidor = true } = {}) {
  if (avisarServidor) {
    await Promise.allSettled([apiAmb.logout(), api.logout(), antesDeSalir?.()]);
  }
  usarTokenAmbientes(null);
  usarToken(null);
  estado.usuario = null;
  estado.usuarioAsistencia = null;
  estado.catalogos = null;
  guardar(null);
  emitir('sesion', null);
}

export async function catalogos() {
  estado.catalogos ||= await api.catalogos();
  return estado.catalogos;
}

/**
 * Usuario para los módulos de asistencia (datos simulados). Sin sesión de
 * asistencia lanza un error con origen 'asistencia' para que la vista
 * muestre "No hay asistencias registradas" en lugar de un error técnico.
 */
export function usuarioAsistencia() {
  if (!estado.usuarioAsistencia) {
    const e = new Error('No hay asistencias registradas por el momento.');
    e.origen = 'asistencia';
    e.codigo = 'SIN_ASISTENCIA';
    throw e;
  }
  return { ...estado.usuarioAsistencia, nombre: estado.usuario?.nombre || estado.usuarioAsistencia.nombre };
}
