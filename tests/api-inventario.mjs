// Inventario contra la API real: carga masiva (Excel con PhpSpreadsheet y
// CSV), registro por escaneo, reimpresión de etiquetas, trazabilidad y, en
// la revisión, "todo está bien" y daños del salón sin ítem.
//   npm run test:api   (Apache y MySQL encendidos, base instalada con db/instalar.php)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const API = process.env.API || 'http://localhost/sena-ambientes/api/index.php';
const CLAVE = 'Sena2026*';
const FOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function pedir(metodo, ruta, { token, cuerpo } = {}) {
  const r = await fetch(API + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const tipo = r.headers.get('content-type') || '';
  return { status: r.status, tipo, datos: r.status === 204 ? null : tipo.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
}
const ingresar = async (identificacion, rol) => (await pedir('POST', '/auth/login', { cuerpo: { identificacion, password: CLAVE, rol } })).datos.token;
const disponible = () => fetch(API + '/me').then(() => true, () => false);
const aDataUrl = (buffer, tipo) => `data:${tipo};base64,${Buffer.from(buffer).toString('base64')}`;

test('carga masiva, escaneo, etiquetas y trazabilidad del inventario', async (t) => {
  if (!await disponible()) { t.skip('API no disponible (enciende Apache y MySQL en XAMPP)'); return; }
  const admin = await ingresar('2020202020', 'administrativo');
  const instructor = await ingresar('1010101010', 'instructor');

  // El Excel de prueba ya se cargó al instalar: volver a subirlo no cambia nada.
  const excel = readFileSync(new URL('../db/inventario-prueba.xlsx', import.meta.url));
  const vista = await pedir('POST', '/items/import', { token: admin, cuerpo: { nombre: 'inventario-prueba.xlsx', archivo: aDataUrl(excel, 'application/octet-stream'), simular: true } });
  assert.equal(vista.status, 200, JSON.stringify(vista.datos));
  assert.equal(vista.datos.nuevos, 0);
  assert.equal(vista.datos.errores.length, 0);
  assert.ok(vista.datos.sinCambios > 100);
  assert.equal((await pedir('POST', '/items/import', { token: instructor, cuerpo: { nombre: 'x.csv', archivo: 'data:text/csv,a' } })).status, 403);

  // CSV con una fila nueva, una que actualiza y dos con error
  const csv = 'ambiente;codigo;nombre;categoria;serial;estado\n'
    + '108;;Teclado inalámbrico prueba;Cómputo;TEST-KB-01;Operativo\n'
    + '108;SILLA-108-01;Silla #1;Mobiliario;;En reparación\n'
    + '999;;Algo;Mobiliario;;\n'
    + '107;;Mesa sin categoría;;;\n';
  const archivo = aDataUrl(Buffer.from(csv, 'utf8'), 'text/csv');
  const previa = (await pedir('POST', '/items/import', { token: admin, cuerpo: { nombre: 'prueba.csv', archivo, simular: true } })).datos;
  assert.deepEqual([previa.nuevos, previa.actualizados, previa.errores.map((e) => e.fila)], [1, 1, [4, 5]]);
  assert.equal((await pedir('GET', '/items/by-code/SILLA-108-01', { token: admin })).datos.estado, 'operativo', 'simular no guarda');
  const carga = (await pedir('POST', '/items/import', { token: admin, cuerpo: { nombre: 'prueba.csv', archivo } })).datos;
  assert.deepEqual([carga.nuevos, carga.actualizados], [1, 1]);
  const nuevo = carga.filas.find((f) => f.accion === 'nuevo');
  assert.match(nuevo.codigo, /^AMB108-\d{3}$/);
  const silla = (await pedir('GET', '/items/by-code/SENA-INV:SILLA-108-01', { token: admin })).datos;
  assert.equal(silla.estado, 'en_reparacion');

  // Exportar a Excel (misma estructura que la carga)
  const xlsx = await pedir('GET', '/items/export?ambienteId=1', { token: admin });
  assert.equal(xlsx.status, 200);
  assert.ok(xlsx.tipo.includes('spreadsheetml') && xlsx.datos.subarray(0, 2).toString() === 'PK');

  // Registro rápido con lector: código nuevo → se crea; repetido → se devuelve
  const reg = await pedir('POST', '/items/scan', { token: admin, cuerpo: { codigo: 'SENA-INV:MOUSE-TEST-01', ambienteId: 2, nombre: 'Mouse', categoria: 'Cómputo' } });
  assert.equal(reg.status, 201, JSON.stringify(reg.datos));
  assert.ok(reg.datos.creado);
  assert.equal(reg.datos.item.codigo, 'MOUSE-TEST-01');
  const otraVez = (await pedir('POST', '/items/scan', { token: admin, cuerpo: { codigo: 'MOUSE-TEST-01', ambienteId: 1, nombre: 'Mouse', categoria: 'Cómputo' } })).datos;
  assert.equal(otraVez.creado, false);
  assert.equal(otraVez.otroAmbiente, true);
  assert.equal((await pedir('POST', '/items/scan', { token: admin, cuerpo: { codigo: 'no válido!', ambienteId: 1, nombre: 'X', categoria: 'Y' } })).status, 422);

  // Reimpresión de etiqueta y trazabilidad
  assert.equal((await pedir('POST', '/items/labels', { token: instructor, cuerpo: { ids: [silla.id], motivo: 'Etiqueta despegada' } })).status, 200);
  await pedir('POST', '/items/labels', { token: admin, cuerpo: { ids: [silla.id] } });
  const hist = (await pedir('GET', `/items/${silla.id}/history`, { token: admin })).datos;
  const acciones = hist.map((h) => h.accion);
  assert.deepEqual(acciones.slice(0, 3), ['etiqueta', 'etiqueta', 'carga_masiva']);
  assert.match(hist[0].detalle, /reimpresa/);
  assert.match(hist[1].detalle, /impresa: Etiqueta despegada/);
});

test('revisión: "todo está bien" sin revisar ítem por ítem y daño del salón sin ítem', async (t) => {
  if (!await disponible()) { t.skip('API no disponible'); return; }
  const admin = await ingresar('2020202020', 'administrativo');
  const laura = await ingresar('1010101010', 'instructor');
  const andres = await ingresar('1010101011', 'instructor');
  const ambientes = (await pedir('GET', '/environments', { token: admin })).datos;
  const libre = (codigo) => ambientes.find((a) => a.codigo === codigo);

  // Todo bien en un solo paso
  const r1 = (await pedir('POST', '/inspections', { token: laura, cuerpo: { ambienteId: libre('107').id } })).datos;
  const ok = await pedir('POST', `/inspections/${r1.id}/confirm`, { token: laura, cuerpo: { todoBien: true } });
  assert.equal(ok.status, 200, JSON.stringify(ok.datos));
  assert.equal(ok.datos.resultado, 'ok');
  assert.ok(ok.datos.checklist.every((c) => c.ok === true));

  // Daño en la pared: sin ítem, con foto, asociado al ambiente
  const r2 = (await pedir('POST', '/inspections', { token: andres, cuerpo: { ambienteId: libre('108').id } })).datos;
  assert.equal((await pedir('POST', `/inspections/${r2.id}/items`, { token: andres, cuerpo: { ubicacion: 'pared', tipoDano: 'rotura', severidad: 'leve', comentario: 'Grieta en la pared del fondo' } })).status, 422, 'sin foto no');
  const pared = await pedir('POST', `/inspections/${r2.id}/items`, { token: andres, cuerpo: { ubicacion: 'pared', tipoDano: 'rotura', severidad: 'leve', comentario: 'Grieta en la pared del fondo', foto: FOTO } });
  assert.equal(pared.status, 201, JSON.stringify(pared.datos));
  const rep = pared.datos.reportes[0];
  assert.deepEqual([rep.itemId, rep.ubicacion, rep.nombre], [null, 'pared', 'Pared']);
  assert.ok(rep.foto);
  // Con daños ya no se puede marcar "todo bien"
  assert.equal((await pedir('POST', `/inspections/${r2.id}/confirm`, { token: andres, cuerpo: { todoBien: true } })).status, 422);
  const fin = await pedir('POST', `/inspections/${r2.id}/confirm`, {
    token: andres, cuerpo: { checklist: r2.checklist.map((c) => ({ clave: c.clave, ok: true })) },
  });
  assert.equal(fin.datos.resultado, 'con_danos');

  // Portero genera QR, instructor lo escanea → coordinación recibe el detalle del salón
  const portero = await ingresar('4040404040', 'portero');
  const qr = (await pedir('POST', `/inspections/${r2.id}/qr`, { token: portero })).datos.qr.replace('SENA-INSP:', '');
  assert.equal((await pedir('POST', `/inspections/by-qr/${qr}/receive`, { token: andres })).status, 200);
  const bandeja = (await pedir('GET', '/inbox', { token: admin })).datos;
  const aviso = bandeja.notificaciones.find((n) => n.inspeccionId === r2.id);
  assert.ok(aviso, 'coordinación debe recibir el aviso');
  assert.match(aviso.detalle, /daño\(s\) del salón \(pared\)/);
  const reporte = (await pedir('GET', '/reports', { token: admin })).datos;
  assert.ok(reporte.danos.some((d) => d.inspeccionId === r2.id && d.item === 'Salón · Pared'));
});
