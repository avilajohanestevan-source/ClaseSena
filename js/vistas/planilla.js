// Planilla de entrega del ambiente: documento imprimible con datos,
// checklist, inventario, daños con foto, quién revisó y recibió
// (instructor) y quién entregó (portero). Arriba, según el momento:
//  · Portero, revisión terminada sin QR: resumen y "Generar QR de entrega".
//  · Portero con el QR generado: QR grande; se consulta cada pocos segundos
//    y, cuando el instructor lo escanea, cambia a "Ambiente entregado".
//  · Instructor esperando el QR: "Escanear QR del portero".
//  · Instructor que acaba de escanear (?recibida=1): aviso de recepción.
import { h, icono, vaciar, vibrar } from '../ui/dom.js';
import { anim } from '../ui/anim.js';
import { toast, confirmar } from '../ui/avisos.js';
import { escanearEntrega } from '../ui/recibir.js';
import { chipInspeccion, chipResultado, chipItem, chipSeveridad, etiquetaTipoDano, fecha, qr } from '../ui/ambientes-ui.js';
import { apiAmb } from '../api/ambientes.js';
import { estado, emitir, escuchar } from '../estado.js';

const CONSULTA_MS = 4000;

export async function render(raiz, { params, alSalir }) {
  const id = Number(params.get('id'));
  const u = estado.usuario;
  let d = await apiAmb.inspeccion(id);
  if (d.estado === 'en_curso' && u.rol === 'instructor' && d.instructor.id === u.id) {
    location.replace(`#/inspeccion?id=${id}`);
    return;
  }
  let aviso = u.rol === 'instructor' && params.get('recibida') && d.estado === 'recibida' ? 'recibida' : null;

  function pintar() {
    const pendiente = d.estado === 'pendiente_recepcion';
    const panel = !pendiente ? null
      : u.rol === 'portero' ? (d.qr ? panelQr() : panelGenerar())
        : u.rol === 'instructor' ? panelInstructor() : null;
    const acciones = h('div', { class: 'planilla-acciones no-imprimir' },
      h('button', { class: 'btn btn-outline', type: 'button', onclick: () => window.print() }, icono('imprimir'), 'Imprimir planilla'),
      h('a', { class: 'btn btn-outline', href: '#/inspecciones' }, 'Volver'));

    const constancia = (titulo, c, persona, accion, pendienteTexto) => h('div', { class: 'planilla-firma' },
      h('span', { class: 'planilla-firma-titulo' }, titulo),
      h('span', { class: `planilla-firma-vacia${c ? ' planilla-firma--ok' : ''}` }, c ? [icono('qr'), accion] : pendienteTexto),
      h('strong', {}, c?.nombre || persona || '—'),
      h('span', { class: 'text-muted' }, c ? fecha.completa(c.fecha) : 'Pendiente'));

    const doc = h('article', { class: 'planilla card', 'aria-labelledby': 'planilla-titulo' },
      h('header', { class: 'planilla-cabecera' },
        h('img', { class: 'planilla-logo', src: 'img/sena-logo-verde.png', alt: 'SENA' }),
        h('div', {},
          h('span', { class: 'eyebrow eyebrow-verde' }, 'Servicio Nacional de Aprendizaje'),
          h('h2', { id: 'planilla-titulo' }, 'Planilla de entrega de ambiente'),
          h('span', { class: 'planilla-numero mono' }, `INS-${String(d.id).padStart(6, '0')}`),
          h('div', { class: 'planilla-chips' }, chipInspeccion(d.estado), chipResultado(d.resultado)))),

      h('dl', { class: 'planilla-datos' },
        dato('Ambiente', `${d.ambiente.codigo} · ${d.ambiente.nombre}`),
        dato('Ubicación', d.ambiente.bloque || '—'),
        dato('Revisó y recibió (instructor)', d.instructor.nombre),
        dato('Entregó (portero)', d.portero?.nombre || 'Pendiente'),
        dato('Inicio de la revisión', fecha.completa(d.iniciadaEn)),
        dato('Revisión terminada', fecha.completa(d.confirmadaEn)),
        dato('QR de entrega generado', fecha.completa(d.qrGeneradoEn)),
        dato('Recibido (QR escaneado)', fecha.completa(d.recibidaEn))),

      h('section', { class: 'planilla-seccion' },
        h('h3', {}, 'Checklist'),
        h('ul', { class: 'planilla-checklist' }, d.checklist.map((c) => h('li', {},
          h('span', {}, c.etiqueta),
          c.ok === true ? h('span', { class: 'status-chip in' }, icono('check'), 'Bien')
            : c.ok === false ? h('span', { class: 'status-chip error' }, icono('alerta'), 'Novedad')
              : h('span', { class: 'status-chip neutro' }, 'Sin revisar')))),
        d.observaciones && h('p', { class: 'planilla-obs' }, h('strong', {}, 'Observaciones: '), d.observaciones)),

      h('section', { class: 'planilla-seccion' },
        h('h3', {}, `Daños reportados (${d.reportes.length})`),
        d.reportes.length ? h('div', { class: 'planilla-danos' }, d.reportes.map((r) => h('figure', { class: 'planilla-dano' },
          r.foto ? h('img', { src: r.foto, alt: `Foto del daño en ${r.nombre}`, loading: 'lazy' }) : h('span', { class: 'reporte-foto--vacia', 'aria-hidden': 'true' }, icono('camara')),
          h('figcaption', {},
            h('strong', {}, `${r.nombre} · ${r.codigo}`),
            h('span', { class: 'reporte-chips' }, h('span', { class: 'status-chip neutro' }, etiquetaTipoDano(r.tipoDano)), chipSeveridad(r.severidad)),
            h('span', {}, r.comentario),
            h('span', { class: 'text-muted' }, `Reportado ${fecha.corta(r.reportadoEn)}`)))))
          : h('p', { class: 'text-muted' }, 'Sin daños reportados.')),

      h('section', { class: 'planilla-seccion' },
        h('h3', {}, `Inventario del ambiente (${d.inventario.length})`),
        h('div', { class: 'table-wrap' }, h('table', {},
          h('thead', {}, h('tr', {}, h('th', {}, 'Código'), h('th', {}, 'Ítem'), h('th', {}, 'Categoría'), h('th', {}, 'Estado actual'), h('th', {}, 'En esta revisión'))),
          h('tbody', {}, d.inventario.map((it) => h('tr', {},
            h('td', { class: 'mono' }, it.codigo), h('td', {}, it.nombre), h('td', {}, it.categoria), h('td', {}, chipItem(it.estado)),
            h('td', {}, it.reportado ? h('span', { class: 'status-chip error' }, 'Daño reportado') : 'Sin novedad'))))))),

      h('section', { class: 'planilla-firmas' },
        constancia('Entrega · portero', d.entrega, d.portero?.nombre || d.ambiente.portero, 'Generó el QR de entrega', 'Aún no genera el QR'),
        constancia('Recibe · instructor', d.recibe, d.instructor.nombre, 'Escaneó el QR de entrega', 'Aún no escanea el QR')));

    vaciar(raiz, panel, aviso ? panelAviso() : null, acciones, doc);
  }

  /* --- portero: revisión terminada, falta generar el QR --- */
  function panelGenerar() {
    const boton = h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'button', onclick: generar }, icono('qr'), 'Generar QR de entrega');
    async function generar() {
      boton.disabled = true;
      boton.classList.add('cargando-boton');
      try {
        d = await apiAmb.generarQr(id);
        emitir('inspecciones');
        pintar();
        const marco = raiz.querySelector('.entrega-qr');
        if (marco) anim.resultado(marco);
        vigilar();
      } catch (e) {
        toast('error', 'No se generó el QR', e.message);
        boton.disabled = false;
        boton.classList.remove('cargando-boton');
      }
    }
    return h('section', { class: 'card entrega-qr no-imprimir', 'aria-labelledby': 'entrega-gen-t' },
      h('span', { class: 'eyebrow eyebrow-verde' }, `Ambiente ${d.ambiente.codigo}`),
      h('h2', { class: 'entrega-qr-titulo', id: 'entrega-gen-t' }, `${d.instructor.nombre.split(' ')[0]} terminó la revisión`),
      h('div', { class: 'planilla-chips' }, chipResultado(d.resultado),
        d.danos ? h('span', { class: 'status-chip error' }, `${d.danos} daño${d.danos === 1 ? '' : 's'} con foto`) : null),
      h('p', { class: 'text-muted' }, 'Revisa la planilla de abajo. Si estás de acuerdo, genera el QR y muéstraselo al instructor para que lo escanee y reciba el ambiente.'),
      boton);
  }

  /* --- portero: QR grande mientras el instructor no lo escanea --- */
  function panelQr() {
    const tamano = Math.min(280, Math.round(window.innerWidth * 0.7));
    return h('section', { class: 'card entrega-qr no-imprimir', 'aria-labelledby': 'entrega-qr-t' },
      h('span', { class: 'eyebrow eyebrow-verde' }, `Ambiente ${d.ambiente.codigo} · ${d.instructor.nombre}`),
      h('h2', { class: 'entrega-qr-titulo', id: 'entrega-qr-t' }, 'Muéstrale este QR al instructor'),
      h('p', { class: 'text-muted' }, 'Al escanearlo confirma que recibe el ambiente y queda registrado quién entregó y quién recibió.'),
      h('div', { class: 'entrega-qr-marco' }, qr(d.qr, tamano, 'QR de entrega')),
      h('p', { class: 'entrega-qr-estado', role: 'status' }, h('span', { class: 'entrega-qr-pulso', 'aria-hidden': 'true' }), 'Esperando que el instructor lo escanee…'),
      h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: renovar }, icono('reintentar'), 'Generar otro QR'));
  }

  async function renovar() {
    try { d = await apiAmb.generarQr(id); pintar(); toast('info', 'QR nuevo', 'El anterior ya no sirve.'); } catch (e) { toast('error', 'No se generó el QR', e.message); }
  }

  /* --- instructor: esperando el QR del portero --- */
  function panelInstructor() {
    return h('section', { class: 'card entrega-qr no-imprimir', 'aria-labelledby': 'entrega-ins-t' },
      h('span', { class: 'eyebrow eyebrow-verde' }, `Ambiente ${d.ambiente.codigo}`),
      h('h2', { class: 'entrega-qr-titulo', id: 'entrega-ins-t' }, 'Revisión terminada'),
      h('p', { class: 'text-muted' }, `Pide a ${d.ambiente.portero || 'portería'} que genere el QR de entrega y escanéalo para recibir oficialmente el ambiente.`),
      h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'button', onclick: escanearEntrega }, icono('escanear'), 'Escanear QR del portero'),
      h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: cancelarRevision }, 'Cancelar revisión'));
  }

  async function cancelarRevision() {
    if (!await confirmar({ titulo: '¿Cancelar la revisión?', mensaje: 'Se borran los daños reportados y el ambiente queda libre para otra revisión.', textoAceptar: 'Cancelar revisión', peligro: true })) return;
    try {
      await apiAmb.cancelarInspeccion(id);
      emitir('inspecciones');
      toast('info', 'Revisión cancelada');
      location.hash = '#/inspecciones';
    } catch (e) { toast('error', 'No se canceló', e.message); }
  }

  function panelAviso() {
    const icono_ = h('svg', { class: 'resultado-icono', viewBox: '0 0 64 64', 'aria-hidden': 'true' },
      h('circle', { __svg: true, cx: 32, cy: 32, r: 28 }), h('path', { __svg: true, d: 'M19 33l9 9 17-19' }));
    const texto = aviso === 'recibida'
      ? [h('strong', {}, `Recibiste el ambiente ${d.ambiente.codigo}`),
        h('span', {}, `Entregado por ${d.portero.nombre} · ${fecha.hora(d.recibidaEn)}`),
        h('span', {}, d.resultado === 'con_danos' ? 'Con novedades: se avisó a coordinación y el inventario ya está actualizado.' : 'En buen estado, sin novedades.')]
      : [h('strong', {}, `Ambiente ${d.ambiente.codigo} entregado`),
        h('span', {}, `${d.instructor.nombre} lo recibió a las ${fecha.hora(d.recibidaEn)}`),
        d.resultado === 'con_danos' && h('span', {}, 'Coordinación recibió el aviso de los daños.')];
    return h('section', { class: `resultado ${d.resultado === 'con_danos' ? 'resultado--tarde' : 'resultado--aceptado'} entrega-aviso no-imprimir`, role: 'status' },
      icono_, h('div', { class: 'resultado-texto' }, texto));
  }

  // Mientras el portero muestra el QR, se consulta si el instructor ya lo escaneó.
  let sondeo = null;
  function vigilar() {
    clearInterval(sondeo);
    sondeo = setInterval(async () => {
      let nuevo;
      try { nuevo = await apiAmb.inspeccion(id); } catch { return; }
      if (nuevo.estado === 'pendiente_recepcion') return;
      clearInterval(sondeo);
      d = nuevo;
      if (d.estado === 'recibida') {
        aviso = 'entregada';
        vibrar([60, 40, 60]);
        emitir('inspecciones');
      }
      pintar();
      mostrarAviso();
    }, CONSULTA_MS);
  }
  alSalir(() => clearInterval(sondeo));
  if (u.rol === 'portero' && d.estado === 'pendiente_recepcion' && d.qr) vigilar();

  function mostrarAviso() {
    const el = raiz.querySelector('.entrega-aviso');
    if (el) { anim.resultado(el); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  }

  // Si cambia mientras está abierta (el portero genera el QR, otra persona la cancela), se actualiza.
  alSalir(escuchar('bandeja', async () => { try { d = await apiAmb.inspeccion(id); pintar(); } catch { /* sin cambios */ } }));
  pintar();
  anim.entrarVista(raiz);
  mostrarAviso();
}

function dato(etiqueta, valor) {
  return h('div', {}, h('dt', {}, etiqueta), h('dd', {}, valor));
}
