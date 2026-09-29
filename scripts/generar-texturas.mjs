// Genera la textura principal del manual de identidad SENA para el fondo
// del login (diseño "Manual SENA"): img/fondo/textura-principal.svg, haces de
// líneas finas que ondulan (cada haz interpola entre dos curvas, lo que da el
// efecto de cinta). La textura secundaria no se usa: recarga el ingreso.
//   node scripts/generar-texturas.mjs
import { writeFileSync } from 'node:fs';

const destino = (nombre) => new URL(`../img/fondo/${nombre}`, import.meta.url);
const r = (n) => Math.round(n * 10) / 10;

/* ---------- textura principal ---------- */

// Cada haz: dos curvas cúbicas [inicio, control1, control2, fin] y cuántas líneas trazar entre ellas.
const HACES = [
  // Onda ancha que cruza de izquierda a derecha por la mitad inferior.
  { lineas: 90, a: [[-60, 560], [380, 300], [820, 900], [1660, 420]], b: [[-60, 820], [480, 1020], [1000, 280], [1660, 700]] },
  // Barrido diagonal desde la esquina superior izquierda.
  { lineas: 60, a: [[180, -60], [300, 260], [420, 600], [640, 1060]], b: [[-120, -60], [360, 180], [240, 700], [900, 1060]] },
  // Abanico en la esquina superior derecha.
  { lineas: 60, a: [[980, -60], [1180, 180], [1320, 360], [1660, 260]], b: [[1240, -60], [1260, 320], [1460, 120], [1660, 560]] },
];

const mezcla = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
const trazos = HACES.flatMap(({ lineas, a, b }) => Array.from({ length: lineas }, (_, i) => {
  // t no lineal: las líneas se juntan en los bordes del haz, como en el manual.
  const t = 0.5 - Math.cos((i / (lineas - 1)) * Math.PI) / 2;
  const [p0, p1, p2, p3] = a.map((p, k) => mezcla(p, b[k], t));
  return `<path d="M${r(p0[0])} ${r(p0[1])}C${r(p1[0])} ${r(p1[1])} ${r(p2[0])} ${r(p2[1])} ${r(p3[0])} ${r(p3[1])}"/>`;
}));

writeFileSync(destino('textura-principal.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
  <!-- Textura principal del manual de identidad SENA (sobre fondo blanco). Generada con scripts/generar-texturas.mjs -->
  <g fill="none" stroke="#1F2421" stroke-opacity=".1" stroke-width=".7">
    ${trazos.join('\n    ')}
  </g>
</svg>
`);

console.log('✓ img/fondo/textura-principal.svg');
