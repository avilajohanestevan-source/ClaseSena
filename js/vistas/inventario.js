// Inventario por ambiente (backend real). Todo el personal consulta y ve el
// QR de cada ítem; el administrativo crea, edita y borra. "Etiquetas QR"
// abre la hoja imprimible con el QR de todos los ítems del ambiente.
import { h, anexar, icono, vaciar, errorCampo } from '../ui/dom.js';
import { anim } from '../ui/anim.js';
import { toast, abrirModal, confirmar } from '../ui/avisos.js';
import { cargando, tarjetaError } from '../ui/componentes.js';
import { cabecera, chipItem, qr, vacio, fecha } from '../ui/ambientes-ui.js';
import { apiAmb } from '../api/ambientes.js';
import { estado } from '../estado.js';
import { ESTADOS_ITEM } from '../reglas.js';

const CATEGORIAS = ['Cómputo', 'Audiovisual', 'Redes', 'Mobiliario', 'Infraestructura', 'Laboratorio', 'Herramientas', 'Seguridad'];

export async function render(raiz, { params }) {
  const admin = estado.usuario.rol === 'administrativo';
  const ambientes = (await apiAmb.ambientes()).filter((a) => admin || a.activo);
  if (!ambientes.length) { anexar(raiz, vacio('No hay ambientes registrados', '', 'ambiente')); return; }
  let ambienteId = Number(params.get('ambiente')) || ambientes[0].id;
  let items = [], busqueda = '', filtroEstado = '';

  const selector = h('div', { class: 'pestanas pestanas--desplazable', role: 'tablist', 'aria-label': 'Ambiente' });
  const buscar = h('input', { type: 'search', placeholder: 'Buscar por nombre, código o serial', 'aria-label': 'Buscar ítem',
    oninput: () => { busqueda = buscar.value.trim().toLowerCase(); pintar(); } });
  const estadoSel = h('select', { 'aria-label': 'Filtrar por estado', onchange: () => { filtroEstado = estadoSel.value; pintar(); } },
    h('option', { value: '' }, 'Todos los estados'), Object.entries(ESTADOS_ITEM).map(([k, [t]]) => h('option', { value: k }, t)));
  const resumen = h('div', { class: 'inv-resumen' });
  const lista = h('ul', { class: 'inv-lista inv-lista--grande' }, h('li', {}, cargando()));
  const etiquetas = h('a', { class: 'btn btn-outline' }, icono('qr'), 'Etiquetas QR');

  anexar(raiz,
    cabecera({ eyebrow: 'Inventario', titulo: 'Inventario por ambiente',
      subtitulo: admin ? 'Registra los equipos y muebles de cada ambiente. Cada ítem tiene su QR.' : 'Consulta los ítems y su estado. Cada etiqueta tiene un QR.',
      acciones: [etiquetas, admin && h('button', { class: 'btn btn-primary', type: 'button', onclick: () => formulario() }, icono('mas'), 'Nuevo ítem')].filter(Boolean) }),
    h('div', { 'data-anim': '' }, selector),
    h('section', { class: 'card', 'data-anim': '' },
      resumen,
      h('div', { class: 'inv-filtros' }, h('div', { class: 'adm-buscar' }, icono('buscar'), buscar), estadoSel),
      lista));

  function pintarSelector() {
    vaciar(selector, ambientes.map((a) => h('button', {
      class: 'pestana', type: 'button', role: 'tab', 'aria-selected': String(a.id === ambienteId),
      onclick: () => { ambienteId = a.id; history.replaceState(null, '', `#/inventario?ambiente=${a.id}`); cargar(); },
    }, h('strong', {}, a.codigo), h('span', { class: 'pestana-sub' }, a.nombre))));
    etiquetas.href = `#/etiquetas?ambiente=${ambienteId}`;
  }

  async function cargar() {
    pintarSelector();
    vaciar(lista, h('li', {}, cargando()));
    try { items = await apiAmb.items(ambienteId); } catch (e) { vaciar(lista, h('li', {}, tarjetaError(e, cargar))); return; }
    pintar(true);
  }

  function pintar(entrada = false) {
    const cuenta = Object.fromEntries(Object.keys(ESTADOS_ITEM).map((k) => [k, items.filter((i) => i.estado === k).length]));
    vaciar(resumen,
      h('span', {}, h('strong', {}, items.length), ' ítems'),
      Object.entries(ESTADOS_ITEM).filter(([k]) => cuenta[k]).map(([k, [t, c]]) => h('span', { class: `status-chip ${c}` }, `${cuenta[k]} ${t.toLowerCase()}`)));
    const visibles = items.filter((i) => (!filtroEstado || i.estado === filtroEstado)
      && (!busqueda || [i.nombre, i.codigo, i.serial || '', i.categoria].some((v) => v.toLowerCase().includes(busqueda))));
    vaciar(lista, visibles.length ? visibles.map((i) => h('li', { class: 'inv-fila' },
      h('button', { class: 'inv-fila-boton', type: 'button', onclick: () => detalle(i), 'aria-label': `${i.nombre}, ${i.codigo}. Ver detalle y QR` },
        h('span', { class: 'inv-categoria' }, i.categoria),
        h('strong', {}, i.nombre),
        h('span', { class: 'mono text-muted' }, `${i.codigo}${i.serial ? ` · ${i.serial}` : ''}`)),
      chipItem(i.estado),
      admin && h('div', { class: 'inv-fila-acciones' },
        h('button', { class: 'btn btn-outline btn-sm btn-icono', type: 'button', 'aria-label': `Editar ${i.nombre}`, onclick: () => formulario(i) }, icono('lapiz')),
        h('button', { class: 'btn btn-outline btn-sm btn-icono', type: 'button', 'aria-label': `Borrar ${i.nombre}`, onclick: () => borrar(i) }, icono('basura')))))
      : h('li', {}, vacio('Ningún ítem coincide', busqueda || filtroEstado ? 'Cambia la búsqueda o el filtro.' : 'Este ambiente aún no tiene inventario.', 'caja')));
    if (entrada) anim.lista(lista.children, { autoAlpha: 0, y: 6 });
  }

  function detalle(i) {
    abrirModal({
      titulo: i.nombre, subtitulo: `${i.codigo} · ambiente ${i.ambiente}`, ancho: 'angosto',
      contenido: h('div', { class: 'inv-detalle' },
        qr(i.qr, 200, `QR de ${i.nombre}`),
        h('code', { class: 'insp-qr-texto' }, i.qr),
        h('dl', { class: 'detalle-datos' },
          h('dt', {}, 'Estado'), h('dd', {}, chipItem(i.estado)),
          h('dt', {}, 'Categoría'), h('dd', {}, i.categoria),
          h('dt', {}, 'Serial'), h('dd', { class: 'mono' }, i.serial || '—'),
          h('dt', {}, 'Actualizado'), h('dd', {}, fecha.corta(i.actualizadoEn)))),
      acciones: admin ? [({ cerrar }) => h('button', { class: 'btn btn-outline', type: 'button', onclick: () => { cerrar(); formulario(i); } }, icono('lapiz'), 'Editar')] : [],
    });
  }

  function formulario(i = null) {
    const amb = ambientes.find((a) => a.id === ambienteId);
    const c = (id, etiqueta, input) => h('div', { class: 'campo' }, h('label', { for: id }, etiqueta), input);
    const nombre = h('input', { type: 'text', id: 'it-nombre', value: i?.nombre || '', maxlength: 120 });
    const categoria = h('select', { id: 'it-cat' }, h('option', { value: '' }, 'Elige una categoría'),
      [...new Set([...CATEGORIAS, i?.categoria].filter(Boolean))].map((x) => h('option', { value: x, selected: x === i?.categoria }, x)));
    const serial = h('input', { type: 'text', id: 'it-serial', value: i?.serial || '', maxlength: 60 });
    const estadoIt = h('select', { id: 'it-estado' }, Object.entries(ESTADOS_ITEM).map(([k, [t]]) => h('option', { value: k, selected: k === (i?.estado || 'operativo') }, t)));
    const guardar = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => enviar() }, icono('check'), i ? 'Guardar' : 'Agregar ítem');
    const { cerrar } = abrirModal({
      titulo: i ? `Editar ${i.codigo}` : `Nuevo ítem · ambiente ${amb.codigo}`,
      subtitulo: i ? '' : 'El código y su QR se generan automáticamente.',
      contenido: h('form', { class: 'form-grid', novalidate: true, onsubmit: (e) => { e.preventDefault(); enviar(); } },
        h('div', { class: 'full' }, c('it-nombre', 'Nombre', nombre)), c('it-cat', 'Categoría', categoria), c('it-serial', 'Serial (opcional)', serial),
        h('div', { class: 'full' }, c('it-estado', 'Estado', estadoIt))),
      acciones: [({ cerrar: x }) => h('button', { class: 'btn btn-outline', type: 'button', onclick: () => x() }, 'Cancelar'), guardar],
    });
    async function enviar() {
      errorCampo(nombre, nombre.value.trim().length >= 3 ? null : 'Escribe el nombre del ítem.');
      errorCampo(categoria, categoria.value ? null : 'Elige la categoría.');
      if (nombre.value.trim().length < 3 || !categoria.value) return;
      const datos = { ambienteId, nombre: nombre.value.trim(), categoria: categoria.value, serial: serial.value.trim(), estado: estadoIt.value };
      guardar.disabled = true;
      try {
        const nuevo = i ? await apiAmb.editarItem(i.id, datos) : await apiAmb.crearItem(datos);
        toast('exito', i ? 'Ítem actualizado' : 'Ítem agregado', `${nuevo.codigo} · ${nuevo.nombre}`);
        cerrar();
        cargar();
      } catch (e) { toast('error', 'No se guardó', e.message); guardar.disabled = false; }
    }
  }

  async function borrar(i) {
    if (!await confirmar({ titulo: `¿Borrar ${i.nombre}?`, mensaje: `${i.codigo}. Si ya tiene daños reportados no se puede borrar: márcalo "De baja".`, textoAceptar: 'Borrar', peligro: true })) return;
    try { await apiAmb.borrarItem(i.id); toast('exito', 'Ítem borrado'); cargar(); } catch (e) { toast('error', 'No se borró', e.message); }
  }

  await cargar();
  anim.entrarVista(raiz);
}
