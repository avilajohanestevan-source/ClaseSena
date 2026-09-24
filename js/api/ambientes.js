// Contratos del backend real de entrega y revisión de ambientes
// (api/index.php, PHP + MySQL). Detalle en API.md, sección
// "Entrega y revisión de ambientes". Las vistas solo usan estas funciones.
import { pedirAmbientes as p, descargarAmbientes } from './cliente.js';

/**
 * @typedef {'instructor'|'administrativo'|'portero'|'aprendiz'} Rol
 * @typedef {{id:number, tipoDocumento:string, identificacion:string, nombre:string, email:?string,
 *   telefono:?string, rol:Rol, ficha:?string}} Usuario
 * @typedef {{id:number, codigo:string, nombre:string, bloque:?string, capacidad:?number, porteroId:?number,
 *   portero:?string, activo:boolean, itemsTotal:number, itemsNovedad:number,
 *   ultimaInspeccion:?{id:number, estado:string, resultado:?string, iniciadaEn:string, instructorId:number, instructor:string}}} Ambiente
 * @typedef {{id:number, ambienteId:number, ambiente:string, codigo:string, qr:string, nombre:string,
 *   categoria:string, serial:?string, estado:'operativo'|'danado'|'en_reparacion'|'baja'}} Item
 * @typedef {{clave:string, etiqueta:string, ok:?boolean}} PuntoChecklist
 * @typedef {{nombre:string, fecha:string}} Firma
 * @typedef {{id:number, itemId:?number, ubicacion:?string, codigo:?string, nombre:string, categoria:string, tipoDano:string,
 *   severidad:'leve'|'moderada'|'grave', comentario:string, foto:?string, reportadoEn:string}} ReporteDano
 * @typedef {{id:number, estado:'en_curso'|'pendiente_recepcion'|'recibida'|'cancelada', resultado:?('ok'|'con_danos'),
 *   qr:?string, qrGeneradoEn:?string, ambiente:{id:number, codigo:string, nombre:string, bloque:?string, porteroId:?number, portero:?string},
 *   instructor:{id:number, nombre:string}, portero:?{id:number, nombre:string},
 *   iniciadaEn:string, confirmadaEn:?string, recibidaEn:?string, danos:number, danosGraves:number}} Inspeccion
 * @typedef {Inspeccion & {checklist:PuntoChecklist[], observaciones:?string, entrega:?Firma,
 *   recibe:?Firma, reportes:ReporteDano[], inventario:(Item & {reportado:boolean})[]}} InspeccionDetalle
 */

export const apiAmb = {
  // Sesión y perfil
  login: (datos) => p('POST', '/auth/login', datos),                 // → {token, usuario:Usuario}
  logout: () => p('POST', '/auth/logout'),
  yo: () => p('GET', '/me'),                                          // → Usuario
  actualizarPerfil: (datos) => p('PATCH', '/me', datos),              // → Usuario  {nombre, email?, telefono?}
  cambiarPassword: (actual, nueva) => p('POST', '/me/password', { actual, nueva }),
  usuarios: (rol) => p('GET', '/users', { rol }),                     // → Usuario[] (administrativo)

  // Ambientes
  ambientes: (filtros) => p('GET', '/environments', filtros),         // → Ambiente[]  {asignados?}
  ambiente: (id) => p('GET', `/environments/${id}`),
  crearAmbiente: (datos) => p('POST', '/environments', datos),
  editarAmbiente: (id, datos) => p('PATCH', `/environments/${id}`, datos),
  borrarAmbiente: (id) => p('DELETE', `/environments/${id}`),

  // Inventario
  items: (ambienteId) => p('GET', `/environments/${ambienteId}/items`), // → Item[]
  itemPorCodigo: (codigo) => p('GET', `/items/by-code/${encodeURIComponent(codigo)}`),
  crearItem: (datos) => p('POST', '/items', datos),                   // {ambienteId, codigo?, nombre, categoria, serial?, estado?}
  registrarPorEscaneo: (datos) => p('POST', '/items/scan', datos),    // {codigo, ambienteId, nombre, categoria} → {item, creado, otroAmbiente}
  cargaMasiva: (datos) => p('POST', '/items/import', datos),          // {nombre, archivo (data URL), simular} → {total, nuevos, actualizados, sinCambios, errores, filas}
  exportarInventario: (ambienteId) => descargarAmbientes('/items/export', { ambienteId }, 'inventario.xlsx'),
  etiquetasImpresas: (ids, motivo) => p('POST', '/items/labels', { ids, motivo }),
  historialItem: (id) => p('GET', `/items/${id}/history`),
  editarItem: (id, datos) => p('PATCH', `/items/${id}`, datos),
  borrarItem: (id) => p('DELETE', `/items/${id}`),

  // Inspecciones
  inspecciones: (filtros) => p('GET', '/inspections', filtros),       // → Inspeccion[]
  inspeccion: (id) => p('GET', `/inspections/${id}`),                 // → InspeccionDetalle
  inspeccionPorQr: (token) => p('GET', `/inspections/by-qr/${token}`),      // portero y administrativo
  iniciarInspeccion: (ambienteId) => p('POST', '/inspections', { ambienteId }),
  guardarChecklist: (id, checklist, observaciones) => p('PATCH', `/inspections/${id}/checklist`, { checklist, observaciones }),
  reportarDano: (id, datos) => p('POST', `/inspections/${id}/items`, datos), // {itemId|codigo|ubicacion, tipoDano, severidad, comentario, foto}
  quitarDano: (id, reporteId) => p('DELETE', `/inspections/${id}/items/${reporteId}`),
  confirmarInspeccion: (id, datos) => p('POST', `/inspections/${id}/confirm`, datos), // instructor termina: {checklist, observaciones} | {todoBien:true}
  generarQr: (id) => p('POST', `/inspections/${id}/qr`),                     // portero: QR de entrega
  recibirPorQr: (token) => p('POST', `/inspections/by-qr/${token}/receive`), // instructor: escanea el QR del portero
  cancelarInspeccion: (id) => p('POST', `/inspections/${id}/cancel`),

  // Notificaciones
  bandeja: () => p('GET', '/inbox'),                                  // → {sinLeer, notificaciones}
  leerNotificacion: (id) => p('POST', `/inbox/${id}/read`),
  leerTodas: () => p('POST', '/inbox/read-all'),

  // Reportes
  reporte: (filtros) => p('GET', '/reports', filtros),                // → {resumen, porAmbiente, danos}
};
