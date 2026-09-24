// Contratos de la API que el backend debe implementar. Las vistas solo
// usan estas funciones: con CONFIG.usarMock=true las responde el servidor
// simulado; con false van por fetch a CONFIG.apiBase. Detalle en API.md.
import { pedir } from './cliente.js';

/**
 * @typedef {'instructor'|'administrativo'|'aprendiz'} Rol
 * @typedef {{id:string, identificacion:string, nombre:string, rol:Rol, ficha?:string, ambienteIds?:string[]}} Usuario
 * @typedef {{id:string, nombre:string, sede:string}} Ambiente
 * @typedef {{id:string, nombre:string}} Competencia
 * @typedef {{id:string, ficha:string, programa:string, competenciaId:string, competencia:string,
 *   ambienteId:string, ambiente:string, instructorId:string, instructor:string,
 *   startTime:string, endTime:string, ventanaMin:number, cancelada:boolean, motivoCancelacion?:string,
 *   inscritos:number, registrados:number}} Sesion
 * @typedef {{sessionId:string, startTime:string, expiryTime:string, nonce:string}} PayloadQr
 * @typedef {{resultado:'aceptado'|'falla', estado?:'presente'|'tarde', motivo?:string, codigo?:string,
 *   registro?:Asistencia}} ResultadoEscaneo
 * @typedef {{id:string, sessionId:string, aprendizId:string, documento:string, aprendiz:string, ficha:string,
 *   competencia:string, ambiente:string, fecha:string, estado:'presente'|'tarde'|'falla'|'cancelada', hora?:string}} Asistencia
 * @typedef {{aprendizId:string, documento:string, nombre:string, ficha:string, ambienteId:string,
 *   competenciaId:string, faltasConsecutivas:number, faltasTotales:number, ultimaFalta?:string}} EstadoFaltas
 * @typedef {{id:string, tipo:'clase-cancelada'|'riesgo'|'dano-grave'|'p004', titulo:string, detalle:string,
 *   fecha:string, leida:boolean}} Notificacion
 * @typedef {{documento:string, nombre:string, ficha:string, programa:string, estado:string,
 *   actualizadoPor?:string, actualizadoEn?:string}} RegistroP004
 * @typedef {{id:string, codigo:string, nombre:string, tipo:string, ambienteId:string,
 *   estado:'operativo'|'danado'|'en-reparacion'|'baja', serial:string,
 *   historial:{fecha:string, evento:string, usuario:string}[], fotos:{url:string, fecha:string, descripcion:string}[]}} Activo
 * @typedef {{id:string, activoId:string, prioridad:'leve'|'moderada'|'grave', descripcion:string,
 *   foto:string|null, reportadoPor:string, fecha:string}} Dano
 */

export const api = {
  // Autenticación
  login: (datos) => pedir('POST', '/auth/login', datos),              // → {token, usuario:Usuario}
  logout: () => pedir('POST', '/auth/logout'),

  // Catálogos
  catalogos: () => pedir('GET', '/catalogs'),                         // → {ambientes, competencias, fichas}

  // Sesiones de clase
  sesiones: (filtros) => pedir('GET', '/sessions', filtros),          // → Sesion[]  filtros: {instructorId?, ficha?, fecha?}
  generarQr: (id, validezSeg) => pedir('POST', `/sessions/${id}/qr`, { validezSeg }), // → {payload:PayloadQr, texto:string}
  cancelarSesion: (id, motivo) => pedir('POST', `/sessions/${id}/cancel`, { motivo }), // → Sesion
  asistenciaSesion: (id) => pedir('GET', `/sessions/${id}/attendance`), // → Asistencia[]

  // Asistencia
  escanear: (datos) => pedir('POST', '/attendance/scan', datos),      // → ResultadoEscaneo  datos: {payload, aprendizId, scannedAt}
  asistencias: (filtros) => pedir('GET', '/attendance', filtros),     // → Asistencia[]  filtros: {desde?, hasta?, ficha?, ambienteId?, aprendizId?}

  // Semáforo y notificaciones
  semaforo: (filtros) => pedir('GET', '/students/absences', filtros), // → EstadoFaltas[]  filtros: {ambienteId?, competenciaId?, fecha?}
  notificaciones: () => pedir('GET', '/notifications'),               // → Notificacion[]
  marcarLeida: (id) => pedir('POST', `/notifications/${id}/read`),

  // P004
  p004: () => pedir('GET', '/p004'),                                  // → RegistroP004[]
  importarP004: (registros) => pedir('POST', '/p004/import', { registros }), // → {importados:number, total:number}
  cambiarEstadoP004: (documento, estado) => pedir('PATCH', `/p004/${documento}`, { estado }), // → RegistroP004

};
