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
 * @param {{token:string, usuario:object, tokenMock?:string|null}} sesion
 *   token: backend real; tokenMock: servidor simulado de asistencia (opcional).
 */
export function iniciarSesion({ token, usuario, tokenMock = null }) {
  usarTokenAmbientes(token);
  usarToken(tokenMock);
  estado.usuario = usuario;
  guardar({ token, usuario, tokenMock });
  emitir('sesion', usuario);
}

/** Restaura la sesión guardada si el backend la sigue aceptando. */
export async function restaurarSesion() {
  let sesion = null;
  try { sesion = JSON.parse(sessionStorage.getItem(CLAVE_SESION)); } catch { /* nada guardado */ }
  if (!sesion?.token) return false;
  usarTokenAmbientes(sesion.token);
  usarToken(sesion.tokenMock);
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

export async function cerrarSesion({ avisarServidor = true } = {}) {
  if (avisarServidor) {
    await Promise.allSettled([apiAmb.logout(), api.logout()]);
  }
  usarTokenAmbientes(null);
  usarToken(null);
  estado.usuario = null;
  estado.catalogos = null;
  guardar(null);
  emitir('sesion', null);
}

export async function catalogos() {
  estado.catalogos ||= await api.catalogos();
  return estado.catalogos;
}
