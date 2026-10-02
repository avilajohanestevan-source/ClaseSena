// Cambios administrativos contra la API real: especialidades y capacidad de
// aprendices, categorías, familias de ítems, carga masiva por multipart,
// reporte de una familia completa, novedades permanentes (persistent_issues)
// con sus avisos, historial de novedades y resolución.
//   npm run test:api   (Apache y MySQL encendidos, base instalada con db/instalar.php)
import { test } from 'node:test';
import assert from 'node:assert/strict';

const API = process.env.API || 'http://localhost/sena-ambientes/api/index.php';
const CLAVE = 'Sena2026*';
const FOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function pedir(metodo, ruta, { token, cuerpo, form } = {}) {
  const r = await fetch(API + ruta, {
    method: metodo,
    headers: { ...(form ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: form || (cuerpo ? JSON.stringify(cuerpo) : undefined),
  });
  return { status: r.status, datos: r.status === 204 ? null : await r.json() };
}
const ingresar = async (identificacion, rol) => (await pedir('POST', '/auth/login', { cuerpo: { identificacion, password: CLAVE, rol } })).datos.token;
const disponible = () => fetch(API + '/me').then(() => true, () => false);
const sufijo = () => Math.random().toString(36).slice(2, 6).toUpperCase();

test('ambientes con capacidad_aprendices y especialidad_id; categorías del inventario', async (t) => {
  if (!await disponible()) { t.skip('API no disponible (enciende Apache y MySQL en XAMPP)'); return; }
  const admin = await ingresar('2020202020', 'administrativo');
  const instructor = await ingresar('1010101010', 'instructor');

  const especialidades = (await pedir('GET', '/specialties', { token: instructor })).datos;
  for (const nombre of ['Cocina', 'Laboratorio', 'Audiovisual', 'Axo']) assert.ok(especialidades.some((e) => e.nombre === nombre), `falta ${nombre}`);
  const cocina = especialidades.find((e) => e.nombre === 'Cocina');

  // snake_case como en la base…
  const codigo = `T${sufijo()}`;
  const creado = await pedir('POST', '/environments', { token: admin, cuerpo: { codigo, nombre: 'Cocina de prueba', capacidad_aprendices: 25, especialidad_id: cocina.id } });
  assert.equal(creado.status, 201, JSON.stringify(creado.datos));
  assert.equal(creado.datos.capacidadAprendices, 25);
  assert.equal(creado.datos.especialidad, 'Cocina');
  assert.equal(creado.datos.capacidad, undefined, 'el campo "capacidad" ya no existe');
  // …o camelCase, y la especialidad por nombre
  const editado = await pedir('PATCH', `/environments/${creado.datos.id}`, { token: admin, cuerpo: { codigo, nombre: 'Cocina de prueba', capacidadAprendices: 30, especialidad: 'audiovisual' } });
  assert.equal(editado.datos.especialidad, 'Audiovisual');
  assert.equal(editado.datos.capacidadAprendices, 30);
  assert.equal((await pedir('POST', '/environments', { token: admin, cuerpo: { codigo: `T${sufijo()}`, nombre: 'X1', capacidad_aprendices: 0 } })).status, 422);
  assert.equal((await pedir('POST', '/environments', { token: admin, cuerpo: { codigo: `T${sufijo()}`, nombre: 'X2', especialidad_id: 9999 } })).status, 422);
  assert.equal((await pedir('POST', '/environments', { token: instructor, cuerpo: { codigo: `T${sufijo()}`, nombre: 'X3' } })).status, 403);
  const filtrados = (await pedir('GET', `/environments?especialidadId=${cocina.id}`, { token: admin })).datos;
  assert.ok(filtrados.length && filtrados.every((a) => a.especialidadId === cocina.id));
  assert.equal((await pedir('DELETE', `/environments/${creado.datos.id}`, { token: admin })).status, 204);
  // No se borra una especialidad en uso
  assert.equal((await pedir('DELETE', `/specialties/${cocina.id}`, { token: admin })).status, 409);

  // Categorías
  const categorias = (await pedir('GET', '/inventory/categories', { token: instructor })).datos.map((c) => c.nombre);
  for (const nombre of ['Inmuebles', 'Mobiliario', 'Electrodomésticos', 'Equipos Informáticos', 'Periféricos']) assert.ok(categorias.includes(nombre), `falta ${nombre}`);
  const nueva = await pedir('POST', '/inventory/categories', { token: admin, cuerpo: { nombre: `Instrumentos ${sufijo()}`, descripcion: 'Guitarras, teclados' } });
  assert.equal(nueva.status, 201);
  assert.equal((await pedir('POST', '/inventory/categories', { token: admin, cuerpo: { nombre: nueva.datos.nombre } })).status, 409);
  const mobiliario = (await pedir('GET', '/inventory/categories', { token: admin })).datos.find((c) => c.nombre === 'Mobiliario');
  assert.ok(mobiliario.enUso > 0);
  assert.equal((await pedir('DELETE', `/inventory/categories/${mobiliario.id}`, { token: admin })).status, 409, 'en uso: no se borra');
  assert.equal((await pedir('DELETE', `/inventory/categories/${nueva.datos.id}`, { token: admin })).status, 204);
});

test('familias de ítems e importación por multipart en /inventory/import', async (t) => {
  if (!await disponible()) { t.skip('API no disponible'); return; }
  const admin = await ingresar('2020202020', 'administrativo');
  const ambientes = (await pedir('GET', '/environments', { token: admin })).datos;
  const cocina = ambientes.find((a) => a.codigo === '110');
  assert.equal(cocina.especialidad, 'Cocina');

  // Las familias creadas por la carga masiva de prueba
  const familias = (await pedir('GET', `/inventory/families?ambienteId=${cocina.id}`, { token: admin })).datos;
  const est1 = familias.find((f) => f.codigo === 'FAM110-EST01');
  assert.equal(est1.tipo, 'Estación de cocina');
  assert.equal(est1.componentes.length, 3);
  assert.equal(est1.qr, 'SENA-FAM:FAM110-EST01');
  const pc = (await pedir('GET', '/inventory/lookup?codigo=SENA-FAM:FAM107-PC01', { token: admin })).datos;
  assert.equal(pc.tipo, 'familia');
  // CPU (seed.sql) + monitor, teclado y mouse (Excel); api-inventario.mjs puede haberle sumado otro mouse
  const nombres = pc.familia.componentes.map((c) => c.nombre);
  for (const n of ['Computador de escritorio #1', 'Monitor 24" #1', 'Teclado #1', 'Mouse #1']) assert.ok(nombres.includes(n), `falta ${n}`);
  assert.equal(pc.familia.componentes.find((c) => c.nombre === 'Teclado #1').categoria, 'Periféricos');

  // Nueva familia con ítems sueltos del 110; un ítem de otro ambiente no puede entrar
  const sueltos = (await pedir('GET', `/environments/${cocina.id}/items`, { token: admin })).datos.filter((i) => !i.familiaId).slice(0, 2);
  const fam = await pedir('POST', '/inventory/families', { token: admin, cuerpo: { ambienteId: cocina.id, tipo: 'Estación de cocina', nombre: 'Estación de prueba', itemIds: sueltos.map((i) => i.id) } });
  assert.equal(fam.status, 201, JSON.stringify(fam.datos));
  assert.match(fam.datos.codigo, /^FAM110-EST\d{2}$/);
  assert.equal(fam.datos.componentesTotal, 2);
  const ajena = (await pedir('GET', '/items/by-code/SILLA-107-01', { token: admin })).datos;
  assert.equal((await pedir('PATCH', `/inventory/families/${fam.datos.id}`, { token: admin, cuerpo: { tipo: 'Estación de cocina', nombre: 'Estación de prueba', itemIds: [ajena.id] } })).status, 422);
  const menos = (await pedir('PATCH', `/inventory/families/${fam.datos.id}`, { token: admin, cuerpo: { tipo: 'Estación de cocina', nombre: 'Estación de prueba', itemIds: [sueltos[0].id] } })).datos;
  assert.equal(menos.componentesTotal, 1);
  const hist = (await pedir('GET', `/items/${sueltos[1].id}/history`, { token: admin })).datos;
  assert.equal(hist[0].accion, 'familia');
  assert.match(hist[0].detalle, /Sale de la familia/);
  assert.equal((await pedir('DELETE', `/inventory/families/${fam.datos.id}`, { token: admin })).status, 204);

  // Carga por multipart/form-data: un ítem con familia nueva y QR propio
  const qr = `QR-MULTI-${sufijo()}`;
  const csv = 'ambiente;codigo;nombre;categoria;serial;estado;familia;familia_nombre;familia_tipo;qr\n'
    + `110;;Batidora de prueba ${qr};Electrodomésticos;;Operativo;FAM110-BAT${sufijo().slice(0, 2)};Batidoras;Batidora;${qr}\n`;
  const form = (simular) => {
    const f = new FormData();
    f.append('archivo', new Blob([csv], { type: 'text/csv' }), 'multipart.csv');
    if (simular) f.append('simular', '1');
    return f;
  };
  const previa = await pedir('POST', '/inventory/import', { token: admin, form: form(true) });
  assert.equal(previa.status, 200, JSON.stringify(previa.datos));
  assert.deepEqual([previa.datos.nuevos, previa.datos.familiasNuevas, previa.datos.errores.length], [1, 1, 0]);
  assert.equal((await pedir('GET', `/inventory/lookup?codigo=${qr}`, { token: admin })).status, 404, 'simular no guarda');
  const carga = (await pedir('POST', '/inventory/import', { token: admin, form: form(false) })).datos;
  assert.equal(carga.nuevos, 1);
  const leido = (await pedir('GET', `/inventory/lookup?codigo=${qr}`, { token: admin })).datos;
  assert.equal(leido.tipo, 'item');
  assert.equal(leido.item.qr, qr);
  assert.equal(leido.item.familia.tipo, 'Batidora');
});

test('novedad permanente de una familia: persistent_issues, avisos a coordinación, administrativo e inventario, historial y resolución', async (t) => {
  if (!await disponible()) { t.skip('API no disponible'); return; }
  const carlos = await ingresar('2020202020', 'administrativo');   // administrativo
  const patricia = await ingresar('2020202021', 'administrativo'); // coordinación
  const hernan = await ingresar('2020202022', 'administrativo');   // inventario
  const andres = await ingresar('1010101011', 'instructor');
  const laura = await ingresar('1010101010', 'instructor');
  const martha = await ingresar('4040404041', 'portero');
  const amb = (await pedir('GET', '/environments', { token: carlos })).datos.find((a) => a.codigo === '111');

  async function entregar(token, insp) {
    const conf = await pedir('POST', `/inspections/${insp.id}/confirm`, {
      token, cuerpo: { checklist: insp.checklist.map((c) => ({ clave: c.clave, ok: true })), itemsOk: insp.inventario.map((i) => i.id) },
    });
    assert.equal(conf.status, 200, JSON.stringify(conf.datos));
    const qr = (await pedir('POST', `/inspections/${insp.id}/qr`, { token: martha })).datos.qr.replace('SENA-INSP:', '');
    const rec = await pedir('POST', `/inspections/by-qr/${qr}/receive`, { token });
    assert.equal(rec.status, 200, JSON.stringify(rec.datos));
    return rec.datos;
  }

  // 1. Andrés revisa el 111: la familia completa del kit de grabación tiene una novedad permanente
  const insp = (await pedir('POST', '/inspections', { token: andres, cuerpo: { ambienteId: amb.id } })).datos;
  const kit = insp.familias.find((f) => f.codigo === 'FAM111-KIT01');
  assert.equal(kit.itemIds.length, 3);
  const fam = await pedir('POST', `/inspections/${insp.id}/items`, {
    token: andres, cuerpo: { codigo: 'SENA-FAM:FAM111-KIT01', naturaleza: 'permanente', tipoDano: 'no_funciona', severidad: 'grave', comentario: 'El kit no graba: la cámara no enciende', foto: FOTO },
  });
  assert.equal(fam.status, 201, JSON.stringify(fam.datos));
  const rep = fam.datos.reportes.find((r) => r.familiaId === kit.id);
  assert.equal(rep.naturaleza, 'permanente');
  const componentes = fam.datos.inventario.filter((i) => kit.itemIds.includes(i.id));
  assert.ok(componentes.every((i) => i.reportado && i.reportadoPorFamilia && i.estado === 'danado'));
  // Un componente de una familia ya reportada no se reporta suelto
  assert.equal((await pedir('POST', `/inspections/${insp.id}/items`, {
    token: andres, cuerpo: { itemId: kit.itemIds[0], tipoDano: 'rotura', severidad: 'leve', comentario: 'Componente suelto de prueba', foto: FOTO },
  })).status, 409);
  // Incidencia de limpieza (suciedad → limpieza por defecto): no cambia el inventario
  const fondo = insp.inventario.find((i) => i.nombre === 'Fondo verde');
  const limpieza = await pedir('POST', `/inspections/${insp.id}/items`, {
    token: andres, cuerpo: { itemId: fondo.id, tipoDano: 'suciedad', severidad: 'leve', comentario: 'Manchas de pintura en el fondo verde', foto: FOTO },
  });
  assert.equal(limpieza.datos.reportes.find((r) => r.itemId === fondo.id).naturaleza, 'limpieza');
  assert.equal(limpieza.datos.inventario.find((i) => i.id === fondo.id).estado, 'operativo');

  // 2. Termina (con todos los ítems OK menos los que tienen novedad), Martha genera el QR y Andrés lo escanea
  const final = await entregar(andres, limpieza.datos);
  assert.equal(final.estado, 'recibida');
  assert.equal(final.portero.nombre, 'Martha Lucía Peña');
  assert.equal(final.itemsOk.length, insp.inventario.length - 4, 'los 3 del kit y el fondo verde no cuentan como OK');
  assert.deepEqual([final.estadoSalon.reportes.permanentes, final.estadoSalon.reportes.limpieza], [1, 1]);
  assert.equal(final.estadoSalon.items.marcadosOk, final.itemsOk.length);
  const novedadId = final.reportes.find((r) => r.familiaId === kit.id).novedadId;
  assert.ok(novedadId, 'la novedad permanente queda en persistent_issues');
  assert.equal(final.reportes.find((r) => r.itemId === fondo.id).novedadId, null, 'la de limpieza no');

  // 3. Avisos a coordinación, administrativo e inventario
  for (const token of [carlos, patricia, hernan]) {
    const bandeja = (await pedir('GET', '/inbox', { token })).datos;
    assert.ok(bandeja.notificaciones.some((n) => n.tipo === 'novedad_permanente' && n.novedadId === novedadId && n.ambiente === '111'));
  }
  const activas = (await pedir('GET', `/persistent-issues?estado=en_curso&ambienteId=${amb.id}`, { token: carlos })).datos;
  const nov = activas.find((n) => n.id === novedadId);
  assert.deepEqual([nov.objetivo.tipo, nov.objetivo.codigo, nov.severidad, nov.reportes], ['familia', 'FAM111-KIT01', 'grave', 1]);

  // 4. Laura revisa el 111 al otro día: ve la novedad activa; volver a reportarla no la duplica
  const insp2 = (await pedir('POST', '/inspections', { token: laura, cuerpo: { ambienteId: amb.id } })).datos;
  assert.ok(insp2.novedadesActivas.some((n) => n.id === novedadId));
  const otra = await pedir('POST', `/inspections/${insp2.id}/items`, {
    token: laura, cuerpo: { familiaId: kit.id, naturaleza: 'permanente', tipoDano: 'no_funciona', severidad: 'grave', comentario: 'Sigue sin funcionar el kit', foto: FOTO },
  });
  assert.equal(otra.status, 201);
  const final2 = await entregar(laura, otra.datos);
  assert.equal(final2.reportes[0].novedadId, novedadId);
  assert.equal((await pedir('GET', `/persistent-issues/${novedadId}`, { token: carlos })).datos.historial.length, 2);
  const avisos = (await pedir('GET', '/inbox', { token: patricia })).datos.notificaciones.filter((n) => n.tipo === 'novedad_permanente' && n.novedadId === novedadId);
  assert.equal(avisos.length, 1, 'no se vuelve a avisar como novedad nueva');

  // 5. Inventario deja los componentes fuera de servicio y luego la resuelve
  const fuera = await pedir('PATCH', `/persistent-issues/${novedadId}`, { token: hernan, cuerpo: { estadoItem: 'fuera_servicio' } });
  assert.equal(fuera.status, 200, JSON.stringify(fuera.datos));
  const detalle = (await pedir('GET', `/persistent-issues/${novedadId}`, { token: hernan })).datos;
  assert.ok(detalle.items.every((i) => i.estado === 'fuera_servicio'));
  assert.equal((await pedir('POST', `/persistent-issues/${novedadId}/resolve`, { token: martha, cuerpo: { resolucion: 'Revisado' } })).status, 403, 'el portero no resuelve');
  assert.equal((await pedir('POST', `/persistent-issues/${novedadId}/resolve`, { token: andres, cuerpo: { resolucion: 'x' } })).status, 422);
  const resuelta = await pedir('POST', `/persistent-issues/${novedadId}/resolve`, { token: hernan, cuerpo: { resolucion: 'Se cambió la batería de la cámara y el cable del micrófono.' } });
  assert.equal(resuelta.status, 200, JSON.stringify(resuelta.datos));
  assert.equal(resuelta.datos.estado, 'resuelta');
  assert.equal(resuelta.datos.resueltaPor, 'Hernán Darío Ospina');
  // Cada cambio de estado queda en su historial con fecha, usuario y evidencia
  assert.deepEqual(resuelta.datos.eventos.map((e) => e.accion), ['creada', 'reportada_de_nuevo', 'modificada', 'resuelta']);
  assert.ok(resuelta.datos.eventos.every((e) => e.fecha && e.usuario));
  assert.ok(resuelta.datos.eventos[0].foto, 'la apertura guarda la foto de evidencia');
  assert.ok((await pedir('GET', `/persistent-issues/${novedadId}`, { token: hernan })).datos.items.every((i) => i.estado === 'operativo'));
  assert.equal((await pedir('POST', `/persistent-issues/${novedadId}/resolve`, { token: hernan, cuerpo: { resolucion: 'Otra vez' } })).status, 409);
  assert.ok((await pedir('GET', '/inbox', { token: andres })).datos.notificaciones.some((n) => n.tipo === 'novedad_resuelta' && n.novedadId === novedadId), 'avisa a quien la reportó');
  assert.ok((await pedir('GET', '/inbox', { token: patricia })).datos.notificaciones.some((n) => n.tipo === 'novedad_resuelta' && n.novedadId === novedadId));
  assert.ok(!(await pedir('GET', '/inbox', { token: hernan })).datos.notificaciones.some((n) => n.tipo === 'novedad_resuelta' && n.novedadId === novedadId), 'no a quien la resolvió');

  // 6. Historial completo de novedades: equipo, fecha, usuario, evidencia, estado y fecha de resolución
  const historial = (await pedir('GET', `/issues?ambienteId=${amb.id}`, { token: carlos })).datos;
  const deKit = historial.filter((h) => h.novedadId === novedadId);
  assert.equal(deKit.length, 2);
  assert.ok(deKit.every((h) => h.estado === 'resuelta' && h.resueltaEn && h.foto && h.usuario && h.objetivo.codigo === 'FAM111-KIT01'));
  const deFondo = historial.find((h) => h.objetivo.id === fondo.id);
  assert.deepEqual([deFondo.naturaleza, deFondo.estado], ['limpieza', 'cerrada']);
  assert.ok(deFondo.resueltaEn);
  const porItem = (await pedir('GET', `/issues?itemId=${kit.itemIds[0]}`, { token: carlos })).datos;
  assert.ok(porItem.some((h) => h.novedadId === novedadId), 'el historial de un componente incluye las novedades de su familia');
  assert.equal((await pedir('GET', '/issues', { token: andres })).status, 200, 'los instructores también ven el historial');
  assert.equal((await pedir('GET', '/issues', { token: martha })).status, 403);
});

test('novedad permanente registrada por un administrativo y ítem fuera de servicio', async (t) => {
  if (!await disponible()) { t.skip('API no disponible'); return; }
  const patricia = await ingresar('2020202021', 'administrativo');
  const carlos = await ingresar('2020202020', 'administrativo');
  // El aire del 107 ya tiene una activa (seed): no se duplica
  assert.equal((await pedir('POST', '/persistent-issues', { token: patricia, cuerpo: { codigo: 'SENA-INV:AMB107-007', tipoDano: 'no_funciona', severidad: 'grave', descripcion: 'Sigue sin enfriar el aire' } })).status, 409);
  const tv = await pedir('POST', '/persistent-issues', {
    token: patricia, cuerpo: { codigo: 'AMB108-005', tipoDano: 'rotura', severidad: 'moderada', descripcion: 'Pantalla del televisor con una línea vertical', estadoItem: 'fuera_servicio' },
  });
  assert.equal(tv.status, 201, JSON.stringify(tv.datos));
  assert.equal((await pedir('GET', '/items/by-code/AMB108-005', { token: carlos })).datos.estado, 'fuera_servicio');
  assert.ok((await pedir('GET', '/inbox', { token: carlos })).datos.notificaciones.some((n) => n.tipo === 'novedad_permanente' && n.novedadId === tv.datos.id));
  const resuelta = (await pedir('POST', `/persistent-issues/${tv.datos.id}/resolve`, { token: carlos, cuerpo: { resolucion: 'Se cambió el panel', estadoItem: 'operativo' } })).datos;
  assert.equal(resuelta.estado, 'resuelta');
  assert.equal((await pedir('GET', '/items/by-code/AMB108-005', { token: carlos })).datos.estado, 'operativo');
  const hist = (await pedir('GET', '/issues?estado=resuelta', { token: carlos })).datos;
  assert.ok(hist.some((h) => h.origen === 'modulo' && h.novedadId === tv.datos.id && h.usuario === 'Patricia Rondón Gil'));
});

test('el instructor levanta, modifica y resuelve una novedad grave; retirar el reporte la anula; todo queda en auditoría', async (t) => {
  if (!await disponible()) { t.skip('API no disponible'); return; }
  const laura = await ingresar('1010101010', 'instructor');
  const diana = await ingresar('1010101012', 'instructor');
  const carlos = await ingresar('2020202020', 'administrativo');
  const patricia = await ingresar('2020202021', 'administrativo');
  const amb111 = (await pedir('GET', '/environments', { token: laura })).datos.find((a) => a.codigo === '111');
  const item = (await pedir('GET', `/environments/${amb111.id}/items`, { token: laura })).datos.find((i) => i.nombre === 'Aire acondicionado');

  // Sin foto no; con foto queda en curso, visible en Novedades y avisa a los administrativos
  const base = { itemId: item.id, tipoDano: 'no_funciona', severidad: 'grave', descripcion: 'El aire acondicionado del 111 dejó de enfriar en plena clase' };
  assert.equal((await pedir('POST', '/persistent-issues', { token: laura, cuerpo: base })).status, 422);
  assert.equal((await pedir('POST', '/persistent-issues', { token: laura, cuerpo: { ...base, foto: FOTO, estadoItem: 'baja' } })).status, 403, 'dar de baja es de administrativos');
  const creada = await pedir('POST', '/persistent-issues', { token: laura, cuerpo: { ...base, foto: FOTO, estadoItem: 'fuera_servicio' } });
  assert.equal(creada.status, 201, JSON.stringify(creada.datos));
  const id = creada.datos.id;
  assert.deepEqual([creada.datos.estado, creada.datos.reportadaPor, creada.datos.items[0].estado], ['en_curso', 'Laura Gómez Patiño', 'fuera_servicio']);
  assert.ok((await pedir('GET', '/persistent-issues?estado=en_curso', { token: diana })).datos.some((n) => n.id === id), 'visible para los instructores');
  assert.ok((await pedir('GET', '/inbox', { token: patricia })).datos.notificaciones.some((n) => n.tipo === 'novedad_permanente' && n.novedadId === id));
  assert.equal((await pedir('POST', '/persistent-issues', { token: diana, cuerpo: { ...base, foto: FOTO } })).status, 409, 'no se duplica');

  // Modificación con nota y nueva evidencia
  assert.equal((await pedir('PATCH', `/persistent-issues/${id}`, { token: diana, cuerpo: {} })).status, 422);
  const mod = await pedir('PATCH', `/persistent-issues/${id}`, { token: diana, cuerpo: { severidad: 'moderada', nota: 'Mantenimiento dice que falta gas refrigerante', foto: FOTO } });
  assert.equal(mod.status, 200, JSON.stringify(mod.datos));
  const evMod = mod.datos.eventos.at(-1);
  assert.deepEqual([evMod.accion, evMod.usuario], ['modificada', 'Diana Marcela Ruiz']);
  assert.ok(evMod.foto && evMod.datos.severidad && /refrigerante/.test(evMod.detalle));

  // Otro instructor la resuelve con foto de la reparación; avisa a quien la levantó y a los administrativos
  const res = await pedir('POST', `/persistent-issues/${id}/resolve`, { token: diana, cuerpo: { resolucion: 'Se recargó el gas y enfría bien', foto: FOTO } });
  assert.equal(res.status, 200, JSON.stringify(res.datos));
  assert.deepEqual([res.datos.estado, res.datos.resueltaPor, res.datos.items[0].estado], ['resuelta', 'Diana Marcela Ruiz', 'operativo']);
  assert.ok(res.datos.fotoResolucion);
  assert.deepEqual(res.datos.eventos.map((e) => e.accion), ['creada', 'modificada', 'resuelta']);
  assert.ok((await pedir('GET', '/inbox', { token: laura })).datos.notificaciones.some((n) => n.tipo === 'novedad_resuelta' && n.novedadId === id));
  assert.ok((await pedir('GET', '/inbox', { token: carlos })).datos.notificaciones.some((n) => n.tipo === 'novedad_resuelta' && n.novedadId === id));
  const auditoria = (await pedir('GET', `/audit?entidad=novedad&entidadId=${id}`, { token: carlos })).datos;
  assert.deepEqual(auditoria.map((e) => e.accion), ['resuelta', 'modificada', 'creada']);
  assert.equal((await pedir('GET', '/audit', { token: laura })).status, 403);

  // En una revisión la permanente queda en curso al reportarla; si se retira el reporte, queda anulada
  const amb = (await pedir('GET', '/environments', { token: carlos })).datos.find((a) => a.codigo === '110');
  const insp = (await pedir('POST', '/inspections', { token: laura, cuerpo: { ambienteId: amb.id } })).datos;
  const nevera = insp.inventario.find((i) => i.nombre === 'Nevera industrial');
  const rep = await pedir('POST', `/inspections/${insp.id}/items`, {
    token: laura, cuerpo: { itemId: nevera.id, naturaleza: 'permanente', tipoDano: 'no_funciona', severidad: 'grave', comentario: 'La nevera no enfría desde anoche', foto: FOTO },
  });
  const reporte = rep.datos.reportes[0];
  assert.ok(reporte.novedadId, 'queda en curso en el momento de reportarla');
  assert.equal((await pedir('GET', `/persistent-issues/${reporte.novedadId}`, { token: laura })).datos.estado, 'en_curso');
  await pedir('DELETE', `/inspections/${insp.id}/items/${reporte.id}`, { token: laura });
  const anulada = (await pedir('GET', `/persistent-issues/${reporte.novedadId}`, { token: laura })).datos;
  assert.equal(anulada.estado, 'anulada');
  assert.deepEqual(anulada.eventos.map((e) => e.accion), ['creada', 'anulada']);
  assert.ok((await pedir('GET', '/issues?estado=anulada', { token: laura })).datos.some((h) => h.novedadId === reporte.novedadId));
  await pedir('POST', `/inspections/${insp.id}/cancel`, { token: laura });
});
