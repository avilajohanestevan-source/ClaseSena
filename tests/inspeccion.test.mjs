// Pruebas de las reglas de la inspección de ambientes. Ejecutar con: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validarLogin, leerQrItem, leerQrInspeccion, validarReporteDano, progresoChecklist, resultadoInspeccion,
  marcarTodoBien, itemsRevisables, naturalezaPorDefecto, ESTADOS_ITEM,
} from '../js/reglas.js';

test('login: acepta el rol portero', () => {
  assert.deepEqual(validarLogin({ identificacion: '4040404040', password: 'Sena2026*', rol: 'portero' }), {});
});

test('QR o código de barras de ítem: con prefijo, en minúsculas, solo el código o un EAN', () => {
  assert.equal(leerQrItem('SENA-INV:AMB107-003'), 'AMB107-003');
  assert.equal(leerQrItem(' sena-inv:amb108-010 '), 'AMB108-010');
  assert.equal(leerQrItem('AMB109-001'), 'AMB109-001');
  assert.equal(leerQrItem('SILLA-107-04'), 'SILLA-107-04');
  assert.equal(leerQrItem('7701234500017'), '7701234500017');
  assert.equal(leerQrItem('SENA-ASIS:algo'), null);
  assert.equal(leerQrItem('SENA-INSP:7CE7AC30D072334D'), null);
  assert.equal(leerQrItem('mesa 3'), null);
  assert.equal(leerQrItem(''), null);
});

test('QR de inspección: exige el prefijo y 16 caracteres', () => {
  assert.equal(leerQrInspeccion('SENA-INSP:7CE7AC30D072334D'), '7CE7AC30D072334D');
  assert.equal(leerQrInspeccion('SENA-INSP:123'), null);
  assert.equal(leerQrInspeccion('SENA-INV:AMB107-003'), null);
});

test('reporte de daño: campos obligatorios y foto de evidencia siempre', () => {
  const base = { itemId: 5, tipoDano: 'rotura', severidad: 'leve', comentario: 'Pantalla con una grieta', foto: 'data:image/jpeg;base64,xx' };
  assert.deepEqual(validarReporteDano(base), {});
  assert.ok(validarReporteDano({ ...base, foto: null }).foto);
  assert.deepEqual(validarReporteDano({ ...base, severidad: 'grave' }), {});
  assert.deepEqual(validarReporteDano({ ...base, itemId: null, ubicacion: 'pared' }), {}, 'daño del salón sin ítem');
  assert.ok(validarReporteDano({ ...base, itemId: null, ubicacion: 'jardin' }).itemId);
  const e = validarReporteDano({ itemId: null, tipoDano: 'x', severidad: '', comentario: 'corto' });
  assert.ok(e.itemId && e.tipoDano && e.severidad && e.comentario);
});

test('checklist: progreso, novedades y resultado', () => {
  const lista = [{ clave: 'a', ok: true }, { clave: 'b', ok: null }, { clave: 'c', ok: false }];
  assert.deepEqual(progresoChecklist(lista), { revisados: 2, total: 3, completo: false, novedades: 1 });
  assert.equal(progresoChecklist([]).completo, false);
  assert.equal(resultadoInspeccion({ checklist: [{ ok: true }, { ok: true }], reportes: [] }), 'ok');
  assert.equal(resultadoInspeccion({ checklist: [{ ok: true }], reportes: [{ id: 1 }] }), 'con_danos');
  assert.equal(resultadoInspeccion({ checklist: [{ ok: false }], reportes: [] }), 'con_danos');
});

test('reporte de una familia completa y naturaleza de la novedad', () => {
  const base = { tipoDano: 'no_funciona', severidad: 'grave', comentario: 'El PC del puesto 3 no enciende', foto: 'data:image/jpeg;base64,xx' };
  assert.deepEqual(validarReporteDano({ ...base, familiaId: 7, naturaleza: 'permanente' }), {});
  assert.ok(validarReporteDano({ ...base, familiaId: 7, naturaleza: 'para siempre' }).naturaleza);
  assert.ok(validarReporteDano({ ...base, familiaId: 7, naturaleza: '' }).naturaleza, 'en la app la naturaleza es obligatoria');
  assert.deepEqual(validarReporteDano({ ...base, itemId: 3 }), {}, 'sin naturaleza (API) se usa la de por defecto');
  assert.equal(naturalezaPorDefecto('suciedad'), 'limpieza');
  assert.equal(naturalezaPorDefecto('rotura'), 'permanente');
  assert.equal(naturalezaPorDefecto('no_funciona'), 'permanente');
});

test('"Todo está bien" solo marca en la pantalla: checklist e ítems revisables', () => {
  const checklist = [{ clave: 'aseo', ok: null }, { clave: 'luces', ok: false }, { clave: 'equipos', ok: true }];
  const inventario = [
    { id: 1, estado: 'operativo', reportado: false, novedadActivaId: null },
    { id: 2, estado: 'danado', reportado: true, novedadActivaId: null },         // novedad en esta revisión
    { id: 3, estado: 'fuera_servicio', reportado: false, novedadActivaId: 9 },   // novedad permanente activa
    { id: 4, estado: 'baja', reportado: false, novedadActivaId: null },
    { id: 5, estado: 'en_reparacion', reportado: false, novedadActivaId: null },
  ];
  assert.deepEqual(itemsRevisables(inventario).map((i) => i.id), [1, 5]);
  const r = marcarTodoBien(checklist, inventario);
  assert.deepEqual(r.checklist.map((c) => c.ok), [true, false, true], 'respeta la novedad que el instructor ya marcó');
  assert.deepEqual([...r.itemsOk], [1, 5]);
  assert.deepEqual(checklist.map((c) => c.ok), [null, false, true], 'no modifica el checklist original (es pura)');
  assert.equal(ESTADOS_ITEM.fuera_servicio[0], 'Fuera de servicio');
});
