// Animaciones con GSAP (vendor/gsap). Todo el movimiento del módulo
// pasa por aquí para mantener un mismo lenguaje de animación y respetar
// "reducir movimiento" del sistema operativo. Los plugins adicionales
// (ScrollTrigger, SplitText, MorphSVG, MotionPath...) están en
// vendor/gsap listos para cargarse cuando se necesiten.
const gsap = window.gsap;

if (gsap) {
  const plugins = ['CustomEase', 'DrawSVGPlugin', 'Flip'].map((n) => window[n]).filter(Boolean);
  gsap.registerPlugin(...plugins);
  if (window.CustomEase) {
    window.CustomEase.create('sena', 'M0,0 C0.2,0 0.1,1 1,1');
    window.CustomEase.create('rebote', 'M0,0 C0.3,1.4 0.5,1 1,1');
  }
}

const reducido = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const movil = () => window.matchMedia('(max-width: 640px)').matches;
// Curvas del rediseño (tokens.css): out-cúbico, in-out-cúbico y rebote.
const CURVA = { salida: 'power3.out', inOut: 'power3.inOut', rebote: 'back.out(1.8)' };
const listo = () => gsap && !reducido();
const ease = (nombre, respaldo) => (window.CustomEase ? nombre : respaldo);

export const anim = {
  disponible: () => !!gsap,

  /** Entrada de una vista: sus bloques [data-anim] suben escalonados. */
  entrarVista(raiz) {
    if (!listo()) return;
    const bloques = raiz.querySelectorAll('[data-anim]');
    gsap.fromTo(bloques.length ? bloques : raiz, { autoAlpha: 0, y: 18 },
      { autoAlpha: 1, y: 0, duration: 0.55, ease: ease('sena', 'power3.out'), stagger: 0.06, clearProps: 'transform,opacity,visibility' });
  },

  /** Aparición escalonada de una lista (filas, tarjetas, badges). */
  lista(elementos, desde = { autoAlpha: 0, y: 10 }) {
    if (!listo() || !elementos?.length) return;
    gsap.fromTo(elementos, desde, { autoAlpha: 1, y: 0, x: 0, scale: 1, duration: 0.4, ease: 'power2.out', stagger: { each: 0.03, from: 'start' }, clearProps: 'all' });
  },

  /** Los toasts entran desde arriba (420 ms, rebote) y salen hacia arriba (240 ms). */
  toastEntra(el) {
    if (!listo()) return;
    gsap.fromTo(el, { autoAlpha: 0, y: -28, scale: 0.97 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.42, ease: ease('rebote', CURVA.rebote) });
  },
  toastSale(el) {
    if (!listo()) return Promise.resolve();
    return gsap.to(el, { autoAlpha: 0, y: -16, scale: 0.96, height: 0, marginTop: 0, paddingTop: 0, paddingBottom: 0, duration: 0.24, ease: CURVA.inOut }).then();
  },

  /** En móvil el modal es una hoja inferior: sube desde el borde. */
  modalEntra(panel) {
    if (!listo()) return;
    if (movil()) gsap.fromTo(panel, { yPercent: 100 }, { yPercent: 0, duration: 0.42, ease: CURVA.salida });
    else gsap.fromTo(panel, { autoAlpha: 0, y: 24, scale: 0.97 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.4, ease: ease('sena', 'power3.out') });
  },
  modalSale(panel) {
    if (!listo()) return Promise.resolve();
    if (movil()) return gsap.to(panel, { yPercent: 100, duration: 0.26, ease: 'power2.in' }).then();
    return gsap.to(panel, { autoAlpha: 0, y: 12, scale: 0.98, duration: 0.2, ease: 'power2.in' }).then();
  },

  /**
   * Login correcto: micro-rebote de la tarjeta (360 ms) y las dos piezas
   * del fondo salen de la pantalla (750 ms, in-out cúbico) mientras la
   * tarjeta se desvanece. Resuelve cuando la pantalla queda limpia.
   */
  salidaLogin({ tarjeta, piezaA, piezaB, extras = [] }) {
    if (!listo()) return Promise.resolve();
    const tl = gsap.timeline();
    tl.to(tarjeta, { keyframes: { scale: [1, 1.03, 0.99, 1] }, duration: 0.36, ease: 'none' })
      .to(piezaA, { x: '75vw', y: '-85vh', duration: 0.75, ease: CURVA.inOut }, 0.36)
      .to(piezaB, { x: '-75vw', y: '85vh', duration: 0.75, ease: CURVA.inOut }, 0.36)
      .to(extras, { autoAlpha: 0, duration: 0.3 }, 0.36)
      .to(tarjeta, { autoAlpha: 0, y: -16, scale: 0.97, duration: 0.4, ease: CURVA.inOut }, 0.44);
    // No hace falta esperar el final de las piezas: a los 800 ms ya salieron del área visible.
    return new Promise((ok) => tl.call(ok, null, 0.8));
  },

  /** Entrada del panel tras el login: barra superior y navegación con 120 ms de retraso. */
  entrarShell(barra, navegacion) {
    if (!listo()) return;
    if (barra) gsap.fromTo(barra, { autoAlpha: 0, y: -12 }, { autoAlpha: 1, y: 0, duration: 0.4, ease: CURVA.salida, clearProps: 'all' });
    if (navegacion) gsap.fromTo(navegacion, { autoAlpha: 0, y: movil() ? 24 : -8 }, { autoAlpha: 1, y: 0, duration: 0.6, delay: 0.12, ease: CURVA.salida, clearProps: 'all' });
  },

  /** Sacudida corta para errores de validación. */
  sacudir(el) {
    if (!listo() || !el) return;
    gsap.fromTo(el, { x: 0 }, { x: 0, duration: 0.45, ease: 'none', keyframes: { x: [0, -9, 8, -6, 4, -2, 0] } });
  },

  /** Latido para llamar la atención (contador por vencer, notificación nueva). */
  latido(el) {
    if (!listo() || !el) return;
    gsap.fromTo(el, { scale: 1 }, { scale: 1.12, duration: 0.18, yoyo: true, repeat: 1, ease: 'power1.inOut' });
  },

  /** Número que cuenta hasta su valor. */
  contar(el, hasta) {
    if (!listo()) { el.textContent = hasta; return; }
    const obj = { v: Number(el.textContent) || 0 };
    gsap.to(obj, { v: hasta, duration: 0.8, ease: 'power2.out', onUpdate: () => { el.textContent = Math.round(obj.v); } });
  },

  /** Resultado de escaneo: la tarjeta crece y el trazo del ícono se dibuja. */
  resultado(tarjeta) {
    if (!listo()) return;
    const tl = gsap.timeline();
    tl.fromTo(tarjeta, { autoAlpha: 0, scale: 0.85 }, { autoAlpha: 1, scale: 1, duration: 0.5, ease: ease('rebote', 'back.out(1.7)') });
    const trazos = tarjeta.querySelectorAll('.resultado-icono path, .resultado-icono circle');
    if (window.DrawSVGPlugin && trazos.length) tl.fromTo(trazos, { drawSVG: '0%' }, { drawSVG: '100%', duration: 0.5, stagger: 0.12, ease: 'power2.out' }, '-=0.25');
    tl.fromTo(tarjeta.querySelectorAll('.resultado-texto > *'), { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, stagger: 0.07, duration: 0.3 }, '-=0.2');
  },

  /** Reordenamiento suave de una lista con Flip (filtros del semáforo). */
  capturarFlip(elementos) {
    return listo() && window.Flip ? window.Flip.getState(elementos) : null;
  },
  aplicarFlip(estado) {
    if (estado) window.Flip.from(estado, { duration: 0.45, ease: 'power2.inOut', absolute: true, onEnter: (e) => gsap.fromTo(e, { autoAlpha: 0, scale: 0.9 }, { autoAlpha: 1, scale: 1, duration: 0.3 }), onLeave: (e) => gsap.to(e, { autoAlpha: 0, scale: 0.9, duration: 0.2 }) });
  },

  /** Anillo de cuenta regresiva del QR: stroke-dashoffset lineal hasta 0. */
  anillo(circulo, segundosRestantes, segundosTotales) {
    const largo = circulo.getTotalLength();
    circulo.style.strokeDasharray = largo;
    const desde = largo * (1 - segundosRestantes / segundosTotales);
    if (!gsap) { circulo.style.strokeDashoffset = desde; return null; }
    gsap.killTweensOf(circulo);
    return gsap.fromTo(circulo, { strokeDashoffset: desde }, { strokeDashoffset: largo, duration: segundosRestantes, ease: 'none' });
  },
};
