// Codificador Code 128 (juego B) para imprimir etiquetas de activos y
// probar el escáner de códigos de barras. ZXing solo decodifica este
// formato, por eso se genera aquí.

const PATRONES = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const INICIO_B = 104;
const PARADA = 106;

/** Anchos de barras y espacios alternados (empieza en barra), en módulos. */
export function anchosCode128(texto) {
  const valores = [...texto].map((c) => {
    const v = c.charCodeAt(0) - 32;
    if (v < 0 || v > 94) throw new Error(`Carácter no válido para Code 128-B: ${c}`);
    return v;
  });
  const control = valores.reduce((suma, v, i) => suma + v * (i + 1), INICIO_B) % 103;
  return [INICIO_B, ...valores, control, PARADA].flatMap((v) => [...PATRONES[v]].map(Number));
}

/** SVG del código con zona de silencio y el texto debajo. */
export function svgCode128(texto, { modulo = 2, alto = 64 } = {}) {
  const anchos = anchosCode128(texto);
  const silencio = 10 * modulo;
  let x = silencio;
  let barras = '';
  anchos.forEach((a, i) => {
    if (i % 2 === 0) barras += `<rect x="${x}" y="0" width="${a * modulo}" height="${alto}"/>`;
    x += a * modulo;
  });
  const ancho = x + silencio;
  const seguro = texto.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ancho} ${alto + 22}" width="${ancho}" height="${alto + 22}" role="img" aria-label="Código de barras ${seguro}">`
    + `<rect width="100%" height="100%" fill="#fff"/><g fill="#000">${barras}</g>`
    + `<text x="${ancho / 2}" y="${alto + 17}" font-family="JetBrains Mono, monospace" font-size="14" text-anchor="middle">${seguro}</text></svg>`;
}
