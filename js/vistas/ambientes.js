// Ambientes: tarjetas con el estado de la entrega de hoy.
//  · Instructor: "Revisar", continuar su revisión o escanear el QR del portero.
//  · Portero: generar o mostrar el QR cuando la revisión está terminada; filtro "Mis asignados".
//  · Administrativo: crear, editar, activar/desactivar y borrar (CRUD), con
//    capacidad de aprendices y especialidad (y el catálogo de especialidades).
//    En el mismo formulario se gestionan los instructores asignados por
//    jornada: por periodo, por días o sin tiempo definido; editar y anular.
//  · Todos: filtro por especialidad.
//  · Aprendiz: solo consulta.
import { h, anexar, icono, vaciar, errorCampo } from '../ui/dom.js';
import { anim } from '../ui/anim.js';
import { toast, abrirModal, confirmar } from '../ui/avisos.js';
import { cargando, tarjetaError } from '../ui/componentes.js';
import { cabecera, chipInspeccion, fecha, esHoy, vacio } from '../ui/ambientes-ui.js';
import { apiAmb } from '../api/ambientes.js';
import { estado } from '../estado.js';
import { escanearEntrega } from '../ui/recibir.js';
import { gestionarCatalogo } from '../ui/catalogo.js';
import { crearGestorAsignaciones } from '../ui/asignaciones-ambiente.js';
import { ETIQUETA_JORNADA } from '../reglas.js';

export async function render(raiz) {
  const u = estado.usuario;
  const admin = u.rol === 'administrativo';
  let soloAsignados = u.rol === 'portero';
  let especialidadId = '';
  const lista = h('div', { class: 'amb-grid' }, cargando());

  const filtro = u.rol === 'portero' && h('label', { class: 'interruptor' },
    h('input', { type: 'checkbox', role: 'switch', checked: soloAsignados, onchange: (e) => { soloAsignados = e.target.checked; cargar(); } }),
    h('span', { class: 'interruptor-pista', 'aria-hidden': 'true' }), 'Solo mis ambientes asignados');
  const filtroEspecialidad = h('select', { 'aria-label': 'Filtrar por especialidad', onchange: (e) => { especialidadId = e.target.value; cargar(); } },
    h('option', { value: '' }, 'Todas las especialidades'));
  async function cargarEspecialidades() {
    try {
      const opciones = await apiAmb.especialidades();
      vaciar(filtroEspecialidad, h('option', { value: '' }, 'Todas las especialidades'),
        opciones.map((e) => h('option', { value: e.id, selected: String(e.id) === especialidadId }, e.nombre)));
    } catch { /* el filtro es opcional */ }
  }

  anexar(raiz,
    cabecera({
      eyebrow: 'Ambientes de formación', titulo: 'Ambientes',
      subtitulo: admin ? 'Crea y administra los ambientes, su especialidad, capacidad de aprendices y portero asignado.' : 'Estado de la revisión de cada ambiente hoy.',
      acciones: admin ? [
        h('button', { class: 'btn btn-outline', type: 'button', onclick: especialidades }, icono('filtro'), 'Especialidades'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => formulario() }, icono('mas'), 'Nuevo ambiente')] : [],
    }),
    h('div', { class: 'barra-filtros', 'data-anim': '' }, filtroEspecialidad, filtro),
    lista);

  function especialidades() {
    gestionarCatalogo({
      titulo: 'Especialidades de ambiente', subtitulo: 'Cocina, Laboratorio, Audiovisual, Axo… Cada ambiente tiene una.',
      singular: 'especialidad', usados: 'ambiente(s)',
      listar: () => apiAmb.especialidades(true), crear: apiAmb.crearEspecialidad, editar: apiAmb.editarEspecialidad, borrar: apiAmb.borrarEspecialidad,
      alCambiar: () => { cargarEspecialidades(); cargar(); },
    });
  }

  async function cargar() {
    vaciar(lista, cargando());
    let ambientes;
    try { ambientes = await apiAmb.ambientes({ asignados: soloAsignados ? 1 : undefined, especialidadId: especialidadId || undefined }); } catch (e) { vaciar(lista, tarjetaError(e, cargar)); return; }
    vaciar(lista, ambientes.length ? ambientes.map(tarjeta) : vacio('No hay ambientes para mostrar', soloAsignados ? 'No tienes ambientes asignados.' : '', 'ambiente'));
    anim.lista(lista.children);
  }

  function tarjeta(a) {
    const ult = a.ultimaInspeccion;
    const hoy = ult && esHoy(ult.iniciadaEn);
    const acciones = [];
    const abierta = ult && ['en_curso', 'pendiente_recepcion'].includes(ult.estado);
    if (u.rol === 'instructor' && a.activo) {
      const propia = abierta && ult.instructorId === u.id;
      if (propia) {
        acciones.push(ult.estado === 'en_curso'
          ? h('a', { class: 'btn btn-primary btn-sm', href: `#/inspeccion?id=${ult.id}` }, icono('inspeccion'), 'Continuar revisión')
          : h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: escanearEntrega }, icono('escanear'), 'Escanear QR del portero'));
      } else {
        acciones.push(h('a', { class: `btn btn-primary btn-sm${abierta ? ' is-disabled' : ''}`, href: abierta ? null : `#/inspecciones?ambiente=${a.id}`, 'aria-disabled': abierta ? 'true' : false }, icono('inspeccion'), 'Revisar'));
      }
    }
    if (u.rol === 'portero' && ult?.estado === 'pendiente_recepcion') {
      acciones.push(h('a', { class: 'btn btn-primary btn-sm', href: `#/planilla?id=${ult.id}` }, icono('qr'), 'Generar QR'));
    }
    if (u.rol !== 'aprendiz') acciones.push(h('a', { class: 'btn btn-outline btn-sm', href: `#/inventario?ambiente=${a.id}` }, icono('caja'), 'Inventario'));
    if (admin) {
      acciones.push(
        h('button', { class: 'btn btn-outline btn-sm btn-icono', type: 'button', 'aria-label': `Editar ambiente ${a.codigo}`, onclick: () => formulario(a) }, icono('lapiz')),
        h('button', { class: 'btn btn-outline btn-sm btn-icono', type: 'button', 'aria-label': `Borrar ambiente ${a.codigo}`, onclick: () => borrar(a) }, icono('basura')));
    }
    return h('article', { class: `card amb-tarjeta${a.activo ? '' : ' amb-tarjeta--inactivo'}` },
      h('div', { class: 'amb-tarjeta-cab' },
        h('span', { class: 'amb-numero amb-numero--grande' }, a.codigo),
        h('div', {}, h('h3', {}, a.nombre), h('span', { class: 'text-muted' }, a.capacidadAprendices ? `${a.capacidadAprendices} aprendices` : 'Capacidad sin definir')),
        a.especialidad && h('span', { class: 'status-chip azul amb-especialidad' }, a.especialidad),
        !a.activo && h('span', { class: 'status-chip neutro' }, 'Inactivo')),
      h('dl', { class: 'amb-datos' },
        h('div', {}, h('dt', {}, 'Portero'), h('dd', {}, a.portero || 'Sin asignar')),
        h('div', {}, h('dt', {}, 'Inventario'), h('dd', {}, `${a.itemsTotal} ítems`, a.familiasTotal ? ` · ${a.familiasTotal} familia${a.familiasTotal === 1 ? '' : 's'}` : '',
          a.itemsNovedad ? h('span', { class: 'amb-novedad' }, ` · ${a.itemsNovedad} con novedad`) : '')),
        a.novedadesActivas ? h('div', { class: 'amb-datos-ancho' }, h('dt', {}, 'Novedades permanentes'), h('dd', {},
          ['administrativo', 'instructor', 'almacen'].includes(u.rol)
            ? h('a', { class: 'table-link amb-novedad', href: `#/novedades?ambiente=${a.id}` }, `${a.novedadesActivas} en curso`)
            : h('span', { class: 'amb-novedad' }, `${a.novedadesActivas} en curso hasta que se resuelvan`))) : null,
        // El instructor solo recibe sus propias jornadas; portero y administrativo, las de todos.
        a.asignadosHoy && u.rol === 'instructor'
          ? (a.asignadosHoy.length ? h('div', { class: 'amb-datos-ancho' }, h('dt', {}, 'Tus jornadas hoy'), h('dd', { class: 'amb-jornadas' },
            a.asignadosHoy.map((j) => h('span', { class: 'amb-jornada amb-jornada--mia' }, h('strong', {}, ETIQUETA_JORNADA[j.jornada]))))) : null)
          : a.asignadosHoy && h('div', { class: 'amb-datos-ancho' }, h('dt', {}, 'Instructores hoy'), h('dd', { class: 'amb-jornadas' },
            a.asignadosHoy.map((j) => h('span', { class: `amb-jornada${j.instructor ? '' : ' amb-jornada--vacia'}` },
              h('strong', {}, ETIQUETA_JORNADA[j.jornada]), ` ${j.instructor ? j.instructor.split(' ').slice(0, 2).join(' ') : '—'}`)))),
        h('div', { class: 'amb-datos-ancho' }, h('dt', {}, 'Revisión de hoy'), h('dd', {},
          hoy ? [chipInspeccion(ult.estado), h('span', { class: 'text-muted' }, ` ${ult.instructor}${ult.portero ? ` · entregó ${ult.portero}` : ''} · ${fecha.hora(ult.iniciadaEn)}`)]
            : h('span', { class: 'status-chip neutro' }, ult ? `Última: ${fecha.corta(ult.iniciadaEn)}` : 'Sin inspecciones')))),
      acciones.length ? h('div', { class: 'amb-acciones' }, acciones) : null);
  }

  /* --- CRUD (administrativo) --- */
  async function formulario(a = null) {
    let porteros = [], especialidades = [], instructores = [];
    try {
      [porteros, especialidades, instructores] = await Promise.all([apiAmb.usuarios('portero'), apiAmb.especialidades(), apiAmb.usuarios('instructor')]);
    } catch (e) { toast('error', 'No se cargaron los porteros, instructores o especialidades', e.message); }
    // Instructores asignados por jornada: se gestionan aquí mismo (los cambios se guardan al instante).
    const asignaciones = crearGestorAsignaciones({ ambiente: a ? { id: a.id, codigo: a.codigo, asignadosHoy: a.asignadosHoy } : null, instructores });
    const c = (id, etiqueta, input) => h('div', { class: 'campo' }, h('label', { for: id }, etiqueta), input);
    const codigo = h('input', { type: 'text', id: 'amb-codigo', value: a?.codigo || '', maxlength: 10, inputmode: 'numeric', required: true });
    const nombre = h('input', { type: 'text', id: 'amb-nombre', value: a?.nombre || '', maxlength: 120, required: true });
    const capacidad = h('input', { type: 'number', id: 'amb-cap', value: a?.capacidadAprendices ?? '', min: 1, max: 500, inputmode: 'numeric' });
    const especialidad = h('select', { id: 'amb-esp' }, h('option', { value: '' }, 'Sin especialidad'),
      especialidades.map((e) => h('option', { value: e.id, selected: a?.especialidadId === e.id }, e.nombre)));
    const portero = h('select', { id: 'amb-portero' }, h('option', { value: '' }, 'Sin asignar'),
      porteros.map((p) => h('option', { value: p.id, selected: a?.porteroId === p.id }, p.nombre)));
    const activo = h('input', { type: 'checkbox', role: 'switch', checked: a ? a.activo : true });
    const form = h('form', { class: 'form-grid', novalidate: true, onsubmit: (e) => { e.preventDefault(); enviar(); } },
      c('amb-codigo', 'Número del ambiente', codigo), c('amb-cap', 'Capacidad (aprendices)', capacidad),
      h('div', { class: 'full' }, c('amb-nombre', 'Nombre', nombre)),
      c('amb-esp', 'Especialidad', especialidad), c('amb-portero', 'Portero asignado', portero),
      h('label', { class: 'interruptor full' }, activo, h('span', { class: 'interruptor-pista', 'aria-hidden': 'true' }), 'Ambiente activo (disponible para inspección)'),
      asignaciones.el);
    const guardar = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => enviar() }, icono('check'), a ? 'Guardar cambios' : 'Crear ambiente');
    let guardado = false;
    const { cerrar } = abrirModal({
      titulo: a ? `Editar ambiente ${a.codigo}` : 'Nuevo ambiente', contenido: form, ancho: 'ancho',
      acciones: [({ cerrar: x }) => h('button', { class: 'btn btn-outline', type: 'button', onclick: () => x() }, a ? 'Cerrar' : 'Cancelar'), guardar],
      // Las asignaciones se guardan al instante: al cerrar se refrescan las tarjetas (instructores de hoy).
      alCerrar: () => { if (a && !guardado) cargar(); },
    });
    async function enviar() {
      errorCampo(codigo, codigo.value.trim() ? null : 'Escribe el número.');
      errorCampo(nombre, nombre.value.trim().length >= 3 ? null : 'Escribe el nombre.');
      if (!codigo.value.trim() || nombre.value.trim().length < 3) return;
      const cap = capacidad.value ? Number(capacidad.value) : null;
      errorCampo(capacidad, cap === null || (cap >= 1 && cap <= 500) ? null : 'Entre 1 y 500 aprendices.');
      if (cap !== null && (cap < 1 || cap > 500)) return;
      const datos = {
        codigo: codigo.value.trim(), nombre: nombre.value.trim(), capacidadAprendices: cap,
        especialidadId: especialidad.value || null, porteroId: portero.value || null, activo: activo.checked,
      };
      guardar.disabled = true;
      try {
        const r = a ? await apiAmb.editarAmbiente(a.id, datos) : await apiAmb.crearAmbiente(datos);
        const asignadas = a ? 0 : await asignaciones.guardarPendientes(r.id);
        toast('exito', a ? 'Ambiente actualizado' : 'Ambiente creado', `Ambiente ${datos.codigo}${asignadas ? ` · ${asignadas} asignación(es) de instructores` : ''}`);
        guardado = true;
        cerrar();
        cargar();
      } catch (e) {
        if (e.codigo === 'DUPLICADO') errorCampo(codigo, e.message); else toast('error', 'No se guardó', e.message);
      } finally { guardar.disabled = false; }
    }
  }

  async function borrar(a) {
    const ok = await confirmar({ titulo: `¿Borrar el ambiente ${a.codigo}?`, mensaje: 'Solo se puede borrar si no tiene inventario ni inspecciones. Si los tiene, desactívalo.', textoAceptar: 'Borrar', peligro: true });
    if (!ok) return;
    try { await apiAmb.borrarAmbiente(a.id); toast('exito', 'Ambiente borrado'); cargar(); } catch (e) { toast('error', 'No se borró', e.message); }
  }

  await Promise.all([cargar(), cargarEspecialidades()]);
  anim.entrarVista(raiz);
}
