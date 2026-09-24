// Planilla de entrega y revisión del ambiente: documento imprimible con
// datos, checklist, inventario, daños con foto y las dos firmas.
// El portero firma aquí la recepción cuando está "pendiente de recepción".
import { h, icono, vaciar } from '../ui/dom.js';
import { anim } from '../ui/anim.js';
import { toast } from '../ui/avisos.js';
import { pedirFirma } from '../ui/firma.js';
import { chipInspeccion, chipResultado, chipItem, chipSeveridad, etiquetaTipoDano, fecha, qr } from '../ui/ambientes-ui.js';
import { apiAmb } from '../api/ambientes.js';
import { estado, emitir, escuchar } from '../estado.js';

export async function render(raiz, { params, alSalir }) {
  const id = Number(params.get('id'));
  const u = estado.usuario;
  let d = await apiAmb.inspeccion(id);
  if (d.estado === 'en_curso' && u.rol === 'instructor' && d.instructor.id === u.id) {
    location.replace(`#/inspeccion?id=${id}`);
    return;
  }

  function pintar() {
    const puedeRecibir = u.rol === 'portero' && d.estado === 'pendiente_recepcion';
    const acciones = h('div', { class: 'planilla-acciones no-imprimir' },
      puedeRecibir && h('button', { class: 'btn btn-primary btn-lg', type: 'button', onclick: recibir }, icono('portero'), 'Firmar recepción'),
      h('button', { class: 'btn btn-outline', type: 'button', onclick: () => window.print() }, icono('imprimir'), 'Imprimir planilla'),
      h('a', { class: 'btn btn-outline', href: '#/inspecciones' }, 'Volver'));

    const firma = (titulo, f, persona) => h('div', { class: 'planilla-firma' },
      h('span', { class: 'planilla-firma-titulo' }, titulo),
      f?.imagen ? h('img', { src: f.imagen, alt: `Firma de ${f.nombre}` })
        : h('span', { class: 'planilla-firma-vacia' }, f ? 'Firma registrada (dato histórico sin imagen)' : 'Pendiente'),
      h('strong', {}, f?.nombre || persona || '—'),
      h('span', { class: 'text-muted' }, f ? fecha.completa(f.fecha) : 'Sin firmar'));

    const doc = h('article', { class: 'planilla card', 'aria-labelledby': 'planilla-titulo' },
      h('header', { class: 'planilla-cabecera' },
        h('img', { class: 'planilla-logo', src: 'img/sena-logo-verde.png', alt: 'SENA' }),
        h('div', {},
          h('span', { class: 'eyebrow eyebrow-verde' }, 'Servicio Nacional de Aprendizaje'),
          h('h2', { id: 'planilla-titulo' }, 'Planilla de entrega y revisión de ambiente'),
          h('span', { class: 'planilla-numero mono' }, `INS-${String(d.id).padStart(6, '0')}`),
          h('div', { class: 'planilla-chips' }, chipInspeccion(d.estado), chipResultado(d.resultado))),
        h('div', { class: 'planilla-qr' }, qr(d.qr, 96, 'QR de la inspección'))),

      h('dl', { class: 'planilla-datos' },
        dato('Ambiente', `${d.ambiente.codigo} · ${d.ambiente.nombre}`),
        dato('Ubicación', d.ambiente.bloque || '—'),
        dato('Instructor', d.instructor.nombre),
        dato('Portero', d.portero?.nombre || d.ambiente.portero || '—'),
        dato('Inicio de la inspección', fecha.completa(d.iniciadaEn)),
        dato('Confirmación del instructor', fecha.completa(d.confirmadaEn)),
        dato('Recepción del portero', fecha.completa(d.recibidaEn))),

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
          h('thead', {}, h('tr', {}, h('th', {}, 'Código'), h('th', {}, 'Ítem'), h('th', {}, 'Categoría'), h('th', {}, 'Estado actual'), h('th', {}, 'En esta inspección'))),
          h('tbody', {}, d.inventario.map((it) => h('tr', {},
            h('td', { class: 'mono' }, it.codigo), h('td', {}, it.nombre), h('td', {}, it.categoria), h('td', {}, chipItem(it.estado)),
            h('td', {}, it.reportado ? h('span', { class: 'status-chip error' }, 'Daño reportado') : 'Sin novedad'))))))),

      h('section', { class: 'planilla-firmas' },
        firma('Entrega · instructor', d.firmaInstructor, d.instructor.nombre),
        firma('Recepción · portero', d.firmaPortero, d.ambiente.portero)));

    vaciar(raiz, acciones, doc);
  }

  async function recibir() {
    const f = await pedirFirma({
      titulo: 'Firma de recepción',
      declaracion: `Recibo la planilla del ambiente ${d.ambiente.codigo} entregada por ${d.instructor.nombre}${d.reportes.length ? `, con ${d.reportes.length} daño(s) reportado(s)` : ', sin novedades'}.`,
      nombre: u.nombre,
      textoConfirmar: 'Firmar recepción',
    });
    if (!f) return;
    try {
      d = await apiAmb.recibirInspeccion(id, f);
      emitir('inspecciones');
      toast('exito', 'Recepción firmada', `Ambiente ${d.ambiente.codigo}, recibida a las ${fecha.hora(d.recibidaEn)} Se avisó al instructor.`);
      pintar();
      anim.lista([raiz.querySelector('.planilla-firmas')], { autoAlpha: 0, scale: 0.97 });
    } catch (e) { toast('error', 'No se firmó', e.message); }
  }

  // Si otra persona la recibe mientras está abierta, se actualiza.
  alSalir(escuchar('bandeja', async () => { try { d = await apiAmb.inspeccion(id); pintar(); } catch { /* sin cambios */ } }));
  pintar();
  anim.entrarVista(raiz);
}

function dato(etiqueta, valor) {
  return h('div', {}, h('dt', {}, etiqueta), h('dd', {}, valor));
}
