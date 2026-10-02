// Revisión del ambiente (instructor), en una sola columna pensada para el celular.
// El instructor la hace al entrar al salón, antes de recibirlo:
//  1. Cabecera con el ambiente y la hora de inicio.
//  2. "Todo está bien": atajo que marca en la pantalla el checklist y todos los
//     ítems del ambiente como OK. No envía nada, no termina la revisión ni
//     escanea ningún QR: el instructor revisa y luego pulsa "Terminar revisión".
//  3. Novedades permanentes que el ambiente ya tiene activas (no se reportan otra vez).
//  4. Si hay una novedad: "Escanear ítem o familia" (QR o código de barras de
//     la pegatina) o "Daño del salón" (pared, techo, piso…) → formulario con
//     foto de evidencia, naturaleza (permanente, temporal o limpieza), tipo,
//     severidad y comentario. De una familia se reporta la familia completa o
//     un componente.
//  5. Checklist (Bien / Novedad) que se guarda solo, y observaciones.
//  6. Ítems y familias del ambiente: marcar OK uno a uno o reportar sin escanear.
//  7. Barra fija: "Terminar revisión" envía checklist e ítems OK. Se avisa al
//     portero, que genera el QR de entrega; el instructor lo escanea para recibir.
// Si la revisión ya no está en curso, se muestra su planilla.
import { h, anexar, icono, vaciar, errorCampo, vibrar } from '../ui/dom.js';
import { anim } from '../ui/anim.js';
import { toast, abrirModal, confirmar } from '../ui/avisos.js';
import { crearEscaner } from '../ui/escaner.js';
import { crearCapturaFoto } from '../ui/camara.js';
import { chipItem, chipSeveridad, chipNaturaleza, etiquetaTipoDano, fecha } from '../ui/ambientes-ui.js';
import { apiAmb } from '../api/ambientes.js';
import { estado, emitir } from '../estado.js';
import {
  validarReporteDano, progresoChecklist, resultadoInspeccion, marcarTodoBien, itemsRevisables, naturalezaPorDefecto,
  TIPOS_DANO, PRIORIDADES, UBICACIONES, NATURALEZAS,
} from '../reglas.js';

const AYUDA_SEVERIDAD = { leve: 'Se puede seguir usando.', moderada: 'Funciona con limitaciones.', grave: 'No se puede usar o es un riesgo.' };

export async function render(raiz, { params, alSalir }) {
  const id = Number(params.get('id'));
  let d = await apiAmb.inspeccion(id);
  if (d.estado !== 'en_curso' || d.instructor.id !== estado.usuario.id) {
    location.replace(`#/planilla?id=${id}`);
    return;
  }

  // Ítems marcados OK: solo existen en esta pantalla hasta "Terminar revisión"
  // (se recuerdan en la pestaña por si se recarga la página).
  const claveOk = `sena-ambientes.insp-ok-${id}`;
  let itemsOk = new Set();
  try { itemsOk = new Set(JSON.parse(sessionStorage.getItem(claveOk) || '[]')); } catch { /* sin almacenamiento */ }
  const recordarOk = () => { try { sessionStorage.setItem(claveOk, JSON.stringify([...itemsOk])); } catch { /* sin almacenamiento */ } };
  let deshacer = null; // estado anterior al atajo "Todo está bien"

  /**
   * Toma la revisión que devuelve el servidor tras reportar o quitar una
   * novedad, sin perder lo que solo está en la pantalla: el checklist marcado
   * con el atajo "Todo está bien" todavía no se ha enviado.
   */
  function conservarLocal(nuevo) {
    const checklist = d.checklist;
    d = nuevo;
    d.checklist = d.checklist.map((c) => {
      const local = checklist.find((x) => x.clave === c.clave);
      return local ? { ...c, ok: local.ok } : c;
    });
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
      h('span', {}, 'Si todo está en orden, "Todo está bien" marca el checklist y los ítems como OK; revisa y pulsa "Terminar revisión". Si algo tiene una novedad, escanea su pegatina (o la de su familia) y toma una foto.')));

  /* --- atajo "Todo está bien" (solo en la pantalla) --- */
  const todoBienTexto = h('span', {});
  const todoBienBtn = h('button', { class: 'todo-bien', type: 'button', onclick: () => todoBien() },
    h('span', { class: 'todo-bien-icono', 'aria-hidden': 'true' }, icono('check')),
    h('span', {}, h('strong', {}, 'Todo está bien'), todoBienTexto),
    icono('flecha'));
  const deshacerBtn = h('button', { class: 'btn btn-outline btn-sm todo-bien-deshacer', type: 'button', hidden: true, onclick: () => deshacerTodoBien() }, icono('reintentar'), 'Deshacer');
  const avisoAtajo = h('p', { class: 'todo-bien-aviso', role: 'status' });

  /* --- escanear --- */
  const escanearBtn = h('button', { class: 'btn btn-primary btn-lg', type: 'button', onclick: () => escanear() },
    icono('escanear'), 'Escanear ítem o familia');
  const salonBtn = h('button', { class: 'btn btn-outline btn-lg', type: 'button', onclick: () => formularioDano({}) },
    icono('ambiente'), 'Daño del salón');

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
    deshacer = null;
    pintarChecklist();
    pintarPie();
    pintarAtajo();
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

  /* --- novedades activas, reportes, ítems y familias --- */
  const activas = h('section', { class: 'card insp-activas', 'data-anim': '', 'aria-labelledby': 'insp-t-activas' });
  const listaInventario = h('ul', { class: 'inv-lista' });
  const listaFamilias = h('ul', { class: 'inv-lista insp-familias' });
  const listaReportes = h('div', { class: 'reportes' });
  const tituloReportes = h('h3', { class: 'bloque-titulo' });
  const resumenItems = h('span', { class: 'text-muted' });

  let filtroInv = '';
  const buscarInv = h('input', { type: 'search', placeholder: 'Buscar por nombre, código o familia', 'aria-label': 'Buscar en el inventario',
    oninput: () => { filtroInv = buscarInv.value.trim().toLowerCase(); pintarInventario(); } });

  function pintarActivas() {
    activas.hidden = !d.novedadesActivas.length;
    vaciar(activas,
      h('h3', { class: 'bloque-titulo', id: 'insp-t-activas' }, icono('reloj'), ` Novedades permanentes en curso (${d.novedadesActivas.length})`),
      h('p', { class: 'text-muted' }, 'Ya están registradas y siguen en curso hasta que un instructor o coordinación las resuelva. No hace falta reportarlas de nuevo: puedes agregarles seguimiento en Novedades.'),
      h('ul', { class: 'insp-activas-lista' }, d.novedadesActivas.map((n) => h('li', {},
        h('strong', {}, n.titulo),
        h('span', {}, n.descripcion),
        h('span', { class: 'reporte-chips' }, chipSeveridad(n.severidad), n.itemEstado && chipItem(n.itemEstado),
          h('span', { class: 'text-muted' }, `desde ${fecha.corta(n.creadaEn)}`))))));
  }

  function filaItem(it) {
    const revisable = itemsRevisables([it]).length === 1;
    const ok = revisable && itemsOk.has(it.id);
    return h('li', { class: `inv-fila${it.reportado ? ' inv-fila--reportado' : ok ? ' inv-fila--ok' : ''}` },
      h('div', { class: 'inv-fila-datos' },
        h('strong', {}, it.nombre),
        h('span', { class: 'mono text-muted' }, it.codigo, it.familia && ` · ${it.familia.codigo}`)),
      it.reportado ? h('span', { class: 'status-chip error' }, icono('alerta'), it.reportadoPorFamilia ? 'Reportado con la familia' : 'Reportado')
        : it.novedadActivaId ? h('span', { class: 'status-chip out' }, icono('reloj'), 'Novedad en curso')
          : revisable ? h('button', { class: 'checklist-btn checklist-btn--ok', type: 'button', 'aria-pressed': String(ok), 'aria-label': `${it.nombre}: ${ok ? 'marcado OK' : 'marcar OK'}`, onclick: () => alternarOk(it) }, icono('check'), 'OK')
            : chipItem(it.estado),
      !it.reportado && h('button', { class: 'btn btn-outline btn-sm', type: 'button', 'aria-label': `Reportar novedad en ${it.nombre}`, onclick: () => formularioDano({ item: it }) }, icono('herramienta'), 'Novedad'));
  }

  function alternarOk(it) {
    if (itemsOk.has(it.id)) itemsOk.delete(it.id); else itemsOk.add(it.id);
    deshacer = null;
    recordarOk();
    pintarInventario();
    pintarPie();
    pintarAtajo();
  }

  function pintarInventario() {
    const visibles = d.inventario.filter((it) => !filtroInv || `${it.nombre} ${it.codigo} ${it.familia?.codigo || ''} ${it.familia?.nombre || ''}`.toLowerCase().includes(filtroInv));
    vaciar(listaInventario, visibles.map(filaItem));
    vaciar(listaFamilias, d.familias.map((f) => h('li', { class: `inv-fila${f.reportado ? ' inv-fila--reportado' : ''}` },
      h('div', { class: 'inv-fila-datos' }, h('strong', {}, icono('capas'), ` ${f.nombre}`), h('span', { class: 'mono text-muted' }, `${f.codigo} · ${f.itemIds.length} componente(s)`)),
      f.reportado ? h('span', { class: 'status-chip error' }, icono('alerta'), 'Familia reportada')
        : f.novedadActivaId ? h('span', { class: 'status-chip out' }, icono('reloj'), 'Novedad en curso') : null,
      !f.reportado && h('button', { class: 'btn btn-outline btn-sm', type: 'button', 'aria-label': `Novedad en la familia ${f.nombre}`, onclick: () => elegirEnFamilia(f) }, icono('herramienta'), 'Novedad'))));
    const revisables = itemsRevisables(d.inventario);
    const marcados = revisables.filter((i) => itemsOk.has(i.id)).length;
    resumenItems.textContent = `${marcados} de ${revisables.length} ítems OK${d.inventario.length > revisables.length ? ` · ${d.inventario.length - revisables.length} con novedad o fuera de servicio` : ''}`;

    tituloReportes.textContent = d.reportes.length ? `Novedades reportadas (${d.reportes.length})` : 'Novedades reportadas';
    vaciar(listaReportes, d.reportes.length ? d.reportes.map((r) => h('article', { class: 'reporte' },
      r.foto ? h('img', { class: 'reporte-foto', src: r.foto, alt: `Foto de la novedad en ${r.nombre}`, loading: 'lazy' }) : h('span', { class: 'reporte-foto reporte-foto--vacia', 'aria-hidden': 'true' }, icono('camara')),
      h('div', { class: 'reporte-datos' },
        h('strong', {}, r.itemId || r.familiaId ? r.nombre : `Salón · ${r.nombre}`), h('span', { class: 'mono text-muted' }, r.codigo || `Ambiente ${d.ambiente.codigo}`),
        h('div', { class: 'reporte-chips' }, chipNaturaleza(r.naturaleza), h('span', { class: 'status-chip neutro' }, etiquetaTipoDano(r.tipoDano)), chipSeveridad(r.severidad),
          r.novedadId && h('a', { class: 'status-chip error', href: `#/novedades?id=${r.novedadId}` }, `Novedad #${r.novedadId} en curso`)),
        h('p', {}, r.comentario)),
      h('button', { class: 'btn btn-outline btn-sm btn-icono', type: 'button', 'aria-label': `Quitar el reporte de ${r.nombre}`, onclick: () => quitar(r) }, icono('basura'))))
      : h('p', { class: 'text-muted reportes-vacio' }, 'Ninguna novedad reportada.'));
  }

  async function quitar(r) {
    if (!await confirmar({ titulo: `¿Quitar el reporte de ${r.nombre}?`, mensaje: r.itemId || r.familiaId ? 'Si era permanente, el inventario vuelve al estado que tenía antes del reporte.' : 'Se borra el reporte y su foto.', textoAceptar: 'Quitar', peligro: true })) return;
    try { conservarLocal(await apiAmb.quitarDano(id, r.id)); pintarTodo(); toast('exito', 'Reporte quitado'); } catch (e) { toast('error', 'No se quitó', e.message); }
  }

  /* --- "Todo está bien": solo cambia la pantalla --- */
  function pintarAtajo() {
    const revisables = itemsRevisables(d.inventario);
    const p = progresoChecklist(d.checklist);
    const completo = p.completo && revisables.every((i) => itemsOk.has(i.id));
    todoBienBtn.disabled = completo;
    todoBienBtn.classList.toggle('todo-bien--hecho', completo);
    todoBienTexto.textContent = completo
      ? 'Checklist e ítems marcados OK. Revisa y pulsa "Terminar revisión".'
      : `Marca el checklist y ${revisables.length} ítem(s) como OK, sin enviar nada`;
    deshacerBtn.hidden = !deshacer;
    avisoAtajo.textContent = deshacer ? 'Se marcó todo como OK en esta pantalla. Aún no se ha enviado: revisa y pulsa "Terminar revisión".' : '';
  }

  function todoBien() {
    deshacer = { checklist: d.checklist.map((c) => ({ ...c })), itemsOk: new Set(itemsOk) };
    const r = marcarTodoBien(d.checklist, d.inventario);
    d.checklist = r.checklist;
    itemsOk = new Set([...itemsOk, ...r.itemsOk]);
    recordarOk();
    vibrar(30);
    pintarChecklist();
    pintarInventario();
    pintarPie();
    pintarAtajo();
  }

  function deshacerTodoBien() {
    if (!deshacer) return;
    d.checklist = deshacer.checklist;
    itemsOk = deshacer.itemsOk;
    deshacer = null;
    recordarOk();
    pintarTodo();
    todoBienBtn.focus();
  }

  /* --- escanear un ítem o una familia --- */
  function escanear() {
    let escaner;
    const { cerrar } = abrirModal({
      titulo: 'Escanear ítem o familia', subtitulo: `Ambiente ${d.ambiente.codigo} · QR o código de barras de la pegatina.`, ancho: 'angosto',
      contenido: () => {
        escaner = crearEscaner({
          tipos: ['qr', 'barras'], etiqueta: 'Abrir cámara', placeholder: 'Código de la pegatina (AMB107-003, FAM107-PC01)',
          alLeer: async (texto) => {
            let r;
            try { r = await apiAmb.buscarEscaneado(texto); } catch (e) {
              if (e.status !== 404) { toast('error', 'No se pudo consultar', e.message); return; }
              cerrar();
              // Sin pegatina registrada: se puede reportar igual como daño del salón.
              if (await confirmar({ titulo: 'Ese código no está en el inventario', mensaje: 'Puedes reportarlo como daño del salón (con foto) y coordinación lo revisará.', textoAceptar: 'Reportar como daño del salón' })) {
                formularioDano({ comentario: `Elemento con código ${texto.trim().slice(0, 60)} (sin registrar en el inventario): ` });
              }
              return;
            }
            const deOtro = r.tipo === 'item' ? r.item : r.familia;
            if (deOtro.ambienteId !== d.ambiente.id) {
              toast('error', r.tipo === 'item' ? 'Ítem de otro ambiente' : 'Familia de otro ambiente', `${deOtro.nombre} (${deOtro.codigo}) es del ambiente ${deOtro.ambiente}, no del ${d.ambiente.codigo}.`);
              return;
            }
            cerrar();
            vibrar(40);
            if (r.tipo === 'familia') { elegirEnFamilia(d.familias.find((f) => f.id === r.familia.id) || { ...r.familia, itemIds: r.familia.componentes.map((c) => c.id) }); return; }
            const it = d.inventario.find((x) => x.id === r.item.id);
            if (it?.reportado) { toast('aviso', 'Ya reportado', `${it.nombre} ya tiene una novedad en esta revisión${it.reportadoPorFamilia ? ' (con su familia)' : ''}.`); return; }
            formularioDano({ item: it || r.item });
          },
        });
        return escaner.el;
      },
      alCerrar: () => escaner?.detener(),
    });
  }

  /** Pegatina de familia: la familia completa o uno de sus componentes. */
  function elegirEnFamilia(f) {
    if (f.reportado) { toast('aviso', 'Familia ya reportada', `${f.nombre} ya tiene una novedad en esta revisión.`); return; }
    const componentes = d.inventario.filter((i) => f.itemIds.includes(i.id));
    const sueltos = componentes.filter((i) => i.reportado);
    const { cerrar } = abrirModal({
      titulo: f.nombre, subtitulo: `Familia ${f.tipo} · ${f.codigo} · ¿qué tiene la novedad?`, ancho: 'angosto',
      contenido: h('div', { class: 'familia-elegir' },
        h('button', { class: 'todo-bien familia-completa', type: 'button', disabled: sueltos.length > 0,
          onclick: () => { cerrar(); formularioDano({ familia: f }); } },
        h('span', { class: 'todo-bien-icono', 'aria-hidden': 'true' }, icono('capas')),
        h('span', {}, h('strong', {}, 'Toda la familia'),
          h('span', {}, sueltos.length ? `Ya reportaste ${sueltos.map((i) => i.nombre).join(', ')}: quita ese reporte para reportar la familia completa.`
            : `${componentes.length} componente(s): ${componentes.map((i) => i.nombre).join(', ')}`)),
        icono('flecha')),
        h('p', { class: 'insp-escanear-titulo' }, 'O solo un componente:'),
        h('ul', { class: 'inv-lista' }, componentes.map((it) => h('li', { class: `inv-fila${it.reportado ? ' inv-fila--reportado' : ''}` },
          h('div', { class: 'inv-fila-datos' }, h('strong', {}, it.nombre), h('span', { class: 'mono text-muted' }, `${it.codigo} · ${it.categoria}`)),
          it.reportado ? h('span', { class: 'status-chip error' }, 'Reportado')
            : h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => { cerrar(); formularioDano({ item: it }); } }, icono('herramienta'), 'Novedad'))))),
    });
  }

  /** Novedad de un ítem, de una familia completa o (sin ninguno) del salón con su ubicación. */
  function formularioDano({ item = null, familia = null, comentario: comentarioInicial = '' }) {
    let tipoDano = '', severidad = '', foto = null, enviando = false, ubicacion = '', naturaleza = '', naturalezaElegida = false;
    const delSalon = !item && !familia;
    const ubicaciones = delSalon && h('div', { class: 'opciones-chip', role: 'radiogroup', 'aria-labelledby': 'dano-ubic' },
      UBICACIONES.map((u) => h('label', { class: 'opcion-chip' },
        h('input', { type: 'radio', name: 'ubicacion', value: u.clave, onchange: () => { ubicacion = u.clave; errorCampo(ubicaciones, null); } }),
        h('span', {}, u.etiqueta))));
    const naturalezas = h('div', { class: 'prioridades naturalezas', role: 'radiogroup', 'aria-labelledby': 'dano-nat' },
      NATURALEZAS.map((n) => h('label', { class: `prioridad naturaleza--${n.clave}` },
        h('input', { type: 'radio', name: 'naturaleza', value: n.clave, onchange: () => { naturaleza = n.clave; naturalezaElegida = true; errorCampo(naturalezas, null); } }),
        h('strong', {}, n.etiqueta), h('span', {}, n.ayuda))));
    const tipos = h('div', { class: 'opciones-chip', role: 'radiogroup', 'aria-labelledby': 'dano-tipo' },
      TIPOS_DANO.map((t) => h('label', { class: 'opcion-chip' },
        h('input', { type: 'radio', name: 'tipo-dano', value: t.clave, onchange: () => {
          tipoDano = t.clave;
          errorCampo(tipos, null);
          // Sugerencia: la suciedad es de limpieza; lo demás, permanente. El instructor puede cambiarla.
          if (!naturalezaElegida) {
            naturaleza = naturalezaPorDefecto(t.clave);
            naturalezas.querySelector(`input[value="${naturaleza}"]`).checked = true;
          }
        } }),
        h('span', {}, t.etiqueta))));
    const severidades = h('div', { class: 'prioridades', role: 'radiogroup', 'aria-labelledby': 'dano-sev' },
      PRIORIDADES.map((p) => h('label', { class: `prioridad prioridad--${p.clave}` },
        h('input', { type: 'radio', name: 'severidad', value: p.clave, onchange: () => { severidad = p.clave; errorCampo(severidades, null); } }),
        h('strong', {}, p.etiqueta), h('span', {}, AYUDA_SEVERIDAD[p.clave]))));
    const comentario = h('textarea', { id: 'dano-comentario', rows: 3, maxlength: 500, placeholder: delSalon ? 'Ej.: grieta en la pared del fondo, junto a la ventana.' : '¿Qué le pasa? ¿Desde cuándo?' });
    comentario.value = comentarioInicial;
    const contador = h('span', { class: 'contador-caracteres' }, `${comentarioInicial.length}/500`);
    comentario.addEventListener('input', () => { contador.textContent = `${comentario.value.length}/500`; errorCampo(comentario, null); });
    const captura = crearCapturaFoto({ alCambiar: (f) => { foto = f; if (f) errorCampo(captura.el, null); } });
    const marcaFoto = h('span', { class: 'foto-requisito foto-requisito--obligatoria' }, '(evidencia obligatoria)');
    const enviar = h('button', { class: 'btn btn-peligro', type: 'button', onclick: () => guardar() }, icono('herramienta'), 'Reportar novedad');
    const componentes = familia ? d.inventario.filter((i) => familia.itemIds.includes(i.id)) : [];

    const { cerrar } = abrirModal({
      titulo: familia ? 'Novedad de la familia completa' : item ? 'Reportar novedad' : 'Daño del salón',
      subtitulo: familia ? `${familia.nombre} · ${familia.codigo} · ${componentes.map((i) => i.nombre).join(', ')}`
        : item ? `${item.nombre} · ${item.codigo}` : `Ambiente ${d.ambiente.codigo} · no es un ítem del inventario`,
      ancho: 'normal',
      contenido: h('div', { class: 'form-dano-insp' },
        delSalon && h('div', { class: 'campo' }, h('label', { id: 'dano-ubic' }, '¿Dónde está el daño?'), ubicaciones),
        h('div', { class: 'campo' }, h('label', { id: 'dano-tipo' }, 'Tipo de novedad'), tipos),
        h('div', { class: 'campo' }, h('label', { id: 'dano-nat' }, '¿Es permanente o temporal?'), naturalezas),
        h('div', { class: 'campo' }, h('label', { id: 'dano-sev' }, 'Severidad'), severidades),
        h('div', { class: 'campo' }, h('label', { for: 'dano-comentario' }, 'Comentario'), comentario, contador),
        h('div', { class: 'campo' }, h('label', {}, 'Foto ', marcaFoto), captura.el)),
      acciones: [({ cerrar: c }) => h('button', { class: 'btn btn-outline', type: 'button', onclick: () => c() }, 'Cancelar'), enviar],
      alCerrar: () => captura.detener(),
    });

    async function guardar() {
      if (enviando) return;
      const base = { naturaleza, tipoDano, severidad, comentario: comentario.value.trim(), foto };
      const datos = familia ? { familiaId: familia.id, ...base } : item ? { itemId: item.id, ...base } : { ubicacion, ...base };
      const errores = validarReporteDano(datos);
      if (delSalon) errorCampo(ubicaciones, ubicacion ? null : 'Elige dónde está el daño.');
      errorCampo(naturalezas, errores.naturaleza);
      errorCampo(tipos, errores.tipoDano);
      errorCampo(severidades, errores.severidad);
      errorCampo(comentario, errores.comentario);
      errorCampo(captura.el, errores.foto);
      if (Object.keys(errores).length) return;
      enviando = true;
      enviar.disabled = true;
      try {
        conservarLocal(await apiAmb.reportarDano(id, datos));
        // Lo que ahora tiene una novedad ya no cuenta como OK.
        d.inventario.filter((i) => i.reportado).forEach((i) => itemsOk.delete(i.id));
        recordarOk();
        cerrar();
        pintarTodo();
        const permanente = naturaleza === 'permanente';
        if (permanente) emitir('novedades');
        toast(permanente ? 'aviso' : 'exito', permanente ? 'Novedad permanente en curso' : 'Novedad reportada', familia ? `La familia ${familia.nombre}${permanente ? ' quedó marcada como dañada' : ' quedó con la novedad'}.`
          : item ? `${item.nombre}${permanente ? ' quedó marcado como dañado en el inventario' : ': incidencia registrada, el inventario no cambia'}.` : 'Quedó asociada al ambiente con su foto.');
      } catch (e) {
        toast('error', 'No se reportó', e.message);
        enviando = false;
        enviar.disabled = false;
      }
    }
  }

  /* --- pie fijo: terminar la revisión (el único paso que envía) --- */
  const ayudaPie = h('p', { class: 'insp-pie-ayuda', role: 'status' });
  const confirmarBtn = h('button', { class: 'btn btn-primary btn-block btn-lg', type: 'button', onclick: () => confirmarInspeccion() });
  const cancelarBtn = h('button', { class: 'btn btn-outline', type: 'button', onclick: () => cancelar() }, 'Cancelar revisión');

  function pintarPie() {
    const p = progresoChecklist(d.checklist);
    const resultado = resultadoInspeccion(d);
    const revisables = itemsRevisables(d.inventario);
    const marcados = revisables.filter((i) => itemsOk.has(i.id)).length;
    confirmarBtn.disabled = !p.completo;
    confirmarBtn.className = `btn btn-block btn-lg ${resultado === 'ok' ? 'btn-primary' : 'btn-out'}`;
    vaciar(confirmarBtn, icono(resultado === 'ok' ? 'check' : 'alerta'),
      resultado === 'ok' ? 'Terminar revisión' : 'Terminar revisión con novedades');
    ayudaPie.textContent = !p.completo
      ? `Falta revisar ${p.total - p.revisados} punto(s) del checklist, o usa "Todo está bien".`
      : `${marcados} de ${revisables.length} ítems OK · ` + (resultado === 'ok' ? 'al terminar, el portero genera el QR de entrega.'
        : `${d.reportes.length} novedad(es) y ${p.novedades} punto(s) con novedad: coordinación recibirá el aviso cuando escanees el QR.`);
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
    const revisables = itemsRevisables(d.inventario);
    const ok = revisables.filter((i) => itemsOk.has(i.id));
    const novedades = [
      d.reportes.length && `${d.reportes.length} novedad(es) reportada(s)`, p.novedades && `${p.novedades} punto(s) del checklist con novedad`,
    ].filter(Boolean).join(' y ');
    if (!await confirmar({
      titulo: `¿Terminar la revisión del ${d.ambiente.codigo}?`,
      mensaje: `${resultado === 'ok' ? 'Todo en orden.' : `Con ${novedades}.`} ${ok.length} de ${revisables.length} ítems marcados OK. Se avisa a ${d.ambiente.portero || 'portería'} para que genere el QR de entrega. Después ya no podrás cambiar la revisión.`,
      textoAceptar: 'Terminar revisión',
    })) return;
    confirmarBtn.disabled = true;
    try {
      d = await apiAmb.confirmarInspeccion(id, {
        checklist: d.checklist.map(({ clave, ok: v }) => ({ clave, ok: v })), observaciones: observaciones.value.trim(), itemsOk: ok.map((i) => i.id),
      });
      clearTimeout(temporizador); temporizador = null;
      try { sessionStorage.removeItem(claveOk); } catch { /* sin almacenamiento */ }
      emitir('inspecciones');
      location.hash = `#/planilla?id=${id}`;
    } catch (e) {
      toast('error', 'No se terminó la revisión', e.message);
      confirmarBtn.disabled = false;
    }
  }

  async function cancelar() {
    if (!await confirmar({ titulo: '¿Cancelar la revisión?', mensaje: 'Se borran las novedades reportadas y el ambiente queda libre para otra revisión.', textoAceptar: 'Cancelar revisión', peligro: true })) return;
    try {
      await apiAmb.cancelarInspeccion(id);
      clearTimeout(temporizador); temporizador = null;
      try { sessionStorage.removeItem(claveOk); } catch { /* sin almacenamiento */ }
      emitir('inspecciones');
      toast('info', 'Revisión cancelada');
      location.hash = '#/inspecciones';
    } catch (e) { toast('error', 'No se canceló', e.message); }
  }

  function pintarTodo() { pintarChecklist(); pintarActivas(); pintarInventario(); pintarPie(); pintarAtajo(); }

  anexar(raiz,
    cab,
    h('div', { class: 'todo-bien-bloque', 'data-anim': '' }, todoBienBtn, h('div', { class: 'todo-bien-pie' }, avisoAtajo, deshacerBtn)),
    activas,
    h('section', { class: 'insp-escanear', 'data-anim': '', 'aria-label': 'Reportar una novedad' },
      h('p', { class: 'insp-escanear-titulo' }, '¿Encontraste una novedad?'),
      h('div', { class: 'insp-escanear-botones' }, escanearBtn, salonBtn),
      h('p', { class: 'text-muted' }, 'Escanea la pegatina del elemento o de su familia (PC, estación de cocina…), o reporta un daño de pared, techo, piso… Siempre con foto.')),
    h('section', { class: 'card', 'data-anim': '', 'aria-labelledby': 'insp-t-check' },
      h('div', { class: 'adm-bloque-cabecera' }, h('h3', { class: 'bloque-titulo', id: 'insp-t-check' }, 'Checklist del ambiente'), progresoTexto),
      progreso, listaChecklist,
      h('div', { class: 'campo' }, h('label', { for: 'insp-obs' }, 'Observaciones ', h('span', { class: 'opt' }, '(obligatorias si hay novedades)')), observaciones)),
    h('section', { class: 'card', 'data-anim': '' }, tituloReportes, listaReportes),
    h('details', { class: 'card insp-inventario', 'data-anim': '' },
      h('summary', {}, h('span', { class: 'bloque-titulo' }, `Ítems del ambiente (${d.inventario.length})`), resumenItems),
      d.familias.length ? h('div', { class: 'insp-familias-bloque' },
        h('h4', { class: 'insp-subtitulo' }, `Familias (${d.familias.length})`), listaFamilias) : null,
      h('h4', { class: 'insp-subtitulo' }, 'Ítems'),
      h('div', { class: 'adm-buscar' }, icono('buscar'), buscarInv),
      listaInventario),
    h('div', { class: 'insp-pie' }, ayudaPie, confirmarBtn, cancelarBtn));
  pintarTodo();
  anim.entrarVista(raiz);
}
