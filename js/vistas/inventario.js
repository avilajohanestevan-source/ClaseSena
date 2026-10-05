// Inventario por ambiente (backend real). Cada ítem tiene una pegatina con
// QR y código de barras, una categoría (Inmuebles, Mobiliario,
// Electrodomésticos, Equipos Informáticos, Periféricos…) y, si es parte de
// un conjunto, una familia (Familia PC = monitor + CPU + teclado + mouse).
//  · Todo el personal: consultar ítems y familias, "Escanear" una pegatina
//    (de ítem o de familia) para ver su estado y trazabilidad, y reimprimir.
//  · Administrativo: crear, editar y borrar ítems y familias; categorías;
//    "Registrar con escáner" (cada código leído crea o actualiza el ítem al
//    instante); "Carga masiva" desde Excel/CSV con vista previa; exportar.
import { h, anexar, icono, vaciar, errorCampo } from '../ui/dom.js';
import { anim } from '../ui/anim.js';
import { toast, abrirModal, confirmar } from '../ui/avisos.js';
import { cargando, tarjetaError } from '../ui/componentes.js';
import { crearEscaner } from '../ui/escaner.js';
import { gestionarCatalogo } from '../ui/catalogo.js';
import { cabecera, chipItem, qr, codigoBarras, vacio, fecha } from '../ui/ambientes-ui.js';
import { apiAmb } from '../api/ambientes.js';
import { estado } from '../estado.js';
import { ESTADOS_ITEM, leerQrItem, gestionaInventario } from '../reglas.js';

const ACCIONES_HISTORIAL = {
  registro: ['Registro', 'mas'], carga_masiva: ['Carga masiva', 'subir'], escaneo: ['Escaneo', 'escanear'], traslado: ['Traslado', 'ambiente'],
  edicion: ['Edición', 'lapiz'], etiqueta: ['Pegatina', 'imprimir'], familia: ['Familia', 'capas'], dano: ['Novedad reportada', 'alerta'],
  dano_retirado: ['Novedad retirada', 'reintentar'], novedad: ['Novedad permanente', 'reloj'], novedad_resuelta: ['Novedad resuelta', 'check'],
  estado: ['Cambio de estado', 'herramienta'],
};

export async function render(raiz, { params }) {
  // Administrativo y almacén gestionan el inventario; los demás lo consultan.
  const admin = gestionaInventario(estado.usuario);
  const ambientes = (await apiAmb.ambientes()).filter((a) => admin || a.activo);
  if (!ambientes.length) { anexar(raiz, vacio('No hay ambientes registrados', '', 'ambiente')); return; }
  let categorias = await apiAmb.categorias();
  let ambienteId = Number(params.get('ambiente')) || ambientes[0].id;
  let pestana = params.get('ver') === 'familias' ? 'familias' : 'items';
  let items = [], familias = [], busqueda = '', filtroEstado = '', filtroCategoria = '';

  const selector = h('div', { class: 'pestanas pestanas--desplazable', role: 'tablist', 'aria-label': 'Ambiente' });
  const vistas = h('div', { class: 'segmentos', role: 'tablist', 'aria-label': 'Ver' });
  const buscar = h('input', { type: 'search', placeholder: 'Buscar por nombre, código, serial o familia', 'aria-label': 'Buscar',
    oninput: () => { busqueda = buscar.value.trim().toLowerCase(); pintar(); } });
  const estadoSel = h('select', { 'aria-label': 'Filtrar por estado', onchange: () => { filtroEstado = estadoSel.value; pintar(); } },
    h('option', { value: '' }, 'Todos los estados'), Object.entries(ESTADOS_ITEM).map(([k, [t]]) => h('option', { value: k }, t)));
  const categoriaSel = h('select', { 'aria-label': 'Filtrar por categoría', onchange: () => { filtroCategoria = categoriaSel.value; pintar(); } });
  const resumen = h('div', { class: 'inv-resumen' });
  const lista = h('ul', { class: 'inv-lista inv-lista--grande' }, h('li', {}, cargando()));
  const pegatinas = h('a', { class: 'btn btn-outline btn-sm' }, icono('imprimir'), 'Pegatinas');
  const ambienteActual = () => ambientes.find((a) => a.id === ambienteId);
  const opcionesCategoria = (sel) => categorias.filter((c) => c.activo || c.id === sel).map((c) => h('option', { value: c.id, selected: c.id === sel }, c.nombre));

  anexar(raiz,
    cabecera({ eyebrow: 'Inventario', titulo: 'Inventario por ambiente',
      subtitulo: admin ? 'Cada elemento tiene su pegatina con QR y código de barras. Agrúpalos en familias (PC = monitor + CPU + teclado + mouse) para revisarlos y reportarlos juntos.'
        : 'Escanea la pegatina de un elemento o de una familia para ver su estado y su historial.',
      acciones: [
        h('button', { class: 'btn btn-outline', type: 'button', onclick: () => escanearConsulta() }, icono('escanear'), 'Escanear'),
        admin && h('button', { class: 'btn btn-primary', type: 'button', onclick: () => registroConEscaner() }, icono('qr'), 'Registrar con escáner'),
      ].filter(Boolean) }),
    h('div', { 'data-anim': '' }, selector),
    h('div', { class: 'inv-herramientas', 'data-anim': '' },
      vistas,
      pegatinas,
      admin && h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => cargaMasiva() }, icono('subir'), 'Carga masiva'),
      admin && h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => exportar() }, icono('descargar'), 'Exportar Excel'),
      admin && h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => categoriasAdmin() }, icono('filtro'), 'Categorías'),
      admin && h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => (pestana === 'familias' ? formularioFamilia() : formulario()) }, icono('mas'), 'Nuevo')),
    h('section', { class: 'card', 'data-anim': '' },
      resumen,
      h('div', { class: 'inv-filtros' }, h('div', { class: 'adm-buscar' }, icono('buscar'), buscar), estadoSel, categoriaSel),
      lista));

  function pintarSelector() {
    vaciar(selector, ambientes.map((a) => h('button', {
      class: 'pestana', type: 'button', role: 'tab', 'aria-selected': String(a.id === ambienteId),
      onclick: () => { ambienteId = a.id; recordarUrl(); cargar(); },
    }, h('strong', {}, a.codigo), h('span', { class: 'pestana-sub' }, a.especialidad ? `${a.nombre} · ${a.especialidad}` : a.nombre))));
    vaciar(vistas, [['items', 'Ítems', 'caja'], ['familias', 'Familias', 'capas']].map(([clave, texto, ic]) => h('button', {
      class: 'segmento', type: 'button', role: 'tab', 'aria-selected': String(pestana === clave),
      onclick: () => { pestana = clave; recordarUrl(); pintarSelector(); pintar(true); },
    }, icono(ic), texto, h('span', { class: 'pestana-cuenta' }, clave === 'items' ? items.length : familias.length))));
    pegatinas.href = `#/etiquetas?ambiente=${ambienteId}`;
  }
  const recordarUrl = () => history.replaceState(null, '', `#/inventario?ambiente=${ambienteId}${pestana === 'familias' ? '&ver=familias' : ''}`);

  async function cargar() {
    pintarSelector();
    vaciar(lista, h('li', {}, cargando()));
    try { [items, familias] = await Promise.all([apiAmb.items(ambienteId), apiAmb.familias(ambienteId)]); } catch (e) { vaciar(lista, h('li', {}, tarjetaError(e, cargar))); return; }
    pintarSelector();
    pintar(true);
  }

  function pintar(entrada = false) {
    const enUso = [...new Set(items.map((i) => i.categoria))].sort();
    vaciar(categoriaSel, h('option', { value: '' }, 'Todas las categorías'), enUso.map((c) => h('option', { value: c, selected: c === filtroCategoria }, c)));
    estadoSel.hidden = categoriaSel.hidden = pestana === 'familias';
    if (pestana === 'familias') { pintarFamilias(entrada); return; }

    const cuenta = Object.fromEntries(Object.keys(ESTADOS_ITEM).map((k) => [k, items.filter((i) => i.estado === k).length]));
    vaciar(resumen,
      h('span', {}, h('strong', {}, items.length), ' ítems'),
      Object.entries(ESTADOS_ITEM).filter(([k]) => cuenta[k]).map(([k, [t, c]]) => h('span', { class: `status-chip ${c}` }, `${cuenta[k]} ${t.toLowerCase()}`)));
    const visibles = items.filter((i) => (!filtroEstado || i.estado === filtroEstado) && (!filtroCategoria || i.categoria === filtroCategoria)
      && (!busqueda || [i.nombre, i.codigo, i.serial || '', i.categoria, i.familia?.codigo || '', i.familia?.nombre || ''].some((v) => v.toLowerCase().includes(busqueda))));
    vaciar(lista, visibles.length ? visibles.map((i) => h('li', { class: 'inv-fila' },
      h('button', { class: 'inv-fila-boton', type: 'button', onclick: () => detalle(i), 'aria-label': `${i.nombre}, ${i.codigo}. Ver detalle, pegatina e historial` },
        h('span', { class: 'inv-categoria' }, i.categoria, i.familia && h('span', { class: 'inv-familia' }, icono('capas'), i.familia.codigo)),
        h('strong', {}, i.nombre),
        h('span', { class: 'mono text-muted' }, `${i.codigo}${i.serial ? ` · ${i.serial}` : ''}`)),
      h('div', { class: 'inv-fila-estado' }, chipItem(i.estado), i.novedadActivaId && h('span', { class: 'status-chip out' }, icono('reloj'), 'Novedad en curso')),
      admin && h('div', { class: 'inv-fila-acciones' },
        h('button', { class: 'btn btn-outline btn-sm btn-icono', type: 'button', 'aria-label': `Editar ${i.nombre}`, onclick: () => formulario(i) }, icono('lapiz')),
        h('button', { class: 'btn btn-outline btn-sm btn-icono', type: 'button', 'aria-label': `Borrar ${i.nombre}`, onclick: () => borrar(i) }, icono('basura')))))
      : h('li', {}, vacio('Ningún ítem coincide', busqueda || filtroEstado || filtroCategoria ? 'Cambia la búsqueda o el filtro.' : 'Este ambiente aún no tiene inventario.', 'caja')));
    if (entrada) anim.lista(lista.children, { autoAlpha: 0, y: 6 });
  }

  /* ---------------- familias ---------------- */

  function pintarFamilias(entrada) {
    const conNovedad = familias.filter((f) => f.componentesConNovedad || f.novedadActivaId).length;
    vaciar(resumen, h('span', {}, h('strong', {}, familias.length), ' familias'),
      conNovedad ? h('span', { class: 'status-chip error' }, `${conNovedad} con novedad`) : null,
      h('span', { class: 'text-muted' }, `${items.filter((i) => !i.familiaId).length} ítems sueltos`));
    const visibles = familias.filter((f) => !busqueda || [f.nombre, f.codigo, f.tipo, ...f.componentes.map((c) => `${c.nombre} ${c.codigo}`)].some((v) => v.toLowerCase().includes(busqueda)));
    vaciar(lista, visibles.length ? visibles.map((f) => h('li', { class: 'fam-fila' },
      h('button', { class: 'inv-fila-boton', type: 'button', onclick: () => detalleFamilia(f), 'aria-label': `Familia ${f.nombre}, ${f.codigo}. Ver componentes y pegatina` },
        h('span', { class: 'inv-categoria' }, icono('capas'), `Familia ${f.tipo}`),
        h('strong', {}, f.nombre),
        h('span', { class: 'mono text-muted' }, `${f.codigo} · ${f.componentesTotal} componente(s)`)),
      h('ul', { class: 'fam-componentes', 'aria-label': `Componentes de ${f.nombre}` }, f.componentes.map((c) => h('li', { class: `fam-componente fam-componente--${c.estado}` }, c.nombre))),
      h('div', { class: 'inv-fila-estado' },
        f.novedadActivaId ? h('span', { class: 'status-chip out' }, icono('reloj'), 'Novedad en curso')
          : f.componentesConNovedad ? h('span', { class: 'status-chip error' }, `${f.componentesConNovedad} con novedad`) : h('span', { class: 'status-chip in' }, 'Completa')),
      admin && h('div', { class: 'inv-fila-acciones' },
        h('button', { class: 'btn btn-outline btn-sm btn-icono', type: 'button', 'aria-label': `Editar familia ${f.nombre}`, onclick: () => formularioFamilia(f) }, icono('lapiz')),
        h('button', { class: 'btn btn-outline btn-sm btn-icono', type: 'button', 'aria-label': `Borrar familia ${f.nombre}`, onclick: () => borrarFamilia(f) }, icono('basura')))))
      : h('li', {}, vacio('No hay familias', busqueda ? 'Cambia la búsqueda.' : 'Agrupa los ítems que se revisan juntos: un PC con su monitor, teclado y mouse; una estación de cocina…', 'capas')));
    if (entrada) anim.lista(lista.children, { autoAlpha: 0, y: 6 });
  }

  function detalleFamilia(f) {
    abrirModal({
      titulo: f.nombre, subtitulo: `Familia ${f.tipo} · ${f.codigo} · ambiente ${f.ambiente}`, ancho: 'angosto',
      contenido: h('div', { class: 'inv-detalle' },
        h('div', { class: 'inv-detalle-codigos' }, qr(f.qr, 168, `QR de la familia ${f.nombre}`), codigoBarras(f.codigo)),
        h('p', { class: 'text-muted' }, 'En la revisión, escanear esta pegatina permite reportar la familia completa o uno de sus componentes.'),
        f.novedadActivaId && h('p', { class: 'banner warning' }, icono('reloj'), ' Tiene una novedad permanente en curso',
          estado.usuario.rol !== 'portero' && h('a', { class: 'table-link', href: `#/novedades?id=${f.novedadActivaId}` }, ' · ver novedad')),
        h('h3', { class: 'bloque-titulo' }, `Componentes (${f.componentes.length})`),
        h('ul', { class: 'inv-lista' }, f.componentes.map((c) => h('li', { class: 'inv-fila' },
          h('div', { class: 'inv-fila-datos' }, h('strong', {}, c.nombre), h('span', { class: 'mono text-muted' }, `${c.codigo} · ${c.categoria}`)),
          chipItem(c.estado))))),
      acciones: [
        h('a', { class: 'btn btn-outline', href: `#/etiquetas?familias=${f.id}&de=${f.ambienteId}&motivo=${encodeURIComponent('Reimpresión')}` }, icono('imprimir'), 'Reimprimir pegatina'),
        admin && (({ cerrar }) => h('button', { class: 'btn btn-outline', type: 'button', onclick: () => { cerrar(); formularioFamilia(f); } }, icono('lapiz'), 'Editar')),
      ].filter(Boolean),
    });
  }

  function formularioFamilia(f = null) {
    const amb = ambienteActual();
    const c = (id, etiqueta, input) => h('div', { class: 'campo' }, h('label', { for: id }, etiqueta), input);
    const tipo = h('input', { type: 'text', id: 'fam-tipo', value: f?.tipo || 'PC', maxlength: 40, list: 'fam-tipos' });
    const tipos = h('datalist', { id: 'fam-tipos' }, [...new Set(['PC', 'Estación de cocina', 'Kit de grabación', ...familias.map((x) => x.tipo)])].map((t) => h('option', { value: t })));
    const nombre = h('input', { type: 'text', id: 'fam-nombre', value: f?.nombre || '', maxlength: 120, placeholder: 'PC puesto 5' });
    const codigo = !f && h('input', { type: 'text', id: 'fam-codigo', maxlength: 40, placeholder: 'Vacío = se genera (FAM107-PC05)', class: 'mono', autocomplete: 'off' });
    const elegidos = new Set(f ? f.componentes.map((x) => x.id) : []);
    let filtro = '';
    const buscarComp = h('input', { type: 'search', placeholder: 'Buscar ítems del ambiente', 'aria-label': 'Buscar ítems para la familia', oninput: () => { filtro = buscarComp.value.trim().toLowerCase(); pintarComp(); } });
    const listaComp = h('ul', { class: 'fam-elegir' });
    const cuenta = h('span', { class: 'text-muted' });
    function pintarComp() {
      const candidatos = items.filter((i) => elegidos.has(i.id) || !filtro || `${i.nombre} ${i.codigo} ${i.categoria}`.toLowerCase().includes(filtro));
      vaciar(listaComp, candidatos.map((i) => h('li', {},
        h('label', { class: 'check-linea' },
          h('input', { type: 'checkbox', checked: elegidos.has(i.id), onchange: (e) => { if (e.target.checked) elegidos.add(i.id); else elegidos.delete(i.id); cuenta.textContent = `${elegidos.size} elegido(s)`; } }),
          h('span', {}, h('strong', {}, i.nombre), ' ', h('span', { class: 'mono text-muted' }, i.codigo),
            i.familia && i.familia.id !== f?.id && h('span', { class: 'text-muted' }, ` · ahora en ${i.familia.codigo}`))))));
      cuenta.textContent = `${elegidos.size} elegido(s)`;
    }
    pintarComp();
    const guardar = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => enviar() }, icono('check'), f ? 'Guardar' : 'Crear familia');
    const { cerrar } = abrirModal({
      titulo: f ? `Editar ${f.codigo}` : `Nueva familia · ambiente ${amb.codigo}`,
      subtitulo: 'Una familia agrupa ítems que se revisan y reportan juntos. Un ítem solo puede estar en una familia.',
      contenido: h('form', { class: 'form-grid', novalidate: true, onsubmit: (e) => { e.preventDefault(); enviar(); } },
        c('fam-tipo', 'Tipo', tipo), tipos, c('fam-nombre', 'Nombre', nombre),
        codigo && h('div', { class: 'full' }, c('fam-codigo', 'Código de la pegatina (opcional)', codigo)),
        h('div', { class: 'full campo' }, h('div', { class: 'adm-bloque-cabecera' }, h('label', {}, 'Componentes'), cuenta),
          h('div', { class: 'adm-buscar' }, icono('buscar'), buscarComp), listaComp)),
      acciones: [({ cerrar: x }) => h('button', { class: 'btn btn-outline', type: 'button', onclick: () => x() }, 'Cancelar'), guardar],
    });
    async function enviar() {
      errorCampo(tipo, tipo.value.trim() ? null : 'Escribe el tipo (PC, Estación de cocina…).');
      errorCampo(nombre, nombre.value.trim().length >= 2 ? null : 'Escribe el nombre.');
      if (!tipo.value.trim() || nombre.value.trim().length < 2) return;
      const datos = { tipo: tipo.value.trim(), nombre: nombre.value.trim(), itemIds: [...elegidos] };
      if (codigo?.value.trim()) datos.codigo = codigo.value.trim();
      guardar.disabled = true;
      try {
        const r = f ? await apiAmb.editarFamilia(f.id, datos) : await apiAmb.crearFamilia({ ...datos, ambienteId });
        toast('exito', f ? 'Familia actualizada' : 'Familia creada', `${r.codigo} · ${r.componentesTotal} componente(s)`);
        cerrar();
        pestana = 'familias';
        cargar();
      } catch (e) { toast('error', 'No se guardó', e.message); guardar.disabled = false; }
    }
  }

  async function borrarFamilia(f) {
    if (!await confirmar({ titulo: `¿Borrar la familia ${f.nombre}?`, mensaje: `${f.codigo}. Sus ${f.componentesTotal} componente(s) quedan como ítems sueltos. Si tiene novedades reportadas no se puede borrar.`, textoAceptar: 'Borrar', peligro: true })) return;
    try { await apiAmb.borrarFamilia(f.id); toast('exito', 'Familia borrada'); cargar(); } catch (e) { toast('error', 'No se borró', e.message); }
  }

  function categoriasAdmin() {
    gestionarCatalogo({
      titulo: 'Categorías del inventario', subtitulo: 'Inmuebles, Mobiliario, Electrodomésticos, Equipos Informáticos, Periféricos…',
      singular: 'categoría', usados: 'ítem(s)',
      listar: () => apiAmb.categorias(true), crear: apiAmb.crearCategoria, editar: apiAmb.editarCategoria, borrar: apiAmb.borrarCategoria,
      alCambiar: async () => { categorias = await apiAmb.categorias(); cargar(); },
    });
  }

  /* ---------------- detalle: pegatina, reimpresión e historial ---------------- */

  function detalle(i) {
    const historial = h('ol', { class: 'historial' }, h('li', {}, cargando()));
    apiAmb.historialItem(i.id).then((filas) => vaciar(historial, filas.length ? filas.map((x) => {
      const [titulo, ic] = ACCIONES_HISTORIAL[x.accion] || [x.accion, 'reloj'];
      return h('li', { class: `historial-fila historial-fila--${x.accion}` },
        h('span', { class: 'historial-icono', 'aria-hidden': 'true' }, icono(ic)),
        h('div', {},
          h('strong', {}, titulo),
          h('span', {}, x.detalle),
          h('span', { class: 'text-muted' }, `${fecha.corta(x.fecha)} · ${x.usuario || 'Sistema'}`),
          x.inspeccionId && h('a', { class: 'table-link', href: `#/planilla?id=${x.inspeccionId}` }, 'Ver planilla'),
          estado.usuario.rol !== 'portero' && x.novedadId && h('a', { class: 'table-link', href: `#/novedades?id=${x.novedadId}` }, 'Ver novedad')));
    }) : h('li', { class: 'text-muted' }, 'Sin movimientos.'))).catch((e) => vaciar(historial, h('li', { class: 'text-muted' }, e.message)));

    abrirModal({
      titulo: i.nombre, subtitulo: `${i.codigo} · ambiente ${i.ambiente}`, ancho: 'angosto',
      contenido: h('div', { class: 'inv-detalle' },
        h('div', { class: 'inv-detalle-codigos' }, qr(i.qr, 168, `QR de ${i.nombre}`), codigoBarras(i.codigo)),
        i.novedadActivaId && h('p', { class: 'banner warning' }, icono('reloj'), ' Tiene una novedad permanente en curso',
          estado.usuario.rol !== 'portero' && h('a', { class: 'table-link', href: `#/novedades?id=${i.novedadActivaId}` }, ' · ver novedad')),
        h('dl', { class: 'detalle-datos' },
          h('dt', {}, 'Estado'), h('dd', {}, chipItem(i.estado)),
          h('dt', {}, 'Categoría'), h('dd', {}, i.categoria),
          h('dt', {}, 'Familia'), h('dd', {}, i.familia ? `${i.familia.nombre} · ${i.familia.codigo}` : 'Ítem suelto'),
          h('dt', {}, 'Contenido del QR'), h('dd', { class: 'mono' }, i.qr),
          h('dt', {}, 'Serial'), h('dd', { class: 'mono' }, i.serial || '—'),
          h('dt', {}, 'Actualizado'), h('dd', {}, fecha.corta(i.actualizadoEn))),
        h('h3', { class: 'bloque-titulo' }, 'Trazabilidad'),
        historial),
      acciones: [
        h('a', { class: 'btn btn-outline', href: `#/etiquetas?items=${i.id}&de=${i.ambienteId}&motivo=${encodeURIComponent('Reimpresión')}` }, icono('imprimir'), 'Reimprimir pegatina'),
        admin && (({ cerrar }) => h('button', { class: 'btn btn-outline', type: 'button', onclick: () => { cerrar(); formulario(i); } }, icono('lapiz'), 'Editar')),
      ].filter(Boolean),
    });
  }

  /* ---------------- escanear para consultar (ítem o familia) ---------------- */

  function escanearConsulta() {
    let escaner;
    const { cerrar } = abrirModal({
      titulo: 'Escanear pegatina', subtitulo: 'QR o código de barras de un elemento o de una familia. También funciona con un lector USB.', ancho: 'angosto',
      contenido: () => {
        escaner = crearEscaner({
          tipos: ['qr', 'barras'], etiqueta: 'Abrir cámara', placeholder: 'Código de la pegatina',
          alLeer: async (texto) => {
            try {
              const r = await apiAmb.buscarEscaneado(texto);
              cerrar();
              const ambLeido = r.tipo === 'item' ? r.item.ambienteId : r.familia.ambienteId;
              if (ambLeido !== ambienteId) { ambienteId = ambLeido; recordarUrl(); await cargar(); }
              if (r.tipo === 'item') detalle(r.item); else detalleFamilia(r.familia);
            } catch (e) {
              if (e.status !== 404) { toast('error', 'No se pudo consultar', e.message); return; }
              cerrar();
              const codigo = leerQrItem(texto);
              if (!admin) { toast('aviso', `${codigo || texto.slice(0, 40)} no está registrado`, 'Pide a almacén que lo registre en el inventario.'); return; }
              if (await confirmar({ titulo: `${codigo || 'Ese código'} no está registrado`, mensaje: `¿Lo registras en el ambiente ${ambienteActual().codigo}?`, textoAceptar: 'Registrar' })) {
                formulario(null, codigo ? { codigo } : { qr: texto.trim() });
              }
            }
          },
        });
        return escaner.el;
      },
      alCerrar: () => escaner?.detener(),
    });
  }

  /* ---------------- registro con escáner (continuo): crea o actualiza ---------------- */

  function registroConEscaner() {
    let escaner, ocupado = false, registrados = 0, actualizados = 0;
    const ambSel = h('select', { id: 'reg-amb', onchange: () => cargarFamiliasReg() },
      ambientes.filter((a) => a.activo).map((a) => h('option', { value: a.id, selected: a.id === ambienteId }, `${a.codigo} · ${a.nombre}`)));
    const nombre = h('input', { type: 'text', id: 'reg-nombre', value: 'Silla', maxlength: 100 });
    const categoria = h('select', { id: 'reg-cat' }, opcionesCategoria(categorias.find((c) => c.nombre === 'Mobiliario')?.id));
    const familiaSel = h('select', { id: 'reg-fam' }, h('option', { value: '' }, 'Sin familia'));
    const numerar = h('input', { type: 'checkbox', checked: true });
    const leidos = h('ul', { class: 'registro-lista', 'aria-live': 'polite' });
    const contador = h('span', { class: 'text-muted' }, 'Aún no has escaneado pegatinas.');
    const campo = (id, etiqueta, input) => h('div', { class: 'campo' }, h('label', { for: id }, etiqueta), input);

    async function cargarFamiliasReg() {
      const ambId = Number(ambSel.value);
      let delAmbiente = ambId === ambienteId ? familias : [];
      if (ambId !== ambienteId) { try { delAmbiente = await apiAmb.familias(ambId); } catch { delAmbiente = []; } }
      vaciar(familiaSel, h('option', { value: '' }, 'Sin familia'), delAmbiente.map((f) => h('option', { value: f.id }, `${f.codigo} · ${f.nombre}`)));
    }
    cargarFamiliasReg();

    // Siguiente número para "Silla #N" según lo que ya hay en el ambiente.
    async function siguienteNombre(ambId) {
      const base = nombre.value.trim();
      if (!numerar.checked) return base;
      const existentes = ambId === ambienteId ? items : await apiAmb.items(ambId);
      const patron = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} #(\\d+)$`, 'i');
      const max = existentes.reduce((m, i) => Math.max(m, Number(patron.exec(i.nombre)?.[1] || 0)), 0);
      return `${base} #${max + 1}`;
    }

    async function registrar(texto) {
      if (ocupado || !texto.trim()) return;
      if (nombre.value.trim().length < 2) { errorCampo(nombre, 'Escribe el nombre base (p. ej. Silla).'); nombre.focus(); return; }
      ocupado = true;
      const ambId = Number(ambSel.value);
      try {
        // Lo leído va tal cual: el servidor reconoce SENA-INV:…, el código solo o un QR de otro sistema.
        const r = await apiAmb.registrarPorEscaneo({
          codigo: texto.trim(), ambienteId: ambId, nombre: await siguienteNombre(ambId), categoriaId: Number(categoria.value), familiaId: familiaSel.value || null,
        });
        if (r.creado) registrados++; else if (r.actualizado) actualizados++;
        if (ambId === ambienteId) items = [...items.filter((i) => i.id !== r.item.id), r.item];
        const tipo = r.creado ? 'nuevo' : r.actualizado ? 'otro' : 'existe';
        leidos.prepend(h('li', { class: `registro-fila registro-fila--${tipo}` },
          h('span', { class: 'registro-icono', 'aria-hidden': 'true' }, icono(tipo === 'existe' ? 'alerta' : 'check')),
          h('div', {},
            h('strong', {}, `${r.item.nombre} · ${r.item.codigo}`),
            h('span', {}, r.creado ? `Registrado en el ambiente ${r.item.ambiente}${r.item.familia ? ` · ${r.item.familia.codigo}` : ''}`
              : r.actualizado ? `Actualizado: ${r.cambios.join(' · ')}` : 'Ya estaba registrado aquí; se anotó el escaneo')),
          h('a', { class: 'btn btn-outline btn-sm', href: `#/etiquetas?items=${r.item.id}&de=${r.item.ambienteId}&motivo=${encodeURIComponent('Reimpresión al registrar')}`, target: '_blank' }, icono('imprimir'), 'Pegatina')));
        anim.lista([leidos.firstChild], { autoAlpha: 0, x: -8 });
        contador.textContent = `${registrados} registrado(s) y ${actualizados} actualizado(s) en esta sesión`;
      } catch (e) { toast('error', 'No se registró', e.message); }
      ocupado = false;
    }

    abrirModal({
      titulo: 'Registrar con escáner',
      subtitulo: 'Cada pegatina que leas (cámara o lector USB) se registra al instante; si ya existía, se actualiza (se traslada a este ambiente y a la familia elegida).',
      contenido: () => {
        escaner = crearEscaner({ tipos: ['qr', 'barras'], etiqueta: 'Escanear con la cámara', placeholder: 'Lector USB o escribe el código', continuo: true, alLeer: registrar });
        setTimeout(() => escaner.enfocar(), 300);
        return h('div', { class: 'registro-escaner' },
          h('div', { class: 'form-grid' },
            h('div', { class: 'full' }, campo('reg-amb', 'Ambiente', ambSel)),
            campo('reg-nombre', 'Nombre base', nombre), campo('reg-cat', 'Categoría', categoria),
            h('div', { class: 'full' }, campo('reg-fam', 'Familia (opcional)', familiaSel)),
            h('label', { class: 'full check-linea' }, numerar, 'Numerar automáticamente (Silla #1, Silla #2…)')),
          escaner.el,
          h('div', { class: 'adm-bloque-cabecera' }, h('h3', { class: 'bloque-titulo' }, 'Leídos'), contador),
          leidos);
      },
      alCerrar: () => { escaner?.detener(); if (registrados || actualizados) cargar(); },
    });
  }

  /* ---------------- carga masiva (Excel / CSV) ---------------- */

  function cargaMasiva() {
    let archivo = null;
    const entrada = h('input', { type: 'file', id: 'carga-archivo', accept: '.xlsx,.xls,.ods,.csv', onchange: () => elegir(entrada.files[0]) });
    const resultado = h('div', { class: 'carga-resultado', 'aria-live': 'polite' });
    const cargarBtn = h('button', { class: 'btn btn-primary', type: 'button', disabled: true, onclick: () => enviar(false) }, icono('subir'), 'Cargar');

    const { cerrar } = abrirModal({
      titulo: 'Carga masiva del inventario',
      subtitulo: 'Sube un Excel (.xlsx) o CSV. Primero verás una vista previa; nada se guarda hasta que confirmes.',
      contenido: h('div', { class: 'carga' },
        h('ol', { class: 'carga-pasos' },
          h('li', {}, 'Descarga la plantilla (es el inventario actual en Excel) o usa tu propio archivo con los títulos ',
            h('code', {}, 'ambiente, codigo, nombre, categoria, serial, estado, familia, familia_nombre, familia_tipo, qr'), '.'),
          h('li', {}, 'Una fila por elemento. La categoría debe existir (', categorias.filter((c) => c.activo).map((c) => c.nombre).join(', '), '). Si el código ya existe, se actualiza; si lo dejas vacío, se genera (AMB107-021).'),
          h('li', {}, 'Familia: código de la familia (FAM107-PC01). Si no existe se crea con familia_nombre y familia_tipo. qr: lo que trae el QR de la pegatina (vacío = SENA-INV:<código>).'),
          h('li', {}, 'Sube el archivo, revisa la vista previa y confirma.')),
        h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => exportar() }, icono('descargar'), `Descargar plantilla (ambiente ${ambienteActual().codigo})`),
        h('div', { class: 'campo' }, h('label', { for: 'carga-archivo' }, 'Archivo'), entrada),
        resultado),
      acciones: [({ cerrar: c }) => h('button', { class: 'btn btn-outline', type: 'button', onclick: () => c() }, 'Cancelar'), cargarBtn],
    });

    function elegir(f) {
      if (!f) return;
      if (f.size > 5 * 1024 * 1024) { errorCampo(entrada, 'El archivo supera 5 MB.'); return; }
      errorCampo(entrada, null);
      const lector = new FileReader();
      lector.onload = () => { archivo = { nombre: f.name, archivo: lector.result }; enviar(true); };
      lector.readAsDataURL(f);
    }

    async function enviar(simular) {
      if (!archivo) return;
      cargarBtn.disabled = true;
      vaciar(resultado, cargando(simular ? 'Leyendo el archivo…' : 'Cargando…'));
      let r;
      try { r = await apiAmb.cargaMasiva({ ...archivo, simular }); } catch (e) {
        vaciar(resultado, h('div', { class: 'banner error' }, e.message));
        return;
      }
      if (!simular) {
        cerrar();
        toast('exito', 'Inventario cargado', `${r.nuevos} nuevos, ${r.actualizados} actualizados${r.familiasNuevas ? `, ${r.familiasNuevas} familias nuevas` : ''}${r.errores.length ? `, ${r.errores.length} filas omitidas por error` : ''}.`, 7000);
        cargar();
        return;
      }
      const validas = r.nuevos + r.actualizados;
      const cifra = (n, t, c) => h('div', { class: `carga-cifra carga-cifra--${c}` }, h('strong', {}, n), h('span', {}, t));
      const ACCION = { nuevo: ['Nuevo', 'in'], actualizado: ['Actualiza', 'azul'], sin_cambios: ['Sin cambios', 'neutro'] };
      vaciar(resultado,
        h('div', { class: 'carga-cifras' }, cifra(r.nuevos, 'nuevos', 'nuevo'), cifra(r.actualizados, 'actualizados', 'actualiza'),
          cifra(r.familiasNuevas, 'familias nuevas', 'nuevo'), cifra(r.sinCambios, 'sin cambios', 'igual'), cifra(r.errores.length, 'con error', 'error')),
        r.errores.length ? h('div', { class: 'banner error carga-errores' },
          h('strong', {}, 'Estas filas no se cargarán:'),
          h('ul', {}, r.errores.slice(0, 50).map((e) => h('li', {}, `Fila ${e.fila}: ${e.mensaje}`)))) : null,
        r.filas.length ? h('div', { class: 'table-wrap' }, h('table', {},
          h('thead', {}, h('tr', {}, ['Fila', 'Código', 'Nombre', 'Categoría', 'Familia', 'Ambiente', ''].map((t) => h('th', {}, t)))),
          h('tbody', {}, r.filas.slice(0, 100).map((f) => h('tr', {},
            h('td', {}, f.fila), h('td', { class: 'mono' }, f.codigo || '(se genera)'), h('td', {}, f.nombre), h('td', {}, f.categoria),
            h('td', { class: 'mono' }, f.familia || '—'), h('td', {}, f.ambiente),
            h('td', {}, h('span', { class: `status-chip ${ACCION[f.accion][1]}` }, ACCION[f.accion][0]))))))) : null);
      cargarBtn.disabled = !validas;
      cargarBtn.lastChild.textContent = validas ? `Cargar ${validas} fila(s)` : 'Nada para cargar';
    }
  }

  async function exportar() {
    try { const nombre = await apiAmb.exportarInventario(ambienteId); toast('exito', 'Excel descargado', nombre); } catch (e) { toast('error', 'No se exportó', e.message); }
  }

  /* ---------------- crear / editar / borrar ---------------- */

  /** @param leido {codigo} o {qr} de una pegatina escaneada que no estaba registrada. */
  function formulario(i = null, leido = {}) {
    const amb = ambienteActual();
    const c = (id, etiqueta, input) => h('div', { class: 'campo' }, h('label', { for: id }, etiqueta), input);
    const codigo = h('input', { type: 'text', id: 'it-codigo', value: leido.codigo || '', maxlength: 40, placeholder: 'Vacío = se genera', autocomplete: 'off', class: 'mono' });
    const qrInput = h('input', { type: 'text', id: 'it-qr', value: i?.qr || leido.qr || '', maxlength: 120, placeholder: 'Vacío = SENA-INV:<código>', autocomplete: 'off', class: 'mono' });
    const nombre = h('input', { type: 'text', id: 'it-nombre', value: i?.nombre || '', maxlength: 120 });
    const categoria = h('select', { id: 'it-cat' }, h('option', { value: '' }, 'Elige una categoría'), opcionesCategoria(i?.categoriaId));
    const familia = h('select', { id: 'it-fam' }, h('option', { value: '' }, 'Ítem suelto (sin familia)'),
      familias.map((f) => h('option', { value: f.id, selected: f.id === i?.familiaId }, `${f.codigo} · ${f.nombre}`)));
    const serial = h('input', { type: 'text', id: 'it-serial', value: i?.serial || '', maxlength: 60 });
    const estadoIt = h('select', { id: 'it-estado' }, Object.entries(ESTADOS_ITEM).map(([k, [t]]) => h('option', { value: k, selected: k === (i?.estado || 'operativo') }, t)));
    const guardar = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => enviar() }, icono('check'), i ? 'Guardar' : 'Agregar ítem');
    const { cerrar } = abrirModal({
      titulo: i ? `Editar ${i.codigo}` : `Nuevo ítem · ambiente ${amb.codigo}`,
      subtitulo: i ? '' : 'Escribe el código de la pegatina que ya tiene el elemento, o déjalo vacío para generar uno.',
      contenido: h('form', { class: 'form-grid', novalidate: true, onsubmit: (e) => { e.preventDefault(); enviar(); } },
        !i && h('div', { class: 'full' }, c('it-codigo', 'Código (código de barras)', codigo)),
        h('div', { class: 'full' }, c('it-qr', 'Contenido del QR (opcional, p. ej. una placa anterior)', qrInput)),
        h('div', { class: 'full' }, c('it-nombre', 'Nombre', nombre)), c('it-cat', 'Categoría', categoria), c('it-serial', 'Serial (opcional)', serial),
        c('it-fam', 'Familia', familia), c('it-estado', 'Estado', estadoIt)),
      acciones: [({ cerrar: x }) => h('button', { class: 'btn btn-outline', type: 'button', onclick: () => x() }, 'Cancelar'), guardar],
    });
    async function enviar() {
      const cod = codigo.value.trim();
      errorCampo(codigo, !cod || leerQrItem(cod) ? null : 'Solo letras, números y guiones (3 a 40).');
      errorCampo(nombre, nombre.value.trim().length >= 3 ? null : 'Escribe el nombre del ítem.');
      errorCampo(categoria, categoria.value ? null : 'Elige la categoría.');
      if ((cod && !leerQrItem(cod)) || nombre.value.trim().length < 3 || !categoria.value) return;
      const datos = {
        ambienteId, nombre: nombre.value.trim(), categoriaId: Number(categoria.value), familiaId: familia.value ? Number(familia.value) : null,
        serial: serial.value.trim(), estado: estadoIt.value, qr: qrInput.value.trim(),
      };
      if (!i && cod) datos.codigo = leerQrItem(cod);
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
    if (!await confirmar({ titulo: `¿Borrar ${i.nombre}?`, mensaje: `${i.codigo}. Si ya tiene novedades reportadas no se puede borrar: márcalo "De baja (inactivo)".`, textoAceptar: 'Borrar', peligro: true })) return;
    try { await apiAmb.borrarItem(i.id); toast('exito', 'Ítem borrado'); cargar(); } catch (e) { toast('error', 'No se borró', e.message); }
  }

  await cargar();
  anim.entrarVista(raiz);
}
