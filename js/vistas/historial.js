// Historial y reportes: FiltroFechas + filtros de ficha, ambiente y estado,
// resumen, TablaAsistencias y ExportMock.
import { h, vaciar } from '../ui/dom.js';
import { anim } from '../ui/anim.js';
import { toast } from '../ui/avisos.js';
import { encabezado, filtroFechas, tablaAsistencias, exportMock, COLUMNAS_ASISTENCIA, cargando } from '../ui/componentes.js';
import { fechaIso } from '../reglas.js';
import { api } from '../api/contratos.js';
import { catalogos } from '../estado.js';

export async function render(raiz) {
  const cat = await catalogos();
  const filtros = { desde: fechaIso(Date.now() - 7 * 86400_000), hasta: fechaIso(), ficha: '', ambienteId: '' };
  let registros = [], estadoFiltro = '';

  const selectFicha = h('select', { onchange: () => { filtros.ficha = selectFicha.value; cargar(); } },
    h('option', { value: '' }, 'Todas las fichas'), cat.fichas.map((f) => h('option', { value: f.ficha }, `${f.ficha} · ${f.programa}`)));
  const selectAmbiente = h('select', { onchange: () => { filtros.ambienteId = selectAmbiente.value; cargar(); } },
    h('option', { value: '' }, 'Todos los ambientes'), cat.ambientes.map((a) => h('option', { value: a.id }, a.nombre)));
  const selectEstado = h('select', { onchange: () => { estadoFiltro = selectEstado.value; pintar(); } },
    h('option', { value: '' }, 'Todos'), ['presente', 'tarde', 'falla', 'cancelada'].map((e) => h('option', { value: e }, e[0].toUpperCase() + e.slice(1))));
  const resumen = h('div', { class: 'stat-grid stat-grid--4', 'data-anim': '' });
  const tabla = tablaAsistencias();
  const visibles = () => registros.filter((r) => !estadoFiltro || r.estado === estadoFiltro);

  raiz.append(
    encabezado('Historial y reportes', 'Consulta la asistencia por rango de fechas y exporta lo que ves en pantalla.',
      exportMock({ nombre: 'asistencias', obtenerFilas: visibles, columnas: COLUMNAS_ASISTENCIA })),
    h('section', { class: 'card', 'data-anim': '' },
      filtroFechas({ desde: filtros.desde, hasta: filtros.hasta, alCambiar: ({ desde, hasta }) => { Object.assign(filtros, { desde, hasta }); cargar(); } }),
      h('div', { class: 'filtros' },
        h('div', { class: 'campo' }, h('label', {}, 'Ficha'), selectFicha),
        h('div', { class: 'campo' }, h('label', {}, 'Ambiente'), selectAmbiente),
        h('div', { class: 'campo' }, h('label', {}, 'Estado'), selectEstado))),
    resumen,
    h('section', { class: 'card', 'data-anim': '' }, tabla.el));
  anim.entrarVista(raiz);

  function pintar() {
    const lista = visibles();
    const cuenta = (e) => registros.filter((r) => r.estado === e).length;
    const validos = registros.filter((r) => r.estado !== 'cancelada').length;
    const pct = validos ? Math.round(((cuenta('presente') + cuenta('tarde')) / validos) * 100) : 0;
    const tarjeta = (clase, etiqueta, valor, sufijo = '') => {
      const num = h('span', {}, '0');
      queueMicrotask(() => anim.contar(num, valor));
      return h('div', { class: `stat-card ${clase}` }, h('div', { class: 'label' }, etiqueta), h('div', { class: 'value' }, num, sufijo));
    };
    vaciar(resumen,
      tarjeta('in', 'Asistencia', pct, '%'),
      tarjeta('total', 'Presentes', cuenta('presente')),
      tarjeta('out', 'Tarde', cuenta('tarde')),
      tarjeta('rojo', 'Fallas', cuenta('falla')));
    tabla.mostrar(lista);
  }

  async function cargar() {
    tabla.mostrar([]);
    vaciar(resumen, cargando());
    try { registros = await api.asistencias(filtros); } catch (e) { toast('error', 'No se pudo cargar el historial', e.message); return; }
    pintar();
  }

  await cargar();
}
