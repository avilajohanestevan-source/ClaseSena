// Revisión del ambiente (portero), en una sola columna pensada para el celular.
// El portero la hace con el instructor en el salón, antes de entregárselo:
//  1. Cabecera con el ambiente y la hora de inicio.
//  2. Botón grande "Escanear QR de ítem" → formulario de daño (tipo, severidad, foto, comentario).
//  3. Checklist visible (Bien / Novedad) que se guarda solo, y observaciones.
//  4. Inventario del ambiente con "Reportar daño" por ítem y la lista de daños reportados.
//  5. Barra fija: "Entregar y generar QR". El portero firma y se abre la planilla
//     con el QR grande que el instructor escanea para recibir el ambiente.
// Si la revisión ya no está en curso, se muestra su planilla.
import { h, anexar, icono, vaciar, errorCampo } from '../ui/dom.js';
import { anim } from '../ui/anim.js';
import { toast, abrirModal, confirmar } from '../ui/avisos.js';
import { crearEscaner } from '../ui/escaner.js';
import { crearCapturaFoto } from '../ui/camara.js';
import { pedirFirma } from '../ui/firma.js';
import { chipItem, chipSeveridad, etiquetaTipoDano, fecha } from '../ui/ambientes-ui.js';
import { apiAmb } from '../api/ambientes.js';
import { estado, emitir } from '../estado.js';
import { leerQrItem, validarReporteDano, progresoChecklist, resultadoInspeccion, TIPOS_DANO, PRIORIDADES } from '../reglas.js';

const AYUDA_SEVERIDAD = { leve: 'Se puede seguir usando.', moderada: 'Funciona con limitaciones.', grave: 'No se puede usar o es un riesgo. Foto obligatoria.' };

export async function render(raiz, { params, alSalir }) {
  const id = Number(params.get('id'));
  let d = await apiAmb.inspeccion(id);
  if (d.estado !== 'en_curso' || d.portero.id !== estado.usuario.id) {
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
        h('span', { class: 'eyebrow eyebrow-verde' }, 'Revisión antes de entregar'),
        h('h2', { class: 'vista-titulo' }, d.ambiente.nombre),
        h('p', { class: 'section-sub' }, transcurrido))),
    h('p', { class: 'insp-cabecera-ayuda' }, icono('qr'),
      h('span', {}, 'Revisa el salón con el instructor. Al terminar se genera un QR que él escanea para recibirlo.')));

  /* --- escanear ítem --- */
  const escanearBtn = h('button', { class: 'btn btn-primary btn-block btn-lg', type: 'button', onclick: () => escanearItem() },
    icono('escanear'), 'Escanear QR de ítem');

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

  function pintarInventario() {
    vaciar(listaInventario, d.inventario.map((it) => h('li', { class: `inv-fila${it.reportado ? ' inv-fila--reportado' : ''}` },
      h('div', { class: 'inv-fila-datos' }, h('strong', {}, it.nombre), h('span', { class: 'mono text-muted' }, it.codigo)),
      it.reportado ? h('span', { class: 'status-chip error' }, icono('alerta'), 'Reportado') : chipItem(it.estado),
      !it.reportado && h('button', { class: 'btn btn-outline btn-sm', type: 'button', 'aria-label': `Reportar daño en ${it.nombre}`, onclick: () => formularioDano(it) }, icono('herramienta'), 'Daño'))));
    tituloReportes.textContent = d.reportes.length ? `Daños reportados (${d.reportes.length})` : 'Daños reportados';
    vaciar(listaReportes, d.reportes.length ? d.reportes.map((r) => h('article', { class: 'reporte' },
      r.foto ? h('img', { class: 'reporte-foto', src: r.foto, alt: `Foto del daño en ${r.nombre}`, loading: 'lazy' }) : h('span', { class: 'reporte-foto reporte-foto--vacia', 'aria-hidden': 'true' }, icono('camara')),
      h('div', { class: 'reporte-datos' },
        h('strong', {}, r.nombre), h('span', { class: 'mono text-muted' }, r.codigo),
        h('div', { class: 'reporte-chips' }, h('span', { class: 'status-chip neutro' }, etiquetaTipoDano(r.tipoDano)), chipSeveridad(r.severidad)),
        h('p', {}, r.comentario)),
      h('button', { class: 'btn btn-outline btn-sm btn-icono', type: 'button', 'aria-label': `Quitar el reporte de ${r.nombre}`, onclick: () => quitar(r) }, icono('basura'))))
      : h('p', { class: 'text-muted reportes-vacio' }, 'Ningún daño reportado. Si todo está bien, marca el checklist y entrega el ambiente.'));
  }

  async function quitar(r) {
    if (!await confirmar({ titulo: `¿Quitar el reporte de ${r.nombre}?`, mensaje: 'El ítem vuelve al estado que tenía antes del reporte.', textoAceptar: 'Quitar', peligro: true })) return;
    try { d = await apiAmb.quitarDano(id, r.id); pintarTodo(); toast('exito', 'Reporte quitado'); } catch (e) { toast('error', 'No se quitó', e.message); }
  }

  function escanearItem() {
    let escaner;
    const { cerrar } = abrirModal({
      titulo: 'Escanear QR del ítem', subtitulo: `Ambiente ${d.ambiente.codigo} · apunta a la etiqueta del equipo o mueble.`, ancho: 'angosto',
      contenido: () => {
        escaner = crearEscaner({
          tipos: ['qr'], etiqueta: 'Abrir cámara', placeholder: 'Código de la etiqueta (AMB107-003)',
          alLeer: async (texto) => {
            const codigo = leerQrItem(texto);
            if (!codigo) { toast('error', 'Ese QR no es de un ítem del inventario', texto.slice(0, 60)); return; }
            const it = d.inventario.find((x) => x.codigo === codigo);
            if (!it) {
              let detalle = `${codigo} no está en el inventario.`;
              try { const otro = await apiAmb.itemPorCodigo(codigo); detalle = `${otro.nombre} (${codigo}) es del ambiente ${otro.ambiente}, no del ${d.ambiente.codigo}.`; } catch { /* no existe */ }
              toast('error', 'Ítem de otro ambiente', detalle);
              return;
            }
            cerrar();
            if (it.reportado) { toast('aviso', 'Ya reportado', `${it.nombre} ya tiene un daño en esta inspección.`); return; }
            navigator.vibrate?.(40);
            formularioDano(it);
          },
        });
        return escaner.el;
      },
      alCerrar: () => escaner?.detener(),
    });
  }

  function formularioDano(it) {
    let tipoDano = '', severidad = '', foto = null, enviando = false;
    const tipos = h('div', { class: 'opciones-chip', role: 'radiogroup', 'aria-labelledby': 'dano-tipo' },
      TIPOS_DANO.map((t) => h('label', { class: 'opcion-chip' },
        h('input', { type: 'radio', name: 'tipo-dano', value: t.clave, onchange: () => { tipoDano = t.clave; errorCampo(tipos, null); } }),
        h('span', {}, t.etiqueta))));
    const severidades = h('div', { class: 'prioridades', role: 'radiogroup', 'aria-labelledby': 'dano-sev' },
      PRIORIDADES.map((p) => h('label', { class: `prioridad prioridad--${p.clave}` },
        h('input', { type: 'radio', name: 'severidad', value: p.clave, onchange: () => { severidad = p.clave; errorCampo(severidades, null); marcaFoto.hidden = p.clave !== 'grave'; } }),
        h('strong', {}, p.etiqueta), h('span', {}, AYUDA_SEVERIDAD[p.clave]))));
    const comentario = h('textarea', { id: 'dano-comentario', rows: 3, maxlength: 500, placeholder: '¿Qué le pasa? ¿Desde cuándo?' });
    const contador = h('span', { class: 'contador-caracteres' }, '0/500');
    comentario.addEventListener('input', () => { contador.textContent = `${comentario.value.length}/500`; errorCampo(comentario, null); });
    const captura = crearCapturaFoto({ alCambiar: (f) => { foto = f; if (f) errorCampo(captura.el, null); } });
    const marcaFoto = h('span', { class: 'foto-requisito foto-requisito--obligatoria', hidden: true }, '(obligatoria)');
    const enviar = h('button', { class: 'btn btn-peligro', type: 'button', onclick: () => guardar() }, icono('herramienta'), 'Reportar daño');

    const { cerrar } = abrirModal({
      titulo: 'Reportar daño', subtitulo: `${it.nombre} · ${it.codigo}`, ancho: 'normal',
      contenido: h('div', { class: 'form-dano-insp' },
        h('div', { class: 'campo' }, h('label', { id: 'dano-tipo' }, 'Tipo de daño'), tipos),
        h('div', { class: 'campo' }, h('label', { id: 'dano-sev' }, 'Severidad'), severidades),
        h('div', { class: 'campo' }, h('label', { for: 'dano-comentario' }, 'Comentario'), comentario, contador),
        h('div', { class: 'campo' }, h('label', {}, 'Foto ', marcaFoto), captura.el)),
      acciones: [({ cerrar: c }) => h('button', { class: 'btn btn-outline', type: 'button', onclick: () => c() }, 'Cancelar'), enviar],
      alCerrar: () => captura.detener(),
    });

    async function guardar() {
      if (enviando) return;
      const datos = { itemId: it.id, tipoDano, severidad, comentario: comentario.value.trim(), foto };
      const errores = validarReporteDano(datos);
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
        toast('exito', 'Daño reportado', `${it.nombre} quedó marcado como dañado.`);
      } catch (e) {
        toast('error', 'No se reportó', e.message);
        enviando = false;
        enviar.disabled = false;
      }
    }
  }

  /* --- pie fijo: confirmar y firmar --- */
  const ayudaPie = h('p', { class: 'insp-pie-ayuda', role: 'status' });
  const confirmarBtn = h('button', { class: 'btn btn-primary btn-block btn-lg', type: 'button', onclick: () => confirmarInspeccion() });
  const cancelarBtn = h('button', { class: 'btn btn-outline', type: 'button', onclick: () => cancelar() }, 'Cancelar revisión');

  function pintarPie() {
    const p = progresoChecklist(d.checklist);
    const resultado = resultadoInspeccion(d);
    confirmarBtn.disabled = !p.completo;
    confirmarBtn.className = `btn btn-block btn-lg ${resultado === 'ok' ? 'btn-primary' : 'btn-out'}`;
    vaciar(confirmarBtn, icono('qr'),
      resultado === 'ok' ? 'Entregar en buen estado y generar QR' : 'Entregar con novedades y generar QR');
    ayudaPie.textContent = p.completo
      ? (resultado === 'ok' ? 'Todo en orden. Firma y muéstrale el QR al instructor.' : `${d.reportes.length} daño(s) y ${p.novedades} novedad(es): se avisará a coordinación cuando el instructor reciba.`)
      : `Falta revisar ${p.total - p.revisados} punto(s) del checklist.`;
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
    const firma = await pedirFirma({
      titulo: 'Firma del portero',
      declaracion: `Entrego el ambiente ${d.ambiente.codigo} ${resultado === 'ok' ? 'en buen estado' : `con ${[
        d.reportes.length && `${d.reportes.length} daño(s) reportado(s)`, p.novedades && `${p.novedades} novedad(es) en el checklist`,
      ].filter(Boolean).join(' y ')}`}.`,
      nombre: estado.usuario.nombre,
      textoConfirmar: 'Firmar y generar QR',
    });
    if (!firma) return;
    confirmarBtn.disabled = true;
    try {
      d = await apiAmb.confirmarInspeccion(id, {
        checklist: d.checklist.map(({ clave, ok }) => ({ clave, ok })), observaciones: observaciones.value.trim(), ...firma,
      });
      clearTimeout(temporizador); temporizador = null;
      emitir('inspecciones');
      location.hash = `#/planilla?id=${id}&qr=1`;
    } catch (e) {
      toast('error', 'No se confirmó la entrega', e.message);
      confirmarBtn.disabled = false;
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
    h('div', { class: 'insp-escanear', 'data-anim': '' }, escanearBtn,
      h('p', { class: 'text-muted' }, 'Escanea la etiqueta de un equipo o mueble para reportar su daño.')),
    h('section', { class: 'card', 'data-anim': '', 'aria-labelledby': 'insp-t-check' },
      h('div', { class: 'adm-bloque-cabecera' }, h('h3', { class: 'bloque-titulo', id: 'insp-t-check' }, 'Checklist del ambiente'), progresoTexto),
      progreso, listaChecklist,
      h('div', { class: 'campo' }, h('label', { for: 'insp-obs' }, 'Observaciones ', h('span', { class: 'opt' }, '(obligatorias si hay novedades)')), observaciones)),
    h('section', { class: 'card', 'data-anim': '' }, tituloReportes, listaReportes),
    h('section', { class: 'card', 'data-anim': '' },
      h('h3', { class: 'bloque-titulo' }, `Inventario del ambiente (${d.inventario.length})`),
      listaInventario),
    h('div', { class: 'insp-pie' }, ayudaPie, confirmarBtn, cancelarBtn));
  pintarTodo();
  anim.entrarVista(raiz);
}
