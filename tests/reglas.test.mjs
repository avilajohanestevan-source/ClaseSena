// Pruebas de las reglas de front-end. Ejecutar con: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validarLogin, estadoVentana, formatearDuracion, codificarQr, leerQr, prevalidarEscaneo,
  calcularSemaforo, parsearCsv, validarRegistrosP004, validarDano,
} from '../js/reglas.js';

test('login: valida identificación, contraseña y rol', () => {
  assert.deepEqual(validarLogin({ identificacion: '1010101010', password: 'Sena2026*', rol: 'instructor' }), {});
  const e = validarLogin({ identificacion: '12.345', password: '123', rol: 'otro' });
  assert.ok(e.identificacion && e.password && e.rol);
});

test('ventana horaria: pendiente, abierta, cerrada y cancelada', () => {
  const inicio = Date.parse('2026-09-21T08:00:00');
  const sesion = { startTime: new Date(inicio).toISOString(), ventanaMin: 15 };
  assert.equal(estadoVentana(sesion, inicio - 1000).estado, 'pendiente');
  const abierta = estadoVentana(sesion, inicio + 5 * 60_000);
  assert.equal(abierta.estado, 'abierta');
  assert.equal(abierta.restanteMs, 10 * 60_000);
  assert.equal(estadoVentana(sesion, inicio + 15 * 60_000 + 1).estado, 'cerrada');
  assert.equal(estadoVentana({ ...sesion, cancelada: true }, inicio).estado, 'cancelada');
});

test('formato de duración', () => {
  assert.equal(formatearDuracion(65_000), '01:05');
  assert.equal(formatearDuracion(3_725_000), '1:02:05');
  assert.equal(formatearDuracion(-5), '00:00');
});

test('QR: ida y vuelta, y rechazo de códigos ajenos', () => {
  const payload = { sessionId: 'S1', startTime: '2026-09-21T08:00:00Z', expiryTime: '2026-09-21T08:01:00Z', nonce: 'x' };
  assert.deepEqual(leerQr(codificarQr(payload)), { ok: true, payload });
  assert.equal(leerQr('https://sena.edu.co').ok, false);
  assert.equal(leerQr('SENA-ASIS:{"sessionId":"S1"}').ok, false);
});

test('prevalidación del escaneo: vencido y fuera de ventana', () => {
  const inicio = Date.parse('2026-09-21T08:00:00Z');
  const sesion = { id: 'S1', startTime: new Date(inicio).toISOString(), ventanaMin: 15 };
  const payload = { sessionId: 'S1', startTime: sesion.startTime, expiryTime: new Date(inicio + 60_000).toISOString() };
  assert.equal(prevalidarEscaneo(payload, sesion, inicio + 30_000), null);
  assert.match(prevalidarEscaneo(payload, sesion, inicio + 61_000), /venció/);
  const largo = { ...payload, expiryTime: new Date(inicio + 3_600_000).toISOString() };
  assert.match(prevalidarEscaneo(largo, sesion, inicio + 20 * 60_000), /Fuera de ventana/);
  assert.match(prevalidarEscaneo({ ...payload, sessionId: 'S2' }, sesion, inicio), /otra clase/);
});

test('semáforo: toma el nivel más grave entre consecutivas y totales', () => {
  assert.equal(calcularSemaforo({ faltasConsecutivas: 0, faltasTotales: 1 }).clave, 'verde');
  assert.equal(calcularSemaforo({ faltasConsecutivas: 1, faltasTotales: 1 }).clave, 'amarillo');
  assert.equal(calcularSemaforo({ faltasConsecutivas: 0, faltasTotales: 4 }).clave, 'naranja');
  assert.equal(calcularSemaforo({ faltasConsecutivas: 3, faltasTotales: 3 }).clave, 'rojo-claro');
  assert.equal(calcularSemaforo({ faltasConsecutivas: 1, faltasTotales: 9 }).clave, 'rojo');
  assert.match(calcularSemaforo({ faltasConsecutivas: 1, faltasTotales: 9 }).motivo, /9 faltas en total/);
});

test('CSV: separador ; y comillas', () => {
  const filas = parsearCsv('Documento;Nombre;Ficha;Programa;Estado\n123456;"Pérez; Ana";2758432;ADSO;En formación\n');
  assert.equal(filas.length, 1);
  assert.equal(filas[0].nombre, 'Pérez; Ana');
});

test('P004: valida campos, estados y duplicados', () => {
  const { validos, errores } = validarRegistrosP004([
    { documento: '1000123456', nombre: 'Ana', ficha: '2758432', programa: 'ADSO', estado: 'En formación' },
    { documento: '1000123456', nombre: 'Ana bis', ficha: '2758432', programa: 'ADSO', estado: 'CANCELADO' },
    { documento: 'abc', nombre: '', ficha: '1', programa: 'ADSO', estado: 'VACACIONES' },
  ]);
  assert.equal(validos.length, 1);
  assert.equal(validos[0].estado, 'EN FORMACION');
  assert.equal(errores.length, 2);
  assert.match(errores[0].mensaje, /repetido/);
});

test('daño: foto obligatoria solo si es grave', () => {
  const base = { activoId: 'A1', descripcion: 'Pantalla rota en la esquina' };
  assert.deepEqual(validarDano({ ...base, prioridad: 'leve' }), {});
  assert.ok(validarDano({ ...base, prioridad: 'grave' }).foto);
  assert.deepEqual(validarDano({ ...base, prioridad: 'grave', foto: 'data:image/jpeg;base64,x' }), {});
  assert.ok(validarDano({ prioridad: 'leve', descripcion: 'corto' }).activoId);
});
