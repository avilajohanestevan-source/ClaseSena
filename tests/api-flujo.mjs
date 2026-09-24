// Prueba de punta a punta contra la API real (PHP + MySQL de XAMPP).
//   npm run test:api            (usa http://localhost/sena-ambientes/api/index.php)
//   API=http://otro/api/index.php npm run test:api
// Requiere Apache y MySQL encendidos y la base instalada (php db/instalar.php).
// Deja datos nuevos en la base: vuelve a correr db/instalar.php para limpiar.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const API = process.env.API || 'http://localhost/sena-ambientes/api/index.php';
const CLAVE = 'Sena2026*';
const FOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function pedir(metodo, ruta, { token, cuerpo } = {}) {
  const r = await fetch(API + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  return { status: r.status, datos: r.status === 204 ? null : await r.json() };
}
const ingresar = async (identificacion, rol) => (await pedir('POST', '/auth/login', { cuerpo: { identificacion, password: CLAVE, rol } })).datos;

test('flujo completo: el instructor revisa y reporta daños, el portero genera el QR, el instructor lo escanea y coordinación recibe el aviso', async (t) => {
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

  // La instructora Diana revisa el 109 (portera asignada: Martha); el portero no puede iniciar la revisión
  const instructor = await ingresar('1010101012', 'instructor');
  const portero = await ingresar('4040404041', 'portero');
  const amb = ambientes.find((x) => x.codigo === '109');
  assert.equal((await pedir('POST', '/inspections', { token: portero.token, cuerpo: { ambienteId: amb.id } })).status, 403);
  const inicio = await pedir('POST', '/inspections', { token: instructor.token, cuerpo: { ambienteId: amb.id } });
  assert.ok([200, 201].includes(inicio.status), JSON.stringify(inicio.datos));
  const insp = inicio.datos;
  assert.equal(insp.estado, 'en_curso');
  assert.equal(insp.instructor.nombre, 'Diana Marcela Ruiz');
  assert.equal(insp.qr, null);

  // Escanea el ítem dañado y deja evidencia → inspection_items vinculado a inventory_items; el inventario queda "danado"
  const item = insp.inventario.find((i) => !i.reportado && i.estado === 'operativo');
  const dano = await pedir('POST', `/inspections/${insp.id}/items`, {
    token: instructor.token, cuerpo: { codigo: item.qr, tipoDano: 'rotura', severidad: 'moderada', comentario: 'Prueba automática de reporte de daño', foto: FOTO },
  });
  assert.equal(dano.status, 201, JSON.stringify(dano.datos));
  const reporte = dano.datos.reportes.find((r) => r.itemId === item.id);
  assert.ok(reporte && reporte.foto, 'el reporte debe apuntar al ítem y guardar la foto');
  assert.equal((await pedir('GET', `/items/by-code/${item.codigo}`, { token: instructor.token })).datos.estado, 'danado');

  // Termina la revisión → se avisa al portero; todavía no hay QR
  assert.equal((await pedir('POST', `/inspections/${insp.id}/qr`, { token: portero.token })).status, 409);
  const checklist = insp.checklist.map((c) => ({ clave: c.clave, ok: true }));
  const conf = await pedir('POST', `/inspections/${insp.id}/confirm`, { token: instructor.token, cuerpo: { checklist } });
  assert.equal(conf.status, 200, JSON.stringify(conf.datos));
  assert.equal(conf.datos.estado, 'pendiente_recepcion');
  assert.equal(conf.datos.resultado, 'con_danos');
  const bPortero = (await pedir('GET', '/inbox', { token: portero.token })).datos;
  assert.ok(bPortero.notificaciones.some((n) => n.inspeccionId === insp.id && n.tipo === 'revision_lista'));

  // El portero genera el QR; el instructor nunca recibe el texto del QR por la API
  const gen = await pedir('POST', `/inspections/${insp.id}/qr`, { token: portero.token });
  assert.equal(gen.status, 200, JSON.stringify(gen.datos));
  assert.ok(gen.datos.qr.startsWith('SENA-INSP:') && gen.datos.qrGeneradoEn);
  assert.equal((await pedir('GET', `/inspections/${insp.id}`, { token: instructor.token })).datos.qr, null);
  const token = gen.datos.qr.replace('SENA-INSP:', '');

  // Otro instructor no puede usar ese QR
  const otro = await ingresar('1010101010', 'instructor');
  assert.equal((await pedir('POST', `/inspections/by-qr/${token}/receive`, { token: otro.token })).status, 403);

  // La instructora escanea el QR: queda recibido con quién entregó y quién recibió
  const rec = await pedir('POST', `/inspections/by-qr/${token}/receive`, { token: instructor.token });
  assert.equal(rec.status, 200, JSON.stringify(rec.datos));
  const final = rec.datos;
  assert.equal(final.estado, 'recibida');
  assert.equal(final.instructor.nombre, 'Diana Marcela Ruiz');
  assert.equal(final.portero.nombre, 'Martha Lucía Peña');
  assert.ok(final.iniciadaEn && final.confirmadaEn && final.qrGeneradoEn && final.recibidaEn);
  assert.equal(final.entrega.nombre, 'Martha Lucía Peña');
  assert.equal(final.recibe.nombre, 'Diana Marcela Ruiz');

  // Notificaciones: al portero (recibido) y a coordinación (daños)
  const bPortero2 = (await pedir('GET', '/inbox', { token: portero.token })).datos;
  assert.ok(bPortero2.notificaciones.some((n) => n.inspeccionId === insp.id && n.tipo === 'entrega_recibida'));
  const bAdmin = (await pedir('GET', '/inbox', { token: admin.token })).datos;
  assert.ok(bAdmin.notificaciones.some((n) => n.inspeccionId === insp.id && n.tipo === 'dano_reportado'));

  // El administrativo lo ve en el reporte
  const rep = (await pedir('GET', '/reports', { token: admin.token })).datos;
  assert.ok(rep.danos.some((d) => d.inspeccionId === insp.id && d.codigo === item.codigo));
});
