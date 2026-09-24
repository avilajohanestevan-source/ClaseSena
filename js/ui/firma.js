// Confirmación con firma: lienzo para firmar con el dedo, el mouse o un
// lápiz, nombre de quien firma y fecha/hora en vivo. Resuelve con
// {firma: data URL PNG, nombreFirma} o null si se cancela. La hora que
// queda registrada es la del servidor al guardar; la de pantalla es guía.
import { h, icono } from './dom.js';
import { abrirModal } from './avisos.js';

const fmtAhora = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
const ANCHO_EXPORTE = 600;

export function pedirFirma({ titulo, declaracion, nombre = '', textoConfirmar = 'Firmar y confirmar' }) {
  return new Promise((resolver) => {
    let resultado = null, trazos = 0, dibujando = false, ultimo = null;

    const lienzo = h('canvas', { class: 'firma-lienzo', 'aria-label': 'Espacio para firmar. Firma con el dedo o el mouse.', role: 'img' });
    const ctx = lienzo.getContext('2d');
    const guia = h('span', { class: 'firma-guia', 'aria-hidden': 'true' }, 'Firma aquí');
    const borrar = h('button', { class: 'btn btn-outline btn-sm', type: 'button', disabled: true, onclick: () => limpiar() }, icono('reintentar'), 'Borrar');
    const inputNombre = h('input', { type: 'text', id: 'firma-nombre', value: nombre, autocomplete: 'name', maxlength: 120 });
    const reloj = h('time', { class: 'firma-hora' });
    const error = h('p', { class: 'field-error', role: 'alert', hidden: true });

    const tic = () => { const d = new Date(); reloj.dateTime = d.toISOString(); reloj.textContent = fmtAhora.format(d); };
    tic();
    const intervalo = setInterval(tic, 1000);

    // Ajusta el lienzo a su tamaño en pantalla sin perder lo ya firmado
    // (en el celular, abrir el teclado para escribir el nombre dispara resize).
    function ajustarTamano() {
      const r = lienzo.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const ancho = Math.round(r.width * dpr), alto = Math.round(r.height * dpr);
      if (!ancho || (ancho === lienzo.width && alto === lienzo.height)) return;
      let copia = null;
      if (trazos) {
        copia = h('canvas', { width: lienzo.width, height: lienzo.height });
        copia.getContext('2d').drawImage(lienzo, 0, 0);
      }
      lienzo.width = ancho;
      lienzo.height = alto;
      if (copia) ctx.drawImage(copia, 0, 0, ancho, alto);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 2.4; ctx.strokeStyle = '#00304D';
      actualizar();
    }
    function punto(e) { const r = lienzo.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    function limpiar() { ctx.clearRect(0, 0, lienzo.width, lienzo.height); trazos = 0; actualizar(); }
    function actualizar() {
      guia.hidden = trazos > 0;
      borrar.disabled = trazos === 0;
      confirmar.disabled = trazos < 8 || inputNombre.value.trim().length < 3;
    }

    lienzo.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { lienzo.setPointerCapture(e.pointerId); } catch { /* sin captura: se dibuja igual */ }
      dibujando = true; ultimo = punto(e);
      ctx.beginPath(); ctx.arc(ultimo.x, ultimo.y, 1.1, 0, Math.PI * 2); ctx.fillStyle = '#00304D'; ctx.fill();
    });
    lienzo.addEventListener('pointermove', (e) => {
      if (!dibujando) return;
      const p = punto(e);
      // Curva suave entre el punto anterior y el actual.
      const medio = { x: (ultimo.x + p.x) / 2, y: (ultimo.y + p.y) / 2 };
      ctx.beginPath(); ctx.moveTo(ultimo.x, ultimo.y); ctx.quadraticCurveTo(ultimo.x, ultimo.y, medio.x, medio.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      ultimo = p; trazos++;
      if (trazos === 8) actualizar();
    });
    const soltar = () => { dibujando = false; actualizar(); };
    lienzo.addEventListener('pointerup', soltar);
    lienzo.addEventListener('pointercancel', soltar);
    inputNombre.addEventListener('input', actualizar);

    const confirmar = h('button', { class: 'btn btn-primary', type: 'button', disabled: true, onclick: () => {
      const nombreFirma = inputNombre.value.trim();
      if (nombreFirma.length < 3) { error.textContent = 'Escribe tu nombre completo.'; error.hidden = false; return; }
      // Se exporta reducida para que pese poco (≈ 10–30 KB).
      const escala = Math.min(1, ANCHO_EXPORTE / lienzo.width);
      const salida = h('canvas', { width: Math.round(lienzo.width * escala), height: Math.round(lienzo.height * escala) });
      salida.getContext('2d').drawImage(lienzo, 0, 0, salida.width, salida.height);
      resultado = { firma: salida.toDataURL('image/png'), nombreFirma };
      cerrar(resultado);
    } }, icono('check'), textoConfirmar);

    const { cerrar } = abrirModal({
      titulo, ancho: 'normal',
      contenido: h('div', { class: 'firma' },
        declaracion && h('p', { class: 'firma-declaracion' }, declaracion),
        h('div', { class: 'firma-marco' }, lienzo, guia, h('span', { class: 'firma-linea', 'aria-hidden': 'true' })),
        h('div', { class: 'firma-herramientas' }, h('span', { class: 'text-muted' }, 'Firma con el dedo, el mouse o un lápiz.'), borrar),
        h('div', { class: 'campo' }, h('label', { for: 'firma-nombre' }, 'Nombre de quien firma'), inputNombre),
        h('p', { class: 'firma-sello' }, icono('reloj'), 'Fecha y hora: ', reloj),
        error),
      acciones: [({ cerrar: c }) => h('button', { class: 'btn btn-outline', type: 'button', onclick: () => c() }, 'Cancelar'), confirmar],
      alCerrar: () => { clearInterval(intervalo); window.removeEventListener('resize', ajustarTamano); resolver(resultado); },
    });
    setTimeout(ajustarTamano, 0);
    window.addEventListener('resize', ajustarTamano);
  });
}
