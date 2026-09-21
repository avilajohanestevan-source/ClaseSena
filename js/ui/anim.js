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

  toastEntra(el) {
    if (!listo()) return;
    gsap.fromTo(el, { autoAlpha: 0, x: 60, scale: 0.96 }, { autoAlpha: 1, x: 0, scale: 1, duration: 0.45, ease: ease('rebote', 'back.out(1.6)') });
  },
  toastSale(el) {
    if (!listo()) return Promise.resolve();
    return gsap.to(el, { autoAlpha: 0, x: 40, height: 0, marginTop: 0, paddingTop: 0, paddingBottom: 0, duration: 0.3, ease: 'power2.in' }).then();
  },

  modalEntra(panel) {
    if (!listo()) return;
    gsap.fromTo(panel, { autoAlpha: 0, y: 24, scale: 0.97 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.4, ease: ease('sena', 'power3.out') });
  },
  modalSale(panel) {
    if (!listo()) return Promise.resolve();
    return gsap.to(panel, { autoAlpha: 0, y: 12, scale: 0.98, duration: 0.2, ease: 'power2.in' }).then();
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
