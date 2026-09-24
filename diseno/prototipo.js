// Prototipo login → dashboard (sin dependencias). Todas las duraciones y
// curvas salen de tokens.css para que diseño y código no se desalineen.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const css = getComputedStyle(document.documentElement);
  const tok = (n) => css.getPropertyValue(n).trim();
  const ms = (n) => parseFloat(tok(n)) || 0;
  const reducir = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const I = (n) => `<svg class="i"><use href="assets/iconos.svg#i-${n}"/></svg>`;
  const esperar = (t) => new Promise((r) => setTimeout(r, t));

  const EASE = {
    standard: tok('--ease-standard'),
    outCubic: tok('--ease-out-cubic'),
    inOutCubic: tok('--ease-in-out-cubic'),
    bounce: tok('--ease-bounce'),
  };

  /* ---------------- Ripple en todos los .btn ---------------- */
  document.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('.btn');
    if (!btn || btn.disabled || reducir) return;
    const r = btn.getBoundingClientRect();
    const d = Math.max(r.width, r.height) * 2;
    const s = document.createElement('span');
    s.className = 'ripple';
    s.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
    btn.append(s);
    s.addEventListener('animationend', () => s.remove());
  });

  /* ---------------- Toasts (entran desde arriba) ---------------- */
  function toast({ titulo, texto = '', icono = 'check', duracion = 5000 }) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.innerHTML = `<span class="toast__icon">${I(icono)}</span><div><strong>${titulo}</strong><span>${texto}</span></div>
      <button class="btn btn--ghost btn--icon toast__close" type="button" aria-label="Cerrar aviso">${I('cerrar')}</button>
      ${duracion ? `<span class="toast__timer" style="animation-duration:${duracion}ms"></span>` : ''}`;
    const cerrar = () => { el.classList.add('is-leaving'); el.addEventListener('animationend', () => el.remove(), { once: true }); };
    el.querySelector('.toast__close').onclick = cerrar;
    $('#toasts').prepend(el);
    if (duracion) {
      let t = setTimeout(cerrar, duracion);
      // Pausar el auto-dismiss mientras el puntero o el foco están encima.
      const timer = el.querySelector('.toast__timer');
      el.addEventListener('mouseenter', () => { clearTimeout(t); timer.style.animationPlayState = 'paused'; });
      el.addEventListener('mouseleave', () => { t = setTimeout(cerrar, 1500); timer.style.animationPlayState = 'running'; });
    }
  }

  /* ---------------- LOGIN ---------------- */
  const login = $('#login'), app = $('#app'), card = $('#login-card');
  const form = $('#form-login'), doc = $('#documento'), pass = $('#password');
  const btn = $('#btn-ingresar'), errorBox = $('#login-error');
  const piezaA = $('#pieza-a'), piezaB = $('#pieza-b');

  // Selector de rol: el "thumb" se desliza con rebote.
  const thumb = $('#seg-thumb');
  document.querySelectorAll('.seg input').forEach((inp, i) => inp.addEventListener('change', () => {
    thumb.style.transform = `translateX(calc(${i} * (100% + 4px)))`;
  }));

  $('#ver-pass').addEventListener('click', (e) => {
    const b = e.currentTarget, ver = pass.type === 'password';
    pass.type = ver ? 'text' : 'password';
    b.setAttribute('aria-pressed', String(ver));
    b.setAttribute('aria-label', ver ? 'Ocultar contraseña' : 'Mostrar contraseña');
  });
  doc.addEventListener('input', () => { doc.value = doc.value.replace(/\D/g, ''); marcarError(doc, null); });
  pass.addEventListener('input', () => marcarError(pass, null));

  function marcarError(input, msg) {
    const hint = $('#' + input.getAttribute('aria-describedby'));
    if (msg) { input.setAttribute('aria-invalid', 'true'); hint.textContent = msg; hint.className = 'field__hint field__hint--error'; hint.hidden = false; }
    else { input.removeAttribute('aria-invalid'); hint.hidden = true; }
  }

  // Parallax suave de las piezas con el puntero (±12px).
  if (!reducir) login.addEventListener('pointermove', (e) => {
    const x = e.clientX / innerWidth - 0.5, y = e.clientY / innerHeight - 0.5;
    piezaA.firstElementChild.style.transform = `translate(${x * -24}px, ${y * -24}px)`;
    piezaB.firstElementChild.style.transform = `translate(${x * 18}px, ${y * 18}px)`;
  });

  const sacudir = () => card.animate(
    [{ translate: '0' }, { translate: '-8px' }, { translate: '7px' }, { translate: '-5px' }, { translate: '3px' }, { translate: '0' }],
    { duration: reducir ? 0 : 380, easing: EASE.standard });

  // Micro-bounce al validar: 1 → 1.03 → .99 → 1 en 360 ms.
  const microBounce = () => card.animate(
    [{ scale: '1' }, { scale: '1.03', offset: 0.35 }, { scale: '0.99', offset: 0.7 }, { scale: '1' }],
    { duration: reducir ? 0 : 360, easing: EASE.bounce }).finished;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.hidden = true;
    let ok = true;
    if (doc.value.length < 6) { marcarError(doc, 'Escribe tu número de documento (mínimo 6 dígitos).'); ok = false; }
    if (!pass.value) { marcarError(pass, 'Escribe tu contraseña.'); ok = false; }
    if (!ok) { sacudir(); form.querySelector('[aria-invalid]').focus(); return; }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" aria-hidden="true"></span><span class="btn__txt">Validando…</span>';
    await esperar(900); // simula la API

    if (pass.value !== 'Sena2026*') {
      btn.disabled = false;
      btn.innerHTML = `<span class="btn__txt">Ingresar</span>${I('flecha')}`;
      errorBox.querySelector('span').textContent = 'Documento o contraseña incorrectos. Te quedan 4 intentos.';
      errorBox.hidden = false;
      pass.value = ''; pass.focus();
      sacudir();
      return;
    }

    btn.innerHTML = `${I('check')}<span class="btn__txt">¡Bienvenida!</span>`;
    btn.style.setProperty('--_bg', 'var(--color-primary)');
    btn.style.setProperty('--_fg', '#fff');
    await microBounce();
    await entrarDashboard();
  });

  /* ---------------- Transición login → dashboard ----------------
     t=0     piezas salen (750 ms, in-out cúbico) + tarjeta se eleva y se desvanece (400 ms)
     t=450   crossfade: login 1→0 / app 0→1 (400 ms)
     t=450   contenido: slide up 24px (600 ms, out cúbico)
     t=570   barra lateral: entra desde -16px (delay 120 ms)
     t=750   contadores y barras se llenan (900 ms, out cúbico, escalonado 80 ms) */
  async function entrarDashboard() {
    const dPieza = ms('--dur-screen-3'), dFade = ms('--dur-screen-1'), dSlide = ms('--dur-screen-2'), dSide = ms('--delay-sidebar');
    const opt = (duration, easing, extra = {}) => ({ duration, easing, fill: 'forwards', ...extra });

    piezaA.animate([{ translate: '0 0' }, { translate: '70vw -80vh' }], opt(dPieza, EASE.inOutCubic));
    piezaB.animate([{ translate: '0 0' }, { translate: '-70vw 80vh' }], opt(dPieza, EASE.inOutCubic));
    card.animate([{ opacity: 1, translate: '0 0', scale: '1' }, { opacity: 0, translate: '0 -16px', scale: '.97' }], opt(dFade, EASE.inOutCubic, { delay: 80 }));

    await esperar(reducir ? 0 : 450);
    app.hidden = false;
    document.querySelector('meta[name=theme-color]').content = '#FAF9F7';
    pintarDashboard();
    const fadeOut = login.animate([{ opacity: 1 }, { opacity: 0 }], opt(dFade, EASE.standard));
    app.animate([{ opacity: 0 }, { opacity: 1 }], opt(dFade, EASE.standard));
    $('.main').animate([{ translate: '0 24px' }, { translate: '0 0' }], opt(dSlide, EASE.outCubic));
    if (matchMedia('(min-width: 901px)').matches) {
      $('#sidebar').animate([{ opacity: 0, translate: '-16px 0' }, { opacity: 1, translate: '0 0' }], opt(dSlide, EASE.outCubic, { delay: dSide }));
    }
    fadeOut.finished.then(() => { login.hidden = true; });

    await esperar(reducir ? 0 : 300);
    animarDatos();
    await esperar(reducir ? 0 : 500);
    toast({ titulo: 'Bienvenida, Laura', texto: 'Tienes 3 avisos nuevos y 2 aprendices en riesgo.', icono: 'campana', duracion: 5000 });
    $('#topbar h1').focus?.();
  }

  async function volverLogin() {
    const dFade = ms('--dur-screen-1'), dPieza = ms('--dur-screen-3');
    await app.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dFade, easing: EASE.standard, fill: 'forwards' }).finished;
    app.hidden = true;
    app.getAnimations().forEach((a) => a.cancel());
    login.hidden = false;
    login.getAnimations().forEach((a) => a.cancel());
    card.getAnimations().forEach((a) => a.cancel());
    // Las piezas regresan desde fuera de la pantalla.
    piezaA.getAnimations().forEach((a) => a.cancel());
    piezaB.getAnimations().forEach((a) => a.cancel());
    piezaA.animate([{ translate: '70vw -80vh' }, { translate: '0 0' }], { duration: dPieza, easing: EASE.outCubic });
    piezaB.animate([{ translate: '-70vw 80vh' }, { translate: '0 0' }], { duration: dPieza, easing: EASE.outCubic });
    card.animate([{ opacity: 0, translate: '0 16px' }, { opacity: 1, translate: '0 0' }], { duration: dFade, delay: 200, easing: EASE.outCubic, fill: 'backwards' });
    document.querySelector('meta[name=theme-color]').content = '#FFFFFF';
    form.reset(); pass.type = 'password';
    btn.disabled = false; btn.removeAttribute('style');
    btn.innerHTML = `<span class="btn__txt">Ingresar</span>${I('flecha')}`;
    thumb.style.transform = '';
    doc.focus();
  }

  /* ---------------- DASHBOARD ---------------- */
  const AMBIENTES = [
    { n: 'Ambiente 204 · Sistemas', sede: 'Bloque B · Piso 2', estado: 'clase', ocup: 28, cap: 32, inst: 'Carlos Rojas', ini: 'CR', h: '07:00–12:00', f: ['#E4F4DA', '#E5F8FB'] },
    { n: 'Taller 1 · Mecánica', sede: 'Bloque D', estado: 'mant', ocup: 0, cap: 24, inst: 'Proveedor externo', ini: 'PE', h: '14:00–17:00', f: ['#FFF4CC', '#F2F0EC'] },
    { n: 'Ambiente 108 · Contabilidad', sede: 'Bloque A · Piso 1', estado: 'libre', ocup: 0, cap: 30, inst: 'Sin asignar', ini: '—', h: 'Libre hasta 14:00', f: ['#F2F0EC', '#E5F8FB'] },
    { n: 'Laboratorio 3 · Redes', sede: 'Bloque B · Piso 3', estado: 'clase', ocup: 31, cap: 32, inst: 'Diana Ruiz', ini: 'DR', h: '07:00–13:00', f: ['#E5F8FB', '#E4F4DA'] },
    { n: 'Ambiente 305 · Diseño', sede: 'Bloque C · Piso 3', estado: 'clase', ocup: 17, cap: 28, inst: 'Julián Mora', ini: 'JM', h: '08:00–12:00', f: ['#F3FAEE', '#FFF4CC'] },
    { n: 'Cocina · Gastronomía', sede: 'Bloque E', estado: 'clase', ocup: 20, cap: 20, inst: 'Paola Gil', ini: 'PG', h: '06:00–11:00', f: ['#E4F4DA', '#F2F0EC'] },
  ];
  const ESTADO = { clase: ['chip--ok', 'En clase'], libre: ['chip--info', 'Libre'], mant: ['chip--warn', 'Mantenimiento'] };
  const FICHAS = [
    { f: 'Ficha 2758412 · ADSO', v: 94 }, { f: 'Ficha 2675310 · Contabilidad', v: 88 },
    { f: 'Ficha 2801147 · Redes', v: 81 }, { f: 'Ficha 2699021 · Gastronomía', v: 72 }, { f: 'Ficha 2744590 · Diseño', v: 58 },
  ];

  function pintarAmbientes(filtro = '') {
    $('#ambientes').innerHTML = AMBIENTES.filter((a) => !filtro || a.estado === filtro).map((a) => {
      const pct = a.cap ? Math.round((a.ocup / a.cap) * 100) : 0;
      const tono = pct >= 100 ? 'bar--danger' : pct >= 90 ? 'bar--warn' : '';
      const [chip, txt] = ESTADO[a.estado];
      return `<article class="card card--interactive amb" tabindex="0" aria-label="${a.n}, ${txt}, ${a.ocup} de ${a.cap}">
        <div class="amb__foto" style="--_f1:${a.f[0]};--_f2:${a.f[1]}">${I('ambiente')}<span class="chip ${chip}">${txt}</span></div>
        <div class="amb__cuerpo">
          <div><div class="amb__nombre">${a.n}</div><div class="amb__meta">${a.sede}</div></div>
          <div><div class="amb__ocup"><span>Ocupación</span><strong>${a.ocup}/${a.cap}</strong></div>
            <div class="bar ${tono}"><div class="bar__fill" style="--v:${pct}%"></div></div></div>
          <div class="amb__pie"><span class="avatar">${a.ini}</span>${a.inst}<time>${a.h}</time></div>
        </div></article>`;
    }).join('');
  }

  function pintarDashboard() {
    const hoy = new Date();
    const f = hoy.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
    $('#fecha-hoy').textContent = `${f[0].toUpperCase()}${f.slice(1)} · Jornada diurna`;
    pintarAmbientes();
    $('#fichas').innerHTML = FICHAS.map((x) => {
      const tono = x.v < 65 ? 'bar--danger' : x.v < 80 ? 'bar--warn' : '';
      return `<li><div class="ficha__fila"><strong>${x.f}</strong><span data-count="${x.v}" data-suffix="%">0%</span></div>
        <div class="bar bar--lg ${tono}"><div class="bar__fill" style="--v:${x.v}%"></div></div></li>`;
    }).join('');
    document.querySelectorAll('[data-count]').forEach((el) => { el.textContent = '0' + (el.dataset.suffix || ''); });
    document.querySelectorAll('.bar__fill').forEach((b) => b.classList.remove('is-filled'));
  }

  // Contadores: 0 → valor en 1000 ms con out-cúbico, formato es-CO.
  function contar(el, dur = 1000) {
    const fin = +el.dataset.count, suf = el.dataset.suffix || '';
    if (reducir) { el.textContent = fin.toLocaleString('es-CO') + suf; return; }
    const t0 = performance.now();
    const paso = (t) => {
      const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(fin * e).toLocaleString('es-CO') + suf;
      if (p < 1) requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
  }
  function llenarBarras(scope = document) {
    scope.querySelectorAll('.bar__fill:not(.is-filled)').forEach((b, i) => {
      b.style.transitionDelay = `${i * 80}ms`;
      requestAnimationFrame(() => requestAnimationFrame(() => b.classList.add('is-filled')));
    });
  }
  function animarDatos() {
    document.querySelectorAll('[data-count]').forEach((el) => contar(el));
    llenarBarras();
  }

  // Filtros de ambientes con fundido rápido.
  $('#filtros').addEventListener('click', async (e) => {
    const b = e.target.closest('.filtro'); if (!b) return;
    $('#filtros').querySelectorAll('.filtro').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    const cont = $('#ambientes');
    await cont.animate([{ opacity: 1 }, { opacity: 0, translate: '0 6px' }], { duration: reducir ? 0 : 140, easing: EASE.standard, fill: 'forwards' }).finished;
    pintarAmbientes(b.dataset.f);
    cont.getAnimations().forEach((a) => a.cancel());
    cont.animate([{ opacity: 0, translate: '0 6px' }, { opacity: 1, translate: '0 0' }], { duration: reducir ? 0 : 200, easing: EASE.outCubic });
    llenarBarras(cont);
  });

  $('#btn-campana').addEventListener('click', () => toast({
    titulo: 'Clase cancelada · Amb. 108', texto: 'Instr. Diana Ruiz · 14:00. Se notificó a la ficha 2675310.', icono: 'aviso', duracion: 6000,
  }));
  $('#btn-salir').addEventListener('click', volverLogin);
  $('#btn-menu').addEventListener('click', (e) => {
    const abierto = app.classList.toggle('menu-abierto');
    e.currentTarget.setAttribute('aria-expanded', String(abierto));
  });
  addEventListener('scroll', () => $('#topbar').classList.toggle('is-scrolled', scrollY > 4), { passive: true });

  $('#proto-reset').addEventListener('click', () => { if (!app.hidden) volverLogin(); else { form.reset(); doc.focus(); } });

  doc.focus();
})();
