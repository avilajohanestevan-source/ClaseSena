// Planilla de entrega del ambiente: documento imprimible con datos,
// checklist, inventario, daños con foto, quién entregó y quién recibió.
//  · Portero con la entrega "esperando al instructor": arriba muestra el QR
//    grande para que el instructor lo escanee; se consulta cada pocos
//    segundos y, cuando lo reciben, cambia a "Ambiente entregado".
//  · Instructor que acaba de escanear (?recibida=1): aviso de recepción.
import { h, icono, vaciar } from '../ui/dom.js';
import { anim } from '../ui/anim.js';
import { toast, confirmar } from '../ui/avisos.js';
import { chipInspeccion, chipResultado, chipItem, chipSeveridad, etiquetaTipoDano, fecha, qr } from '../ui/ambientes-ui.js';
import { apiAmb } from '../api/ambientes.js';
import { estado, emitir, escuchar } from '../estado.js';

const CONSULTA_MS = 4000;

export async function render(raiz, { params, alSalir }) {
  const id = Number(params.get('id'));
  const u = estado.usuario;
  let d = await apiAmb.inspeccion(id);
  if (d.estado === 'en_curso' && u.rol === 'portero' && d.portero.id === u.id) {
    location.replace(`#/inspeccion?id=${id}`);
    return;
  }
  let aviso = u.rol === 'instructor' && params.get('recibida') ? 'recibida' : null;

  function pintar() {
    const esperando = u.rol === 'portero' && d.estado === 'pendiente_recepcion';
    const acciones = h('div', { class: 'planilla-acciones no-imprimir' },
      h('button', { class: 'btn btn-outline', type: 'button', onclick: () => window.print() }, icono('imprimir'), 'Imprimir planilla'),
      h('a', { class: 'btn btn-outline', href: '#/inspecciones' }, 'Volver'));

    const firma = (titulo, f, persona, pendiente) => h('div', { class: 'planilla-firma' },
      h('span', { class: 'planilla-firma-titulo' }, titulo),
      f?.imagen ? h('img', { src: f.imagen, alt: `Firma de ${f.nombre}` })
        : h('span', { class: 'planilla-firma-vacia' }, f ? (titulo.includes('instructor') ? 'Confirmó escaneando el QR' : 'Firma registrada (dato histórico sin imagen)') : pendiente),
      h('strong', {}, f?.nombre || persona || '—'),
      h('span', { class: 'text-muted' }, f ? fecha.completa(f.fecha) : 'Sin confirmar'));

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
        dato('Entregó (portero)', d.portero.nombre),
        dato('Recibió (instructor)', d.instructor?.nombre || 'Pendiente'),
        dato('Inicio de la revisión', fecha.completa(d.iniciadaEn)),
        dato('Entrega confirmada', fecha.completa(d.confirmadaEn)),
        dato('Recibido por el instructor', fecha.completa(d.recibidaEn))),

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
          h('thead', {}, h('tr', {}, h('th', {}, 'Código'), h('th', {}, 'Ítem'), h('th', {}, 'Categoría'), h('th', {}, 'Estado actual'), h('th', {}, 'En esta entrega'))),
          h('tbody', {}, d.inventario.map((it) => h('tr', {},
            h('td', { class: 'mono' }, it.codigo), h('td', {}, it.nombre), h('td', {}, it.categoria), h('td', {}, chipItem(it.estado)),
            h('td', {}, it.reportado ? h('span', { class: 'status-chip error' }, 'Daño reportado') : 'Sin novedad'))))))),

      h('section', { class: 'planilla-firmas' },
        firma('Entrega · portero', d.firmaPortero, d.portero.nombre, 'Pendiente'),
        firma('Recibe · instructor', d.firmaInstructor, d.instructor?.nombre, 'Esperando el escaneo del QR')));

    vaciar(raiz, esperando ? panelQr() : null, aviso ? panelAviso() : null, acciones, doc);
  }

  /* --- portero: QR grande mientras el instructor no lo escanea --- */
  function panelQr() {
    const tamano = Math.min(280, Math.round(window.innerWidth * 0.7));
    return h('section', { class: 'card entrega-qr no-imprimir', 'aria-labelledby': 'entrega-qr-t' },
      h('span', { class: 'eyebrow eyebrow-verde' }, `Ambiente ${d.ambiente.codigo}`),
      h('h2', { class: 'entrega-qr-titulo', id: 'entrega-qr-t' }, 'Muéstrale este QR al instructor'),
      h('p', { class: 'text-muted' }, 'Lo escanea desde su celular en Inspecciones → Recibir ambiente. Al hacerlo queda registrado quién entregó y quién recibió.'),
      h('div', { class: 'entrega-qr-marco' }, qr(d.qr, tamano, 'QR de la entrega')),
      h('code', { class: 'insp-qr-texto' }, d.qr),
      h('p', { class: 'entrega-qr-estado', role: 'status' }, h('span', { class: 'entrega-qr-pulso', 'aria-hidden': 'true' }), 'Esperando que el instructor lo escanee…'),
      h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: cancelarEntrega }, 'Cancelar entrega'));
  }

  function panelAviso() {
    const icono_ = h('svg', { class: 'resultado-icono', viewBox: '0 0 64 64', 'aria-hidden': 'true' },
      h('circle', { __svg: true, cx: 32, cy: 32, r: 28 }), h('path', { __svg: true, d: 'M19 33l9 9 17-19' }));
    const texto = aviso === 'recibida'
      ? [h('strong', {}, `Recibiste el ambiente ${d.ambiente.codigo}`),
        h('span', {}, `Entregado por ${d.portero.nombre} · ${fecha.hora(d.recibidaEn)}`),
        h('span', {}, d.resultado === 'con_danos' ? `Con ${d.danos} daño(s) registrado(s): se avisó a coordinación y el inventario ya está actualizado.` : 'En buen estado, sin novedades.')]
      : [h('strong', {}, `Ambiente ${d.ambiente.codigo} entregado`),
        h('span', {}, `${d.instructor.nombre} lo recibió a las ${fecha.hora(d.recibidaEn)}`),
        d.resultado === 'con_danos' && h('span', {}, 'Coordinación recibió el aviso de los daños.')];
    return h('section', { class: `resultado ${d.resultado === 'con_danos' ? 'resultado--tarde' : 'resultado--aceptado'} entrega-aviso no-imprimir`, role: 'status' },
      icono_, h('div', { class: 'resultado-texto' }, texto));
  }

  async function cancelarEntrega() {
    if (!await confirmar({ titulo: '¿Cancelar la entrega?', mensaje: 'El QR deja de funcionar y los daños reportados se deshacen.', textoAceptar: 'Cancelar entrega', peligro: true })) return;
    try {
      await apiAmb.cancelarInspeccion(id);
      emitir('inspecciones');
      toast('info', 'Entrega cancelada');
      location.hash = '#/inspecciones';
    } catch (e) { toast('error', 'No se canceló', e.message); }
  }

  // Mientras el portero espera, se consulta si el instructor ya escaneó.
  let sondeo = null;
  if (u.rol === 'portero' && d.estado === 'pendiente_recepcion') {
    sondeo = setInterval(async () => {
      let nuevo;
      try { nuevo = await apiAmb.inspeccion(id); } catch { return; }
      if (nuevo.estado === 'pendiente_recepcion') return;
      clearInterval(sondeo);
      d = nuevo;
      if (d.estado === 'recibida') {
        aviso = 'entregada';
        navigator.vibrate?.([60, 40, 60]);
        emitir('inspecciones');
      }
      pintar();
      mostrarAviso();
    }, CONSULTA_MS);
    alSalir(() => clearInterval(sondeo));
  }

  function mostrarAviso() {
    const el = raiz.querySelector('.entrega-aviso');
    if (el) { anim.resultado(el); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  }

  // Si cambia mientras está abierta (otra persona la recibe o la cancela), se actualiza.
  alSalir(escuchar('bandeja', async () => { try { d = await apiAmb.inspeccion(id); pintar(); } catch { /* sin cambios */ } }));
  pintar();
  anim.entrarVista(raiz);
  mostrarAviso();
  if (params.get('qr')) toast('exito', 'Entrega confirmada', 'Muéstrale el QR al instructor para que lo escanee.');
}

function dato(etiqueta, valor) {
  return h('div', {}, h('dt', {}, etiqueta), h('dd', {}, valor));
}
