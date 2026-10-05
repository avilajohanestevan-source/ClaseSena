// Contratos del backend real de entrega y revisión de ambientes
// (api/index.php, PHP + MySQL). Detalle en API.md, sección
// "Entrega y revisión de ambientes". Las vistas solo usan estas funciones.
import { pedirAmbientes as p, descargarAmbientes } from './cliente.js';

/**
 * @typedef {'instructor'|'administrativo'|'portero'|'aprendiz'} Rol
 * @typedef {{id:number, tipoDocumento:string, identificacion:string, nombre:string, email:?string,
 *   telefono:?string, rol:Rol, area:?('coordinacion'|'administrativo'|'inventario'), ficha:?string}} Usuario
 * @typedef {{id:number, nombre:string, descripcion:?string, activo:boolean, enUso:number}} Catalogo  especialidad o categoría
 * @typedef {{id:number, codigo:string, nombre:string, capacidadAprendices:?number, especialidadId:?number,
 *   especialidad:?string, porteroId:?number, portero:?string, activo:boolean, itemsTotal:number, itemsNovedad:number,
 *   familiasTotal:number, novedadesActivas:number,
 *   ultimaInspeccion:?{id:number, estado:string, resultado:?string, iniciadaEn:string, instructorId:number, instructor:string}}} Ambiente
 * @typedef {'operativo'|'danado'|'en_reparacion'|'fuera_servicio'|'baja'} EstadoItem
 * @typedef {{id:number, ambienteId:number, ambiente:string, codigo:string, qr:string, nombre:string, categoriaId:number,
 *   categoria:string, familiaId:?number, familia:?{id:number, codigo:string, nombre:string, tipo:string}, serial:?string,
 *   estado:EstadoItem, novedadActivaId:?number}} Item
 * @typedef {{id:number, ambienteId:number, ambiente:string, codigo:string, qr:string, tipo:string, nombre:string,
 *   componentesTotal:number, componentesConNovedad:number, novedadActivaId:?number, componentes?:Item[]}} Familia
 * @typedef {{clave:string, etiqueta:string, ok:?boolean}} PuntoChecklist
 * @typedef {{nombre:string, fecha:string}} Firma
 * @typedef {'permanente'|'temporal'|'limpieza'} Naturaleza
 * @typedef {{id:number, itemId:?number, familiaId:?number, ubicacion:?string, codigo:?string, nombre:string, categoria:string,
 *   naturaleza:Naturaleza, tipoDano:string, severidad:'leve'|'moderada'|'grave', comentario:string, foto:?string,
 *   novedadId:?number, reportadoEn:string}} ReporteDano
 * @typedef {{id:number, estado:'en_curso'|'resuelta'|'anulada', ambiente:{id:number, codigo:string, nombre:string},
 *   objetivo:{tipo:'item'|'familia'|'salon', id:?number, codigo:?string, nombre:string}, titulo:string, itemEstado:?EstadoItem,
 *   tipoDano:string, severidad:string, descripcion:string, foto:?string, reportadaPor:?string, inspeccionId:?number,
 *   creadaEn:string, resueltaPor:?string, resueltaEn:?string, resolucion:?string, reportes:number}} NovedadPermanente
 * @typedef {{id:number, estado:'en_curso'|'pendiente_recepcion'|'recibida'|'cancelada', resultado:?('ok'|'con_danos'),
 *   qr:?string, qrGeneradoEn:?string, ambiente:{id:number, codigo:string, nombre:string, porteroId:?number, portero:?string},
 *   instructor:{id:number, nombre:string}, portero:?{id:number, nombre:string},
 *   iniciadaEn:string, confirmadaEn:?string, recibidaEn:?string, danos:number, danosGraves:number}} Inspeccion
 * @typedef {Inspeccion & {checklist:PuntoChecklist[], observaciones:?string, itemsOk:number[], estadoSalon:?object,
 *   entrega:?Firma, recibe:?Firma, reportes:ReporteDano[],
 *   inventario:(Item & {reportado:boolean, reportadoPorFamilia:boolean})[],
 *   familias:(Familia & {itemIds:number[], reportado:boolean})[], novedadesActivas:NovedadPermanente[]}} InspeccionDetalle
 */

export const apiAmb = {
  // Sesión y perfil
  login: (datos) => p('POST', '/auth/login', datos),                 // → {token, usuario:Usuario}
  logout: () => p('POST', '/auth/logout'),
  yo: () => p('GET', '/me'),                                          // → Usuario
  actualizarPerfil: (datos) => p('PATCH', '/me', datos),              // → Usuario  {nombre, email?, telefono?}
  cambiarPassword: (actual, nueva) => p('POST', '/me/password', { actual, nueva }),
  usuarios: (rol) => p('GET', '/users', { rol }),                     // → Usuario[] (administrativo)

  // Catálogos: especialidades de ambiente y categorías del inventario
  especialidades: (todos) => p('GET', '/specialties', { todos: todos ? 1 : undefined }), // → Catalogo[]
  crearEspecialidad: (datos) => p('POST', '/specialties', datos),
  editarEspecialidad: (id, datos) => p('PATCH', `/specialties/${id}`, datos),
  borrarEspecialidad: (id) => p('DELETE', `/specialties/${id}`),
  categorias: (todos) => p('GET', '/inventory/categories', { todos: todos ? 1 : undefined }), // → Catalogo[]
  crearCategoria: (datos) => p('POST', '/inventory/categories', datos),
  editarCategoria: (id, datos) => p('PATCH', `/inventory/categories/${id}`, datos),
  borrarCategoria: (id) => p('DELETE', `/inventory/categories/${id}`),

  // Ambientes
  ambientes: (filtros) => p('GET', '/environments', filtros),         // → Ambiente[]  {asignados?, especialidadId?}
  ambiente: (id) => p('GET', `/environments/${id}`),
  crearAmbiente: (datos) => p('POST', '/environments', datos),        // {codigo, nombre, capacidadAprendices?, especialidadId?, porteroId?, activo?}
  editarAmbiente: (id, datos) => p('PATCH', `/environments/${id}`, datos),
  borrarAmbiente: (id) => p('DELETE', `/environments/${id}`),

  // Inventario
  items: (ambienteId) => p('GET', `/environments/${ambienteId}/items`), // → Item[]
  itemPorCodigo: (codigo) => p('GET', `/items/by-code/${encodeURIComponent(codigo)}`),
  buscarEscaneado: (codigo) => p('GET', '/inventory/lookup', { codigo }), // → {tipo:'item', item} | {tipo:'familia', familia}
  crearItem: (datos) => p('POST', '/items', datos),                   // {ambienteId, codigo?, qr?, nombre, categoriaId, familiaId?, serial?, estado?}
  registrarPorEscaneo: (datos) => p('POST', '/items/scan', datos),    // {codigo, ambienteId, nombre, categoriaId, familiaId?} → {item, creado, actualizado, cambios, movidoDesde}
  cargaMasiva: (datos) => p('POST', '/inventory/import', datos),      // {nombre, archivo (data URL), simular} → {total, nuevos, actualizados, sinCambios, familiasNuevas, errores, filas}
  exportarInventario: (ambienteId) => descargarAmbientes('/inventory/export', { ambienteId }, 'inventario.xlsx'),
  etiquetasImpresas: (datos) => p('POST', '/inventory/labels', datos), // {ids?, familiaIds?, motivo?} → {registradas, etiquetas}
  historialItem: (id) => p('GET', `/items/${id}/history`),
  editarItem: (id, datos) => p('PATCH', `/items/${id}`, datos),
  borrarItem: (id) => p('DELETE', `/items/${id}`),

  // Familias de ítems (Familia PC = monitor + CPU + teclado + mouse)
  familias: (ambienteId) => p('GET', '/inventory/families', { ambienteId }), // → Familia[] con componentes
  familia: (id) => p('GET', `/inventory/families/${id}`),
  crearFamilia: (datos) => p('POST', '/inventory/families', datos),   // {ambienteId, tipo, nombre, codigo?, itemIds}
  editarFamilia: (id, datos) => p('PATCH', `/inventory/families/${id}`, datos), // {tipo, nombre, itemIds?}
  borrarFamilia: (id) => p('DELETE', `/inventory/families/${id}`),

  // Inspecciones
  inspecciones: (filtros) => p('GET', '/inspections', filtros),       // → Inspeccion[]
  inspeccion: (id) => p('GET', `/inspections/${id}`),                 // → InspeccionDetalle
  inspeccionPorQr: (token) => p('GET', `/inspections/by-qr/${token}`),      // portero y administrativo
  iniciarInspeccion: (ambienteId) => p('POST', '/inspections', { ambienteId }),
  guardarChecklist: (id, checklist, observaciones) => p('PATCH', `/inspections/${id}/checklist`, { checklist, observaciones }),
  reportarDano: (id, datos) => p('POST', `/inspections/${id}/items`, datos), // {itemId|familiaId|codigo|ubicacion, naturaleza, tipoDano, severidad, comentario, foto}
  quitarDano: (id, reporteId) => p('DELETE', `/inspections/${id}/items/${reporteId}`),
  confirmarInspeccion: (id, datos) => p('POST', `/inspections/${id}/confirm`, datos), // instructor termina: {checklist, observaciones, itemsOk}
  generarQr: (id) => p('POST', `/inspections/${id}/qr`),                     // portero: QR de entrega
  recibirPorQr: (token) => p('POST', `/inspections/by-qr/${token}/receive`), // instructor: escanea el QR del portero
  cancelarInspeccion: (id) => p('POST', `/inspections/${id}/cancel`),

  // Novedades permanentes e historial de novedades
  novedades: (filtros) => p('GET', '/persistent-issues', filtros),    // → NovedadPermanente[]  {estado?, ambienteId?}
  novedad: (id) => p('GET', `/persistent-issues/${id}`),              // → NovedadPermanente & {items, historial}
  crearNovedad: (datos) => p('POST', '/persistent-issues', datos),
  editarNovedad: (id, datos) => p('PATCH', `/persistent-issues/${id}`, datos), // {estadoItem?, severidad?, descripcion?}
  resolverNovedad: (id, datos) => p('POST', `/persistent-issues/${id}/resolve`, datos), // {resolucion, estadoItem?}
  historialNovedades: (filtros) => p('GET', '/issues', filtros),      // {ambienteId, itemId, naturaleza, estado, desde, hasta}

  // Asignación de instructores por jornada
  tableroAsignaciones: (filtros) => p('GET', '/assignments/board', filtros), // {desde, dias, ambienteId?} → {fechas, jornadas, ambientes:[{celdas}]}
  asignaciones: (filtros) => p('GET', '/assignments', filtros),       // {ambienteId?, instructorId?, estado?, fecha?}
  asignacion: (id) => p('GET', `/assignments/${id}`),                 // + eventos
  crearAsignacion: (datos) => p('POST', '/assignments', datos),       // {ambienteId, instructorId, jornada, tipo, fechaInicio, fechaFin?, fechas? (varios días), motivo?} → {asignacion, asignaciones, advertencias}
  reasignar: (id, datos) => p('POST', `/assignments/${id}/reassign`, datos), // {instructorId, motivo, desde?}
  anularAsignacion: (id, datos) => p('POST', `/assignments/${id}/cancel`, datos), // {motivo, desde?}
  editarAsignacion: (id, datos) => p('PATCH', `/assignments/${id}`, datos), // {instructorId?, tipo?, fechaInicio?, fechaFin?, motivo?} → {asignacion, advertencias}

  // Auditoría (administrativo): eventos de novedades y asignaciones
  auditoria: (filtros) => p('GET', '/audit', filtros),                // {entidad?, entidadId?, ambienteId?, usuarioId?, desde?, hasta?}

  // Notificaciones
  bandeja: () => p('GET', '/inbox'),                                  // → {sinLeer, notificaciones}
  leerNotificacion: (id) => p('POST', `/inbox/${id}/read`),
  leerTodas: () => p('POST', '/inbox/read-all'),

  // Reportes
  reporte: (filtros) => p('GET', '/reports', filtros),                // → {resumen, porAmbiente, danos}
};
