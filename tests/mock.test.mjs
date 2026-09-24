// Pruebas del servidor simulado: el flujo QR → escaneo y los rechazos.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { responder, reiniciarMock } from '../js/api/mock/servidor.js';
import { leerQr } from '../js/reglas.js';

const login = (identificacion, rol) =>
  responder({ metodo: 'POST', ruta: '/auth/login', cuerpo: { identificacion, password: 'Sena2026*', rol } });

beforeEach(() => reiniciarMock(Date.now()));

test('login: rol equivocado, cuenta bloqueada y credenciales', () => {
  assert.equal(login('1010101010', 'instructor').status, 200);
  assert.equal(login('1010101010', 'aprendiz').status, 403);
  assert.equal(login('3030303030', 'instructor').status, 423);
  assert.equal(responder({ metodo: 'POST', ruta: '/auth/login', cuerpo: { identificacion: '1010101010', password: 'x', rol: 'instructor' } }).status, 401);
  assert.equal(responder({ metodo: 'GET', ruta: '/sessions' }).status, 401);
});

test('flujo completo: QR del instructor, escaneo aceptado y duplicado', () => {
  const tInst = login('1010101010', 'instructor').cuerpo.token;
  const tApr = login('1122334455', 'aprendiz').cuerpo.token;
  const qr = responder({ metodo: 'POST', ruta: '/sessions/S-2758432-hoy-a/qr', cuerpo: { validezSeg: 60 }, token: tInst });
  assert.equal(qr.status, 200);
  const { payload } = leerQr(qr.cuerpo.texto);
  const escaneo = () => responder({ metodo: 'POST', ruta: '/attendance/scan', cuerpo: { payload }, token: tApr }).cuerpo;
  assert.equal(escaneo().resultado, 'aceptado');
  assert.equal(escaneo().codigo, 'DUPLICADO');
});

test('escaneo: clase cancelada, fuera de ventana y QR falsificado', () => {
  const tInst = login('1010101010', 'instructor').cuerpo.token;
  const tApr = login('1122334455', 'aprendiz').cuerpo.token;
  assert.equal(responder({ metodo: 'POST', ruta: '/sessions/S-2834519-hoy-b/qr', cuerpo: {}, token: tInst }).cuerpo.codigo, 'FUERA_DE_VENTANA');
  const { payload } = responder({ metodo: 'POST', ruta: '/sessions/S-2758432-hoy-a/qr', cuerpo: {}, token: tInst }).cuerpo;
  const falso = { ...payload, nonce: 'inventado' };
  assert.equal(responder({ metodo: 'POST', ruta: '/attendance/scan', cuerpo: { payload: falso }, token: tApr }).cuerpo.codigo, 'QR_INVALIDO');
  responder({ metodo: 'POST', ruta: '/sessions/S-2758432-hoy-a/cancel', cuerpo: { motivo: 'Simulacro de evacuación' }, token: tInst });
  assert.equal(responder({ metodo: 'POST', ruta: '/attendance/scan', cuerpo: { payload }, token: tApr }).cuerpo.codigo, 'CANCELADA');
  const notis = responder({ metodo: 'GET', ruta: '/notifications', token: tInst }).cuerpo;
  assert.equal(notis[0].tipo, 'clase-cancelada');
});

test('semáforo: hay aprendices en todos los colores', async () => {
  const { calcularSemaforo } = await import('../js/reglas.js');
  const t = login('2020202020', 'administrativo').cuerpo.token;
  const lista = responder({ metodo: 'GET', ruta: '/students/absences', token: t }).cuerpo;
  const colores = new Set(lista.map((e) => calcularSemaforo(e).clave));
  for (const c of ['verde', 'amarillo', 'naranja', 'rojo-claro', 'rojo']) assert.ok(colores.has(c), `falta ${c}`);
});

