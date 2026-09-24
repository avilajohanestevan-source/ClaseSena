// Reglas de negocio del front: funciones puras (sin DOM ni red) para que
// se puedan probar con `npm test` y reutilizar en las vistas y los mocks.
import { CONFIG, UMBRALES_SEMAFORO } from './config.js';

export const ROLES = [
  { clave: 'instructor', etiqueta: 'Instructor' },
  { clave: 'portero', etiqueta: 'Portero' },
  { clave: 'administrativo', etiqueta: 'Administrativo' },
  { clave: 'aprendiz', etiqueta: 'Aprendiz' },
];

/* ---------------- login ---------------- */

export function validarLogin({ identificacion, password, rol }) {
  const errores = {};
  const id = String(identificacion ?? '').trim();
  if (!id) errores.identificacion = 'Escribe tu número de identificación.';
  else if (!/^\d{6,12}$/.test(id)) errores.identificacion = 'La identificación debe tener entre 6 y 12 dígitos, sin puntos ni espacios.';
  if (!password) errores.password = 'Escribe tu contraseña.';
  else if (String(password).length < 6) errores.password = 'La contraseña tiene al menos 6 caracteres.';
  if (!ROLES.some((r) => r.clave === rol)) errores.rol = 'Selecciona con qué rol vas a entrar.';
  return errores;
}

/* ---------------- ventana horaria ---------------- */

/**
 * Estado de la ventana de registro de una sesión.
 * @param {{startTime:string, ventanaMin?:number, cancelada?:boolean}} sesion
 * @param {number} ahora  epoch en ms
 * @returns {{estado:'cancelada'|'pendiente'|'abierta'|'cerrada', inicio:number, cierre:number, restanteMs:number}}
 */
export function estadoVentana(sesion, ahora = Date.now()) {
  const inicio = new Date(sesion.startTime).getTime();
  const cierre = inicio + (sesion.ventanaMin ?? CONFIG.ventanaPorDefectoMin) * 60_000;
  let estado;
  if (sesion.cancelada) estado = 'cancelada';
  else if (ahora < inicio) estado = 'pendiente';
  else if (ahora > cierre) estado = 'cerrada';
  else estado = 'abierta';
  const restanteMs = estado === 'pendiente' ? inicio - ahora : estado === 'abierta' ? cierre - ahora : 0;
  return { estado, inicio, cierre, restanteMs };
}

export function formatearDuracion(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const dos = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${dos(m)}:${dos(s)}` : `${dos(m)}:${dos(s)}`;
}

/* ---------------- QR de sesión ---------------- */

export const PREFIJO_QR = 'SENA-ASIS';

/** Texto que va dentro del QR: prefijo + JSON con sessionId, startTime y expiryTime. */
export function codificarQr(payload) {
  return `${PREFIJO_QR}:${JSON.stringify(payload)}`;
}

/**
 * Lee el texto de un QR escaneado. Devuelve { ok, payload } o { ok:false, motivo }.
 */
export function leerQr(texto) {
  const crudo = String(texto ?? '').trim();
  if (!crudo.startsWith(PREFIJO_QR + ':')) return { ok: false, motivo: 'El código no es un QR de asistencia SENA.' };
  let payload;
  try { payload = JSON.parse(crudo.slice(PREFIJO_QR.length + 1)); } catch { return { ok: false, motivo: 'El QR está dañado o incompleto.' }; }
  for (const campo of ['sessionId', 'startTime', 'expiryTime']) {
    if (!payload || !payload[campo]) return { ok: false, motivo: `Al QR le falta el campo ${campo}.` };
  }
  if (Number.isNaN(Date.parse(payload.startTime)) || Number.isNaN(Date.parse(payload.expiryTime))) {
    return { ok: false, motivo: 'Las fechas del QR no son válidas.' };
  }
  return { ok: true, payload };
}

/**
 * Validación previa al envío (el backend repite todo). Devuelve null si se
 * puede enviar o el motivo del rechazo.
 */
export function prevalidarEscaneo(payload, sesion, ahora = Date.now()) {
  if (sesion && payload.sessionId !== sesion.id) return 'El QR pertenece a otra clase.';
  if (ahora > Date.parse(payload.expiryTime)) return 'El QR ya venció. Pide al instructor que lo muestre de nuevo.';
  if (sesion) {
    const v = estadoVentana(sesion, ahora);
    if (v.estado === 'cancelada') return 'La clase fue cancelada.';
    if (v.estado === 'pendiente') return 'La ventana de registro aún no abre.';
    if (v.estado === 'cerrada') return 'Fuera de ventana: el tiempo de registro ya terminó.';
  }
  return null;
}

/* ---------------- semáforo de faltas ---------------- */

export const NIVELES_SEMAFORO = [
  { clave: 'verde', etiqueta: 'Al día' },
  { clave: 'amarillo', etiqueta: 'En observación' },
  { clave: 'naranja', etiqueta: 'Alerta' },
  { clave: 'rojo-claro', etiqueta: 'Riesgo alto' },
  { clave: 'rojo', etiqueta: 'Riesgo de deserción' },
];

function nivelPor(valor, minimos) {
  let nivel = 0;
  minimos.forEach((min, i) => { if (valor >= min) nivel = i + 1; });
  return nivel;
}

/**
 * Color del semáforo a partir de lo que envía la API.
 * @param {{faltasConsecutivas:number, faltasTotales:number}} datos
 */
export function calcularSemaforo({ faltasConsecutivas = 0, faltasTotales = 0 }, umbrales = UMBRALES_SEMAFORO) {
  const porConsecutivas = nivelPor(faltasConsecutivas, umbrales.consecutivas);
  const porTotales = nivelPor(faltasTotales, umbrales.totales);
  const nivel = Math.max(porConsecutivas, porTotales);
  const motivo = nivel === 0 ? 'Sin faltas relevantes'
    : porConsecutivas >= porTotales ? `${faltasConsecutivas} faltas consecutivas` : `${faltasTotales} faltas en total`;
  return { nivel, ...NIVELES_SEMAFORO[nivel], motivo, faltasConsecutivas, faltasTotales };
}

/* ---------------- P004 (novedades de aprendices) ---------------- */

export const ESTADOS_P004 = [
  'EN FORMACION', 'CONDICIONADO', 'APLAZADO', 'TRASLADADO',
  'RETIRO VOLUNTARIO', 'CANCELADO', 'POR CERTIFICAR', 'CERTIFICADO',
];
export const CAMPOS_P004 = ['documento', 'nombre', 'ficha', 'programa', 'estado'];

/** CSV sencillo con comillas; detecta separador "," o ";". Devuelve objetos por encabezado. */
export function parsearCsv(texto) {
  const limpio = String(texto).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!limpio) return [];
  const primera = limpio.split('\n', 1)[0];
  const sep = (primera.match(/;/g) || []).length > (primera.match(/,/g) || []).length ? ';' : ',';
  const filas = [];
  let fila = [], celda = '', comillas = false;
  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i];
    if (comillas) {
      if (c === '"' && limpio[i + 1] === '"') { celda += '"'; i++; }
      else if (c === '"') comillas = false;
      else celda += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) { fila.push(celda); celda = ''; }
    else if (c === '\n') { fila.push(celda); filas.push(fila); fila = []; celda = ''; }
    else celda += c;
  }
  fila.push(celda); filas.push(fila);
  const encabezados = filas.shift().map((e) => normalizarClave(e));
  return filas
    .filter((f) => f.some((v) => v.trim() !== ''))
    .map((f) => Object.fromEntries(encabezados.map((e, i) => [e, (f[i] ?? '').trim()])));
}

function normalizarClave(texto) {
  return String(texto).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '_');
}

/** Valida los registros importados. Devuelve los válidos (normalizados) y los errores por fila. */
export function validarRegistrosP004(registros) {
  const validos = [];
  const errores = [];
  const vistos = new Set();
  registros.forEach((r, i) => {
    const fila = i + 2; // fila 1 = encabezados en el CSV
    const d = Object.fromEntries(Object.entries(r).map(([k, v]) => [normalizarClave(k), String(v ?? '').trim()]));
    const problemas = [];
    for (const campo of CAMPOS_P004) if (!d[campo]) problemas.push(`falta "${campo}"`);
    if (d.documento && !/^\d{6,12}$/.test(d.documento)) problemas.push('documento con formato inválido');
    if (d.ficha && !/^\d{5,8}$/.test(d.ficha)) problemas.push('ficha con formato inválido');
    const estado = d.estado?.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (d.estado && !ESTADOS_P004.includes(estado)) problemas.push(`estado "${d.estado}" no reconocido`);
    if (d.documento && vistos.has(d.documento)) problemas.push('documento repetido en el archivo');
    if (problemas.length) { errores.push({ fila, documento: d.documento || '—', mensaje: problemas.join(', ') }); return; }
    vistos.add(d.documento);
    validos.push({ documento: d.documento, nombre: d.nombre, ficha: d.ficha, programa: d.programa, estado });
  });
  return { validos, errores };
}

/* ---------------- reporte de daños ---------------- */

export const PRIORIDADES = [
  { clave: 'leve', etiqueta: 'Leve' },
  { clave: 'moderada', etiqueta: 'Moderada' },
  { clave: 'grave', etiqueta: 'Grave' },
];

/* ---------------- utilidades de fechas ---------------- */

export function mismoDia(a, b) {
  const x = new Date(a), y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

/** yyyy-mm-dd en hora local (para inputs type=date). */
export function fechaIso(fecha = new Date()) {
  const d = new Date(fecha);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function enRango(fecha, desde, hasta) {
  const dia = fechaIso(fecha);
  return (!desde || dia >= desde) && (!hasta || dia <= hasta);
}

/* ---------------- inspección de ambientes ---------------- */

export const TIPOS_DANO = [
  { clave: 'rotura', etiqueta: 'Rotura o golpe' },
  { clave: 'no_funciona', etiqueta: 'No funciona' },
  { clave: 'faltante', etiqueta: 'Faltante' },
  { clave: 'suciedad', etiqueta: 'Suciedad o desgaste' },
  { clave: 'otro', etiqueta: 'Otro' },
];

/** [etiqueta, clase de .status-chip] por estado de la inspección. */
export const ESTADOS_INSPECCION = {
  en_curso: ['En curso', 'azul'],
  pendiente_recepcion: ['Pendiente de recepción', 'out'],
  recibida: ['Recibida', 'in'],
  cancelada: ['Cancelada', 'neutro'],
};

export const ESTADOS_ITEM = {
  operativo: ['Operativo', 'in'],
  danado: ['Dañado', 'error'],
  en_reparacion: ['En reparación', 'out'],
  baja: ['De baja', 'neutro'],
};

export const PREFIJO_QR_ITEM = 'SENA-INV:';
export const PREFIJO_QR_INSPECCION = 'SENA-INSP:';

/** Código de ítem a partir del QR de la etiqueta ("SENA-INV:AMB107-003") o del código escrito. */
export function leerQrItem(texto) {
  const t = String(texto ?? '').trim().toUpperCase();
  const m = t.match(/^SENA-INV:([A-Z0-9-]{3,30})$/) || t.match(/^(AMB[A-Z0-9]+-\d{3,})$/);
  return m ? m[1] : null;
}

/** Token de la inspección a partir de su QR ("SENA-INSP:<16 caracteres>"). */
export function leerQrInspeccion(texto) {
  const m = String(texto ?? '').trim().toUpperCase().match(/^SENA-INSP:([A-Z0-9]{16})$/);
  return m ? m[1] : null;
}

/** Mismas reglas que el backend (api/modulos/inspecciones.php → rutaReportarDano). */
export function validarReporteDano({ itemId, tipoDano, severidad, comentario, foto }) {
  const errores = {};
  if (!itemId) errores.itemId = 'Escanea o elige el ítem dañado.';
  if (!TIPOS_DANO.some((t) => t.clave === tipoDano)) errores.tipoDano = 'Elige el tipo de daño.';
  if (!PRIORIDADES.some((p) => p.clave === severidad)) errores.severidad = 'Elige la severidad.';
  const texto = String(comentario ?? '').trim();
  if (texto.length < 10) errores.comentario = 'Describe el daño con al menos 10 caracteres.';
  else if (texto.length > 500) errores.comentario = 'El comentario admite máximo 500 caracteres.';
  if (severidad === 'grave' && !foto) errores.foto = 'La foto es obligatoria cuando el daño es grave.';
  return errores;
}

/** Avance del checklist: cuántos puntos se revisaron y cuántos tienen novedad. */
export function progresoChecklist(checklist = []) {
  const revisados = checklist.filter((c) => c.ok !== null && c.ok !== undefined).length;
  const novedades = checklist.filter((c) => c.ok === false).length;
  return { revisados, total: checklist.length, completo: checklist.length > 0 && revisados === checklist.length, novedades };
}

/** 'ok' solo si el checklist está todo bien y no hay daños reportados. */
export function resultadoInspeccion({ checklist = [], reportes = [] }) {
  return reportes.length || progresoChecklist(checklist).novedades ? 'con_danos' : 'ok';
}

/** { instructor: 'Instructor', portero: 'Portero', … } */
export const ETIQUETA_ROL = Object.fromEntries(ROLES.map((r) => [r.clave, r.etiqueta]));
