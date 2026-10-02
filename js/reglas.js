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
  en_curso: ['En revisión', 'azul'],
  pendiente_recepcion: ['Por entregar', 'out'],
  recibida: ['Recibido', 'in'],
  cancelada: ['Cancelada', 'neutro'],
};

export const ESTADOS_ITEM = {
  operativo: ['Operativo', 'in'],
  danado: ['Dañado', 'error'],
  en_reparacion: ['En reparación', 'out'],
  fuera_servicio: ['Fuera de servicio', 'error'],
  baja: ['De baja (inactivo)', 'neutro'],
};

/**
 * Naturaleza de una novedad (mismas claves que el backend):
 * las permanentes quedan activas hasta que un administrativo las resuelve;
 * las temporales y de limpieza solo quedan en el historial.
 */
export const NATURALEZAS = [
  { clave: 'permanente', etiqueta: 'Permanente', ayuda: 'Daño que sigue hasta que lo arreglen (aire dañado, video beam sin lámpara).' },
  { clave: 'temporal', etiqueta: 'Temporal', ayuda: 'Incidencia de hoy que no requiere reparación (cable suelto, equipo desconectado).' },
  { clave: 'limpieza', etiqueta: 'Limpieza', ayuda: 'Suciedad, desorden o basura.' },
];

/** Sin elegir: la suciedad es de limpieza; lo demás, permanente (igual que el backend). */
export function naturalezaPorDefecto(tipoDano) {
  return tipoDano === 'suciedad' ? 'limpieza' : 'permanente';
}

/** [etiqueta, clase de .status-chip] de una novedad en el historial. */
export const ESTADOS_NOVEDAD = {
  en_revision: ['En revisión', 'azul'],
  en_curso: ['En curso', 'error'],
  resuelta: ['Resuelta', 'in'],
  anulada: ['Anulada', 'neutro'],
  cerrada: ['Cerrada', 'neutro'],
};

/** Eventos del historial de auditoría: [etiqueta, ícono]. */
export const ACCIONES_AUDITORIA = {
  creada: ['Creada', 'mas'], reportada_de_nuevo: ['Reportada de nuevo', 'alerta'], modificada: ['Modificada', 'lapiz'],
  resuelta: ['Resuelta', 'check'], anulada: ['Anulada', 'prohibido'], reporte_retirado: ['Reporte retirado', 'reintentar'],
  reasignada: ['Reasignada', 'usuarios'], recortada: ['Anulada desde una fecha', 'calendario'],
};

/* ---------------- asignación de instructores por jornada ---------------- */

export const JORNADAS = [
  { clave: 'manana', etiqueta: 'Mañana', horario: '6:00 a 12:00' },
  { clave: 'tarde', etiqueta: 'Tarde', horario: '12:00 a 18:00' },
  { clave: 'noche', etiqueta: 'Noche', horario: '18:00 a 22:00' },
];
export const ETIQUETA_JORNADA = Object.fromEntries(JORNADAS.map((j) => [j.clave, j.etiqueta]));

export const TIPOS_ASIGNACION = [
  { clave: 'periodo', etiqueta: 'Por periodo', ayuda: 'De una fecha de inicio a una fecha final (máximo un año).' },
  { clave: 'dia', etiqueta: 'Por días', ayuda: 'Uno o varios días sueltos (reemplazos, clases puntuales). Ese día tienen prioridad.' },
  { clave: 'permanente', etiqueta: 'Sin tiempo definido', ayuda: 'Sin fecha final: vale hasta que se cambie o se anule.' },
];

/**
 * Valida el formulario de una asignación (mismas reglas que el backend,
 * api/modulos/asignaciones.php). Fechas en aaaa-mm-dd; hoy para comparar.
 */
export function validarAsignacion({ ambienteId, instructorId, jornada, tipo, fechaInicio, fechaFin, fechas }, hoy = fechaIso()) {
  const errores = {};
  if (!ambienteId) errores.ambienteId = 'Elige el ambiente.';
  if (!instructorId) errores.instructorId = 'Elige el instructor.';
  if (!JORNADAS.some((j) => j.clave === jornada)) errores.jornada = 'Elige la jornada.';
  if (!TIPOS_ASIGNACION.some((t) => t.clave === tipo)) errores.tipo = 'Elige si es por periodo, por días o sin tiempo definido.';
  // Por días: varios días sueltos.
  if (tipo === 'dia' && Array.isArray(fechas)) {
    if (!fechas.length) errores.fechas = 'Agrega al menos un día.';
    else if (fechas.some((f) => f < hoy)) errores.fechas = 'Hay días que ya pasaron.';
    return errores;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaInicio || '')) errores.fechaInicio = 'Elige la fecha de inicio.';
  if (tipo === 'periodo') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaFin || '')) errores.fechaFin = 'Elige la fecha final.';
    else if (fechaFin < fechaInicio) errores.fechaFin = 'La fecha final no puede ser anterior a la de inicio.';
    else if ((new Date(fechaFin) - new Date(fechaInicio)) / 86_400_000 > 366) errores.fechaFin = 'Máximo un año; para más, usa permanente.';
  }
  const fin = tipo === 'dia' ? fechaInicio : tipo === 'periodo' ? fechaFin : null;
  if (!errores.fechaInicio && fin && fin < hoy) errores.fechaInicio = 'No se puede asignar en fechas que ya pasaron.';
  return errores;
}

/** Área de los administrativos (todos reciben los avisos de novedades). */
export const ETIQUETA_AREA = { coordinacion: 'Coordinación', administrativo: 'Administrativo', inventario: 'Inventario' };

export const PREFIJO_QR_ITEM = 'SENA-INV:';
export const PREFIJO_QR_FAMILIA = 'SENA-FAM:';
export const PREFIJO_QR_INSPECCION = 'SENA-INSP:';

/**
 * Código de ítem a partir del QR de la etiqueta ("SENA-INV:AMB107-003"), del
 * código de barras (el código solo, p. ej. "SILLA-107-04" o un EAN
 * "7701234500017") o del código escrito. Igual que normalizarCodigo() del backend.
 */
export function leerQrItem(texto) {
  const t = String(texto ?? '').trim().toUpperCase().replace(/^SENA-INV:/, '');
  return /^[A-Z0-9][A-Z0-9-]{2,39}$/.test(t) ? t : null;
}

/** Daños del salón que no son ítems del inventario (mismas claves que el backend). */
export const UBICACIONES = [
  { clave: 'pared', etiqueta: 'Pared' }, { clave: 'techo', etiqueta: 'Techo' }, { clave: 'piso', etiqueta: 'Piso' },
  { clave: 'puerta', etiqueta: 'Puerta' }, { clave: 'ventana', etiqueta: 'Ventana' },
  { clave: 'electrica', etiqueta: 'Instalación eléctrica' }, { clave: 'estructura', etiqueta: 'Estructura' }, { clave: 'otro', etiqueta: 'Otro' },
];

/** Token de la inspección a partir de su QR ("SENA-INSP:<16 caracteres>"). */
export function leerQrInspeccion(texto) {
  const m = String(texto ?? '').trim().toUpperCase().match(/^SENA-INSP:([A-Z0-9]{16})$/);
  return m ? m[1] : null;
}

/** Mismas reglas que el backend (api/modulos/inspecciones.php → rutaReportarDano). */
export function validarReporteDano({ itemId, familiaId, ubicacion, naturaleza, tipoDano, severidad, comentario, foto }) {
  const errores = {};
  // Una novedad es de un ítem, de una familia completa o del salón (pared, techo…).
  if (!itemId && !familiaId && !UBICACIONES.some((u) => u.clave === ubicacion)) errores.itemId = 'Escanea el ítem o la familia, o elige dónde está el daño.';
  if (naturaleza !== undefined && !NATURALEZAS.some((n) => n.clave === naturaleza)) errores.naturaleza = 'Indica si la novedad es permanente, temporal o de limpieza.';
  if (!TIPOS_DANO.some((t) => t.clave === tipoDano)) errores.tipoDano = 'Elige el tipo de daño.';
  if (!PRIORIDADES.some((p) => p.clave === severidad)) errores.severidad = 'Elige la severidad.';
  const texto = String(comentario ?? '').trim();
  if (texto.length < 10) errores.comentario = 'Describe el daño con al menos 10 caracteres.';
  else if (texto.length > 500) errores.comentario = 'El comentario admite máximo 500 caracteres.';
  if (!foto) errores.foto = 'Toma una foto del daño como evidencia.';
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

/**
 * Ítems que se pueden marcar OK en la revisión: todos los del ambiente menos
 * los que tienen una novedad en esta revisión (sueltos o por su familia), los
 * que ya tienen una novedad permanente activa y los que están fuera de
 * servicio o de baja.
 */
export function itemsRevisables(inventario = []) {
  return inventario.filter((i) => !i.reportado && !i.novedadActivaId && !['fuera_servicio', 'baja'].includes(i.estado));
}

/**
 * Atajo "Todo está bien": devuelve el checklist con todo en "Bien" y el
 * conjunto de ítems OK. Es una función pura: no envía nada ni termina la
 * revisión; eso lo hace el instructor con "Terminar revisión".
 * Los puntos ya marcados con novedad se respetan.
 */
export function marcarTodoBien(checklist = [], inventario = []) {
  return {
    checklist: checklist.map((c) => ({ ...c, ok: c.ok === false ? false : true })),
    itemsOk: new Set(itemsRevisables(inventario).map((i) => i.id)),
  };
}

/** { instructor: 'Instructor', portero: 'Portero', … } */
export const ETIQUETA_ROL = Object.fromEntries(ROLES.map((r) => [r.clave, r.etiqueta]));
