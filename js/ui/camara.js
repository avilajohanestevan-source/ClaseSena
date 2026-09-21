// CameraCapture + UploadPreview: tomar una foto con la cámara o elegirla de
// la galería, verla en grande y repetirla. Entrega la foto como data URL
// JPEG reducida (máx. 1280 px) lista para el payload de la API.
import { h, icono } from './dom.js';
import { anim } from './anim.js';

const LADO_MAXIMO = 1280;

function aJpeg(fuente, ancho, alto) {
  const escala = Math.min(1, LADO_MAXIMO / Math.max(ancho, alto));
  const canvas = h('canvas', { width: Math.round(ancho * escala), height: Math.round(alto * escala) });
  canvas.getContext('2d').drawImage(fuente, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.82);
}

/**
 * @param {{alCambiar:(foto:string|null)=>void}} opciones
 * @returns {{el:HTMLElement, detener:()=>void, limpiar:()=>void, valor:()=>string|null}}
 */
export function crearCapturaFoto({ alCambiar }) {
  let flujo = null, foto = null;

  const video = h('video', { playsinline: true, muted: true });
  const vivo = h('div', { class: 'captura-vivo', hidden: true }, video,
    h('div', { class: 'captura-controles' },
      h('button', { class: 'btn btn-outline', type: 'button', onclick: () => detener() }, 'Cancelar'),
      h('button', { class: 'captura-disparo', type: 'button', 'aria-label': 'Tomar foto', onclick: () => disparar() })));
  const imagen = h('img', { alt: 'Vista previa de la foto del daño' });
  const preview = h('figure', { class: 'captura-preview', hidden: true }, imagen,
    h('figcaption', {},
      h('span', { class: 'captura-peso' }),
      h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => { limpiar(); abrirCamara(); } }, icono('reintentar'), 'Repetir'),
      h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => limpiar() }, icono('cerrar'), 'Quitar')));
  const archivo = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, onchange: () => desdeArchivo(archivo.files[0]) });
  const aviso = h('p', { class: 'escaner-aviso' });
  const vacio = h('div', { class: 'captura-vacia' },
    icono('camara', 'icon captura-icono'),
    h('div', { class: 'captura-botones' },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => abrirCamara() }, icono('camara'), 'Tomar foto'),
      h('button', { class: 'btn btn-outline', type: 'button', onclick: () => archivo.click() }, icono('subir'), 'Elegir archivo')));

  const el = h('div', { class: 'captura' }, vacio, vivo, preview, aviso, archivo);

  async function abrirCamara() {
    aviso.textContent = '';
    if (!navigator.mediaDevices?.getUserMedia) { archivo.click(); return; }
    try {
      flujo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 } }, audio: false });
    } catch {
      aviso.textContent = 'No se pudo abrir la cámara: elige la foto desde tus archivos.';
      aviso.className = 'escaner-aviso error';
      return;
    }
    video.srcObject = flujo;
    await video.play().catch(() => {});
    vacio.hidden = true;
    vivo.hidden = false;
  }

  function disparar() {
    if (!video.videoWidth) return;
    mostrar(aJpeg(video, video.videoWidth, video.videoHeight));
    detener();
  }

  async function desdeArchivo(file) {
    archivo.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { aviso.textContent = 'El archivo debe ser una imagen.'; aviso.className = 'escaner-aviso error'; return; }
    const bmp = await createImageBitmap(file).catch(() => null);
    if (!bmp) { aviso.textContent = 'No se pudo leer la imagen.'; aviso.className = 'escaner-aviso error'; return; }
    mostrar(aJpeg(bmp, bmp.width, bmp.height));
  }

  function mostrar(dataUrl) {
    foto = dataUrl;
    imagen.src = dataUrl;
    preview.querySelector('.captura-peso').textContent = `${Math.round((dataUrl.length * 3) / 4 / 1024)} KB`;
    vacio.hidden = true;
    preview.hidden = false;
    aviso.textContent = '';
    anim.lista([preview], { autoAlpha: 0, scale: 0.94 });
    alCambiar(foto);
  }

  function detener() {
    flujo?.getTracks().forEach((t) => t.stop());
    flujo = null;
    vivo.hidden = true;
    if (!foto) vacio.hidden = false;
  }

  function limpiar() {
    foto = null;
    imagen.removeAttribute('src');
    preview.hidden = true;
    vacio.hidden = false;
    alCambiar(null);
  }

  return { el, detener, limpiar, valor: () => foto };
}
