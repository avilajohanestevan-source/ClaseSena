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

test('flujo completo: inspección con daño, confirmación, notificación al portero y recepción', async (t) => {
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

  // El instructor Diana (109 → portera Martha) inicia la inspección
  const instructor = await ingresar('1010101012', 'instructor');
  const amb = ambientes.find((x) => x.codigo === '109');
  const inicio = await pedir('POST', '/inspections', { token: instructor.token, cuerpo: { ambienteId: amb.id } });
  assert.ok([200, 201].includes(inicio.status), JSON.stringify(inicio.datos));
  const insp = inicio.datos;
  assert.equal(insp.estado, 'en_curso');
  assert.ok(insp.iniciadaEn && insp.qr.startsWith('SENA-INSP:'));

  // Reporte de daño → inspection_items vinculado a inventory_items
  const item = insp.inventario.find((i) => !i.reportado && i.estado === 'operativo');
  const dano = await pedir('POST', `/inspections/${insp.id}/items`, {
    token: instructor.token, cuerpo: { codigo: item.qr, tipoDano: 'rotura', severidad: 'moderada', comentario: 'Prueba automática de reporte de daño' },
  });
  assert.equal(dano.status, 201);
  const reporte = dano.datos.reportes.find((r) => r.itemId === item.id);
  assert.ok(reporte, 'el reporte debe apuntar al ítem del inventario');
  assert.equal((await pedir('GET', `/items/by-code/${item.codigo}`, { token: instructor.token })).datos.estado, 'danado');

  // Confirmación con firma
  const checklist = insp.checklist.map((c) => ({ clave: c.clave, ok: true }));
  const conf = await pedir('POST', `/inspections/${insp.id}/confirm`, {
    token: instructor.token, cuerpo: { checklist, firma: FIRMA, nombreFirma: 'Diana Marcela Ruiz' },
  });
  assert.equal(conf.status, 200, JSON.stringify(conf.datos));
  assert.equal(conf.datos.estado, 'pendiente_recepcion');
  assert.equal(conf.datos.resultado, 'con_danos');
  assert.ok(conf.datos.firmaInstructor.fecha);

  // El portero asignado recibe la notificación
  const portero = await ingresar('4040404041', 'portero');
  const bandeja = (await pedir('GET', '/inbox', { token: portero.token })).datos;
  assert.ok(bandeja.notificaciones.some((n) => n.inspeccionId === insp.id && n.tipo === 'inspeccion_confirmada'));

  // Firma de recepción: queda con instructor_id, portero_id, firmas y timestamps
  const rec = await pedir('POST', `/inspections/${insp.id}/receive`, { token: portero.token, cuerpo: { firma: FIRMA, nombreFirma: 'Martha Lucia Pena' } });
  assert.equal(rec.status, 200);
  const final = rec.datos;
  assert.equal(final.estado, 'recibida');
  assert.equal(final.instructor.nombre, 'Diana Marcela Ruiz');
  assert.equal(final.portero.nombre, 'Martha Lucía Peña');
  assert.ok(final.iniciadaEn && final.confirmadaEn && final.recibidaEn);
  assert.ok(final.firmaInstructor.imagen && final.firmaPortero.imagen);

  // El administrativo lo ve en el reporte
  const rep = (await pedir('GET', '/reports', { token: admin.token })).datos;
  assert.ok(rep.danos.some((d) => d.inspeccionId === insp.id && d.codigo === item.codigo));
});
