// Cliente HTTP. Hay dos backends:
//  · pedirAmbientes → API real en PHP/MySQL (api/index.php): ambientes,
//    inventario, inspecciones, notificaciones, perfil y login.
//  · pedir → módulos de asistencia; en modo mock las peticiones van al
//    servidor simulado con una latencia aleatoria.
// Ambos agregan su token y normalizan los errores como ErrorApi.
import { CONFIG } from '../config.js';
import { responder } from './mock/servidor.js';

export class ErrorApi extends Error {
  constructor(status, mensaje, codigo, origen = 'ambientes') {
    super(mensaje);
    this.status = status;
    this.codigo = codigo;
    // 'ambientes' (backend real) o 'asistencia' (módulo simulado): un 401 de
    // asistencia no debe cerrar la sesión real.
    this.origen = origen;
  }
}

let token = null;          // sesión del servidor simulado (asistencia)
let tokenAmbientes = null; // sesión del backend real
export function usarToken(nuevo) { token = nuevo; }
export function usarTokenAmbientes(nuevo) { tokenAmbientes = nuevo; }

// Se avisa cuando el backend real responde 401 (sesión vencida).
let alVencer = null;
export function alVencerSesion(fn) { alVencer = fn; }

async function porFetch(base, metodo, ruta, datos, tokenUsado) {
  const conQuery = metodo === 'GET' && datos;
  let url = base + ruta;
  if (conQuery) {
    const q = new URLSearchParams(Object.entries(datos).filter(([, v]) => v !== undefined && v !== null && v !== ''));
    if ([...q].length) url += '?' + q;
  }
  let resp;
  try {
    resp = await fetch(url, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', ...(tokenUsado ? { Authorization: `Bearer ${tokenUsado}` } : {}) },
      body: conQuery || datos === undefined ? undefined : JSON.stringify(datos),
    });
  } catch {
    throw new ErrorApi(0, 'No hay conexión con el servidor. Revisa tu red e inténtalo de nuevo.', 'SIN_CONEXION');
  }
  const cuerpo = resp.status === 204 ? null : await resp.json().catch(() => null);
  if (!resp.ok) throw new ErrorApi(resp.status, cuerpo?.mensaje || `Error ${resp.status}`, cuerpo?.codigo);
  return cuerpo;
}

export async function pedirAmbientes(metodo, ruta, datos) {
  try {
    return await porFetch(CONFIG.apiAmbientes, metodo, ruta, datos, tokenAmbientes);
  } catch (e) {
    if (e.status === 401 && tokenAmbientes && ruta !== '/auth/login') alVencer?.();
    throw e;
  }
}

export async function pedir(metodo, ruta, datos) {
  const conQuery = metodo === 'GET' && datos;
  if (CONFIG.usarMock) {
    const [min, max] = CONFIG.latenciaMock;
    await new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));
    const { status, cuerpo } = responder({ metodo, ruta, query: conQuery ? datos : {}, cuerpo: conQuery ? null : datos, token });
    if (status >= 400) throw new ErrorApi(status, cuerpo.mensaje, cuerpo.codigo, 'asistencia');
    return structuredClone(cuerpo);
  }
  try {
    return await porFetch(CONFIG.apiBase, metodo, ruta, datos, token);
  } catch (e) {
    e.origen = 'asistencia';
    throw e;
  }
}
