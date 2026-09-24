// Inventario por ambiente (backend real). Cada ítem tiene una pegatina con
// QR y código de barras.
//  · Todo el personal: consultar, "Escanear" una pegatina para ver el ítem,
//    su trazabilidad y reimprimir la pegatina.
//  · Administrativo: crear, editar y borrar; "Registrar con escáner" (cada
//    código leído se registra al instante); "Carga masiva" desde Excel/CSV
//    con vista previa; exportar a Excel.
import { h, anexar, icono, vaciar, errorCampo } from '../ui/dom.js';
import { anim } from '../ui/anim.js';
import { toast, abrirModal, confirmar } from '../ui/avisos.js';
import { cargando, tarjetaError } from '../ui/componentes.js';
import { crearEscaner } from '../ui/escaner.js';
import { cabecera, chipItem, qr, codigoBarras, vacio, fecha } from '../ui/ambientes-ui.js';
import { apiAmb } from '../api/ambientes.js';
import { estado } from '../estado.js';
import { ESTADOS_ITEM, leerQrItem } from '../reglas.js';

const CATEGORIAS = ['Cómputo', 'Audiovisual', 'Redes', 'Mobiliario', 'Infraestructura', 'Laboratorio', 'Herramientas', 'Seguridad'];
const ACCIONES_HISTORIAL = {
  registro: ['Registro', 'mas'], carga_masiva: ['Carga masiva', 'subir'], escaneo: ['Registro por escáner', 'escanear'],
  edicion: ['Edición', 'lapiz'], etiqueta: ['Pegatina', 'imprimir'], dano: ['Daño reportado', 'alerta'], dano_retirado: ['Daño retirado', 'reintentar'],
};

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
  const pegatinas = h('a', { class: 'btn btn-outline btn-sm' }, icono('imprimir'), 'Pegatinas');
  const ambienteActual = () => ambientes.find((a) => a.id === ambienteId);

  anexar(raiz,
    cabecera({ eyebrow: 'Inventario', titulo: 'Inventario por ambiente',
      subtitulo: admin ? 'Cada elemento tiene su pegatina con QR y código de barras. Regístralos uno a uno, escaneando o con carga masiva.'
        : 'Escanea la pegatina de un elemento para ver su estado y su historial.',
      acciones: [
        h('button', { class: 'btn btn-outline', type: 'button', onclick: () => escanearConsulta() }, icono('escanear'), 'Escanear'),
        admin && h('button', { class: 'btn btn-primary', type: 'button', onclick: () => registroConEscaner() }, icono('qr'), 'Registrar con escáner'),
      ].filter(Boolean) }),
    h('div', { 'data-anim': '' }, selector),
    h('div', { class: 'inv-herramientas', 'data-anim': '' },
      pegatinas,
      admin && h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => cargaMasiva() }, icono('subir'), 'Carga masiva'),
      admin && h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => exportar() }, icono('descargar'), 'Exportar Excel'),
      admin && h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => formulario() }, icono('mas'), 'Nuevo ítem')),
    h('section', { class: 'card', 'data-anim': '' },
      resumen,
      h('div', { class: 'inv-filtros' }, h('div', { class: 'adm-buscar' }, icono('buscar'), buscar), estadoSel),
      lista));

  function pintarSelector() {
    vaciar(selector, ambientes.map((a) => h('button', {
      class: 'pestana', type: 'button', role: 'tab', 'aria-selected': String(a.id === ambienteId),
      onclick: () => { ambienteId = a.id; history.replaceState(null, '', `#/inventario?ambiente=${a.id}`); cargar(); },
    }, h('strong', {}, a.codigo), h('span', { class: 'pestana-sub' }, a.nombre))));
    pegatinas.href = `#/etiquetas?ambiente=${ambienteId}`;
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
      h('button', { class: 'inv-fila-boton', type: 'button', onclick: () => detalle(i), 'aria-label': `${i.nombre}, ${i.codigo}. Ver detalle, pegatina e historial` },
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
          x.inspeccionId && h('a', { class: 'table-link', href: `#/planilla?id=${x.inspeccionId}` }, 'Ver planilla')));
    }) : h('li', { class: 'text-muted' }, 'Sin movimientos.'))).catch((e) => vaciar(historial, h('li', { class: 'text-muted' }, e.message)));

    abrirModal({
      titulo: i.nombre, subtitulo: `${i.codigo} · ambiente ${i.ambiente}`, ancho: 'angosto',
      contenido: h('div', { class: 'inv-detalle' },
        h('div', { class: 'inv-detalle-codigos' }, qr(i.qr, 168, `QR de ${i.nombre}`), codigoBarras(i.codigo)),
        h('dl', { class: 'detalle-datos' },
          h('dt', {}, 'Estado'), h('dd', {}, chipItem(i.estado)),
          h('dt', {}, 'Categoría'), h('dd', {}, i.categoria),
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

  /* ---------------- escanear para consultar ---------------- */

  function escanearConsulta() {
    let escaner;
    const { cerrar } = abrirModal({
      titulo: 'Escanear pegatina', subtitulo: 'QR o código de barras del elemento. También funciona con un lector USB.', ancho: 'angosto',
      contenido: () => {
        escaner = crearEscaner({
          tipos: ['qr', 'barras'], etiqueta: 'Abrir cámara', placeholder: 'Código de la pegatina',
          alLeer: async (texto) => {
            const codigo = leerQrItem(texto);
            if (!codigo) { toast('error', 'Ese código no es de una pegatina del inventario', texto.slice(0, 60)); return; }
            try {
              const it = await apiAmb.itemPorCodigo(codigo);
              cerrar();
              if (it.ambienteId !== ambienteId) { ambienteId = it.ambienteId; await cargar(); }
              detalle(it);
            } catch (e) {
              if (e.status !== 404) { toast('error', 'No se pudo consultar', e.message); return; }
              cerrar();
              if (!admin) { toast('aviso', `${codigo} no está registrado`, 'Pide a coordinación que lo registre en el inventario.'); return; }
              if (await confirmar({ titulo: `${codigo} no está registrado`, mensaje: `¿Lo registras en el ambiente ${ambienteActual().codigo}?`, textoAceptar: 'Registrar' })) formulario(null, codigo);
            }
          },
        });
        return escaner.el;
      },
      alCerrar: () => escaner?.detener(),
    });
  }

  /* ---------------- registro con escáner (continuo) ---------------- */

  function registroConEscaner() {
    let escaner, ocupado = false, registrados = 0;
    const ambSel = h('select', { id: 'reg-amb' }, ambientes.filter((a) => a.activo).map((a) => h('option', { value: a.id, selected: a.id === ambienteId }, `${a.codigo} · ${a.nombre}`)));
    const nombre = h('input', { type: 'text', id: 'reg-nombre', value: 'Silla', maxlength: 100 });
    const categoria = h('select', { id: 'reg-cat' }, CATEGORIAS.map((c) => h('option', { value: c, selected: c === 'Mobiliario' }, c)));
    const numerar = h('input', { type: 'checkbox', checked: true });
    const leidos = h('ul', { class: 'registro-lista', 'aria-live': 'polite' });
    const contador = h('span', { class: 'text-muted' }, 'Aún no has escaneado pegatinas.');
    const campo = (id, etiqueta, input) => h('div', { class: 'campo' }, h('label', { for: id }, etiqueta), input);

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
      if (ocupado) return;
      const codigo = leerQrItem(texto);
      if (!codigo) { toast('error', 'Código no válido', 'Solo letras, números y guiones (3 a 40).'); return; }
      if (nombre.value.trim().length < 2) { errorCampo(nombre, 'Escribe el nombre base (p. ej. Silla).'); nombre.focus(); return; }
      ocupado = true;
      const ambId = Number(ambSel.value);
      try {
        const r = await apiAmb.registrarPorEscaneo({ codigo, ambienteId: ambId, nombre: await siguienteNombre(ambId), categoria: categoria.value });
        if (r.creado) {
          registrados++;
          if (ambId === ambienteId) items = [...items, r.item];
        }
        const tipo = r.creado ? 'nuevo' : r.otroAmbiente ? 'otro' : 'existe';
        leidos.prepend(h('li', { class: `registro-fila registro-fila--${tipo}` },
          h('span', { class: 'registro-icono', 'aria-hidden': 'true' }, icono(tipo === 'nuevo' ? 'check' : 'alerta')),
          h('div', {},
            h('strong', {}, `${r.item.nombre} · ${r.item.codigo}`),
            h('span', {}, tipo === 'nuevo' ? `Registrado en el ambiente ${r.item.ambiente}`
              : tipo === 'otro' ? `Ya estaba registrado en el ambiente ${r.item.ambiente}` : 'Ya estaba registrado')),
          h('a', { class: 'btn btn-outline btn-sm', href: `#/etiquetas?items=${r.item.id}&de=${r.item.ambienteId}&motivo=${encodeURIComponent('Reimpresión al registrar')}`, target: '_blank' }, icono('imprimir'), 'Pegatina')));
        anim.lista([leidos.firstChild], { autoAlpha: 0, x: -8 });
        contador.textContent = `${registrados} registrado(s) en esta sesión`;
      } catch (e) { toast('error', 'No se registró', e.message); }
      ocupado = false;
    }

    abrirModal({
      titulo: 'Registrar con escáner',
      subtitulo: 'Cada pegatina que leas (cámara o lector USB) se registra al instante con estos datos.',
      contenido: () => {
        escaner = crearEscaner({ tipos: ['qr', 'barras'], etiqueta: 'Escanear con la cámara', placeholder: 'Lector USB o escribe el código', continuo: true, alLeer: registrar });
        setTimeout(() => escaner.enfocar(), 300);
        return h('div', { class: 'registro-escaner' },
          h('div', { class: 'form-grid' },
            h('div', { class: 'full' }, campo('reg-amb', 'Ambiente', ambSel)),
            campo('reg-nombre', 'Nombre base', nombre), campo('reg-cat', 'Categoría', categoria),
            h('label', { class: 'full check-linea' }, numerar, 'Numerar automáticamente (Silla #1, Silla #2…)')),
          escaner.el,
          h('div', { class: 'adm-bloque-cabecera' }, h('h3', { class: 'bloque-titulo' }, 'Leídos'), contador),
          leidos);
      },
      alCerrar: () => { escaner?.detener(); if (registrados) cargar(); },
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
            h('code', {}, 'ambiente, codigo, nombre, categoria, serial, estado'), '.'),
          h('li', {}, 'Una fila por elemento. Si el código ya existe, se actualiza; si lo dejas vacío, se genera (AMB107-021).'),
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
        toast('exito', 'Inventario cargado', `${r.nuevos} nuevos, ${r.actualizados} actualizados${r.errores.length ? `, ${r.errores.length} filas omitidas por error` : ''}.`, 7000);
        cargar();
        return;
      }
      const validas = r.nuevos + r.actualizados;
      const cifra = (n, t, c) => h('div', { class: `carga-cifra carga-cifra--${c}` }, h('strong', {}, n), h('span', {}, t));
      const ACCION = { nuevo: ['Nuevo', 'in'], actualizado: ['Actualiza', 'azul'], sin_cambios: ['Sin cambios', 'neutro'] };
      vaciar(resultado,
        h('div', { class: 'carga-cifras' }, cifra(r.nuevos, 'nuevos', 'nuevo'), cifra(r.actualizados, 'actualizados', 'actualiza'),
          cifra(r.sinCambios, 'sin cambios', 'igual'), cifra(r.errores.length, 'con error', 'error')),
        r.errores.length ? h('div', { class: 'banner error carga-errores' },
          h('strong', {}, 'Estas filas no se cargarán:'),
          h('ul', {}, r.errores.slice(0, 50).map((e) => h('li', {}, `Fila ${e.fila}: ${e.mensaje}`)))) : null,
        r.filas.length ? h('div', { class: 'table-wrap' }, h('table', {},
          h('thead', {}, h('tr', {}, ['Fila', 'Código', 'Nombre', 'Ambiente', ''].map((t) => h('th', {}, t)))),
          h('tbody', {}, r.filas.slice(0, 100).map((f) => h('tr', {},
            h('td', {}, f.fila), h('td', { class: 'mono' }, f.codigo || '(se genera)'), h('td', {}, f.nombre), h('td', {}, f.ambiente),
            h('td', {}, h('span', { class: `status-chip ${ACCION[f.accion][1]}` }, ACCION[f.accion][0]))))))) : null);
      cargarBtn.disabled = !validas;
      cargarBtn.lastChild.textContent = validas ? `Cargar ${validas} fila(s)` : 'Nada para cargar';
    }
  }

  async function exportar() {
    try { const nombre = await apiAmb.exportarInventario(ambienteId); toast('exito', 'Excel descargado', nombre); } catch (e) { toast('error', 'No se exportó', e.message); }
  }

  /* ---------------- crear / editar / borrar ---------------- */

  function formulario(i = null, codigoLeido = '') {
    const amb = ambienteActual();
    const c = (id, etiqueta, input) => h('div', { class: 'campo' }, h('label', { for: id }, etiqueta), input);
    const codigo = h('input', { type: 'text', id: 'it-codigo', value: codigoLeido, maxlength: 40, placeholder: 'Vacío = se genera', autocomplete: 'off', class: 'mono' });
    const nombre = h('input', { type: 'text', id: 'it-nombre', value: i?.nombre || '', maxlength: 120 });
    const categoria = h('select', { id: 'it-cat' }, h('option', { value: '' }, 'Elige una categoría'),
      [...new Set([...CATEGORIAS, i?.categoria].filter(Boolean))].map((x) => h('option', { value: x, selected: x === i?.categoria }, x)));
    const serial = h('input', { type: 'text', id: 'it-serial', value: i?.serial || '', maxlength: 60 });
    const estadoIt = h('select', { id: 'it-estado' }, Object.entries(ESTADOS_ITEM).map(([k, [t]]) => h('option', { value: k, selected: k === (i?.estado || 'operativo') }, t)));
    const guardar = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => enviar() }, icono('check'), i ? 'Guardar' : 'Agregar ítem');
    const { cerrar } = abrirModal({
      titulo: i ? `Editar ${i.codigo}` : `Nuevo ítem · ambiente ${amb.codigo}`,
      subtitulo: i ? '' : 'Escribe el código de la pegatina que ya tiene el elemento, o déjalo vacío para generar uno.',
      contenido: h('form', { class: 'form-grid', novalidate: true, onsubmit: (e) => { e.preventDefault(); enviar(); } },
        !i && h('div', { class: 'full' }, c('it-codigo', 'Código (QR / código de barras)', codigo)),
        h('div', { class: 'full' }, c('it-nombre', 'Nombre', nombre)), c('it-cat', 'Categoría', categoria), c('it-serial', 'Serial (opcional)', serial),
        h('div', { class: 'full' }, c('it-estado', 'Estado', estadoIt))),
      acciones: [({ cerrar: x }) => h('button', { class: 'btn btn-outline', type: 'button', onclick: () => x() }, 'Cancelar'), guardar],
    });
    async function enviar() {
      const cod = codigo.value.trim();
      errorCampo(codigo, !cod || leerQrItem(cod) ? null : 'Solo letras, números y guiones (3 a 40).');
      errorCampo(nombre, nombre.value.trim().length >= 3 ? null : 'Escribe el nombre del ítem.');
      errorCampo(categoria, categoria.value ? null : 'Elige la categoría.');
      if ((cod && !leerQrItem(cod)) || nombre.value.trim().length < 3 || !categoria.value) return;
      const datos = { ambienteId, nombre: nombre.value.trim(), categoria: categoria.value, serial: serial.value.trim(), estado: estadoIt.value };
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
    if (!await confirmar({ titulo: `¿Borrar ${i.nombre}?`, mensaje: `${i.codigo}. Si ya tiene daños reportados no se puede borrar: márcalo "De baja".`, textoAceptar: 'Borrar', peligro: true })) return;
    try { await apiAmb.borrarItem(i.id); toast('exito', 'Ítem borrado'); cargar(); } catch (e) { toast('error', 'No se borró', e.message); }
  }

  await cargar();
  anim.entrarVista(raiz);
}
