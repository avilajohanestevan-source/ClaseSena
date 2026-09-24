// Revisión del ambiente (instructor), en una sola columna pensada para el celular.
// El instructor la hace al entrar al salón, antes de recibirlo:
//  1. Cabecera con el ambiente y la hora de inicio.
//  2. "Todo está bien": marca el ambiente completo y termina sin revisar ítem por ítem.
//  3. Si hay una novedad: "Escanear ítem" (QR o código de barras de mouse,
//     teclado, silla, computador…) o "Daño del salón" (pared, techo, piso…,
//     sin ítem) → formulario con foto de evidencia, tipo, severidad y comentario.
//  4. Checklist (Bien / Novedad) que se guarda solo, y observaciones.
//  5. Daños reportados e inventario del ambiente (plegable, con búsqueda).
//  6. Barra fija: "Terminar revisión". Se avisa al portero, que genera el QR
//     de entrega; el instructor lo escanea desde la planilla para recibir.
// Si la revisión ya no está en curso, se muestra su planilla.
import { h, anexar, icono, vaciar, errorCampo, vibrar } from '../ui/dom.js';
import { anim } from '../ui/anim.js';
import { toast, abrirModal, confirmar } from '../ui/avisos.js';
import { crearEscaner } from '../ui/escaner.js';
import { crearCapturaFoto } from '../ui/camara.js';
import { chipItem, chipSeveridad, etiquetaTipoDano, fecha } from '../ui/ambientes-ui.js';
import { apiAmb } from '../api/ambientes.js';
import { estado, emitir } from '../estado.js';
import { leerQrItem, validarReporteDano, progresoChecklist, resultadoInspeccion, TIPOS_DANO, PRIORIDADES, UBICACIONES } from '../reglas.js';

const AYUDA_SEVERIDAD = { leve: 'Se puede seguir usando.', moderada: 'Funciona con limitaciones.', grave: 'No se puede usar o es un riesgo.' };

export async function render(raiz, { params, alSalir }) {
  const id = Number(params.get('id'));
  let d = await apiAmb.inspeccion(id);
  if (d.estado !== 'en_curso' || d.instructor.id !== estado.usuario.id) {
    location.replace(`#/planilla?id=${id}`);
    return;
  }

  /* --- cabecera --- */
  const transcurrido = h('span', {});
  const reloj = () => { transcurrido.textContent = `Iniciada a las ${fecha.hora(d.iniciadaEn)} · ${fecha.relativa(d.iniciadaEn)}`; };
  reloj();
  const intervalo = setInterval(reloj, 30_000);
  alSalir(() => clearInterval(intervalo));

  const cab = h('section', { class: 'card insp-cabecera', 'data-anim': '' },
    h('div', { class: 'insp-cabecera-fila' },
      h('span', { class: 'amb-numero amb-numero--grande' }, d.ambiente.codigo),
      h('div', {},
        h('span', { class: 'eyebrow eyebrow-verde' }, 'Revisión al entrar'),
        h('h2', { class: 'vista-titulo' }, d.ambiente.nombre),
        h('p', { class: 'section-sub' }, transcurrido))),
    h('p', { class: 'insp-cabecera-ayuda' }, icono('qr'),
      h('span', {}, 'Si todo está en orden, usa "Todo está bien". Si algo está dañado, escanea su pegatina y toma una foto. Al terminar, el portero genera el QR que escaneas para recibir el salón.')));

  /* --- escanear ítem --- */
  const escanearBtn = h('button', { class: 'btn btn-primary btn-lg', type: 'button', onclick: () => escanearItem() },
    icono('escanear'), 'Escanear ítem dañado');
  const salonBtn = h('button', { class: 'btn btn-outline btn-lg', type: 'button', onclick: () => formularioDano(null) },
    icono('ambiente'), 'Daño del salón');
  // Atajo: el ambiente está bien, sin revisar punto por punto ni ítem por ítem.
  const todoBienBtn = h('button', { class: 'todo-bien', type: 'button', onclick: () => todoBien() },
    h('span', { class: 'todo-bien-icono', 'aria-hidden': 'true' }, icono('check')),
    h('span', {}, h('strong', {}, 'Todo está bien'), h('span', {}, 'Marca el ambiente completo y termina la revisión')),
    icono('flecha'));

  /* --- checklist --- */
  const progreso = h('div', { class: 'progreso', role: 'progressbar', 'aria-valuemin': 0 },
    h('span', { class: 'progreso-relleno' }));
  const progresoTexto = h('span', { class: 'text-muted' });
  const listaChecklist = h('ul', { class: 'checklist' });
  const observaciones = h('textarea', { id: 'insp-obs', rows: 3, maxlength: 500, placeholder: 'Ej.: la puerta del fondo no cierra bien.' }, d.observaciones || '');
  observaciones.value = d.observaciones || '';
  observaciones.addEventListener('input', () => { errorCampo(observaciones, null); guardarLuego(); });

  function pintarChecklist() {
    vaciar(listaChecklist, d.checklist.map((c) => h('li', { class: `checklist-fila${c.ok === false ? ' checklist-fila--novedad' : ''}` },
      h('span', { class: 'checklist-etiqueta', id: `ck-${c.clave}` }, c.etiqueta),
      h('div', { class: 'checklist-opciones', role: 'group', 'aria-labelledby': `ck-${c.clave}` },
        h('button', { class: 'checklist-btn checklist-btn--ok', type: 'button', 'aria-pressed': String(c.ok === true), onclick: () => marcar(c, true) }, icono('check'), 'Bien'),
        h('button', { class: 'checklist-btn checklist-btn--novedad', type: 'button', 'aria-pressed': String(c.ok === false), onclick: () => marcar(c, false) }, icono('alerta'), 'Novedad')))));
    const p = progresoChecklist(d.checklist);
    progreso.setAttribute('aria-valuemax', p.total);
    progreso.setAttribute('aria-valuenow', p.revisados);
    progreso.setAttribute('aria-label', `Checklist: ${p.revisados} de ${p.total} revisados`);
    progreso.firstChild.style.width = `${(p.revisados / p.total) * 100}%`;
    progresoTexto.textContent = `${p.revisados} de ${p.total} revisados${p.novedades ? ` · ${p.novedades} con novedad` : ''}`;
  }
  function marcar(c, ok) {
    c.ok = c.ok === ok ? null : ok; // tocar de nuevo desmarca
    pintarChecklist();
    pintarPie();
    guardarLuego();
  }
  let temporizador = null;
  function guardarLuego() {
    clearTimeout(temporizador);
    temporizador = setTimeout(async () => {
      try { await apiAmb.guardarChecklist(id, d.checklist.map(({ clave, ok }) => ({ clave, ok })), observaciones.value.trim()); }
      catch (e) { toast('error', 'No se guardó el checklist', e.message); }
    }, 700);
  }
  alSalir(() => { if (temporizador) { clearTimeout(temporizador); apiAmb.guardarChecklist(id, d.checklist.map(({ clave, ok }) => ({ clave, ok })), observaciones.value.trim()).catch(() => {}); } });

  /* --- inventario y daños --- */
  const listaInventario = h('ul', { class: 'inv-lista' });
  const listaReportes = h('div', { class: 'reportes' });
  const tituloReportes = h('h3', { class: 'bloque-titulo' });

  let filtroInv = '';
  const buscarInv = h('input', { type: 'search', placeholder: 'Buscar por nombre o código', 'aria-label': 'Buscar en el inventario',
    oninput: () => { filtroInv = buscarInv.value.trim().toLowerCase(); pintarInventario(); } });

  function pintarInventario() {
    const visibles = d.inventario.filter((it) => !filtroInv || `${it.nombre} ${it.codigo}`.toLowerCase().includes(filtroInv));
    vaciar(listaInventario, visibles.map((it) => h('li', { class: `inv-fila${it.reportado ? ' inv-fila--reportado' : ''}` },
      h('div', { class: 'inv-fila-datos' }, h('strong', {}, it.nombre), h('span', { class: 'mono text-muted' }, it.codigo)),
      it.reportado ? h('span', { class: 'status-chip error' }, icono('alerta'), 'Reportado') : chipItem(it.estado),
      !it.reportado && h('button', { class: 'btn btn-outline btn-sm', type: 'button', 'aria-label': `Reportar daño en ${it.nombre}`, onclick: () => formularioDano(it) }, icono('herramienta'), 'Daño'))));
    tituloReportes.textContent = d.reportes.length ? `Daños reportados (${d.reportes.length})` : 'Daños reportados';
    vaciar(listaReportes, d.reportes.length ? d.reportes.map((r) => h('article', { class: 'reporte' },
      r.foto ? h('img', { class: 'reporte-foto', src: r.foto, alt: `Foto del daño en ${r.nombre}`, loading: 'lazy' }) : h('span', { class: 'reporte-foto reporte-foto--vacia', 'aria-hidden': 'true' }, icono('camara')),
      h('div', { class: 'reporte-datos' },
        h('strong', {}, r.itemId ? r.nombre : `Salón · ${r.nombre}`), h('span', { class: 'mono text-muted' }, r.codigo || `Ambiente ${d.ambiente.codigo}`),
        h('div', { class: 'reporte-chips' }, h('span', { class: 'status-chip neutro' }, etiquetaTipoDano(r.tipoDano)), chipSeveridad(r.severidad)),
        h('p', {}, r.comentario)),
      h('button', { class: 'btn btn-outline btn-sm btn-icono', type: 'button', 'aria-label': `Quitar el reporte de ${r.nombre}`, onclick: () => quitar(r) }, icono('basura'))))
      : h('p', { class: 'text-muted reportes-vacio' }, 'Ningún daño reportado. Si todo está bien, usa "Todo está bien".'));
    todoBienBtn.hidden = d.reportes.length > 0;
  }

  async function quitar(r) {
    if (!await confirmar({ titulo: `¿Quitar el reporte de ${r.nombre}?`, mensaje: r.itemId ? 'El ítem vuelve al estado que tenía antes del reporte.' : 'Se borra el reporte y su foto.', textoAceptar: 'Quitar', peligro: true })) return;
    try { d = await apiAmb.quitarDano(id, r.id); pintarTodo(); toast('exito', 'Reporte quitado'); } catch (e) { toast('error', 'No se quitó', e.message); }
  }

  function escanearItem() {
    let escaner;
    const { cerrar } = abrirModal({
      titulo: 'Escanear ítem dañado', subtitulo: `Ambiente ${d.ambiente.codigo} · QR o código de barras de la pegatina.`, ancho: 'angosto',
      contenido: () => {
        escaner = crearEscaner({
          tipos: ['qr', 'barras'], etiqueta: 'Abrir cámara', placeholder: 'Código de la pegatina (AMB107-003)',
          alLeer: async (texto) => {
            const codigo = leerQrItem(texto);
            if (!codigo) { toast('error', 'Ese código no es de una pegatina del inventario', texto.slice(0, 60)); return; }
            const it = d.inventario.find((x) => x.codigo === codigo);
            if (!it) {
              let otro = null;
              try { otro = await apiAmb.itemPorCodigo(codigo); } catch { /* no existe */ }
              if (otro) { toast('error', 'Ítem de otro ambiente', `${otro.nombre} (${codigo}) es del ambiente ${otro.ambiente}, no del ${d.ambiente.codigo}.`); return; }
              cerrar();
              // Sin pegatina registrada: se puede reportar igual como daño del salón.
              if (await confirmar({ titulo: `${codigo} no está en el inventario`, mensaje: 'Puedes reportarlo como daño del salón (con foto) y coordinación lo revisará.', textoAceptar: 'Reportar como daño del salón' })) {
                formularioDano(null, `Elemento con código ${codigo} (sin registrar en el inventario): `);
              }
              return;
            }
            cerrar();
            if (it.reportado) { toast('aviso', 'Ya reportado', `${it.nombre} ya tiene un daño en esta revisión.`); return; }
            vibrar(40);
            formularioDano(it);
          },
        });
        return escaner.el;
      },
      alCerrar: () => escaner?.detener(),
    });
  }

  /** Daño de un ítem (it) o, con it = null, daño del salón con su ubicación. */
  function formularioDano(it, comentarioInicial = '') {
    let tipoDano = '', severidad = '', foto = null, enviando = false, ubicacion = '';
    const ubicaciones = !it && h('div', { class: 'opciones-chip', role: 'radiogroup', 'aria-labelledby': 'dano-ubic' },
      UBICACIONES.map((u) => h('label', { class: 'opcion-chip' },
        h('input', { type: 'radio', name: 'ubicacion', value: u.clave, onchange: () => { ubicacion = u.clave; errorCampo(ubicaciones, null); } }),
        h('span', {}, u.etiqueta))));
    const tipos = h('div', { class: 'opciones-chip', role: 'radiogroup', 'aria-labelledby': 'dano-tipo' },
      TIPOS_DANO.map((t) => h('label', { class: 'opcion-chip' },
        h('input', { type: 'radio', name: 'tipo-dano', value: t.clave, onchange: () => { tipoDano = t.clave; errorCampo(tipos, null); } }),
        h('span', {}, t.etiqueta))));
    const severidades = h('div', { class: 'prioridades', role: 'radiogroup', 'aria-labelledby': 'dano-sev' },
      PRIORIDADES.map((p) => h('label', { class: `prioridad prioridad--${p.clave}` },
        h('input', { type: 'radio', name: 'severidad', value: p.clave, onchange: () => { severidad = p.clave; errorCampo(severidades, null); } }),
        h('strong', {}, p.etiqueta), h('span', {}, AYUDA_SEVERIDAD[p.clave]))));
    const comentario = h('textarea', { id: 'dano-comentario', rows: 3, maxlength: 500, placeholder: it ? '¿Qué le pasa? ¿Desde cuándo?' : 'Ej.: grieta en la pared del fondo, junto a la ventana.' });
    comentario.value = comentarioInicial;
    const contador = h('span', { class: 'contador-caracteres' }, '0/500');
    comentario.addEventListener('input', () => { contador.textContent = `${comentario.value.length}/500`; errorCampo(comentario, null); });
    const captura = crearCapturaFoto({ alCambiar: (f) => { foto = f; if (f) errorCampo(captura.el, null); } });
    const marcaFoto = h('span', { class: 'foto-requisito foto-requisito--obligatoria' }, '(evidencia obligatoria)');
    const enviar = h('button', { class: 'btn btn-peligro', type: 'button', onclick: () => guardar() }, icono('herramienta'), 'Reportar daño');

    const { cerrar } = abrirModal({
      titulo: it ? 'Reportar daño' : 'Daño del salón', subtitulo: it ? `${it.nombre} · ${it.codigo}` : `Ambiente ${d.ambiente.codigo} · no es un ítem del inventario`, ancho: 'normal',
      contenido: h('div', { class: 'form-dano-insp' },
        !it && h('div', { class: 'campo' }, h('label', { id: 'dano-ubic' }, '¿Dónde está el daño?'), ubicaciones),
        h('div', { class: 'campo' }, h('label', { id: 'dano-tipo' }, 'Tipo de daño'), tipos),
        h('div', { class: 'campo' }, h('label', { id: 'dano-sev' }, 'Severidad'), severidades),
        h('div', { class: 'campo' }, h('label', { for: 'dano-comentario' }, 'Comentario'), comentario, contador),
        h('div', { class: 'campo' }, h('label', {}, 'Foto ', marcaFoto), captura.el)),
      acciones: [({ cerrar: c }) => h('button', { class: 'btn btn-outline', type: 'button', onclick: () => c() }, 'Cancelar'), enviar],
      alCerrar: () => captura.detener(),
    });

    async function guardar() {
      if (enviando) return;
      const datos = it ? { itemId: it.id, tipoDano, severidad, comentario: comentario.value.trim(), foto }
        : { ubicacion, tipoDano, severidad, comentario: comentario.value.trim(), foto };
      const errores = validarReporteDano(datos);
      if (!it) errorCampo(ubicaciones, ubicacion ? null : 'Elige dónde está el daño.');
      errorCampo(tipos, errores.tipoDano);
      errorCampo(severidades, errores.severidad);
      errorCampo(comentario, errores.comentario);
      errorCampo(captura.el, errores.foto);
      if (Object.keys(errores).length) return;
      enviando = true;
      enviar.disabled = true;
      try {
        d = await apiAmb.reportarDano(id, datos);
        cerrar();
        pintarTodo();
        toast('exito', 'Daño reportado', it ? `${it.nombre} quedó marcado como dañado en el inventario.` : 'Quedó asociado al ambiente con su foto.');
      } catch (e) {
        toast('error', 'No se reportó', e.message);
        enviando = false;
        enviar.disabled = false;
      }
    }
  }

  /* --- pie fijo: terminar la revisión --- */
  const ayudaPie = h('p', { class: 'insp-pie-ayuda', role: 'status' });
  const confirmarBtn = h('button', { class: 'btn btn-primary btn-block btn-lg', type: 'button', onclick: () => confirmarInspeccion() });
  const cancelarBtn = h('button', { class: 'btn btn-outline', type: 'button', onclick: () => cancelar() }, 'Cancelar revisión');

  function pintarPie() {
    const p = progresoChecklist(d.checklist);
    const resultado = resultadoInspeccion(d);
    confirmarBtn.disabled = !p.completo;
    confirmarBtn.className = `btn btn-block btn-lg ${resultado === 'ok' ? 'btn-primary' : 'btn-out'}`;
    vaciar(confirmarBtn, icono(resultado === 'ok' ? 'check' : 'alerta'),
      resultado === 'ok' ? 'Terminar revisión' : 'Terminar revisión con novedades');
    ayudaPie.textContent = p.completo
      ? (resultado === 'ok' ? 'Al terminar, el portero genera el QR de entrega.' : `${d.reportes.length} daño(s) y ${p.novedades} novedad(es): coordinación recibirá el aviso cuando escanees el QR.`)
      : d.reportes.length ? `Falta revisar ${p.total - p.revisados} punto(s) del checklist.`
        : `Falta revisar ${p.total - p.revisados} punto(s) del checklist, o usa "Todo está bien".`;
  }

  async function confirmarInspeccion() {
    const p = progresoChecklist(d.checklist);
    if (!p.completo) return;
    if (p.novedades && !observaciones.value.trim()) {
      errorCampo(observaciones, 'Describe la novedad que marcaste en el checklist.');
      observaciones.focus();
      return;
    }
    const resultado = resultadoInspeccion(d);
    const novedades = [
      d.reportes.length && `${d.reportes.length} daño(s) reportado(s)`, p.novedades && `${p.novedades} novedad(es) en el checklist`,
    ].filter(Boolean).join(' y ');
    if (!await confirmar({
      titulo: `¿Terminar la revisión del ${d.ambiente.codigo}?`,
      mensaje: `${resultado === 'ok' ? 'Todo en orden.' : `Con ${novedades}.`} Se avisa a ${d.ambiente.portero || 'portería'} para que genere el QR de entrega. Después ya no podrás cambiar la revisión.`,
      textoAceptar: 'Terminar revisión',
    })) return;
    confirmarBtn.disabled = true;
    try {
      d = await apiAmb.confirmarInspeccion(id, {
        checklist: d.checklist.map(({ clave, ok }) => ({ clave, ok })), observaciones: observaciones.value.trim(),
      });
      clearTimeout(temporizador); temporizador = null;
      emitir('inspecciones');
      location.hash = `#/planilla?id=${id}`;
    } catch (e) {
      toast('error', 'No se terminó la revisión', e.message);
      confirmarBtn.disabled = false;
    }
  }

  async function todoBien() {
    if (!await confirmar({
      titulo: `¿Todo está bien en el ${d.ambiente.codigo}?`,
      mensaje: `Se marca el ambiente completo en buen estado y se avisa a ${d.ambiente.portero || 'portería'} para que genere el QR de entrega.`,
      textoAceptar: 'Sí, todo está bien',
    })) return;
    todoBienBtn.disabled = true;
    try {
      d = await apiAmb.confirmarInspeccion(id, { todoBien: true, observaciones: observaciones.value.trim() });
      clearTimeout(temporizador); temporizador = null;
      emitir('inspecciones');
      location.hash = `#/planilla?id=${id}`;
    } catch (e) {
      toast('error', 'No se terminó la revisión', e.message);
      todoBienBtn.disabled = false;
    }
  }

  async function cancelar() {
    if (!await confirmar({ titulo: '¿Cancelar la revisión?', mensaje: 'Se borran los daños reportados y el ambiente queda libre para otra revisión.', textoAceptar: 'Cancelar revisión', peligro: true })) return;
    try {
      await apiAmb.cancelarInspeccion(id);
      clearTimeout(temporizador); temporizador = null;
      emitir('inspecciones');
      toast('info', 'Revisión cancelada');
      location.hash = '#/inspecciones';
    } catch (e) { toast('error', 'No se canceló', e.message); }
  }

  function pintarTodo() { pintarChecklist(); pintarInventario(); pintarPie(); }

  anexar(raiz,
    cab,
    h('div', { 'data-anim': '' }, todoBienBtn),
    h('section', { class: 'insp-escanear', 'data-anim': '', 'aria-label': 'Reportar una novedad' },
      h('p', { class: 'insp-escanear-titulo' }, '¿Encontraste una novedad?'),
      h('div', { class: 'insp-escanear-botones' }, escanearBtn, salonBtn),
      h('p', { class: 'text-muted' }, 'Escanea la pegatina del elemento dañado, o reporta un daño de pared, techo, piso… Siempre con foto.')),
    h('section', { class: 'card', 'data-anim': '', 'aria-labelledby': 'insp-t-check' },
      h('div', { class: 'adm-bloque-cabecera' }, h('h3', { class: 'bloque-titulo', id: 'insp-t-check' }, 'Checklist del ambiente'), progresoTexto),
      progreso, listaChecklist,
      h('div', { class: 'campo' }, h('label', { for: 'insp-obs' }, 'Observaciones ', h('span', { class: 'opt' }, '(obligatorias si hay novedades)')), observaciones)),
    h('section', { class: 'card', 'data-anim': '' }, tituloReportes, listaReportes),
    h('details', { class: 'card insp-inventario', 'data-anim': '' },
      h('summary', {}, h('span', { class: 'bloque-titulo' }, `Inventario del ambiente (${d.inventario.length})`), h('span', { class: 'text-muted' }, 'Ver y reportar sin escanear')),
      h('div', { class: 'adm-buscar' }, icono('buscar'), buscarInv),
      listaInventario),
    h('div', { class: 'insp-pie' }, ayudaPie, confirmarBtn, cancelarBtn));
  pintarTodo();
  anim.entrarVista(raiz);
}
