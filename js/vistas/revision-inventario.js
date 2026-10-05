// Revisión de la cuenta antes del ambiente (acta de entrega al responsable o a un
// instructor nuevo).
//  · Sin ?id: las revisiones. La persona ve las suyas (pendientes primero);
//    administrativo y almacén ven todas y pueden anular una pendiente.
//  · Con ?id: el acta. Quien recibe marca cada ítem Conforme, Faltante o Dañado (con
//    observación), escanea las pegatinas para marcarlas conformes, usa "Todo está
//    bien" para los que faltan, o descarga el Excel, lo llena y lo sube.
//    "Aceptar cuenta antes" (todo revisado) la cierra: si es de responsable,
//    queda como responsable. Hasta aceptarla no puede hacer "Ingresé".
import { h, anexar, icono, vaciar, errorCampo } from '../ui/dom.js';
import { anim } from '../ui/anim.js';
import { toast, abrirModal, confirmar } from '../ui/avisos.js';
import { cargando, tarjetaError } from '../ui/componentes.js';
import { crearEscaner } from '../ui/escaner.js';
import { cabecera, vacio, fecha, chipItem } from '../ui/ambientes-ui.js';
import { apiAmb } from '../api/ambientes.js';
import { estado, emitir } from '../estado.js';

const ESTADOS = [['ok', 'Conforme', 'check'], ['faltante', 'Faltante', 'alerta'], ['danado', 'Dañado', 'herramienta']];
const ETIQUETA_ESTADO = { pendiente: ['Pendiente', 'out'], aceptada: ['Aceptada', 'in'], anulada: ['Anulada', 'neutro'] };
const pesos = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const gestiona = () => ['administrativo', 'almacen'].includes(estado.usuario.rol);

export async function render(raiz, { params, alSalir }) {
  const id = Number(params.get('id'));
  return id ? acta(raiz, id, alSalir) : lista(raiz);
}

/* ---------------- lista ---------------- */

async function lista(raiz) {
  const cuerpo = h('div', { class: 'revisiones-lista' }, cargando());
  anexar(raiz,
    cabecera({ eyebrow: 'Inventario', titulo: 'Cuenta antes',
      subtitulo: gestiona() ? 'Revisiones de la cuenta antes que reciben los instructores asignados y los responsables. Mientras estén pendientes, esa persona no puede recibir el ambiente.'
        : 'Cuando te asignan un ambiente recibes su cuenta antes: revisa ítem por ítem si es conforme a lo que hay en el ambiente y acéptala.' }),
    cuerpo);
  let revisiones;
  try { revisiones = await apiAmb.revisiones(gestiona() ? {} : { mias: 1 }); } catch (e) { vaciar(cuerpo, tarjetaError(e)); return; }
  vaciar(cuerpo, revisiones.length ? revisiones.map((r) => {
    const [texto, clase] = ETIQUETA_ESTADO[r.estado];
    const c = r.conteo;
    return h('article', { class: `card revision-tarjeta revision-tarjeta--${r.estado}` },
      h('span', { class: 'amb-numero amb-numero--grande' }, r.ambiente.codigo),
      h('div', { class: 'revision-datos' },
        h('span', { class: 'inv-categoria' }, r.tipo === 'cuentadante' ? 'Recibe como responsable' : 'Instructor asignado'),
        h('strong', {}, `${r.ambiente.nombre} · recibe ${r.responsable.nombre}`),
        h('span', { class: 'text-muted' }, r.cuentadanteAnterior ? `Entrega ${r.cuentadanteAnterior.nombre} · ${r.motivo}` : r.motivo),
        h('div', { class: 'reporte-chips' }, h('span', { class: `status-chip ${clase}` }, texto),
          h('span', { class: 'status-chip neutro' }, `${c.total - c.pendientes}/${c.total} revisados`),
          c.faltantes ? h('span', { class: 'status-chip error' }, `${c.faltantes} faltante(s)`) : null,
          c.danados ? h('span', { class: 'status-chip out' }, `${c.danados} dañado(s)`) : null),
        h('span', { class: 'text-muted' }, r.estado === 'pendiente' ? `Desde ${fecha.completa(r.creadaEn)}` : `${texto} ${fecha.completa(r.cerradaEn)}${r.cerradaPor ? ` · ${r.cerradaPor}` : ''}`)),
      h('a', { class: `btn ${r.estado === 'pendiente' && r.responsable.id === estado.usuario.id ? 'btn-primary' : 'btn-outline'} btn-sm`, href: `#/revision-inventario?id=${r.id}` },
        icono(r.estado === 'pendiente' && r.responsable.id === estado.usuario.id ? 'inspeccion' : 'ojo'),
        r.estado === 'pendiente' && r.responsable.id === estado.usuario.id ? 'Revisar cuenta antes' : 'Ver acta'));
  }) : vacio('No hay cuentas antes por revisar', gestiona() ? '' : 'Cuando te asignen un ambiente con su cuenta antes aparecerá aquí.', 'caja'));
  anim.lista(cuerpo.children, { autoAlpha: 0, y: 8 });
  anim.entrarVista(raiz);
}

/* ---------------- acta ---------------- */

async function acta(raiz, id, alSalir) {
  let d = await apiAmb.revision(id);
  const mia = d.responsable.id === estado.usuario.id && d.estado === 'pendiente';
  let filtro = '', busqueda = '';

  const progreso = h('div', { class: 'progreso', role: 'progressbar', 'aria-valuemin': 0 }, h('span', { class: 'progreso-relleno' }));
  const progresoTexto = h('span', { class: 'text-muted' });
  const listaItems = h('div', { class: 'revision-items' });
  const filtros = h('div', { class: 'segmentos', role: 'tablist', 'aria-label': 'Mostrar' });
  const buscar = h('input', { type: 'search', placeholder: 'Buscar por placa, nombre, serial o categoría', 'aria-label': 'Buscar ítem',
    oninput: () => { busqueda = buscar.value.trim().toLowerCase(); pintarItems(); } });
  const observaciones = h('textarea', { id: 'rev-obs', rows: 3, maxlength: 500, placeholder: 'Observación general del acta (obligatoria si hay faltantes o dañados)' }, d.observaciones || '');
  const aceptar = h('button', { class: 'btn btn-primary btn-lg', type: 'button', onclick: () => aceptarActa() }, icono('check'), 'Aceptar cuenta antes');

  const escaner = mia && crearEscaner({
    tipos: ['qr', 'barras'], etiqueta: 'Escanear pegatina', placeholder: 'Placa o código de la pegatina', continuo: true,
    alLeer: async (texto) => {
      try {
        d = await apiAmb.marcarRevision(id, { items: [{ codigo: texto, estado: 'ok' }] });
        toast('exito', 'Marcado conforme', texto.slice(0, 40), 2500);
        pintar();
      } catch (e) { toast('error', 'No se marcó', e.message); }
    },
  });
  if (escaner) alSalir(() => escaner.detener());

  anexar(raiz,
    cabecera({
      eyebrow: d.tipo === 'cuentadante' ? 'Recibe como responsable' : 'Instructor asignado',
      titulo: `Cuenta antes del ambiente ${d.ambiente.codigo}`,
      subtitulo: `${d.ambiente.nombre}. Recibe ${d.responsable.nombre}${d.cuentadanteAnterior ? `; entrega ${d.cuentadanteAnterior.nombre}` : ''}. ${d.motivo}.`,
      acciones: [
        h('button', { class: 'btn btn-outline', type: 'button', onclick: () => exportar() }, icono('descargar'), 'Descargar Excel'),
        mia && h('button', { class: 'btn btn-outline', type: 'button', onclick: () => importar() }, icono('subir'), 'Subir Excel'),
        gestiona() && d.estado === 'pendiente' && h('button', { class: 'btn btn-outline', type: 'button', onclick: () => anular() }, icono('prohibido'), 'Anular'),
      ],
    }),
    h('section', { class: 'card revision-resumen', 'data-anim': '' },
      h('div', { class: 'revision-resumen-fila' }, progreso, progresoTexto),
      h('p', { class: 'text-muted revision-ayuda' }, mia
        ? (d.tipo === 'cuentadante' ? 'Revisa si la cuenta antes es conforme a lo que hay en el ambiente. Al aceptarla quedas como responsable. '
          : 'Revisa si la cuenta antes es conforme a lo que hay en el ambiente. Al aceptarla podrás recibir el ambiente ("Ingresé"). ')
          + 'Revisa cada ítem: Conforme si está y funciona, Faltante si no está, Dañado si está con daño (con observación). También puedes descargar el Excel, llenar la columna "revision" y subirlo.'
        : d.estado === 'pendiente' ? `Pendiente: la revisa ${d.responsable.nombre}.` : `${ETIQUETA_ESTADO[d.estado][0]} ${fecha.completa(d.cerradaEn)}${d.observaciones ? ` · ${d.observaciones}` : ''}`),
      mia && h('div', { class: 'revision-atajos' },
        h('button', { class: 'todo-bien', type: 'button', onclick: () => todoBien() },
          h('span', { class: 'todo-bien-icono', 'aria-hidden': 'true' }, icono('check')),
          h('span', {}, h('strong', {}, 'Todo está bien'), h('span', {}, 'Marca conformes todos los ítems que faltan por revisar')), icono('flecha')),
        escaner.el)),
    h('section', { class: 'card', 'data-anim': '' },
      h('div', { class: 'revision-filtros' }, filtros, h('div', { class: 'adm-buscar' }, icono('buscar'), buscar)),
      listaItems),
    mia && h('section', { class: 'card', 'data-anim': '' },
      h('div', { class: 'campo' }, h('label', { for: 'rev-obs' }, 'Observaciones del acta'), observaciones)),
    mia && h('div', { class: 'accion-fija revision-aceptar' }, aceptar));

  function pintar() {
    const c = d.conteo;
    const hechos = c.total - c.pendientes;
    progreso.setAttribute('aria-valuemax', c.total);
    progreso.setAttribute('aria-valuenow', hechos);
    progreso.firstChild.style.width = `${c.total ? (hechos / c.total) * 100 : 0}%`;
    progresoTexto.textContent = `${hechos} de ${c.total} revisados · ${c.ok} conformes · ${c.faltantes} faltantes · ${c.danados} dañados`
      + (d.valorTotal ? ` · valor de la cuenta antes ${pesos.format(d.valorTotal)}` : '');
    aceptar.disabled = !c.total || c.pendientes > 0;
    aceptar.title = !c.total ? 'El ambiente no tiene cuenta antes' : c.pendientes ? `Faltan ${c.pendientes} por revisar` : '';
    vaciar(filtros, [['', 'Todos', c.total], ['pendiente', 'Pendientes', c.pendientes], ['novedad', 'Con novedad', c.faltantes + c.danados]].map(([clave, texto, n]) => h('button', {
      class: 'segmento', type: 'button', role: 'tab', 'aria-selected': String(filtro === clave), onclick: () => { filtro = clave; pintar(); },
    }, texto, h('span', { class: 'pestana-cuenta' }, n))));
    pintarItems();
  }

  function pintarItems() {
    const visibles = d.items.filter((i) => (!filtro || (filtro === 'pendiente' ? i.revision === 'pendiente' : ['faltante', 'danado'].includes(i.revision)))
      && (!busqueda || [i.codigo, i.nombre, i.serial, i.categoria].some((v) => (v || '').toLowerCase().includes(busqueda))));
    if (!d.items.length) {
      vaciar(listaItems, vacio('El ambiente no tiene cuenta antes', gestiona() ? 'Cárgala con el Excel en Editar ambiente → Cuenta antes.' : 'Pide a almacén que cargue la cuenta antes.', 'caja'));
      return;
    }
    vaciar(listaItems, visibles.length ? h('ul', { class: 'inv-lista' }, visibles.map(fila)) : h('p', { class: 'text-muted' }, 'Ningún ítem coincide.'));
  }

  function fila(i) {
    const obs = h('input', { type: 'text', maxlength: 300, value: i.observacion || '', 'aria-label': `Observación de ${i.codigo}`, placeholder: 'Qué falta o qué daño tiene',
      hidden: !['faltante', 'danado'].includes(i.revision), disabled: !mia,
      onchange: () => { if (i.revision !== 'ok') marcar(i, i.revision, obs); } });
    return h('li', { class: `inv-fila revision-item revision-item--${i.revision}` },
      h('div', { class: 'inv-fila-datos' },
        h('strong', {}, i.nombre),
        h('span', { class: 'text-muted' }, [h('span', { class: 'mono' }, i.codigo), i.serial && ` · serial ${i.serial}`, ` · ${i.categoria}`,
          i.familia && ` · ${i.familia.codigo}`, i.valor !== null && ` · ${pesos.format(i.valor)}`]),
        h('span', {}, chipItem(i.estadoItem))),
      h('div', { class: 'checklist-opciones', role: 'group', 'aria-label': `Revisión de ${i.codigo}` },
        ESTADOS.map(([clave, texto, ic]) => h('button', {
          class: `checklist-btn checklist-btn--${clave === 'ok' ? 'ok' : 'novedad'}`, type: 'button', 'aria-pressed': String(i.revision === clave), disabled: !mia,
          onclick: () => {
            if (clave === 'ok') { marcar(i, 'ok'); return; }
            obs.hidden = false;
            if (!obs.value.trim()) { i.revision = clave; obs.focus(); errorCampo(obs, 'Escribe la observación y presiona Enter.'); obs.dataset.estado = clave; return; }
            marcar(i, clave, obs);
          },
        }, icono(ic), texto))),
      obs);
  }

  async function marcar(i, nuevo, obs = null) {
    const observacion = obs?.value.trim() || undefined;
    if (nuevo !== 'ok' && !observacion) { errorCampo(obs, 'Escribe la observación.'); return; }
    try {
      d = await apiAmb.marcarRevision(id, { items: [{ itemId: i.itemId, estado: nuevo, observacion }] });
      pintar();
    } catch (e) { toast('error', 'No se guardó', e.message); }
  }

  async function todoBien() {
    if (!d.conteo.pendientes) { toast('info', 'No hay pendientes', 'Todos los ítems ya están revisados.'); return; }
    if (!await confirmar({ titulo: `¿Marcar conformes los ${d.conteo.pendientes} ítems pendientes?`, mensaje: 'Los que ya marcaste como faltantes o dañados no cambian. Después puedes corregir cualquiera.', textoAceptar: 'Marcar OK' })) return;
    try { d = await apiAmb.marcarRevision(id, { todoBien: true }); pintar(); } catch (e) { toast('error', 'No se marcaron', e.message); }
  }

  async function aceptarActa() {
    const novedades = d.conteo.faltantes + d.conteo.danados;
    if (novedades && observaciones.value.trim().length < 5) { errorCampo(observaciones, 'Hay faltantes o dañados: escribe una observación general.'); return; }
    if (!await confirmar({
      titulo: d.tipo === 'cuentadante' ? `¿Recibir la cuenta antes del ${d.ambiente.codigo} como responsable?` : `¿Aceptar la cuenta antes del ${d.ambiente.codigo}?`,
      mensaje: `${d.conteo.total} ítems: ${d.conteo.ok} conformes${novedades ? `, ${d.conteo.faltantes} faltantes y ${d.conteo.danados} dañados (los dañados quedan "Dañado" y se avisa a coordinación y almacén)` : ''}.`,
      textoAceptar: 'Aceptar cuenta antes',
    })) return;
    aceptar.disabled = true;
    try {
      d = await apiAmb.aceptarRevision(id, observaciones.value.trim() || undefined);
      emitir('revisiones');
      toast('exito', d.tipo === 'cuentadante' ? `Ahora eres responsable de la cuenta antes del ${d.ambiente.codigo}` : 'Cuenta antes aceptada', 'Ya puedes recibir el ambiente.');
      location.hash = '#/inspecciones';
    } catch (e) { toast('error', 'No se aceptó', e.message); aceptar.disabled = false; }
  }

  async function exportar() {
    try { toast('exito', 'Excel descargado', await apiAmb.exportarRevision(id)); } catch (e) { toast('error', 'No se descargó', e.message); }
  }

  function importar() {
    const entrada = h('input', { type: 'file', accept: '.xlsx,.xls,.ods,.csv', id: 'rev-archivo' });
    const resultado = h('div', { 'aria-live': 'polite' });
    const boton = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => subir() }, icono('subir'), 'Subir');
    const { cerrar } = abrirModal({
      titulo: 'Subir la revisión en Excel', subtitulo: 'El archivo que descargaste con "Descargar Excel", con la columna "revision" llena (CONFORME, FALTANTE o DAÑADO) y la observación.', ancho: 'normal',
      contenido: h('div', {}, h('div', { class: 'campo' }, h('label', { for: 'rev-archivo' }, 'Archivo'), entrada), resultado),
      acciones: [({ cerrar: x }) => h('button', { class: 'btn btn-outline', type: 'button', onclick: () => x() }, 'Cancelar'), boton],
    });
    function subir() {
      const f = entrada.files[0];
      if (!f) { errorCampo(entrada, 'Elige el archivo.'); return; }
      const lector = new FileReader();
      lector.onload = async () => {
        boton.disabled = true;
        try {
          const r = await apiAmb.importarRevision(id, { nombre: f.name, archivo: lector.result });
          if (r.revision) d = r.revision;
          pintar();
          if (r.errores.length) {
            vaciar(resultado, h('div', { class: 'banner error carga-errores' }, h('strong', {}, `${r.actualizados} actualizados; estas filas no se tomaron:`),
              h('ul', {}, r.errores.slice(0, 30).map((e) => h('li', {}, `Fila ${e.fila}: ${e.mensaje}`)))));
            boton.disabled = false;
          } else {
            toast('exito', 'Revisión cargada', `${r.actualizados} ítems actualizados, ${r.sinCambios} sin cambios.`);
            cerrar();
          }
        } catch (e) { vaciar(resultado, h('div', { class: 'banner error' }, e.message)); boton.disabled = false; }
      };
      lector.readAsDataURL(f);
    }
  }

  function anular() {
    const motivo = h('input', { type: 'text', id: 'rev-motivo', maxlength: 300, placeholder: 'Ej.: el instructor ya no queda en el ambiente' });
    const boton = h('button', { class: 'btn btn-peligro', type: 'button', onclick: async () => {
      if (motivo.value.trim().length < 5) { errorCampo(motivo, 'Escribe el motivo.'); return; }
      boton.disabled = true;
      try { await apiAmb.anularRevision(id, motivo.value.trim()); cerrar(); toast('info', 'Revisión anulada'); location.hash = '#/revision-inventario'; }
      catch (e) { toast('error', 'No se anuló', e.message); boton.disabled = false; }
    } }, icono('prohibido'), 'Anular revisión');
    const { cerrar } = abrirModal({
      titulo: 'Anular la revisión', subtitulo: `${d.responsable.nombre} · ambiente ${d.ambiente.codigo}. El responsable no cambia y se le avisa.`, ancho: 'angosto',
      contenido: h('div', { class: 'campo' }, h('label', { for: 'rev-motivo' }, 'Motivo'), motivo),
      acciones: [({ cerrar: x }) => h('button', { class: 'btn btn-outline', type: 'button', onclick: () => x() }, 'Cancelar'), boton],
    });
  }

  pintar();
  anim.entrarVista(raiz);
}
