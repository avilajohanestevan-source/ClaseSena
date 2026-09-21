// Verifica que las etiquetas Code 128 generadas las lea ZXing (el mismo
// decodificador que usa el escáner del navegador).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { anchosCode128 } from '../js/ui/codigo128.js';

globalThis.window ??= globalThis;
const ZXing = createRequire(import.meta.url)('../node_modules/@zxing/library/umd/index.js');

function decodificar(texto) {
  const modulo = 3, silencio = 30, alto = 20;
  const anchos = anchosCode128(texto);
  const ancho = anchos.reduce((a, b) => a + b, 0) * modulo + silencio * 2;
  const pix = new Uint8ClampedArray(ancho * alto).fill(255);
  let x = silencio;
  anchos.forEach((a, i) => {
    if (i % 2 === 0) for (let y = 0; y < alto; y++) pix.fill(0, y * ancho + x, y * ancho + x + a * modulo);
    x += a * modulo;
  });
  const fuente = new ZXing.RGBLuminanceSource(pix, ancho, alto);
  const lector = new ZXing.MultiFormatReader();
  lector.setHints(new Map([[ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.CODE_128]]]));
  return lector.decode(new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(fuente))).getText();
}

test('Code 128: ZXing lee los códigos de los activos', () => {
  for (const codigo of ['SENA-201-0001', 'SENA-105-0012', 'SENA-T3-0004']) assert.equal(decodificar(codigo), codigo);
});
