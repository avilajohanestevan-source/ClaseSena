// Servidor simulado: implementa los contratos de API.md sobre la base de
// datos en memoria de datos.js. Responde { status, cuerpo } como lo haría
// el backend, incluidos los errores, para probar el front sin servidor.
import { crearBaseDatos, PASSWORD_PRUEBA } from './datos.js';
import { estadoVentana, codificarQr, fechaIso, enRango, ESTADOS_P004, PRIORIDADES } from '../../reglas.js';
import { CONFIG } from '../../config.js';

let db = crearBaseDatos();
export function reiniciarMock(ahora) { db = crearBaseDatos(ahora); }
export function baseDeDatosMock() { return db; }

const ok = (cuerpo, status = 200) => ({ status, cuerpo });
const error = (status, mensaje, codigo) => ({ status, cuerpo: { mensaje, codigo } });
const id = (prefijo) => `${prefijo}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

function usuarioDelToken(token) {
  if (!token?.startsWith('mock-')) return null;
  return db.usuarios.find((u) => u.id === token.slice(5)) || null;
}

function conConteo(s) {
  const inscritos = db.aprendices.filter((a) => a.ficha === s.ficha).length;
  const registrados = db.asistencias.filter((r) => r.sessionId === s.id && (r.estado === 'presente' || r.estado === 'tarde')).length;
  return { ...s, inscritos, registrados };
}

function notificar(tipo, titulo, detalle) {
  db.notificaciones.unshift({ id: id('N'), tipo, titulo, detalle, fecha: new Date().toISOString(), leida: false });
}

/* ---------------- rutas ---------------- */

const rutas = [
  ['POST', /^\/auth\/login$/, ({ cuerpo }) => {
    const u = db.usuarios.find((x) => x.identificacion === String(cuerpo?.identificacion ?? '').trim());
    if (!u || cuerpo.password !== PASSWORD_PRUEBA) return error(401, 'Identificación o contraseña incorrectas.', 'CREDENCIALES');
    if (u.bloqueado) return error(423, 'La cuenta está bloqueada. Comunícate con coordinación académica.', 'BLOQUEADA');
    if (u.rol !== cuerpo.rol) return error(403, 'Tu usuario no tiene el rol seleccionado.', 'ROL');
    const { bloqueado, ...usuario } = u;
    return ok({ token: `mock-${u.id}`, usuario });
  }, { publica: true }],

  ['POST', /^\/auth\/logout$/, () => ok(null, 204)],

  ['GET', /^\/catalogs$/, () => ok({
    ambientes: db.ambientes, competencias: db.competencias,
    fichas: db.fichas.map(({ ficha, programa, ambienteId }) => ({ ficha, programa, ambienteId })),
  })],

  ['GET', /^\/sessions$/, ({ query }) => {
    const lista = db.sesiones
      .filter((s) => !query.instructorId || s.instructorId === query.instructorId)
      .filter((s) => !query.ficha || s.ficha === query.ficha)
      .filter((s) => !query.fecha || fechaIso(s.startTime) === query.fecha)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
    return ok(lista.map(conConteo));
  }],

  ['POST', /^\/sessions\/([^/]+)\/qr$/, ({ params: [sid], cuerpo }) => {
    const s = db.sesiones.find((x) => x.id === sid);
    if (!s) return error(404, 'La sesión no existe.', 'NO_EXISTE');
    const v = estadoVentana(s);
    if (v.estado === 'cancelada') return error(409, 'La clase está cancelada: no se puede generar QR.', 'CANCELADA');
    if (v.estado === 'cerrada') return error(409, 'La ventana de registro ya cerró.', 'FUERA_DE_VENTANA');
    if (v.estado === 'pendiente') return error(409, 'La ventana de registro aún no abre.', 'PENDIENTE');
    const validez = Math.min(Math.max(Number(cuerpo?.validezSeg) || CONFIG.validezQrPorDefecto, 10), 900);
    const ahora = Date.now();
    // El QR nunca vence después de que cierra la ventana.
    const expira = Math.min(ahora + validez * 1000, v.cierre);
    const payload = { sessionId: s.id, startTime: s.startTime, expiryTime: new Date(expira).toISOString(), nonce: Math.random().toString(36).slice(2, 10) };
    (db.qrEmitidos[s.id] ||= []).push(payload.nonce);
    return ok({ payload, texto: codificarQr(payload) });
  }],

  ['POST', /^\/sessions\/([^/]+)\/cancel$/, ({ params: [sid], cuerpo, usuario }) => {
    const s = db.sesiones.find((x) => x.id === sid);
    if (!s) return error(404, 'La sesión no existe.', 'NO_EXISTE');
    if (s.cancelada) return error(409, 'La clase ya estaba cancelada.', 'YA_CANCELADA');
    const motivo = String(cuerpo?.motivo ?? '').trim();
    if (motivo.length < 5) return error(422, 'Indica el motivo de la cancelación.', 'VALIDACION');
    s.cancelada = true;
    s.motivoCancelacion = motivo;
    notificar('clase-cancelada', 'Clase cancelada', `Ficha ${s.ficha} · ${s.competencia} · ${motivo} (${usuario.nombre})`);
    return ok(conConteo(s));
  }],

  ['GET', /^\/sessions\/([^/]+)\/attendance$/, ({ params: [sid] }) => {
    const s = db.sesiones.find((x) => x.id === sid);
    if (!s) return error(404, 'La sesión no existe.', 'NO_EXISTE');
    return ok(db.asistencias.filter((r) => r.sessionId === sid).sort((a, b) => (b.hora || '').localeCompare(a.hora || '')));
  }],

  ['POST', /^\/attendance\/scan$/, ({ cuerpo, usuario }) => {
    const falla = (codigo, motivo) => ok({ resultado: 'falla', codigo, motivo });
    const p = cuerpo?.payload;
    if (!p?.sessionId || !p?.expiryTime || !p?.nonce) return falla('QR_INVALIDO', 'El QR no es válido.');
    const s = db.sesiones.find((x) => x.id === p.sessionId);
    if (!s) return falla('QR_INVALIDO', 'El QR no corresponde a ninguna clase.');
    if (!(db.qrEmitidos[s.id] || []).includes(p.nonce)) return falla('QR_INVALIDO', 'El QR no fue emitido por el sistema.');
    const ahora = Date.now();
    if (ahora > Date.parse(p.expiryTime)) return falla('QR_VENCIDO', 'El QR ya venció. Pide al instructor que lo muestre de nuevo.');
    const v = estadoVentana(s, ahora);
    if (v.estado === 'cancelada') return falla('CANCELADA', 'La clase fue cancelada.');
    if (v.estado !== 'abierta') return falla('FUERA_DE_VENTANA', 'Fuera de ventana: el tiempo de registro terminó.');
    const aprendiz = db.aprendices.find((a) => a.id === (cuerpo.aprendizId || usuario.id));
    if (!aprendiz || aprendiz.ficha !== s.ficha) return falla('NO_INSCRITO', `No estás inscrito en la ficha ${s.ficha}.`);
    const p004 = db.p004.find((r) => r.documento === aprendiz.documento);
    if (p004 && !['EN FORMACION', 'CONDICIONADO'].includes(p004.estado)) return falla('P004', `Tu estado en P004 es "${p004.estado}".`);
    if (db.asistencias.some((r) => r.sessionId === s.id && r.aprendizId === aprendiz.id)) return falla('DUPLICADO', 'Ya habías registrado tu asistencia en esta clase.');
    const estado = ahora - v.inicio > CONFIG.toleranciaTardeMin * 60_000 ? 'tarde' : 'presente';
    const registro = {
      id: id('R'), sessionId: s.id, aprendizId: aprendiz.id, documento: aprendiz.documento, aprendiz: aprendiz.nombre,
      ficha: s.ficha, competenciaId: s.competenciaId, competencia: s.competencia, ambienteId: s.ambienteId, ambiente: s.ambiente,
      fecha: s.startTime, hora: new Date(ahora).toISOString(), estado,
    };
    db.asistencias.push(registro);
    return ok({ resultado: 'aceptado', estado, registro, motivo: estado === 'tarde' ? `Llegada tarde (más de ${CONFIG.toleranciaTardeMin} min)` : undefined });
  }],

  ['GET', /^\/attendance$/, ({ query, usuario }) => {
    const aprendizId = usuario.rol === 'aprendiz' ? usuario.id : query.aprendizId;
    const lista = db.asistencias
      .filter((r) => !aprendizId || r.aprendizId === aprendizId)
      .filter((r) => !query.ficha || r.ficha === query.ficha)
      .filter((r) => !query.ambienteId || r.ambienteId === query.ambienteId)
      .filter((r) => !query.competenciaId || r.competenciaId === query.competenciaId)
      .filter((r) => enRango(r.fecha, query.desde, query.hasta))
      .sort((a, b) => b.fecha.localeCompare(a.fecha) || a.aprendiz.localeCompare(b.aprendiz));
    return ok(lista);
  }],

  ['GET', /^\/students\/absences$/, ({ query }) => {
    const hasta = query.fecha || fechaIso();
    const lista = db.aprendices.map((a) => {
      const ficha = db.fichas.find((f) => f.ficha === a.ficha);
      const registros = db.asistencias
        .filter((r) => r.aprendizId === a.id && r.estado !== 'cancelada' && fechaIso(r.fecha) <= hasta)
        .filter((r) => !query.competenciaId || r.competenciaId === query.competenciaId)
        .sort((x, y) => x.fecha.localeCompare(y.fecha));
      let consecutivas = 0;
      for (let i = registros.length - 1; i >= 0 && registros[i].estado === 'falla'; i--) consecutivas++;
      const fallas = registros.filter((r) => r.estado === 'falla');
      return {
        aprendizId: a.id, documento: a.documento, nombre: a.nombre, ficha: a.ficha, programa: a.programa,
        ambienteId: ficha.ambienteId, competenciaIds: ficha.competencias,
        faltasConsecutivas: consecutivas, faltasTotales: fallas.length, sesiones: registros.length,
        ultimaFalta: fallas.at(-1)?.fecha,
      };
    }).filter((e) => (!query.ambienteId || e.ambienteId === query.ambienteId) && (!query.competenciaId || e.competenciaIds.includes(query.competenciaId)));
    return ok(lista);
  }],

  ['GET', /^\/notifications$/, () => ok([...db.notificaciones].sort((a, b) => b.fecha.localeCompare(a.fecha)))],

  ['POST', /^\/notifications\/([^/]+)\/read$/, ({ params: [nid] }) => {
    const n = db.notificaciones.find((x) => x.id === nid);
    if (n) n.leida = true;
    return ok(null, 204);
  }],

  ['GET', /^\/p004$/, () => ok(db.p004)],

  ['POST', /^\/p004\/import$/, ({ cuerpo, usuario }) => {
    const registros = Array.isArray(cuerpo?.registros) ? cuerpo.registros : [];
    if (!registros.length) return error(422, 'No hay registros para importar.', 'VALIDACION');
    const ahora = new Date().toISOString();
    registros.forEach((r) => {
      const existente = db.p004.find((x) => x.documento === r.documento);
      const nuevo = { ...r, actualizadoPor: usuario.nombre, actualizadoEn: ahora };
      if (existente) Object.assign(existente, nuevo); else db.p004.push(nuevo);
    });
    notificar('p004', 'P004 actualizado', `${registros.length} registros importados por ${usuario.nombre}`);
    return ok({ importados: registros.length, total: db.p004.length });
  }],

  ['PATCH', /^\/p004\/([^/]+)$/, ({ params: [doc], cuerpo, usuario }) => {
    const r = db.p004.find((x) => x.documento === doc);
    if (!r) return error(404, 'El aprendiz no está en el P004.', 'NO_EXISTE');
    if (!ESTADOS_P004.includes(cuerpo?.estado)) return error(422, 'Estado no válido.', 'VALIDACION');
    Object.assign(r, { estado: cuerpo.estado, actualizadoPor: usuario.nombre, actualizadoEn: new Date().toISOString() });
    return ok(r);
  }],

  ['GET', /^\/environments\/([^/]+)\/assets$/, ({ params: [aid] }) => ok(db.activos.filter((a) => a.ambienteId === aid))],

  ['GET', /^\/assets\/by-code\/([^/]+)$/, ({ params: [codigo] }) => {
    const a = db.activos.find((x) => x.codigo.toUpperCase() === decodeURIComponent(codigo).trim().toUpperCase());
    return a ? ok(a) : error(404, `No hay ningún activo con el código ${decodeURIComponent(codigo)}.`, 'NO_EXISTE');
  }],

  ['GET', /^\/assets\/([^/]+)$/, ({ params: [aid] }) => {
    const a = db.activos.find((x) => x.id === aid);
    return a ? ok(a) : error(404, 'El activo no existe.', 'NO_EXISTE');
  }],

  ['POST', /^\/damages$/, ({ cuerpo, usuario }) => {
    const a = db.activos.find((x) => x.id === cuerpo?.activoId);
    if (!a) return error(422, 'El activo vinculado no existe.', 'VALIDACION');
    if (!PRIORIDADES.some((p) => p.clave === cuerpo.prioridad)) return error(422, 'Prioridad no válida.', 'VALIDACION');
    if (cuerpo.prioridad === 'grave' && !cuerpo.foto) return error(422, 'La foto es obligatoria para daños graves.', 'FOTO_OBLIGATORIA');
    const fecha = new Date().toISOString();
    const dano = { id: id('D'), activoId: a.id, prioridad: cuerpo.prioridad, descripcion: cuerpo.descripcion, foto: cuerpo.foto || null, reportadoPor: usuario.nombre, fecha };
    db.danos.push(dano);
    a.estado = 'danado';
    a.historial.push({ fecha, evento: `Reporte de daño (${cuerpo.prioridad})`, usuario: usuario.nombre });
    if (cuerpo.foto) a.fotos.unshift({ url: cuerpo.foto, fecha, descripcion: cuerpo.descripcion });
    if (cuerpo.prioridad === 'grave') {
      const amb = db.ambientes.find((x) => x.id === a.ambienteId);
      notificar('dano-grave', 'Daño grave reportado', `${a.nombre} · ${amb?.nombre ?? ''} (${usuario.nombre})`);
    }
    return ok(dano, 201);
  }],
];

export function responder({ metodo, ruta, query = {}, cuerpo = null, token = null }) {
  for (const [m, patron, manejar, opciones = {}] of rutas) {
    if (m !== metodo) continue;
    const coincide = ruta.match(patron);
    if (!coincide) continue;
    const usuario = usuarioDelToken(token);
    if (!opciones.publica && !usuario) return error(401, 'Tu sesión expiró. Vuelve a iniciar sesión.', 'NO_AUTENTICADO');
    return manejar({ params: coincide.slice(1), query, cuerpo, usuario });
  }
  return error(404, `Ruta simulada no encontrada: ${metodo} ${ruta}`, 'RUTA');
}
