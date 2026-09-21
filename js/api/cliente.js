// Cliente HTTP único: agrega el token, normaliza errores y, en modo mock,
// desvía las peticiones al servidor simulado con una latencia aleatoria.
import { CONFIG } from '../config.js';
import { responder } from './mock/servidor.js';

export class ErrorApi extends Error {
  constructor(status, mensaje, codigo) {
    super(mensaje);
    this.status = status;
    this.codigo = codigo;
  }
}

let token = null;
export function usarToken(nuevo) { token = nuevo; }

export async function pedir(metodo, ruta, datos) {
  const conQuery = metodo === 'GET' && datos;
  if (CONFIG.usarMock) {
    const [min, max] = CONFIG.latenciaMock;
    await new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));
    const { status, cuerpo } = responder({ metodo, ruta, query: conQuery ? datos : {}, cuerpo: conQuery ? null : datos, token });
    if (status >= 400) throw new ErrorApi(status, cuerpo.mensaje, cuerpo.codigo);
    return structuredClone(cuerpo);
  }

  let url = CONFIG.apiBase + ruta;
  if (conQuery) {
    const q = new URLSearchParams(Object.entries(datos).filter(([, v]) => v !== undefined && v !== ''));
    if ([...q].length) url += '?' + q;
  }
  let resp;
  try {
    resp = await fetch(url, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: conQuery || datos === undefined ? undefined : JSON.stringify(datos),
    });
  } catch {
    throw new ErrorApi(0, 'No hay conexión con el servidor. Revisa tu red e inténtalo de nuevo.', 'SIN_CONEXION');
  }
  const cuerpo = resp.status === 204 ? null : await resp.json().catch(() => null);
  if (!resp.ok) throw new ErrorApi(resp.status, cuerpo?.mensaje || `Error ${resp.status}`, cuerpo?.codigo);
  return cuerpo;
}
