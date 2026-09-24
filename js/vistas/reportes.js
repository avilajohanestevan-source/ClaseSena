// Reportes (administrativo): filtros por fecha, ambiente e instructor;
// resumen, inspecciones y daños por ambiente, detalle de daños y de
// inspecciones, exportación CSV e impresión.
import { h, anexar, icono, vaciar, descargar } from '../ui/dom.js';
import { anim } from '../ui/anim.js';
import { toast } from '../ui/avisos.js';
import { cargando, tarjetaError } from '../ui/componentes.js';
import { cabecera, chipInspeccion, chipResultado, chipSeveridad, chipItem, etiquetaTipoDano, fecha, vacio } from '../ui/ambientes-ui.js';
import { apiAmb } from '../api/ambientes.js';
import { fechaIso, ESTADOS_INSPECCION } from '../reglas.js';

export async function render(raiz) {
  const [ambientes, instructores] = await Promise.all([apiAmb.ambientes(), apiAmb.usuarios('instructor')]);
  const hace30 = new Date(); hace30.setDate(hace30.getDate() - 30);
  const f = { desde: fechaIso(hace30), hasta: fechaIso(), ambienteId: '', instructorId: '' };
  let rep = null, inspecciones = [];
  const cuerpo = h('div', { class: 'reporte-cuerpo' }, cargando());

  const campoFecha = (clave, etiqueta) => h('div', { class: 'campo' }, h('label', { for: `r-${clave}` }, etiqueta),
    h('input', { type: 'date', id: `r-${clave}`, value: f[clave], max: fechaIso(), onchange: (e) => { f[clave] = e.target.value; cargar(); } }));
  const campoSel = (clave, etiqueta, opciones) => h('div', { class: 'campo' }, h('label', { for: `r-${clave}` }, etiqueta),
    h('select', { id: `r-${clave}`, onchange: (e) => { f[clave] = e.target.value; cargar(); } }, h('option', { value: '' }, 'Todos'), opciones));

  anexar(raiz,
    cabecera({ eyebrow: 'Coordinación', titulo: 'Reportes de inspección', subtitulo: 'Historial filtrado de inspecciones y daños de los ambientes.',
      acciones: [
        h('button', { class: 'btn btn-outline', type: 'button', onclick: () => exportar('inspecciones') }, icono('descargar'), 'CSV inspecciones'),
        h('button', { class: 'btn btn-outline', type: 'button', onclick: () => exportar('danos') }, icono('descargar'), 'CSV daños'),
        h('button', { class: 'btn btn-outline', type: 'button', onclick: () => window.print() }, icono('imprimir'), 'Imprimir')] }),
    h('section', { class: 'card no-imprimir reporte-filtros', 'data-anim': '' },
      h('div', { class: 'filtros' },
        campoFecha('desde', 'Desde'), campoFecha('hasta', 'Hasta'),
        campoSel('ambienteId', 'Ambiente', ambientes.map((a) => h('option', { value: a.id }, `${a.codigo} · ${a.nombre}`))),
        campoSel('instructorId', 'Instructor', instructores.map((i) => h('option', { value: i.id }, i.nombre))))),
    cuerpo);

  async function cargar() {
    if (f.desde && f.hasta && f.desde > f.hasta) { toast('aviso', 'Rango de fechas inválido', 'La fecha inicial es posterior a la final.'); return; }
    vaciar(cuerpo, cargando());
    try { [rep, inspecciones] = await Promise.all([apiAmb.reporte(f), apiAmb.inspecciones(f)]); } catch (e) { vaciar(cuerpo, tarjetaError(e, cargar)); return; }
    const r = rep.resumen;
    const kpi = (valor, etiqueta, clase, ic, pie = '') => h('div', { class: `adm-kpi adm-kpi--${clase}` },
      h('span', { class: 'adm-kpi-icono' }, icono(ic)), h('span', { class: 'adm-kpi-etiqueta' }, etiqueta),
      h('strong', { class: 'adm-kpi-valor', 'data-valor': valor ?? 0 }, '0'), pie && h('span', { class: 'adm-kpi-pie' }, pie));
    const maxInsp = Math.max(1, ...rep.porAmbiente.map((a) => a.inspecciones));

    vaciar(cuerpo,
      h('section', { class: 'adm-kpis', 'aria-label': 'Resumen' },
        kpi(r.total, 'Inspecciones', 'notis', 'inspeccion', `${r.recibidas} recibidas`),
        kpi(r.ok, 'Sin novedad', 'total', 'check'),
        kpi(r.conDanos, 'Con novedades', 'riesgo', 'alerta', `${r.danos} daños`),
        kpi(r.pendientes + r.enCurso, 'Abiertas', 'canceladas', 'reloj', r.minutosPromedio !== null ? `${r.minutosPromedio} min promedio hasta recepción` : '')),
      h('section', { class: 'card' },
        h('h3', { class: 'bloque-titulo' }, 'Por ambiente'),
        h('ul', { class: 'barras-ambiente' }, rep.porAmbiente.map((a) => h('li', {},
          h('span', { class: 'barras-etiqueta' }, h('strong', {}, a.codigo), ` ${a.nombre}`),
          h('span', { class: 'barras-pista', role: 'img', 'aria-label': `${a.inspecciones} inspecciones, ${a.conDanos} con novedades` },
            h('span', { class: 'barras-relleno', style: `--p:${(a.inspecciones / maxInsp) * 100}%` }),
            h('span', { class: 'barras-relleno barras-relleno--danos', style: `--p:${(a.conDanos / maxInsp) * 100}%` })),
          h('span', { class: 'barras-cifra' }, `${a.inspecciones} · ${a.danos} daños`)))),
        h('p', { class: 'leyenda' }, h('span', { class: 'leyenda-tramo' }), 'Inspecciones', h('span', { class: 'leyenda-tramo leyenda-tramo--danos' }), 'Con novedades')),
      h('section', { class: 'card' },
        h('h3', { class: 'bloque-titulo' }, `Daños reportados (${rep.danos.length})`),
        rep.danos.length ? h('div', { class: 'table-wrap' }, h('table', {},
          h('thead', {}, h('tr', {}, ['Fecha', 'Ambiente', 'Ítem', 'Tipo', 'Severidad', 'Comentario', 'Estado actual', 'Instructor', ''].map((t) => h('th', {}, t)))),
          h('tbody', {}, rep.danos.map((x) => h('tr', {},
            h('td', { class: 'celda-fecha' }, fecha.corta(x.reportadoEn)), h('td', {}, x.ambiente),
            h('td', {}, h('strong', {}, x.item), h('div', { class: 'celda-detalle mono' }, x.codigo)),
            h('td', {}, etiquetaTipoDano(x.tipoDano)), h('td', {}, chipSeveridad(x.severidad)),
            h('td', { class: 'celda-larga' }, x.comentario), h('td', {}, chipItem(x.estadoActual)), h('td', {}, x.instructor),
            h('td', {}, h('a', { class: 'table-link', href: `#/planilla?id=${x.inspeccionId}` }, 'Planilla')))))))
          : vacio('Sin daños en el periodo', '', 'check')),
      h('section', { class: 'card' },
        h('h3', { class: 'bloque-titulo' }, `Inspecciones (${inspecciones.length})`),
        inspecciones.length ? h('div', { class: 'table-wrap' }, h('table', {},
          h('thead', {}, h('tr', {}, ['Inicio', 'Ambiente', 'Instructor', 'Estado', 'Resultado', 'Daños', 'Recibió', ''].map((t) => h('th', {}, t)))),
          h('tbody', {}, inspecciones.map((s) => h('tr', {},
            h('td', { class: 'celda-fecha' }, fecha.corta(s.iniciadaEn)), h('td', {}, s.ambiente.codigo), h('td', {}, s.instructor.nombre),
            h('td', {}, chipInspeccion(s.estado)), h('td', {}, chipResultado(s.resultado) || '—'), h('td', {}, String(s.danos)),
            h('td', {}, s.portero ? `${s.portero.nombre} · ${fecha.hora(s.recibidaEn)}` : '—'),
            h('td', {}, h('a', { class: 'table-link', href: `#/planilla?id=${s.id}` }, 'Planilla')))))))
          : vacio('Sin inspecciones en el periodo', '', 'inspeccion')));
    cuerpo.querySelectorAll('[data-valor]').forEach((el) => anim.contar(el, Number(el.dataset.valor)));
    requestAnimationFrame(() => requestAnimationFrame(() => cuerpo.querySelector('.barras-ambiente')?.classList.add('barras-ambiente--llenas')));
    anim.lista(cuerpo.children);
  }

  function exportar(tipo) {
    const filas = tipo === 'danos'
      ? rep?.danos.map((x) => [x.reportadoEn, x.ambiente, x.codigo, x.item, etiquetaTipoDano(x.tipoDano), x.severidad, x.comentario, x.estadoActual, x.instructor, x.inspeccionId])
      : inspecciones.map((s) => [s.id, s.ambiente.codigo, s.instructor.nombre, ESTADOS_INSPECCION[s.estado]?.[0], s.resultado || '', s.danos, s.iniciadaEn, s.confirmadaEn || '', s.portero?.nombre || '', s.recibidaEn || '']);
    if (!filas?.length) { toast('aviso', 'Nada para exportar', 'Ajusta los filtros.'); return; }
    const cabeza = tipo === 'danos'
      ? ['Fecha', 'Ambiente', 'Código', 'Ítem', 'Tipo', 'Severidad', 'Comentario', 'Estado actual', 'Instructor', 'Inspección']
      : ['Inspección', 'Ambiente', 'Instructor', 'Estado', 'Resultado', 'Daños', 'Inicio', 'Confirmada', 'Portero', 'Recibida'];
    const celda = (v) => { const t = String(v ?? ''); return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const csv = '﻿' + [cabeza, ...filas].map((fila) => fila.map(celda).join(';')).join('\n');
    descargar(`${tipo}-${f.desde || 'inicio'}-a-${f.hasta || fechaIso()}.csv`, csv, 'text/csv;charset=utf-8');
    toast('exito', 'CSV descargado', `${filas.length} filas.`);
  }

  await cargar();
  anim.entrarVista(raiz);
}
