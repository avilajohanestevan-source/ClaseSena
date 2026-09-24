// Prueba de punta a punta contra la API real (PHP + MySQL de XAMPP).
//   npm run test:api            (usa http://localhost/sena-ambientes/api/index.php)
//   API=http://otro/api/index.php npm run test:api
// Requiere Apache y MySQL encendidos y la base instalada (php db/instalar.php).
// Deja datos nuevos en la base: vuelve a correr db/instalar.php para limpiar.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const API = process.env.API || 'http://localhost/sena-ambientes/api/index.php';
const CLAVE = 'Sena2026*';
const FIRMA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function pedir(metodo, ruta, { token, cuerpo } = {}) {
  const r = await fetch(API + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  return { status: r.status, datos: r.status === 204 ? null : await r.json() };
}
const ingresar = async (identificacion, rol) => (await pedir('POST', '/auth/login', { cuerpo: { identificacion, password: CLAVE, rol } })).datos;

test('flujo completo: el portero revisa y entrega con QR, el instructor lo escanea y coordinación recibe los daños', async (t) => {
  let disponible = true;
  await fetch(API + '/me').catch(() => { disponible = false; });
  if (!disponible) { t.skip('API no disponible (enciende Apache y MySQL en XAMPP)'); return; }

  // Datos de prueba exigidos
  const admin = await ingresar('2020202020', 'administrativo');
  const usuarios = (await pedir('GET', '/users', { token: admin.token })).datos;
  const cuenta = (rol) => usuarios.filter((u) => u.rol === rol).length;
  assert.deepEqual([cuenta('instructor'), cuenta('portero'), cuenta('administrativo'), cuenta('aprendiz')], [3, 2, 1, 3]);
  const ambientes = (await pedir('GET', '/environments', { token: admin.token })).datos;
  for (const codigo of ['107', '108', '109']) {
    const a = ambientes.find((x) => x.codigo === codigo);
    assert.ok(a, `falta el ambiente ${codigo}`);
    assert.ok((await pedir('GET', `/environments/${a.id}/items`, { token: admin.token })).datos.length >= 10);
  }

  // Permisos por rol
  assert.equal((await pedir('POST', '/auth/login', { cuerpo: { identificacion: '4040404040', password: CLAVE, rol: 'instructor' } })).status, 403);
  const aprendiz = await ingresar('1122334455', 'aprendiz');
  assert.equal((await pedir('GET', '/inspections', { token: aprendiz.token })).status, 403);

  // La portera Martha (109) revisa el ambiente; el instructor no puede iniciar la revisión
  const portero = await ingresar('4040404041', 'portero');
  const instructor = await ingresar('1010101012', 'instructor');
  const amb = ambientes.find((x) => x.codigo === '109');
  assert.equal((await pedir('POST', '/inspections', { token: instructor.token, cuerpo: { ambienteId: amb.id } })).status, 403);
  const inicio = await pedir('POST', '/inspections', { token: portero.token, cuerpo: { ambienteId: amb.id } });
  assert.ok([200, 201].includes(inicio.status), JSON.stringify(inicio.datos));
  const insp = inicio.datos;
  assert.equal(insp.estado, 'en_curso');
  assert.equal(insp.portero.nombre, 'Martha Lucía Peña');
  assert.equal(insp.instructor, null);

  // Reporte de daño → inspection_items vinculado a inventory_items; el inventario queda "danado"
  const item = insp.inventario.find((i) => !i.reportado && i.estado === 'operativo');
  const dano = await pedir('POST', `/inspections/${insp.id}/items`, {
    token: portero.token, cuerpo: { codigo: item.qr, tipoDano: 'rotura', severidad: 'moderada', comentario: 'Prueba automática de reporte de daño' },
  });
  assert.equal(dano.status, 201);
  assert.ok(dano.datos.reportes.find((r) => r.itemId === item.id), 'el reporte debe apuntar al ítem del inventario');
  assert.equal((await pedir('GET', `/items/by-code/${item.codigo}`, { token: portero.token })).datos.estado, 'danado');

  // El portero confirma la entrega con firma: se genera el QR
  const checklist = insp.checklist.map((c) => ({ clave: c.clave, ok: true }));
  const conf = await pedir('POST', `/inspections/${insp.id}/confirm`, {
    token: portero.token, cuerpo: { checklist, firma: FIRMA, nombreFirma: 'Martha Lucía Peña' },
  });
  assert.equal(conf.status, 200, JSON.stringify(conf.datos));
  assert.equal(conf.datos.estado, 'pendiente_recepcion');
  assert.equal(conf.datos.resultado, 'con_danos');
  assert.ok(conf.datos.firmaPortero.fecha && conf.datos.firmaPortero.imagen);
  assert.notEqual(conf.datos.qr, insp.qr, 'el QR se regenera al confirmar');
  const token = conf.datos.qr.replace('SENA-INSP:', '');
  assert.equal((await pedir('POST', `/inspections/by-qr/${insp.qr.replace('SENA-INSP:', '')}/receive`, { token: instructor.token })).status, 404);

  // El instructor escanea el QR y recibe el ambiente
  const rec = await pedir('POST', `/inspections/by-qr/${token}/receive`, { token: instructor.token });
  assert.equal(rec.status, 200, JSON.stringify(rec.datos));
  const final = rec.datos;
  assert.equal(final.estado, 'recibida');
  assert.equal(final.portero.nombre, 'Martha Lucía Peña');
  assert.equal(final.instructor.nombre, 'Diana Marcela Ruiz');
  assert.ok(final.iniciadaEn && final.confirmadaEn && final.recibidaEn);
  assert.equal(final.firmaInstructor.nombre, 'Diana Marcela Ruiz');
  // El mismo QR no sirve para otro instructor
  const otro = await ingresar('1010101010', 'instructor');
  assert.equal((await pedir('POST', `/inspections/by-qr/${token}/receive`, { token: otro.token })).status, 409);

  // Notificaciones: al portero (recibido) y a coordinación (daños)
  const bPortero = (await pedir('GET', '/inbox', { token: portero.token })).datos;
  assert.ok(bPortero.notificaciones.some((n) => n.inspeccionId === insp.id && n.tipo === 'entrega_recibida'));
  const bAdmin = (await pedir('GET', '/inbox', { token: admin.token })).datos;
  assert.ok(bAdmin.notificaciones.some((n) => n.inspeccionId === insp.id && n.tipo === 'dano_reportado'));

  // El administrativo lo ve en el reporte
  const rep = (await pedir('GET', '/reports', { token: admin.token })).datos;
  assert.ok(rep.danos.some((d) => d.inspeccionId === insp.id && d.codigo === item.codigo));
});
