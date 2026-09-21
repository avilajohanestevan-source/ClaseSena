// Estado de la aplicación en memoria (sin persistencia): usuario con
// sesión, catálogos y un bus de eventos sencillo entre vistas.
import { api } from './api/contratos.js';
import { usarToken } from './api/cliente.js';

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

export function iniciarSesion({ token, usuario }) {
  usarToken(token);
  estado.usuario = usuario;
  emitir('sesion', usuario);
}

export async function cerrarSesion() {
  try { await api.logout(); } catch { /* el cierre local basta */ }
  usarToken(null);
  estado.usuario = null;
  emitir('sesion', null);
}

export async function catalogos() {
  estado.catalogos ||= await api.catalogos();
  return estado.catalogos;
}
