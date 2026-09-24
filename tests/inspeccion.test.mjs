// Pruebas de las reglas de la inspección de ambientes. Ejecutar con: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validarLogin, leerQrItem, leerQrInspeccion, validarReporteDano, progresoChecklist, resultadoInspeccion,
} from '../js/reglas.js';

test('login: acepta el rol portero', () => {
  assert.deepEqual(validarLogin({ identificacion: '4040404040', password: 'Sena2026*', rol: 'portero' }), {});
});

test('QR de ítem: con prefijo, en minúsculas o solo el código', () => {
  assert.equal(leerQrItem('SENA-INV:AMB107-003'), 'AMB107-003');
  assert.equal(leerQrItem(' sena-inv:amb108-010 '), 'AMB108-010');
  assert.equal(leerQrItem('AMB109-001'), 'AMB109-001');
  assert.equal(leerQrItem('SENA-ASIS:algo'), null);
  assert.equal(leerQrItem(''), null);
});

test('QR de inspección: exige el prefijo y 16 caracteres', () => {
  assert.equal(leerQrInspeccion('SENA-INSP:7CE7AC30D072334D'), '7CE7AC30D072334D');
  assert.equal(leerQrInspeccion('SENA-INSP:123'), null);
  assert.equal(leerQrInspeccion('SENA-INV:AMB107-003'), null);
});

test('reporte de daño: campos obligatorios y foto solo si es grave', () => {
  const base = { itemId: 5, tipoDano: 'rotura', severidad: 'leve', comentario: 'Pantalla con una grieta', foto: null };
  assert.deepEqual(validarReporteDano(base), {});
  assert.ok(validarReporteDano({ ...base, severidad: 'grave' }).foto);
  assert.deepEqual(validarReporteDano({ ...base, severidad: 'grave', foto: 'data:image/jpeg;base64,xx' }), {});
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
