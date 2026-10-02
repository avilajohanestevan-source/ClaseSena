// Novedades (coordinación, administrativo e inventario):
//  · Activas: novedades permanentes (persistent_issues) que siguen abiertas
//    revisión tras revisión. Desde aquí se deja el ítem (o la familia) fuera
//    de servicio, en reparación o de baja, y se marca resuelta.
//  · Historial: todo lo reportado (equipo o ambiente, fecha, usuario,
//    evidencia, naturaleza, estado y fecha de resolución), con filtros y CSV.
//  · Nueva novedad permanente sin revisión de por medio.
// #/novedades?id=N abre el detalle de una novedad (enlace de las notificaciones).
import { h, anexar, icono, vaciar, errorCampo, descargar } from '../ui/dom.js';
import { anim } from '../ui/anim.js';
import { toast, abrirModal } from '../ui/avisos.js';
import { cargando, tarjetaError } from '../ui/componentes.js';
import { crearCapturaFoto } from '../ui/camara.js';
import { cabecera, chipItem, chipSeveridad, chipNaturaleza, chipNovedad, etiquetaTipoDano, fecha, vacio } from '../ui/ambientes-ui.js';
import { apiAmb } from '../api/ambientes.js';
import { emitir } from '../estado.js';
import { fechaIso, ESTADOS_ITEM, ESTADOS_NOVEDAD, NATURALEZAS, TIPOS_DANO, PRIORIDADES, UBICACIONES } from '../reglas.js';

export async function render(raiz, { params }) {
  const ambientes = await apiAmb.ambientes();
  let pestana = params.get('ver') === 'historial' ? 'historial' : 'activas';
  const f = { ambienteId: params.get('ambiente') || '', naturaleza: '', estado: '', desde: '', hasta: '' };
  let activas = [], historial = [];

  const pestanas = h('div', { class: 'segmentos', role: 'tablist', 'aria-label': 'Ver' });
  const cuerpo = h('div', { class: 'novedades-cuerpo' }, cargando());
  const sel = (clave, etiqueta, opciones, todos) => h('div', { class: 'campo' }, h('label', { for: `nv-${clave}` }, etiqueta),
    h('select', { id: `nv-${clave}`, onchange: (e) => { f[clave] = e.target.value; cargar(); } }, h('option', { value: '' }, todos),
      opciones.map(([v, t]) => h('option', { value: v, selected: String(v) === f[clave] }, t))));
  const fechaCampo = (clave, etiqueta) => h('div', { class: 'campo' }, h('label', { for: `nv-${clave}` }, etiqueta),
    h('input', { type: 'date', id: `nv-${clave}`, max: fechaIso(), onchange: (e) => { f[clave] = e.target.value; cargar(); } }));
  const filtrosHistorial = h('div', { class: 'filtros-extra' },
    sel('naturaleza', 'Naturaleza', NATURALEZAS.map((n) => [n.clave, n.etiqueta]), 'Todas'),
    sel('estado', 'Estado', Object.entries(ESTADOS_NOVEDAD).map(([k, [t]]) => [k, t]), 'Todos'),
    fechaCampo('desde', 'Desde'), fechaCampo('hasta', 'Hasta'));

  anexar(raiz,
    cabecera({
      eyebrow: 'Coordinación · Administrativo · Inventario', titulo: 'Novedades de los ambientes',
      subtitulo: 'Las novedades permanentes siguen activas hasta que se marcan resueltas. Las temporales y de limpieza quedan en el historial.',
      acciones: [
        h('button', { class: 'btn btn-outline', type: 'button', onclick: () => exportarCsv() }, icono('descargar'), 'CSV historial'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => nuevaNovedad() }, icono('mas'), 'Nueva novedad permanente')],
    }),
    h('div', { 'data-anim': '' }, pestanas),
    h('section', { class: 'card no-imprimir reporte-filtros', 'data-anim': '' },
      h('div', { class: 'filtros' }, sel('ambienteId', 'Ambiente', ambientes.map((a) => [a.id, `${a.codigo} · ${a.nombre}`]), 'Todos'), filtrosHistorial)),
    cuerpo);

  function pintarPestanas() {
    vaciar(pestanas, [['activas', 'Activas', 'reloj', activas.length], ['historial', 'Historial', 'historial', historial.length]].map(([clave, texto, ic, n]) => h('button', {
      class: 'segmento', type: 'button', role: 'tab', 'aria-selected': String(pestana === clave),
      onclick: () => { pestana = clave; history.replaceState(null, '', `#/novedades${clave === 'historial' ? '?ver=historial' : ''}`); cargar(); },
    }, icono(ic), texto, h('span', { class: 'pestana-cuenta' }, n))));
    filtrosHistorial.hidden = pestana !== 'historial';
  }

  async function cargar() {
    pintarPestanas();
    vaciar(cuerpo, cargando());
    try {
      [activas, historial] = await Promise.all([
        apiAmb.novedades({ estado: 'activa', ambienteId: f.ambienteId || undefined }),
        apiAmb.historialNovedades({ ...f }),
      ]);
    } catch (e) { vaciar(cuerpo, tarjetaError(e, cargar)); return; }
    pintarPestanas();
    if (pestana === 'activas') pintarActivas(); else pintarHistorial();
  }

  /* ---------------- activas ---------------- */

  function pintarActivas() {
    vaciar(cuerpo, activas.length ? h('div', { class: 'novedades-lista' }, activas.map((n) => h('article', { class: `card novedad novedad--${n.severidad}` },
      n.foto ? h('img', { class: 'reporte-foto', src: n.foto, alt: `Evidencia de ${n.titulo}`, loading: 'lazy' }) : h('span', { class: 'reporte-foto reporte-foto--vacia', 'aria-hidden': 'true' }, icono('camara')),
      h('div', { class: 'reporte-datos' },
        h('span', { class: 'inv-categoria' }, `Ambiente ${n.ambiente.codigo} · ${n.objetivo.tipo === 'familia' ? 'Familia completa' : n.objetivo.tipo === 'item' ? 'Ítem' : 'Salón'}`),
        h('strong', {}, n.titulo),
        h('div', { class: 'reporte-chips' }, chipSeveridad(n.severidad), h('span', { class: 'status-chip neutro' }, etiquetaTipoDano(n.tipoDano)), n.itemEstado && chipItem(n.itemEstado)),
        h('p', {}, n.descripcion),
        h('span', { class: 'text-muted' }, `Abierta ${fecha.corta(n.creadaEn)}${n.reportadaPor ? ` por ${n.reportadaPor}` : ''} · ${n.reportes ? `${n.reportes} revisión(es) la reportaron` : 'registrada por un administrativo'}`)),
      h('div', { class: 'novedad-acciones' },
        h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => detalle(n.id) }, icono('ojo'), 'Detalle'),
        n.objetivo.tipo !== 'salon' && n.itemEstado !== 'fuera_servicio' && h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => cambiarEstado(n, 'fuera_servicio') }, icono('prohibido'), 'Fuera de servicio'),
        h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => resolver(n) }, icono('check'), 'Marcar resuelta')))))
      : vacio('No hay novedades permanentes activas', f.ambienteId ? 'Este ambiente no tiene novedades abiertas.' : 'Todos los ambientes están al día.', 'check'));
    anim.lista(cuerpo.querySelectorAll('.novedad'), { autoAlpha: 0, y: 6 });
  }

  async function detalle(id) {
    let n;
    try { n = await apiAmb.novedad(id); } catch (e) { toast('error', 'No se abrió la novedad', e.message); return; }
    abrirModal({
      titulo: n.titulo, subtitulo: `Novedad permanente #${n.id} · ambiente ${n.ambiente.codigo}`, ancho: 'normal',
      contenido: h('div', { class: 'novedad-detalle' },
        h('div', { class: 'reporte-chips' }, chipNovedad(n.estado), chipSeveridad(n.severidad), h('span', { class: 'status-chip neutro' }, etiquetaTipoDano(n.tipoDano))),
        h('p', {}, n.descripcion),
        h('dl', { class: 'detalle-datos' },
          h('dt', {}, 'Abierta'), h('dd', {}, `${fecha.completa(n.creadaEn)}${n.reportadaPor ? ` · ${n.reportadaPor}` : ''}`),
          n.inspeccionId && [h('dt', {}, 'Revisión'), h('dd', {}, h('a', { class: 'table-link', href: `#/planilla?id=${n.inspeccionId}` }, `INS-${String(n.inspeccionId).padStart(6, '0')}`))],
          n.estado === 'resuelta' && [h('dt', {}, 'Resuelta'), h('dd', {}, `${fecha.completa(n.resueltaEn)} · ${n.resueltaPor}`), h('dt', {}, 'Solución'), h('dd', {}, n.resolucion)]),
        n.items.length ? [h('h3', { class: 'bloque-titulo' }, `Ítems afectados (${n.items.length})`),
          h('ul', { class: 'inv-lista' }, n.items.map((i) => h('li', { class: 'inv-fila' }, h('span', { class: 'mono' }, i.codigo), chipItem(i.estado))))] : null,
        h('h3', { class: 'bloque-titulo' }, `Reportes en revisiones (${n.historial.length})`),
        n.historial.length ? h('div', { class: 'reportes' }, n.historial.map((r) => h('article', { class: 'reporte' },
          r.foto ? h('img', { class: 'reporte-foto', src: r.foto, alt: 'Evidencia', loading: 'lazy' }) : h('span', { class: 'reporte-foto reporte-foto--vacia', 'aria-hidden': 'true' }, icono('camara')),
          h('div', { class: 'reporte-datos' }, h('strong', {}, r.instructor), h('span', { class: 'text-muted' }, fecha.corta(r.fecha)), h('p', {}, r.comentario)),
          h('a', { class: 'btn btn-outline btn-sm', href: `#/planilla?id=${r.inspeccionId}` }, 'Planilla'))))
          : h('p', { class: 'text-muted' }, 'Registrada directamente por un administrativo.')),
      acciones: n.estado === 'activa' ? [
        n.objetivo.tipo !== 'salon' && (({ cerrar }) => h('button', { class: 'btn btn-outline', type: 'button', onclick: () => { cerrar(); elegirEstado(n); } }, icono('herramienta'), 'Cambiar estado del ítem')),
        ({ cerrar }) => h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { cerrar(); resolver(n); } }, icono('check'), 'Marcar resuelta'),
      ].filter(Boolean) : [],
    });
  }

  function elegirEstado(n) {
    const selector = h('select', { id: 'nv-estado-item' }, ['danado', 'en_reparacion', 'fuera_servicio', 'baja'].map((k) => h('option', { value: k, selected: k === n.itemEstado }, ESTADOS_ITEM[k][0])));
    const { cerrar } = abrirModal({
      titulo: 'Estado mientras siga activa', subtitulo: n.titulo, ancho: 'angosto',
      contenido: h('div', { class: 'campo' }, h('label', { for: 'nv-estado-item' }, n.objetivo.tipo === 'familia' ? 'Estado de todos los componentes' : 'Estado del ítem'), selector),
      acciones: [({ cerrar: x }) => h('button', { class: 'btn btn-outline', type: 'button', onclick: () => x() }, 'Cancelar'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => { if (await cambiarEstado(n, selector.value)) cerrar(); } }, icono('check'), 'Guardar')],
    });
  }

  async function cambiarEstado(n, estadoItem) {
    try {
      await apiAmb.editarNovedad(n.id, { estadoItem });
      toast('exito', 'Estado actualizado', `${n.titulo}: ${ESTADOS_ITEM[estadoItem][0]}`);
      cargar();
      return true;
    } catch (e) { toast('error', 'No se cambió el estado', e.message); return false; }
  }

  function resolver(n) {
    const resolucion = h('textarea', { id: 'nv-resolucion', rows: 3, maxlength: 500, placeholder: 'Ej.: se cambió el compresor del aire acondicionado.' });
    const estadoFinal = n.objetivo.tipo !== 'salon' && h('select', { id: 'nv-estado-final' },
      ['operativo', 'en_reparacion', 'baja'].map((k) => h('option', { value: k }, ESTADOS_ITEM[k][0])));
    const guardar = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => enviar() }, icono('check'), 'Marcar resuelta');
    const { cerrar } = abrirModal({
      titulo: 'Marcar resuelta', subtitulo: `${n.titulo} · ambiente ${n.ambiente.codigo}`, ancho: 'angosto',
      contenido: h('div', { class: 'form-grid' },
        h('div', { class: 'full campo' }, h('label', { for: 'nv-resolucion' }, '¿Qué se hizo?'), resolucion),
        estadoFinal && h('div', { class: 'full campo' }, h('label', { for: 'nv-estado-final' }, n.objetivo.tipo === 'familia' ? 'Los componentes quedan' : 'El ítem queda'), estadoFinal),
        h('p', { class: 'full text-muted' }, 'Se avisa a coordinación, administrativo e inventario, y a quien la reportó.')),
      acciones: [({ cerrar: x }) => h('button', { class: 'btn btn-outline', type: 'button', onclick: () => x() }, 'Cancelar'), guardar],
    });
    async function enviar() {
      const texto = resolucion.value.trim();
      errorCampo(resolucion, texto.length >= 5 ? null : 'Describe la solución (mínimo 5 caracteres).');
      if (texto.length < 5) return;
      guardar.disabled = true;
      try {
        await apiAmb.resolverNovedad(n.id, { resolucion: texto, estadoItem: estadoFinal ? estadoFinal.value : undefined });
        toast('exito', 'Novedad resuelta', n.titulo);
        cerrar();
        emitir('novedades');
        cargar();
      } catch (e) { toast('error', 'No se resolvió', e.message); guardar.disabled = false; }
    }
  }

  /* ---------------- nueva novedad permanente (sin revisión) ---------------- */

  async function nuevaNovedad() {
    let objetivos = [], tipoDano = '', severidad = '', foto = null;
    const ambSel = h('select', { id: 'nn-amb', onchange: () => cargarObjetivos() }, ambientes.filter((a) => a.activo).map((a) => h('option', { value: a.id, selected: String(a.id) === f.ambienteId }, `${a.codigo} · ${a.nombre}`)));
    const objetivo = h('select', { id: 'nn-obj' });
    const descripcion = h('textarea', { id: 'nn-desc', rows: 3, maxlength: 500, placeholder: 'Ej.: el aire acondicionado no enfría.' });
    const estadoItem = h('select', { id: 'nn-estado' }, ['danado', 'en_reparacion', 'fuera_servicio'].map((k) => h('option', { value: k }, ESTADOS_ITEM[k][0])));
    const tipos = h('div', { class: 'opciones-chip', role: 'radiogroup', 'aria-label': 'Tipo' }, TIPOS_DANO.map((t) => h('label', { class: 'opcion-chip' },
      h('input', { type: 'radio', name: 'nn-tipo', value: t.clave, onchange: () => { tipoDano = t.clave; errorCampo(tipos, null); } }), h('span', {}, t.etiqueta))));
    const severidades = h('div', { class: 'opciones-chip', role: 'radiogroup', 'aria-label': 'Severidad' }, PRIORIDADES.map((p) => h('label', { class: 'opcion-chip' },
      h('input', { type: 'radio', name: 'nn-sev', value: p.clave, onchange: () => { severidad = p.clave; errorCampo(severidades, null); } }), h('span', {}, p.etiqueta))));
    const captura = crearCapturaFoto({ alCambiar: (x) => { foto = x; } });

    async function cargarObjetivos() {
      vaciar(objetivo, h('option', { value: '' }, 'Cargando…'));
      const ambId = Number(ambSel.value);
      try {
        const [items, familias] = await Promise.all([apiAmb.items(ambId), apiAmb.familias(ambId)]);
        objetivos = [
          ...UBICACIONES.map((u) => ({ valor: `u:${u.clave}`, texto: `Salón · ${u.etiqueta}`, grupo: 'Salón' })),
          ...familias.map((x) => ({ valor: `f:${x.id}`, texto: `${x.nombre} · ${x.codigo}`, grupo: 'Familias' })),
          ...items.filter((i) => i.estado !== 'baja').map((i) => ({ valor: `i:${i.id}`, texto: `${i.nombre} · ${i.codigo}`, grupo: 'Ítems' })),
        ];
        vaciar(objetivo, h('option', { value: '' }, 'Elige el ítem, la familia o el lugar'),
          ['Ítems', 'Familias', 'Salón'].map((g) => h('optgroup', { label: g }, objetivos.filter((o) => o.grupo === g).map((o) => h('option', { value: o.valor }, o.texto)))));
      } catch (e) { vaciar(objetivo, h('option', { value: '' }, e.message)); }
    }
    cargarObjetivos();

    const guardar = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => enviar() }, icono('check'), 'Registrar novedad');
    const c = (id, etiqueta, input) => h('div', { class: 'campo' }, h('label', { for: id }, etiqueta), input);
    const { cerrar } = abrirModal({
      titulo: 'Nueva novedad permanente', subtitulo: 'Queda activa hasta que se marque resuelta. Se avisa a coordinación, administrativo e inventario.', ancho: 'normal',
      contenido: h('div', { class: 'form-grid' },
        c('nn-amb', 'Ambiente', ambSel), c('nn-obj', '¿Qué tiene la novedad?', objetivo),
        h('div', { class: 'full campo' }, h('label', {}, 'Tipo'), tipos),
        h('div', { class: 'full campo' }, h('label', {}, 'Severidad'), severidades),
        h('div', { class: 'full' }, c('nn-desc', 'Descripción', descripcion)),
        c('nn-estado', 'Estado del ítem mientras siga activa', estadoItem),
        h('div', { class: 'full campo' }, h('label', {}, 'Foto ', h('span', { class: 'opt' }, '(opcional)')), captura.el)),
      acciones: [({ cerrar: x }) => h('button', { class: 'btn btn-outline', type: 'button', onclick: () => x() }, 'Cancelar'), guardar],
      alCerrar: () => captura.detener(),
    });
    async function enviar() {
      const [clase, valor] = objetivo.value.split(':');
      errorCampo(objetivo, objetivo.value ? null : 'Elige qué tiene la novedad.');
      errorCampo(tipos, tipoDano ? null : 'Elige el tipo.');
      errorCampo(severidades, severidad ? null : 'Elige la severidad.');
      errorCampo(descripcion, descripcion.value.trim().length >= 10 ? null : 'Describe la novedad (mínimo 10 caracteres).');
      if (!objetivo.value || !tipoDano || !severidad || descripcion.value.trim().length < 10) return;
      const datos = { ambienteId: Number(ambSel.value), tipoDano, severidad, descripcion: descripcion.value.trim(), estadoItem: estadoItem.value, foto };
      if (clase === 'i') datos.itemId = Number(valor); else if (clase === 'f') datos.familiaId = Number(valor); else datos.ubicacion = valor;
      guardar.disabled = true;
      try {
        const n = await apiAmb.crearNovedad(datos);
        toast('exito', 'Novedad registrada', n.titulo);
        cerrar();
        pestana = 'activas';
        cargar();
      } catch (e) { toast('error', 'No se registró', e.message); guardar.disabled = false; }
    }
  }

  /* ---------------- historial ---------------- */

  function pintarHistorial() {
    vaciar(cuerpo, historial.length ? h('section', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', { class: 'tabla-novedades' },
      h('thead', {}, h('tr', {}, ['Fecha', 'Ambiente', 'Equipo o lugar', 'Novedad', 'Reportó', 'Evidencia', 'Estado', 'Resolución'].map((t) => h('th', {}, t)))),
      h('tbody', {}, historial.map((x) => h('tr', {},
        h('td', {}, fecha.corta(x.fecha)),
        h('td', {}, x.ambiente.codigo),
        h('td', {}, h('strong', {}, x.objetivo.nombre), x.objetivo.codigo && h('span', { class: 'mono text-muted' }, ` ${x.objetivo.codigo}`)),
        h('td', {}, h('div', { class: 'reporte-chips' }, chipNaturaleza(x.naturaleza), chipSeveridad(x.severidad)), h('span', { class: 'text-muted' }, `${etiquetaTipoDano(x.tipoDano)} · ${x.comentario}`)),
        h('td', {}, x.usuario || '—', x.inspeccionId && h('a', { class: 'table-link', href: `#/planilla?id=${x.inspeccionId}` }, ' · planilla')),
        h('td', {}, x.foto ? h('a', { href: x.foto, target: '_blank', rel: 'noopener' }, h('img', { class: 'novedad-miniatura', src: x.foto, alt: `Evidencia de ${x.objetivo.nombre}`, loading: 'lazy' })) : '—'),
        h('td', {}, chipNovedad(x.estado), x.novedadId && h('button', { class: 'table-link boton-enlace', type: 'button', onclick: () => detalle(x.novedadId) }, ` #${x.novedadId}`)),
        h('td', {}, x.resueltaEn ? fecha.corta(x.resueltaEn) : '—', x.resolucion && h('span', { class: 'text-muted' }, ` · ${x.resolucion}`))))))))
      : vacio('Sin novedades', 'No hay novedades con estos filtros.', 'historial'));
  }

  function exportarCsv() {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const filas = [['fecha', 'ambiente', 'equipo_o_lugar', 'codigo', 'naturaleza', 'tipo', 'severidad', 'comentario', 'reporto', 'evidencia', 'estado', 'resuelta_en', 'resolucion']]
      .concat(historial.map((x) => [x.fecha, x.ambiente.codigo, x.objetivo.nombre, x.objetivo.codigo, x.naturaleza, x.tipoDano, x.severidad, x.comentario,
        x.usuario, x.foto ? new URL(x.foto, location.href).href : '', x.estado, x.resueltaEn, x.resolucion]));
    descargar(`novedades-${fechaIso()}.csv`, '﻿' + filas.map((r) => r.map(esc).join(';')).join('\r\n'), 'text/csv;charset=utf-8');
  }

  await cargar();
  anim.entrarVista(raiz);
  if (params.get('id')) detalle(Number(params.get('id')));
}
