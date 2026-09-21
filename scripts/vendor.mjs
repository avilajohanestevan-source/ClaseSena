// Copia las librerías de front-end instaladas con npm a vendor/ para
// que las páginas las carguen sin build ni CDN (jsQR y qrcode.js ya vienen en vendor/qr).
// Uso: npm install && npm run vendor
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const destino = 'vendor';

// GSAP completo (núcleo + todos los plugins: ScrollTrigger, Flip, SplitText,
// MorphSVG, DrawSVG, MotionPath, Draggable, Inertia...). Desde la 3.13 todos
// son gratuitos, también para uso comercial.
const gsapDist = 'node_modules/gsap/dist';
rmSync(join(destino, 'gsap'), { recursive: true, force: true });
mkdirSync(join(destino, 'gsap'), { recursive: true });
for (const archivo of readdirSync(gsapDist)) {
  if (archivo.endsWith('.min.js')) cpSync(join(gsapDist, archivo), join(destino, 'gsap', archivo));
}

// ZXing: decodifica códigos de barras (Code 128, EAN, Code 39...) y QR.
mkdirSync(join(destino, 'zxing'), { recursive: true });
cpSync('node_modules/@zxing/library/umd/index.min.js', join(destino, 'zxing', 'zxing.min.js'));

console.log('Librerías copiadas a', destino);
