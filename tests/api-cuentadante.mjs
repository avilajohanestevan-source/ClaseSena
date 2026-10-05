// Cuenta antes y su revisión contra la API real (en la base y en la API el
// responsable de la cuenta antes sigue llamándose "cuentadante"):
//  · un instructor nuevo en el ambiente no puede hacer "Ingresé" hasta revisar
//    y aceptar la cuenta antes (conforme, faltante o dañado con observación);
//  · cambio de responsable: el nuevo lo es al aceptar la revisión (también
//    subiendo el acta en Excel/CSV);
//  · ambiente nuevo con responsable y cuenta antes cargada desde Excel/CSV
//    (con encabezado, placa, descripción y valor); asignar a un instructor
//    nuevo o como responsable abre la revisión;
//  · asignar con una cuenta antes nueva: el instructor la revisa aunque ya
//    conociera el ambiente.
//   npm run test:api   (Apache y MySQL encendidos, base instalada con db/instalar.php)
import { test } from 'node:test';
import assert from 'node:assert/strict';

const API = process.env.API || 'http://localhost/sena-ambientes/api/index.php';
const CLAVE = 'Sena2026*';

async function pedir(metodo, ruta, { token, cuerpo } = {}) {
  const r = await fetch(API + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const tipo = r.headers.get('Content-Type') || '';
  return { status: r.status, tipo, datos: r.status === 204 ? null : tipo.includes('json') ? await r.json() : await r.arrayBuffer() };
}
const ingresar = async (identificacion, rol) => (await pedir('POST', '/auth/login', { cuerpo: { identificacion, password: CLAVE, rol } })).datos.token;
const disponible = () => fetch(API + '/me').then(() => true, () => false);
const csv = (filas) => `data:text/csv;base64,${Buffer.from(filas.join('\n'), 'utf8').toString('base64')}`;
const hoy = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

test('instructor nuevo: revisa el inventario antes de su primera entrega', async (t) => {
  if (!await disponible()) { t.skip('API no disponible (enciende Apache y MySQL en XAMPP)'); return; }
  const rosa = await ingresar('5050505050', 'instructor');
  const laura = await ingresar('1010101010', 'instructor');
  const amb = (await pedir('GET', '/environments', { token: rosa })).datos.find((a) => a.codigo === '108');

  const bloqueo = await pedir('POST', '/inspections', { token: rosa, cuerpo: { ambienteId: amb.id } });
  assert.equal(bloqueo.status, 409);
  assert.equal(bloqueo.datos.codigo, 'REVISION_INVENTARIO');

  const mias = (await pedir('GET', '/inventory-reviews?estado=pendiente', { token: rosa })).datos;
  const rev = mias.find((r) => r.ambiente.codigo === '108' && r.tipo === 'instructor');
  assert.ok(rev, 'Rosa tiene la revisión del 108');
  assert.ok(rev.conteo.total > 10 && rev.conteo.pendientes === rev.conteo.total);
  assert.equal((await pedir('GET', `/inventory-reviews/${rev.id}`, { token: laura })).status, 403, 'otra persona no la ve');

  let d = (await pedir('GET', `/inventory-reviews/${rev.id}`, { token: rosa })).datos;
  assert.equal((await pedir('POST', `/inventory-reviews/${rev.id}/accept`, { token: rosa, cuerpo: {} })).datos.codigo, 'REVISION_INCOMPLETA');
  const [silla, mesa] = d.items;
  assert.equal((await pedir('PATCH', `/inventory-reviews/${rev.id}/items`, { token: rosa, cuerpo: { items: [{ itemId: silla.itemId, estado: 'faltante' }] } })).status, 422, 'faltante sin observación');
  // Una por pegatina escaneada (OK) y otra faltante; el resto con "Todo está bien"
  d = (await pedir('PATCH', `/inventory-reviews/${rev.id}/items`, { token: rosa, cuerpo: { items: [{ codigo: mesa.qr, estado: 'ok' }, { itemId: silla.itemId, estado: 'faltante', observacion: 'No está en el salón' }] } })).datos;
  assert.equal(d.items.find((i) => i.itemId === mesa.itemId).revision, 'ok');
  d = (await pedir('PATCH', `/inventory-reviews/${rev.id}/items`, { token: rosa, cuerpo: { todoBien: true } })).datos;
  assert.deepEqual([d.conteo.pendientes, d.conteo.faltantes], [0, 1]);
  assert.equal(d.items.find((i) => i.itemId === silla.itemId).revision, 'faltante', 'Todo está bien no cambia lo ya marcado');
  assert.equal((await pedir('POST', `/inventory-reviews/${rev.id}/accept`, { token: rosa, cuerpo: {} })).status, 422, 'con faltantes pide observación');
  const ok = await pedir('POST', `/inventory-reviews/${rev.id}/accept`, { token: rosa, cuerpo: { observaciones: 'Falta una silla, se avisó a almacén' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.datos));
  assert.equal(ok.datos.estado, 'aceptada');

  // Ya puede hacer "Ingresé"
  const insp = await pedir('POST', '/inspections', { token: rosa, cuerpo: { ambienteId: amb.id } });
  assert.ok([200, 201].includes(insp.status), JSON.stringify(insp.datos));
  await pedir('POST', `/inspections/${insp.datos.id}/cancel`, { token: rosa });
});

test('cambio de cuentadante: el acta se baja en Excel y se sube llena; al aceptar queda como cuentadante', async (t) => {
  if (!await disponible()) { t.skip('API no disponible (enciende Apache y MySQL en XAMPP)'); return; }
  const rosa = await ingresar('5050505050', 'instructor');
  const admin = await ingresar('2020202020', 'administrativo');
  let amb = (await pedir('GET', '/environments', { token: admin })).datos.find((a) => a.codigo === '111');
  assert.equal(amb.cuentadante.nombre, 'Laura Gómez Patiño');
  assert.equal(amb.cuentadantePendiente.nombre, 'Rosa Elena Quintero');
  const revId = amb.cuentadantePendiente.revisionId;

  // Excel del acta e inventario del cuentadante
  const acta = await pedir('GET', `/inventory-reviews/${revId}/export`, { token: rosa });
  assert.equal(acta.status, 200);
  assert.match(acta.tipo, /spreadsheetml/);
  const inv = await pedir('GET', `/environments/${amb.id}/inventory/export`, { token: rosa });
  assert.equal(inv.status, 200);
  assert.match(inv.tipo, /spreadsheetml/);

  // El acta llena (aquí en CSV, con encabezado como el Excel): todo OK y un dañado
  const d = (await pedir('GET', `/inventory-reviews/${revId}`, { token: rosa })).datos;
  const danado = d.items.find((i) => i.estadoItem === 'operativo');
  const filas = ['Acta de revisión de inventario · SENA', 'Ambiente;111', '', 'codigo;nombre;revision;observacion',
    ...d.items.map((i) => `${i.codigo};${i.nombre};${i.itemId === danado.itemId ? 'DAÑADO;Pantalla rota' : 'CONFORME;'}`), 'NO-EXISTE-1;Algo;OK;'];
  const sub = await pedir('POST', `/inventory-reviews/${revId}/import`, { token: rosa, cuerpo: { nombre: 'acta.csv', archivo: csv(filas) } });
  assert.equal(sub.status, 200, JSON.stringify(sub.datos));
  assert.equal(sub.datos.actualizados, d.items.length);
  assert.equal(sub.datos.errores.length, 1, 'el código que no está en la revisión se informa');
  assert.equal(sub.datos.revision.conteo.pendientes, 0);
  assert.equal((await pedir('POST', `/inventory-reviews/${revId}/import`, { token: admin, cuerpo: { nombre: 'acta.csv', archivo: csv(filas) } })).status, 403, 'solo quien recibe');

  const ok = await pedir('POST', `/inventory-reviews/${revId}/accept`, { token: rosa, cuerpo: { observaciones: 'Recibido con un equipo dañado' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.datos));
  amb = (await pedir('GET', `/environments/${amb.id}`, { token: admin })).datos;
  assert.equal(amb.cuentadante.nombre, 'Rosa Elena Quintero');
  assert.equal(amb.cuentadantePendiente, null);
  assert.equal((await pedir('GET', `/items/by-code/${danado.codigo}`, { token: admin })).datos.estado, 'danado');
  // Avisos: a coordinación y a la cuentadante anterior
  const laura = await ingresar('1010101010', 'instructor');
  assert.ok((await pedir('GET', '/inbox', { token: laura })).datos.notificaciones.some((n) => n.tipo === 'revision_inventario' && n.titulo.includes('responsable de la cuenta antes')));
});

test('ambiente nuevo con cuentadante e inventario desde Excel; asignar instructores nuevos abre la revisión', async (t) => {
  if (!await disponible()) { t.skip('API no disponible (enciende Apache y MySQL en XAMPP)'); return; }
  const admin = await ingresar('2020202020', 'administrativo');
  const almacen = await ingresar('2020202022', 'almacen');
  const laura = await ingresar('1010101010', 'instructor');
  const usuarios = (await pedir('GET', '/users?rol=instructor', { token: admin })).datos;
  const id = (n) => usuarios.find((u) => u.nombre.startsWith(n)).id;
  const codigo = `T${String(Date.now()).slice(-5)}`;

  // Crear con cuentadante: queda pendiente (aún sin cuentadante)
  const amb = await pedir('POST', '/environments', { token: admin, cuerpo: { codigo, nombre: 'Ambiente de prueba cuentadante', cuentadanteId: id('Laura') } });
  assert.equal(amb.status, 201, JSON.stringify(amb.datos));
  assert.equal(amb.datos.cuentadante, null);
  assert.equal(amb.datos.cuentadantePendiente.nombre, 'Laura Gómez Patiño');

  // Inventario del cuentadante: encabezado arriba, "placa" y "descripción", valor y sin categoría
  const archivo = csv(['Inventario del cuentadante · SENA', `Ambiente;${codigo}`, '',
    'placa;descripción;serial;valor', `PL${codigo}-1;Computador portátil;SN-1;3.250.000`, `PL${codigo}-2;Silla ergonómica;;450000`, `PL${codigo}-3;Tablero;;1.200.000,50`]);
  assert.equal((await pedir('POST', `/environments/${amb.datos.id}/inventory/import`, { token: laura, cuerpo: { nombre: 'inv.csv', archivo } })).status, 403);
  const previa = await pedir('POST', `/environments/${amb.datos.id}/inventory/import`, { token: almacen, cuerpo: { nombre: 'inv.csv', archivo, simular: true } });
  assert.equal(previa.status, 200, JSON.stringify(previa.datos));
  assert.deepEqual([previa.datos.nuevos, previa.datos.errores.length], [3, 0]);
  const carga = await pedir('POST', `/environments/${amb.datos.id}/inventory/import`, { token: almacen, cuerpo: { nombre: 'inv.csv', archivo } });
  assert.equal(carga.datos.nuevos, 3);
  const items = (await pedir('GET', `/environments/${amb.datos.id}/items`, { token: admin })).datos;
  assert.deepEqual(items.map((i) => [i.categoria, i.valor]).sort(), [['Sin clasificar', 1200000.5], ['Sin clasificar', 3250000], ['Sin clasificar', 450000]]);

  // La revisión pendiente de Laura ya trae esos ítems y bloquea su "Ingresé"
  const revLaura = (await pedir('GET', `/inventory-reviews?estado=pendiente&mias=1`, { token: laura })).datos.find((r) => r.ambiente.codigo === codigo);
  assert.equal(revLaura.conteo.total, 3);
  assert.equal((await pedir('POST', '/inspections', { token: laura, cuerpo: { ambienteId: amb.datos.id } })).datos.codigo, 'REVISION_INVENTARIO');

  // Asignar a Andrés (nuevo en el ambiente) abre su revisión de instructor
  const asig = await pedir('POST', '/assignments', { token: admin, cuerpo: { ambienteId: amb.datos.id, instructorId: id('Andrés'), jornada: 'tarde', tipo: 'permanente', fechaInicio: hoy() } });
  assert.equal(asig.status, 201, JSON.stringify(asig.datos));
  assert.ok(asig.datos.revisionInventarioId);
  // Asignar a Diana como cuentadante reemplaza el cambio pendiente hacia Laura
  const comoCuentadante = await pedir('POST', '/assignments', { token: admin, cuerpo: { ambienteId: amb.datos.id, instructorId: id('Diana'), jornada: 'noche', tipo: 'permanente', fechaInicio: hoy(), cuentadante: true } });
  assert.equal(comoCuentadante.status, 201, JSON.stringify(comoCuentadante.datos));
  const detalle = (await pedir('GET', `/environments/${amb.datos.id}`, { token: admin })).datos;
  assert.equal(detalle.cuentadantePendiente.nombre, 'Diana Marcela Ruiz');
  assert.equal((await pedir('GET', `/inventory-reviews/${revLaura.id}`, { token: admin })).datos.estado, 'anulada');
  const libre = await pedir('POST', '/inspections', { token: laura, cuerpo: { ambienteId: amb.datos.id } });
  assert.notEqual(libre.datos.codigo, 'REVISION_INVENTARIO', 'Laura ya no está bloqueada por la anulada');
  if (libre.datos.id) await pedir('POST', `/inspections/${libre.datos.id}/cancel`, { token: laura });

  // Administrativo y almacén ven todas; almacén anula la de Andrés
  const todas = (await pedir('GET', `/inventory-reviews?ambienteId=${amb.datos.id}`, { token: almacen })).datos;
  assert.equal(todas.length, 3);
  const anulada = await pedir('POST', `/inventory-reviews/${asig.datos.revisionInventarioId}/cancel`, { token: almacen, cuerpo: { motivo: 'Prueba automática' } });
  assert.equal(anulada.datos.estado, 'anulada');
});

test('asignar con una cuenta antes nueva: el instructor la revisa aunque ya conozca el ambiente', async (t) => {
  if (!await disponible()) { t.skip('API no disponible (enciende Apache y MySQL en XAMPP)'); return; }
  const admin = await ingresar('2020202020', 'administrativo');
  const andres = await ingresar('1010101011', 'instructor');
  const usuarios = (await pedir('GET', '/users?rol=instructor', { token: admin })).datos;
  const andresId = usuarios.find((u) => u.nombre.startsWith('Andrés')).id;
  const codigo = `C${String(Date.now()).slice(-5)}`;
  const amb = (await pedir('POST', '/environments', { token: admin, cuerpo: { codigo, nombre: 'Ambiente de prueba cuenta antes' } })).datos;
  const cuentaAntes = (n) => csv(['placa;descripción;valor', ...Array.from({ length: n }, (_, i) => `CA${codigo}-${i + 1};Equipo ${i + 1};100000`)]);
  assert.equal((await pedir('POST', `/environments/${amb.id}/inventory/import`, { token: admin, cuerpo: { nombre: 'ca.csv', archivo: cuentaAntes(2) } })).datos.nuevos, 2);

  // Primera asignación: revisa la cuenta antes y la acepta
  const primera = (await pedir('POST', '/assignments', { token: admin, cuerpo: { ambienteId: amb.id, instructorId: andresId, jornada: 'manana', tipo: 'permanente', fechaInicio: hoy() } })).datos;
  assert.ok(primera.revisionInventarioId);
  await pedir('PATCH', `/inventory-reviews/${primera.revisionInventarioId}/items`, { token: andres, cuerpo: { todoBien: true } });
  assert.equal((await pedir('POST', `/inventory-reviews/${primera.revisionInventarioId}/accept`, { token: andres, cuerpo: {} })).datos.estado, 'aceptada');

  // Otra jornada sin cuenta antes: ya conoce el ambiente, no revisa
  const sin = (await pedir('POST', '/assignments', { token: admin, cuerpo: { ambienteId: amb.id, instructorId: andresId, jornada: 'tarde', tipo: 'permanente', fechaInicio: hoy() } })).datos;
  assert.equal(sin.revisionInventarioId, null);

  // Con una cuenta antes nueva: revisión nueva con los ítems que se importan después
  const con = await pedir('POST', '/assignments', { token: admin, cuerpo: { ambienteId: amb.id, instructorId: andresId, jornada: 'noche', tipo: 'permanente', fechaInicio: hoy(), cuentaAntes: true } });
  assert.equal(con.status, 201, JSON.stringify(con.datos));
  assert.ok(con.datos.revisionInventarioId);
  assert.notEqual(con.datos.revisionInventarioId, primera.revisionInventarioId);
  assert.equal((await pedir('POST', `/environments/${amb.id}/inventory/import`, { token: admin, cuerpo: { nombre: 'ca.csv', archivo: cuentaAntes(3) } })).datos.nuevos, 1);
  const rev = (await pedir('GET', `/inventory-reviews/${con.datos.revisionInventarioId}`, { token: andres })).datos;
  assert.deepEqual([rev.tipo, rev.conteo.total, rev.conteo.pendientes], ['instructor', 3, 3]);
  assert.match(rev.motivo, /cuenta antes nueva/);
  assert.equal((await pedir('POST', '/inspections', { token: andres, cuerpo: { ambienteId: amb.id } })).datos.codigo, 'REVISION_INVENTARIO');
  // El acta en Excel usa CONFORME
  const acta = await pedir('GET', `/inventory-reviews/${rev.id}/export`, { token: andres });
  assert.equal(acta.status, 200);
  assert.ok(acta.tipo.includes('spreadsheetml'));
  await pedir('POST', `/inventory-reviews/${rev.id}/cancel`, { token: admin, cuerpo: { motivo: 'Prueba automática' } });
});
