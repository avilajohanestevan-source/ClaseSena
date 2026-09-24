// ScannerView / EscanerBarcode: cámara + decodificación de QR y códigos de
// barras. Usa BarcodeDetector nativo si el navegador lo trae; si no, jsQR
// para QR y ZXing para códigos de barras. Siempre ofrece alternativas sin
// cámara: subir una foto del código o escribirlo.
import { h, icono, vibrar } from './dom.js';

const FORMATOS_NATIVOS = { qr: ['qr_code'], barras: ['code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a'] };

let lectorZxing = null;
function zxing() {
  if (lectorZxing || !window.ZXing) return lectorZxing;
  const Z = window.ZXing;
  lectorZxing = new Z.MultiFormatReader();
  lectorZxing.setHints(new Map([
    [Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.CODE_39, Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.QR_CODE]],
    [Z.DecodeHintType.TRY_HARDER, true],
  ]));
  return lectorZxing;
}

async function crearDetectorNativo(tipos) {
  if (!('BarcodeDetector' in window)) return null;
  try {
    const soportados = await window.BarcodeDetector.getSupportedFormats();
    const formatos = tipos.flatMap((t) => FORMATOS_NATIVOS[t]).filter((f) => soportados.includes(f));
    return formatos.length ? new window.BarcodeDetector({ formats: formatos }) : null;
  } catch { return null; }
}

/** Decodifica el contenido actual de un canvas. */
async function decodificarCanvas(canvas, tipos, nativo) {
  if (nativo) {
    try {
      const codigos = await nativo.detect(canvas);
      if (codigos.length) return codigos[0].rawValue;
    } catch { /* se intenta con las librerías */ }
  }
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (tipos.includes('qr') && window.jsQR) {
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const r = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
    if (r?.data) return r.data;
  }
  if (tipos.includes('barras') && zxing()) {
    try {
      const Z = window.ZXing;
      return zxing().decode(new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(canvas)))).getText();
    } catch { /* NotFoundException: no hay código en este cuadro */ }
  }
  return null;
}

/**
 * @param {{tipos:('qr'|'barras')[], alLeer:(texto:string)=>void, etiqueta?:string,
 *   manual?:boolean, placeholder?:string, bloqueado?:string|null}} opciones
 * @returns {{el:HTMLElement, detener:()=>void, bloquear:(motivo:string|null)=>void}}
 */
export function crearEscaner({ tipos, alLeer, etiqueta = 'Escanear', manual = true, placeholder = 'Escribe el código', bloqueado = null }) {
  let flujo = null, raf = null, ultimo = 0, ocupado = false, nativo = null, motivoBloqueo = bloqueado;
  const esBarras = tipos.includes('barras') && !tipos.includes('qr');

  const video = h('video', { playsinline: true, muted: true, 'aria-label': 'Vista de la cámara' });
  const canvas = h('canvas', { hidden: true });
  const aviso = h('p', { class: 'escaner-aviso', role: 'status' });
  const marco = h('div', { class: `escaner-marco${esBarras ? ' escaner-marco--barras' : ''}` }, h('span', { class: 'escaner-linea' }));
  const visor = h('div', { class: 'escaner-visor', hidden: true }, video, marco);
  const botonCamara = h('button', { class: 'btn btn-primary btn-lg escaner-boton', type: 'button', onclick: () => (flujo ? detener() : iniciar()) }, icono('escanear'), etiqueta);
  const archivo = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: () => leerArchivo(archivo.files[0]) });
  const botonArchivo = h('button', { class: 'btn btn-outline', type: 'button', onclick: () => archivo.click() }, icono('subir'), 'Subir foto del código');
  const entrada = h('input', { type: 'text', placeholder, autocomplete: 'off', spellcheck: 'false', 'aria-label': placeholder });
  const formManual = manual && h('form', { class: 'escaner-manual', onsubmit: (e) => { e.preventDefault(); if (entrada.value.trim()) entregar(entrada.value.trim()); } },
    entrada, h('button', { class: 'btn btn-outline', type: 'submit' }, 'Usar'));

  const el = h('div', { class: 'escaner' },
    h('div', { class: 'escaner-acciones' }, botonCamara, botonArchivo),
    visor, canvas, aviso, formManual, archivo);

  function avisar(texto, tipo = '') { aviso.textContent = texto; aviso.className = `escaner-aviso ${tipo}`; }

  function entregar(texto) {
    if (motivoBloqueo) { avisar(motivoBloqueo, 'error'); return; }
    detener();
    if (formManual) entrada.value = '';
    alLeer(texto);
  }

  async function iniciar() {
    if (motivoBloqueo) { avisar(motivoBloqueo, 'error'); return; }
    if (!navigator.mediaDevices?.getUserMedia) {
      avisar('Este navegador no permite usar la cámara aquí (se necesita HTTPS o localhost). Sube una foto o escribe el código.', 'error');
      return;
    }
    avisar('Pidiendo permiso para usar la cámara…');
    try {
      flujo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
    } catch (e) {
      flujo = null;
      avisar(e.name === 'NotAllowedError' ? 'No diste permiso para usar la cámara. Puedes subir una foto del código.' : 'No se encontró una cámara disponible.', 'error');
      return;
    }
    nativo = await crearDetectorNativo(tipos);
    video.srcObject = flujo;
    await video.play().catch(() => {});
    visor.hidden = false;
    botonCamara.lastChild.textContent = 'Detener cámara';
    avisar(esBarras ? 'Ubica el código de barras dentro de la franja.' : 'Apunta al código QR que muestra el instructor.');
    raf = requestAnimationFrame(cuadro);
  }

  async function cuadro(t) {
    if (!flujo) return;
    raf = requestAnimationFrame(cuadro);
    // ~7 lecturas por segundo: suficiente y no satura el celular.
    if (ocupado || t - ultimo < 140 || video.readyState < video.HAVE_ENOUGH_DATA) return;
    ultimo = t;
    ocupado = true;
    const escala = Math.min(1, 960 / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * escala);
    canvas.height = Math.round(video.videoHeight * escala);
    canvas.getContext('2d', { willReadFrequently: true }).drawImage(video, 0, 0, canvas.width, canvas.height);
    const texto = await decodificarCanvas(canvas, tipos, nativo);
    ocupado = false;
    if (texto && flujo) {
      vibrar(60);
      entregar(texto);
    }
  }

  async function leerArchivo(file) {
    archivo.value = '';
    if (!file) return;
    avisar('Leyendo la imagen…');
    const img = await createImageBitmap(file).catch(() => null);
    if (!img) { avisar('No se pudo abrir la imagen.', 'error'); return; }
    const escala = Math.min(1, 1400 / Math.max(img.width, img.height));
    canvas.width = Math.round(img.width * escala);
    canvas.height = Math.round(img.height * escala);
    canvas.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0, canvas.width, canvas.height);
    const texto = await decodificarCanvas(canvas, tipos, await crearDetectorNativo(tipos));
    if (texto) { avisar(''); entregar(texto); } else avisar('No se encontró ningún código en la foto. Intenta con una imagen más nítida.', 'error');
  }

  function detener() {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    flujo?.getTracks().forEach((t) => t.stop());
    flujo = null;
    video.srcObject = null;
    visor.hidden = true;
    botonCamara.lastChild.textContent = etiqueta;
    if (!aviso.classList.contains('error')) avisar('');
  }

  function bloquear(motivo) {
    motivoBloqueo = motivo;
    [botonCamara, botonArchivo, entrada].forEach((b) => { b.disabled = !!motivo; });
    if (motivo) { detener(); avisar(motivo, 'error'); } else if (aviso.classList.contains('error')) avisar('');
  }
  bloquear(motivoBloqueo);

  return { el, detener, bloquear };
}
