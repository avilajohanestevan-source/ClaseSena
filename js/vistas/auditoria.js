// Auditoría (administrativo): todos los eventos de novedades permanentes
// (creada, reportada de nuevo, modificada, resuelta, anulada) y de
// asignaciones de instructores (creada, reasignada, anulada), con fecha,
// usuario, detalle y evidencia. Filtros por tipo, ambiente, usuario y fechas; CSV.
import { h, anexar, icono, vaciar, descargar } from '../ui/dom.js';
import { anim } from '../ui/anim.js';
import { cargando, tarjetaError } from '../ui/componentes.js';
import { cabecera, fecha, vacio } from '../ui/ambientes-ui.js';
import { apiAmb } from '../api/ambientes.js';
import { fechaIso, ACCIONES_AUDITORIA } from '../reglas.js';

const ENTIDADES = { novedad: 'Novedad', asignacion: 'Asignación' };

export async function render(raiz, { params }) {
  const [ambientes, usuarios] = await Promise.all([apiAmb.ambientes(), apiAmb.usuarios()]);
  const f = { entidad: params.get('entidad') || '', ambienteId: '', usuarioId: '', desde: '', hasta: '' };
  let eventos = [];
  const cuerpo = h('div', {}, cargando());

  const sel = (clave, etiqueta, opciones, todos) => h('div', { class: 'campo' }, h('label', { for: `au-${clave}` }, etiqueta),
    h('select', { id: `au-${clave}`, onchange: (e) => { f[clave] = e.target.value; cargar(); } }, h('option', { value: '' }, todos),
      opciones.map(([v, t]) => h('option', { value: v, selected: String(v) === f[clave] }, t))));
  const fechaCampo = (clave, etiqueta) => h('div', { class: 'campo' }, h('label', { for: `au-${clave}` }, etiqueta),
    h('input', { type: 'date', id: `au-${clave}`, max: fechaIso(), onchange: (e) => { f[clave] = e.target.value; cargar(); } }));

  anexar(raiz,
    cabecera({
      eyebrow: 'Coordinación', titulo: 'Auditoría',
      subtitulo: 'Reportes, modificaciones y resoluciones de novedades, y asignaciones, reasignaciones y anulaciones de turnos: quién, cuándo y con qué evidencia.',
      acciones: [h('button', { class: 'btn btn-outline', type: 'button', onclick: () => exportar() }, icono('descargar'), 'CSV')],
    }),
    h('section', { class: 'card no-imprimir reporte-filtros', 'data-anim': '' }, h('div', { class: 'filtros' },
      sel('entidad', 'Tipo', Object.entries(ENTIDADES), 'Todos'),
      sel('ambienteId', 'Ambiente', ambientes.map((a) => [a.id, `${a.codigo} · ${a.nombre}`]), 'Todos'),
      sel('usuarioId', 'Usuario', usuarios.filter((u) => u.rol !== 'aprendiz').map((u) => [u.id, u.nombre]), 'Todos'),
      fechaCampo('desde', 'Desde'), fechaCampo('hasta', 'Hasta'))),
    cuerpo);

  async function cargar() {
    vaciar(cuerpo, cargando());
    try { eventos = await apiAmb.auditoria(f); } catch (e) { vaciar(cuerpo, tarjetaError(e, cargar)); return; }
    vaciar(cuerpo, eventos.length ? h('section', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', { class: 'tabla-novedades' },
      h('thead', {}, h('tr', {}, ['Fecha', 'Tipo', 'Ambiente', 'Evento', 'Detalle', 'Usuario', 'Evidencia'].map((t) => h('th', {}, t)))),
      h('tbody', {}, eventos.map((e) => h('tr', {},
        h('td', {}, fecha.corta(e.fecha)),
        h('td', {}, e.entidad === 'novedad'
          ? h('a', { class: 'table-link', href: `#/novedades?id=${e.entidadId}` }, `Novedad #${e.entidadId}`)
          : h('span', {}, `Asignación #${e.entidadId}`)),
        h('td', {}, e.ambiente || '—'),
        h('td', {}, h('span', { class: 'status-chip neutro' }, icono((ACCIONES_AUDITORIA[e.accion] || [])[1] || 'reloj'), (ACCIONES_AUDITORIA[e.accion] || [e.accion])[0])),
        h('td', { class: 'celda-larga' }, e.detalle),
        h('td', {}, e.usuario || 'Sistema'),
        h('td', {}, e.foto ? h('a', { href: e.foto, target: '_blank', rel: 'noopener' }, h('img', { class: 'novedad-miniatura', src: e.foto, alt: 'Evidencia', loading: 'lazy' })) : '—')))))))
      : vacio('Sin eventos', 'No hay eventos con estos filtros.', 'historial'));
    anim.lista(cuerpo.children, { autoAlpha: 0, y: 6 });
  }

  function exportar() {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const filas = [['fecha', 'tipo', 'id', 'ambiente', 'evento', 'detalle', 'usuario', 'evidencia']]
      .concat(eventos.map((e) => [e.fecha, e.entidad, e.entidadId, e.ambiente, e.accion, e.detalle, e.usuario, e.foto ? new URL(e.foto, location.href).href : '']));
    descargar(`auditoria-${fechaIso()}.csv`, '﻿' + filas.map((r) => r.map(esc).join(';')).join('\r\n'), 'text/csv;charset=utf-8');
  }

  await cargar();
  anim.entrarVista(raiz);
}
