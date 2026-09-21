// Inventario por ambiente: ListaActivos, EscanerBarcode y DetalleActivo
// (estado, historial, fotos previas, etiqueta con código de barras y
// acceso a marcar daño).
import { h, icono, vaciar, formato } from '../ui/dom.js';
import { anim } from '../ui/anim.js';
import { toast, abrirModal } from '../ui/avisos.js';
import { crearEscaner } from '../ui/escaner.js';
import { chipActivo, cargando, tarjetaError, encabezado } from '../ui/componentes.js';
import { svgCode128 } from '../ui/codigo128.js';
import { api } from '../api/contratos.js';
import { estado, catalogos } from '../estado.js';

export async function render(raiz, { params, alSalir }) {
  const cat = await catalogos();
  const usuario = estado.usuario;
  const ambientes = usuario.ambienteIds ? cat.ambientes.filter((a) => usuario.ambienteIds.includes(a.id)) : cat.ambientes;
  let ambienteId = ambientes.some((a) => a.id === params.get('ambiente')) ? params.get('ambiente') : ambientes[0].id;
  let activos = [], filtroEstado = '', texto = '';

  const selectAmbiente = h('select', { onchange: () => { ambienteId = selectAmbiente.value; cargar(); } },
    ambientes.map((a) => h('option', { value: a.id, selected: a.id === ambienteId }, a.nombre)));
  const selectEstado = h('select', { onchange: () => { filtroEstado = selectEstado.value; pintar(); } },
    h('option', { value: '' }, 'Todos los estados'),
    h('option', { value: 'operativo' }, 'Operativo'), h('option', { value: 'danado' }, 'Dañado'), h('option', { value: 'en-reparacion' }, 'En reparación'));
  const buscar = h('input', { type: 'search', placeholder: 'Nombre, código o tipo', oninput: () => { texto = buscar.value.trim().toLowerCase(); pintar(); } });
  const resumen = h('div', { class: 'stat-grid stat-grid--4' });
  const rejilla = h('div', { class: 'activos' }, cargando());

  const escaner = crearEscaner({
    tipos: ['barras'], etiqueta: 'Escanear activo', placeholder: 'Código del activo (ej. SENA-201-0001)',
    alLeer: async (codigo) => {
      try {
        const activo = await api.activoPorCodigo(codigo);
        toast('exito', 'Activo encontrado', `${activo.nombre} · ${activo.codigo}`);
        detalleActivo(activo, cat);
      } catch (e) { toast('error', 'Código no encontrado', e.message); }
    },
  });
  alSalir(() => escaner.detener());

  raiz.append(
    encabezado('Inventario del ambiente', 'Escanea la etiqueta de un activo para ver su estado, su historial y las fotos de daños anteriores.'),
    h('div', { class: 'inventario-grid' },
      h('section', { class: 'card', 'data-anim': '' },
        h('h3', { class: 'bloque-titulo' }, 'Escanear código de barras'),
        escaner.el),
      h('section', { 'data-anim': '' }, resumen)),
    h('section', { class: 'card', 'data-anim': '' },
      h('div', { class: 'filtros' },
        h('div', { class: 'campo' }, h('label', {}, 'Ambiente'), selectAmbiente),
        h('div', { class: 'campo' }, h('label', {}, 'Estado'), selectEstado),
        h('div', { class: 'campo campo--ancho' }, h('label', {}, 'Buscar'), buscar)),
      rejilla));
  anim.entrarVista(raiz);

  async function cargar() {
    vaciar(rejilla, cargando());
    try { activos = await api.activos(ambienteId); } catch (e) { vaciar(rejilla, tarjetaError(e, cargar)); return; }
    const cuenta = (e) => activos.filter((a) => a.estado === e).length;
    const tarjeta = (clase, etiqueta, valor) => {
      const num = h('div', { class: 'value' }, '0');
      queueMicrotask(() => anim.contar(num, valor));
      return h('div', { class: `stat-card ${clase}` }, h('div', { class: 'label' }, etiqueta), num);
    };
    vaciar(resumen, tarjeta('total', 'Activos', activos.length), tarjeta('in', 'Operativos', cuenta('operativo')),
      tarjeta('rojo', 'Dañados', cuenta('danado')), tarjeta('out', 'En reparación', cuenta('en-reparacion')));
    pintar(true);
  }

  function pintar(entrada = false) {
    const lista = activos.filter((a) => (!filtroEstado || a.estado === filtroEstado)
      && (!texto || `${a.nombre} ${a.codigo} ${a.tipo}`.toLowerCase().includes(texto)));
    vaciar(rejilla, lista.length ? lista.map((a) => h('button', { class: `activo activo--${a.estado}`, type: 'button', onclick: () => detalleActivo(a, cat) },
      h('span', { class: 'activo-tipo' }, a.tipo),
      h('strong', { class: 'activo-nombre' }, a.nombre),
      h('span', { class: 'mono activo-codigo' }, a.codigo),
      h('span', { class: 'activo-pie' }, chipActivo(a.estado), a.fotos.length ? h('span', { class: 'activo-fotos' }, icono('camara'), a.fotos.length) : null)))
      : h('div', { class: 'empty-state' }, 'No hay activos con esos filtros.'));
    if (entrada || lista.length) anim.lista(rejilla.children, { autoAlpha: 0, y: 12, scale: 0.97 });
  }

  await cargar();
}

/** DetalleActivo en modal. Se exporta para usarlo desde otras vistas. */
export function detalleActivo(activoInicial, cat) {
  const cuerpo = h('div', { class: 'detalle-activo' }, cargando());
  const { cerrar } = abrirModal({
    titulo: activoInicial.nombre,
    subtitulo: `${activoInicial.codigo} · ${cat.ambientes.find((x) => x.id === activoInicial.ambienteId)?.nombre ?? ''}`,
    ancho: 'ancho',
    contenido: cuerpo,
    acciones: [
      ({ cerrar }) => h('button', { class: 'btn btn-outline', type: 'button', onclick: () => cerrar() }, 'Cerrar'),
      ({ cerrar }) => h('a', { class: 'btn btn-peligro', href: `#/danos?activo=${activoInicial.id}`, onclick: () => cerrar() }, icono('herramienta'), 'Marcar daño'),
    ],
  });

  api.activo(activoInicial.id).then((a) => {
    const etiqueta = h('div', { class: 'etiqueta-activo' });
    etiqueta.innerHTML = svgCode128(a.codigo); // SVG generado localmente a partir del código
    vaciar(cuerpo,
      h('div', { class: 'detalle-columnas' },
        h('dl', { class: 'detalle-datos' },
          h('dt', {}, 'Estado'), h('dd', {}, chipActivo(a.estado)),
          h('dt', {}, 'Tipo'), h('dd', {}, a.tipo),
          h('dt', {}, 'Serial'), h('dd', { class: 'mono' }, a.serial),
          h('dt', {}, 'Código'), h('dd', { class: 'mono' }, a.codigo)),
        h('div', {}, etiqueta, h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => imprimirEtiqueta(a) }, icono('descargar'), 'Imprimir etiqueta'))),
      h('h4', { class: 'detalle-subtitulo' }, `Fotos previas (${a.fotos.length})`),
      a.fotos.length ? h('div', { class: 'galeria' }, a.fotos.map((f) => h('button', { class: 'galeria-item', type: 'button', onclick: () => verFoto(f) },
        h('img', { src: f.url, alt: f.descripcion, loading: 'lazy' }),
        h('span', {}, formato.fecha(f.fecha)))))
        : h('p', { class: 'text-muted' }, 'Este activo no tiene fotos de daños.'),
      h('h4', { class: 'detalle-subtitulo' }, 'Historial'),
      h('ol', { class: 'linea-tiempo' }, [...a.historial].reverse().map((e) => h('li', {},
        h('time', {}, formato.fechaHora(e.fecha)), h('strong', {}, e.evento), h('span', { class: 'text-muted' }, e.usuario)))));
    anim.lista(cuerpo.querySelectorAll('.galeria-item, .linea-tiempo li'));
  }).catch((e) => { vaciar(cuerpo, tarjetaError(e)); });
  return cerrar;
}

function verFoto(foto) {
  abrirModal({
    titulo: 'Foto del daño', subtitulo: `${formato.fechaHora(foto.fecha)} · ${foto.descripcion}`, ancho: 'ancho',
    contenido: h('img', { class: 'foto-grande', src: foto.url, alt: foto.descripcion }),
  });
}

const escapar = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function imprimirEtiqueta(activo) {
  const ventana = window.open('', '_blank', 'width=480,height=360');
  if (!ventana) { toast('aviso', 'Ventana bloqueada', 'Permite ventanas emergentes para imprimir la etiqueta.'); return; }
  ventana.document.write(`<!doctype html><title>${escapar(activo.codigo)}</title><body style="margin:24px;font-family:sans-serif;text-align:center">
<p style="margin:0 0 8px;font-weight:600">${escapar(activo.nombre)}</p>${svgCode128(activo.codigo, { modulo: 2, alto: 70 })}
<script>onload=()=>{print()}<\/script></body>`);
  ventana.document.close();
}
