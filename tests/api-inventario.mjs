// Inventario contra la API real: carga masiva (Excel con PhpSpreadsheet y
// CSV) con categorías, familias y QR, registro por escaneo (crea o
// actualiza), reimpresión de etiquetas, trazabilidad y, en la revisión,
// los ítems OK al terminar y daños del salón sin ítem.
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
  const vista = await pedir('POST', '/inventory/import', { token: admin, cuerpo: { nombre: 'inventario-prueba.xlsx', archivo: aDataUrl(excel, 'application/octet-stream'), simular: true } });
  assert.equal(vista.status, 200, JSON.stringify(vista.datos));
  assert.deepEqual([vista.datos.nuevos, vista.datos.familiasNuevas, vista.datos.errores.length], [0, 0, 0]);
  assert.ok(vista.datos.sinCambios > 100);
  assert.equal((await pedir('POST', '/items/import', { token: instructor, cuerpo: { nombre: 'x.csv', archivo: 'data:text/csv,a' } })).status, 403);
  // La carga dejó el monitor, el teclado y el mouse en la familia PC de su puesto, y la placa vieja en el QR
  const monitor = (await pedir('GET', '/inventory/lookup?codigo=SAM-S24-10701', { token: admin })).status;
  assert.equal(monitor, 404, 'el serial no es un código de pegatina');
  const pc1 = (await pedir('GET', '/inventory/families?ambienteId=1', { token: admin })).datos.find((f) => f.codigo === 'FAM107-PC01');
  assert.equal(pc1.componentesTotal, 4);
  assert.equal((await pedir('GET', '/inventory/lookup?codigo=PLACA-SENA-000457', { token: admin })).datos.item.codigo, 'AMB107-005');

  // CSV: nuevo, actualiza, nuevo con familia nueva y QR propio, y cuatro con error
  const csv = 'ambiente;codigo;nombre;categoria;serial;estado;familia;familia_nombre;familia_tipo;qr\n'
    + '108;;Teclado inalámbrico prueba;Periféricos;TEST-KB-01;Operativo;;;;\n'
    + '108;SILLA-108-01;Silla #1;Mobiliario;;En reparación;;;;\n'
    + '999;;Algo;Mobiliario;;;;;;\n'
    + '107;;Mesa sin categoría;;;;;;;\n'
    + '107;;Licuadora;Cómputo;;;;;;\n'
    + '108;;Monitor prueba;periféricos;TEST-MON-01;Fuera de servicio;FAM108-TEST01;Puesto de prueba;PC;QR-PRUEBA-0001\n'
    + '107;;Mouse prueba;Periféricos;TEST-MS-01;;FAM108-PC01;;;\n';
  const archivo = aDataUrl(Buffer.from(csv, 'utf8'), 'text/csv');
  const previa = (await pedir('POST', '/items/import', { token: admin, cuerpo: { nombre: 'prueba.csv', archivo, simular: true } })).datos;
  assert.deepEqual([previa.nuevos, previa.actualizados, previa.familiasNuevas, previa.errores.map((e) => e.fila)], [2, 1, 1, [4, 5, 6, 8]]);
  assert.match(previa.errores.find((e) => e.fila === 6).mensaje, /categoría "Cómputo" no existe/);
  assert.match(previa.errores.find((e) => e.fila === 8).mensaje, /FAM108-PC01 es del ambiente 108/);
  assert.equal((await pedir('GET', '/items/by-code/SILLA-108-01', { token: admin })).datos.estado, 'operativo', 'simular no guarda');
  const carga = (await pedir('POST', '/inventory/import', { token: admin, cuerpo: { nombre: 'prueba.csv', archivo } })).datos;
  assert.deepEqual([carga.nuevos, carga.actualizados, carga.familiasNuevas], [2, 1, 1]);
  const nuevo = carga.filas.find((f) => f.accion === 'nuevo');
  assert.match(nuevo.codigo, /^AMB108-\d{3}$/);
  const silla = (await pedir('GET', '/items/by-code/SENA-INV:SILLA-108-01', { token: admin })).datos;
  assert.equal(silla.estado, 'en_reparacion');
  const conQr = (await pedir('GET', '/inventory/lookup?codigo=QR-PRUEBA-0001', { token: admin })).datos.item;
  assert.deepEqual([conQr.categoria, conQr.estado, conQr.familia.codigo, conQr.familia.tipo], ['Periféricos', 'fuera_servicio', 'FAM108-TEST01', 'PC']);

  // Exportar a Excel (misma estructura que la carga)
  const xlsx = await pedir('GET', '/inventory/export?ambienteId=1', { token: admin });
  assert.equal(xlsx.status, 200);
  assert.ok(xlsx.tipo.includes('spreadsheetml') && xlsx.datos.subarray(0, 2).toString() === 'PK');

  // Registro con lector: código nuevo → se crea; el mismo en otro ambiente → se actualiza (se traslada)
  const reg = await pedir('POST', '/items/scan', { token: admin, cuerpo: { codigo: 'SENA-INV:MOUSE-TEST-01', ambienteId: 2, nombre: 'Mouse', categoria: 'Periféricos' } });
  assert.equal(reg.status, 201, JSON.stringify(reg.datos));
  assert.ok(reg.datos.creado);
  assert.equal(reg.datos.item.codigo, 'MOUSE-TEST-01');
  assert.equal(reg.datos.item.qr, 'SENA-INV:MOUSE-TEST-01');
  const otraVez = (await pedir('POST', '/items/scan', { token: admin, cuerpo: { codigo: 'MOUSE-TEST-01', ambienteId: 1, nombre: 'Mouse', categoria: 'Periféricos', familiaId: pc1.id } })).datos;
  assert.deepEqual([otraVez.creado, otraVez.actualizado, otraVez.otroAmbiente, otraVez.movidoDesde, otraVez.item.ambiente], [false, true, true, '108', '107']);
  assert.equal(otraVez.item.familia.codigo, 'FAM107-PC01');
  assert.equal((await pedir('GET', `/items/${otraVez.item.id}/history`, { token: admin })).datos[0].accion, 'traslado');
  // Un QR de otro sistema (no es un código): se genera el consecutivo y lo leído queda como su QR
  const ajeno = await pedir('POST', '/items/scan', { token: admin, cuerpo: { codigo: 'https://activos.ejemplo/placa/55', ambienteId: 1, nombre: 'Lámpara', categoria: 'Electrodomésticos' } });
  assert.equal(ajeno.status, 201, JSON.stringify(ajeno.datos));
  assert.match(ajeno.datos.item.codigo, /^AMB107-\d{3}$/);
  assert.equal(ajeno.datos.item.qr, 'https://activos.ejemplo/placa/55');
  assert.equal((await pedir('POST', '/items/scan', { token: admin, cuerpo: { codigo: '   ', ambienteId: 1, nombre: 'X', categoria: 'Mobiliario' } })).status, 422);
  assert.equal((await pedir('POST', '/items/scan', { token: admin, cuerpo: { codigo: 'SENA-FAM:FAM107-PC01', ambienteId: 1, nombre: 'X', categoria: 'Mobiliario' } })).datos.codigo, 'ES_FAMILIA');

  // Reimpresión de etiquetas (ítems y familias) y trazabilidad
  assert.equal((await pedir('POST', '/items/labels', { token: instructor, cuerpo: { ids: [silla.id], motivo: 'Etiqueta despegada' } })).status, 200);
  const reimpresion = (await pedir('POST', '/inventory/labels', { token: admin, cuerpo: { ids: [silla.id], familiaIds: [pc1.id] } })).datos;
  assert.equal(reimpresion.registradas, 2);
  assert.deepEqual(reimpresion.etiquetas.map((e) => [e.tipo, e.qr, e.reimpresion]), [['item', 'SENA-INV:SILLA-108-01', true], ['familia', 'SENA-FAM:FAM107-PC01', false]]);
  const hist = (await pedir('GET', `/items/${silla.id}/history`, { token: admin })).datos;
  assert.deepEqual(hist.slice(0, 3).map((h) => h.accion), ['etiqueta', 'etiqueta', 'carga_masiva']);
  assert.match(hist[0].detalle, /reimpresa/);
  assert.match(hist[1].detalle, /impresa: Etiqueta despegada/);
});

test('revisión: "todo está bien" no confirma por sí solo; ítems OK al terminar y daño del salón sin ítem', async (t) => {
  if (!await disponible()) { t.skip('API no disponible'); return; }
  const admin = await ingresar('2020202020', 'administrativo');
  const laura = await ingresar('1010101010', 'instructor');
  const andres = await ingresar('1010101011', 'instructor');
  const portero = await ingresar('4040404040', 'portero');
  const ambientes = (await pedir('GET', '/environments', { token: admin })).datos;
  const libre = (codigo) => ambientes.find((a) => a.codigo === codigo);

  // El antiguo atajo {todoBien: true} ya no termina la revisión: hace falta el checklist explícito
  const r1 = (await pedir('POST', '/inspections', { token: laura, cuerpo: { ambienteId: libre('107').id } })).datos;
  assert.ok(r1.novedadesActivas.some((n) => n.objetivo.codigo === 'AMB107-007'), 'el aire del 107 ya tiene una novedad activa');
  assert.equal((await pedir('POST', `/inspections/${r1.id}/confirm`, { token: laura, cuerpo: { todoBien: true } })).status, 422);
  assert.equal((await pedir('GET', `/inspections/${r1.id}`, { token: laura })).datos.estado, 'en_curso');
  // Lo que hace la pantalla con "Todo está bien": checklist y todos los ítems OK, y el instructor termina
  const ok = await pedir('POST', `/inspections/${r1.id}/confirm`, {
    token: laura, cuerpo: { checklist: r1.checklist.map((c) => ({ clave: c.clave, ok: true })), itemsOk: r1.inventario.map((i) => i.id) },
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.datos));
  assert.equal(ok.datos.resultado, 'ok');
  assert.equal(ok.datos.itemsOk.length, r1.inventario.length);
  const ajeno = (await pedir('GET', '/items/by-code/SILLA-107-02', { token: admin })).datos;
  const r1qr = (await pedir('POST', `/inspections/${r1.id}/qr`, { token: portero })).datos.qr.replace('SENA-INSP:', '');
  const recibido = (await pedir('POST', `/inspections/by-qr/${r1qr}/receive`, { token: laura })).datos;
  assert.equal(recibido.estadoSalon.items.marcadosOk, r1.inventario.length);
  assert.equal(recibido.estadoSalon.reportes.total, 0);

  // Daño en la pared: sin ítem, con foto, asociado al ambiente
  const r2 = (await pedir('POST', '/inspections', { token: andres, cuerpo: { ambienteId: libre('108').id } })).datos;
  assert.equal((await pedir('POST', `/inspections/${r2.id}/items`, { token: andres, cuerpo: { ubicacion: 'pared', tipoDano: 'rotura', severidad: 'leve', comentario: 'Grieta en la pared del fondo' } })).status, 422, 'sin foto no');
  const pared = await pedir('POST', `/inspections/${r2.id}/items`, { token: andres, cuerpo: { ubicacion: 'pared', tipoDano: 'rotura', severidad: 'leve', comentario: 'Grieta en la pared del fondo', foto: FOTO } });
  assert.equal(pared.status, 201, JSON.stringify(pared.datos));
  const rep = pared.datos.reportes[0];
  assert.deepEqual([rep.itemId, rep.familiaId, rep.ubicacion, rep.nombre, rep.naturaleza], [null, null, 'pared', 'Pared', 'permanente']);
  assert.ok(rep.foto);
  // Ítems OK de otro ambiente no se aceptan
  assert.equal((await pedir('POST', `/inspections/${r2.id}/confirm`, {
    token: andres, cuerpo: { checklist: r2.checklist.map((c) => ({ clave: c.clave, ok: true })), itemsOk: [ajeno.id] },
  })).status, 422);
  const fin = await pedir('POST', `/inspections/${r2.id}/confirm`, {
    token: andres, cuerpo: { checklist: r2.checklist.map((c) => ({ clave: c.clave, ok: true })) },
  });
  assert.equal(fin.datos.resultado, 'con_danos');

  // Portero genera QR, instructor lo escanea → coordinación recibe el detalle del salón
  const qr = (await pedir('POST', `/inspections/${r2.id}/qr`, { token: portero })).datos.qr.replace('SENA-INSP:', '');
  assert.equal((await pedir('POST', `/inspections/by-qr/${qr}/receive`, { token: andres })).status, 200);
  const bandeja = (await pedir('GET', '/inbox', { token: admin })).datos;
  const aviso = bandeja.notificaciones.find((n) => n.inspeccionId === r2.id && n.tipo === 'dano_reportado');
  assert.ok(aviso, 'coordinación debe recibir el aviso');
  assert.match(aviso.detalle, /daño\(s\) del salón \(pared\)/);
  assert.match(aviso.detalle, /1 novedad\(es\) permanente\(s\) nueva\(s\)/);
  const reporte = (await pedir('GET', '/reports', { token: admin })).datos;
  assert.ok(reporte.danos.some((d) => d.inspeccionId === r2.id && d.item === 'Salón · Pared' && d.novedadEstado === 'en_curso'));
});
