// Instructores asignados a un ambiente, dentro del mismo formulario de
// "Editar ambiente" (no es otra pantalla):
//  · lista de asignaciones vigentes por jornada (mañana, tarde, noche) y
//    quién está hoy;
//  · agregar: por periodo (inicio — fin), por días (uno o varios días
//    sueltos) o sin tiempo definido;
//  · editar en la misma fila (si ya empezó: fecha final, tipo, o cambiar de
//    instructor desde una fecha) y anular desde una fecha.
// Con un ambiente nuevo (sin id) las asignaciones quedan pendientes y se
// crean al guardar el ambiente (guardarPendientes). Cada cambio queda en el
// historial de auditoría y se avisa al instructor.
import { h, icono, vaciar, errorCampo } from './dom.js';
import { toast } from './avisos.js';
import { cargando } from './componentes.js';
import { apiAmb } from '../api/ambientes.js';
import { fechaIso, JORNADAS, ETIQUETA_JORNADA, TIPOS_ASIGNACION, validarAsignacion } from '../reglas.js';

const ETIQUETA_TIPO = Object.fromEntries(TIPOS_ASIGNACION.map((t) => [t.clave, t.etiqueta]));
const fmt = new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });
const dia = (iso) => fmt.format(new Date(`${iso}T12:00:00`));

/** "Del lun, 5 oct al vie, 30 oct", "Solo el mar, 6 oct", "Desde el lun, 5 oct". */
export function describirAsignacion(a) {
  if (a.tipo === 'dia') return `Solo el ${dia(a.fechaInicio)}`;
  if (a.tipo === 'periodo') return `Del ${dia(a.fechaInicio)} al ${dia(a.fechaFin)}`;
  return `Desde el ${dia(a.fechaInicio)}`;
}

/**
 * @param {{ambiente:?{id:number, codigo:string, asignadosHoy?:any[]}, instructores:{id:number, nombre:string}[]}} o
 * @returns {{el:HTMLElement, guardarPendientes:(ambienteId:number)=>Promise<number>}}
 */
export function crearGestorAsignaciones({ ambiente, instructores }) {
  const hoy = fechaIso();
  let lista = [];             // asignaciones vigentes del ambiente (desde el servidor)
  const pendientes = [];      // ambiente nuevo: se crean al guardar
  let editando = null;        // id de la fila en edición, 'nueva' o null

  const resumenHoy = h('p', { class: 'asig-amb-hoy' });
  const cuerpo = h('div', { class: 'asig-amb-lista' }, ambiente ? cargando('Cargando asignaciones…') : null);
  const agregarBtn = h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => { editando = 'nueva'; pintar(); } }, icono('mas'), 'Asignar instructor');
  const el = h('fieldset', { class: 'full asig-amb' },
    h('legend', {}, icono('usuarios'), ' Instructores asignados'),
    resumenHoy, cuerpo, h('div', { class: 'asig-amb-pie' }, agregarBtn));
  // Enter en los campos de las asignaciones no debe enviar el formulario del ambiente.
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('input, select')) e.preventDefault(); });

  async function cargar() {
    if (!ambiente) { pintar(); return; }
    try { lista = await apiAmb.asignaciones({ ambienteId: ambiente.id }); } catch (e) { vaciar(cuerpo, h('p', { class: 'text-muted' }, e.message)); return; }
    try { ambiente.asignadosHoy = (await apiAmb.ambiente(ambiente.id)).asignadosHoy; } catch { /* el resumen es informativo */ }
    pintar();
  }

  function pintar() {
    const hoyJ = ambiente?.asignadosHoy;
    resumenHoy.hidden = !hoyJ;
    if (hoyJ) vaciar(resumenHoy, h('strong', {}, 'Hoy: '), hoyJ.map((j, n) => [n ? ' · ' : '', `${ETIQUETA_JORNADA[j.jornada]} `, h('span', { class: j.instructor ? '' : 'text-muted' }, j.instructor || 'sin asignar')]));
    const filas = [...lista, ...pendientes].sort((x, y) => x.fechaInicio.localeCompare(y.fechaInicio));
    vaciar(cuerpo,
      filas.length ? JORNADAS.map((j) => {
        const deJornada = filas.filter((a) => a.jornada === j.clave);
        return deJornada.length ? h('div', { class: 'asig-amb-jornada' },
          h('h4', {}, j.etiqueta, h('span', { class: 'text-muted' }, ` ${j.horario}`)),
          h('ul', { class: 'inv-lista' }, deJornada.map((a) => (editando === a.id ? h('li', {}, editor(a)) : fila(a))))) : null;
      }) : h('p', { class: 'text-muted' }, ambiente ? 'Este ambiente no tiene instructores asignados desde hoy.' : 'Aún no hay asignaciones. Las que agregues se crean al guardar el ambiente.'),
      editando === 'nueva' ? editor(null) : null);
    agregarBtn.hidden = editando === 'nueva';
  }

  function fila(a) {
    const pendiente = !a.id || String(a.id).startsWith('p');
    return h('li', { class: `inv-fila asig-amb-fila${pendiente ? ' asig-amb-fila--pendiente' : ''}`, 'data-id': a.id },
      h('div', { class: 'inv-fila-datos' },
        h('strong', {}, a.instructor.nombre),
        h('span', { class: 'text-muted' }, `${ETIQUETA_TIPO[a.tipo]} · ${describirAsignacion(a)}${a.motivo ? ` · ${a.motivo}` : ''}`)),
      pendiente ? h('span', { class: 'status-chip neutro' }, 'Se asigna al guardar')
        : a.fechaInicio <= hoy && (!a.fechaFin || a.fechaFin >= hoy) ? h('span', { class: 'status-chip in' }, 'Hoy') : h('span', { class: 'status-chip azul' }, 'Próxima'),
      h('div', { class: 'inv-fila-acciones' },
        !pendiente && h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => { editando = a.id; pintar(); } }, icono('lapiz'), 'Editar'),
        h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => anular(a) }, icono('prohibido'), pendiente ? 'Quitar' : 'Anular')));
  }

  /** Formulario en línea para agregar (a = null) o editar una asignación. */
  function editor(a) {
    const empezo = a && a.fechaInicio <= hoy;
    let tipo = a?.tipo || 'periodo';
    const dias = new Set(a?.tipo === 'dia' ? [a.fechaInicio] : []);
    const id = (s) => `asig-${a?.id || 'nueva'}-${s}`;
    const campo = (clave, etiqueta, input) => h('div', { class: 'campo' }, h('label', { for: id(clave) }, etiqueta), input);
    const jornada = h('select', { id: id('jornada'), disabled: !!a }, JORNADAS.map((j) => h('option', { value: j.clave, selected: j.clave === a?.jornada }, `${j.etiqueta} (${j.horario})`)));
    const instructor = h('select', { id: id('inst') }, h('option', { value: '' }, 'Elige el instructor'),
      instructores.map((i) => h('option', { value: i.id, selected: i.id === a?.instructor.id }, i.nombre)));
    const tipos = h('div', { class: 'segmentos', role: 'radiogroup', 'aria-label': '¿Por cuánto tiempo?' }, TIPOS_ASIGNACION.map((t) => h('button', {
      class: 'segmento', type: 'button', role: 'radio', 'aria-checked': String(t.clave === tipo), title: t.ayuda,
      disabled: empezo && (t.clave === 'dia') !== (a.tipo === 'dia'),
      onclick: () => { tipo = t.clave; tipos.querySelectorAll('.segmento').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.tipo === tipo))); pintarFechas(); },
      'data-tipo': t.clave,
    }, t.etiqueta)));
    const ayuda = h('p', { class: 'text-muted asig-amb-ayuda' });
    const inicio = h('input', { type: 'date', id: id('inicio'), value: a?.fechaInicio || hoy, min: empezo ? undefined : hoy, disabled: empezo });
    const fin = h('input', { type: 'date', id: id('fin'), value: a?.fechaFin || '', min: hoy });
    const nuevoDia = h('input', { type: 'date', id: id('dia'), value: hoy, min: hoy });
    const listaDias = h('div', { class: 'asig-amb-dias' });
    const agregarDia = h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => {
      if (!nuevoDia.value || nuevoDia.value < hoy) { errorCampo(nuevoDia, 'Elige un día desde hoy.'); return; }
      errorCampo(nuevoDia, null); dias.add(nuevoDia.value); pintarDias();
    } }, icono('mas'), 'Agregar día');
    const desde = h('input', { type: 'date', id: id('desde'), value: hoy, min: hoy, max: a?.fechaFin || undefined });
    const campoDesde = empezo && a.tipo !== 'dia' ? campo('desde', 'Si cambias el instructor, desde', desde) : null;
    const motivo = h('input', { type: 'text', id: id('motivo'), maxlength: 300, value: a?.motivo || '', placeholder: 'Ficha, competencia o motivo (opcional)' });
    const zonaFechas = h('div', { class: 'form-grid asig-amb-fechas' });

    function pintarDias() {
      vaciar(listaDias, [...dias].sort().map((f) => h('span', { class: 'status-chip azul asig-amb-dia' }, dia(f),
        !a && h('button', { class: 'boton-enlace', type: 'button', 'aria-label': `Quitar ${dia(f)}`, onclick: () => { dias.delete(f); pintarDias(); } }, icono('cerrar')))));
    }
    function pintarFechas() {
      ayuda.textContent = TIPOS_ASIGNACION.find((t) => t.clave === tipo).ayuda;
      if (tipo === 'dia') {
        // Editando una asignación de un día: se cambia ese día; agregando: varios días.
        vaciar(zonaFechas, a ? campo('inicio', 'Día', inicio) : [campo('dia', 'Día', nuevoDia), h('div', { class: 'campo asig-amb-agregar-dia' }, agregarDia), h('div', { class: 'full' }, listaDias)]);
        pintarDias();
      } else {
        vaciar(zonaFechas, campo('inicio', tipo === 'periodo' ? 'Fecha de inicio' : 'Desde', inicio), tipo === 'periodo' ? campo('fin', 'Fecha final', fin) : null);
      }
    }
    pintarFechas();

    const guardar = h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => enviar() }, icono('check'), a ? 'Guardar cambios' : (ambiente ? 'Asignar' : 'Agregar'));
    const caja = h('div', { class: 'asig-amb-editor' },
      h('div', { class: 'form-grid' }, campo('jornada', 'Jornada', jornada), campo('inst', a && empezo ? 'Instructor (para cambiarlo se reasigna)' : 'Instructor', instructor), campoDesde),
      h('div', { class: 'campo' }, h('label', {}, '¿Por cuánto tiempo?'), tipos, ayuda),
      zonaFechas,
      campo('motivo', 'Motivo', motivo),
      empezo && h('p', { class: 'text-muted asig-amb-ayuda' }, 'Esta asignación ya empezó: se conserva su fecha de inicio y los días anteriores quedan con quien los tuvo.'),
      h('div', { class: 'asig-amb-botones' },
        h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => { editando = null; pintar(); } }, 'Cancelar'), guardar));
    setTimeout(() => instructor.focus(), 0);
    return caja;

    async function enviar() {
      const datos = {
        ambienteId: ambiente?.id || -1, instructorId: Number(instructor.value) || null, jornada: jornada.value, tipo,
        fechaInicio: inicio.value, fechaFin: tipo === 'periodo' ? fin.value : undefined,
        fechas: tipo === 'dia' && !a ? [...dias].sort() : undefined, motivo: motivo.value.trim() || undefined,
      };
      // Al editar algo que ya empezó, la fecha de inicio pasada es válida.
      const errores = validarAsignacion({ ...datos, fechaInicio: empezo ? hoy : datos.fechaInicio }, hoy);
      // Solo los campos que están a la vista según el tipo (los demás no están en la página).
      [[instructor, errores.instructorId], [inicio, errores.fechaInicio], [fin, errores.fechaFin], [nuevoDia, errores.fechas]]
        .forEach(([campo, error]) => { if (campo.isConnected) errorCampo(campo, error); });
      if (Object.keys(errores).length) return;
      const nombre = instructores.find((i) => i.id === datos.instructorId)?.nombre;

      if (!ambiente) { // ambiente nuevo: queda pendiente
        const fechas = datos.fechas || [null];
        fechas.forEach((f) => pendientes.push({ id: `p${pendientes.length}`, ...datos, fechaInicio: f || datos.fechaInicio, fechaFin: f || datos.fechaFin || null, fechas: undefined, instructor: { id: datos.instructorId, nombre } }));
        editando = null;
        pintar();
        return;
      }
      guardar.disabled = true;
      try {
        let advertencias = [];
        if (!a) {
          const r = await apiAmb.crearAsignacion(datos);
          advertencias = r.advertencias;
          toast('exito', 'Instructor asignado', `${nombre} · ${ETIQUETA_JORNADA[datos.jornada]} · ${r.asignaciones.length > 1 ? `${r.asignaciones.length} días` : describirAsignacion(r.asignacion)}`);
        } else {
          let actual = a;
          if (empezo && datos.instructorId !== a.instructor.id) {
            // Ya empezó: cambiar de instructor es reasignar desde una fecha (los días anteriores se conservan).
            const r = await apiAmb.reasignar(a.id, { instructorId: datos.instructorId, motivo: datos.motivo || 'Cambio de instructor', desde: a.tipo === 'dia' ? undefined : desde.value });
            advertencias = r.advertencias;
            actual = r.asignacion;
          }
          const cambios = {};
          if (!empezo && datos.instructorId !== a.instructor.id) cambios.instructorId = datos.instructorId;
          if (tipo !== actual.tipo) cambios.tipo = tipo;
          if (!empezo && datos.fechaInicio !== actual.fechaInicio) cambios.fechaInicio = datos.fechaInicio;
          if (tipo === 'periodo' && datos.fechaFin !== actual.fechaFin) cambios.fechaFin = datos.fechaFin;
          if (tipo === 'permanente' && actual.fechaFin) cambios.fechaFin = null;
          if ((datos.motivo || null) !== (actual.motivo || null) && actual === a) cambios.motivo = datos.motivo || '';
          if (Object.keys(cambios).length) {
            const r = await apiAmb.editarAsignacion(actual.id, cambios);
            advertencias = [...advertencias, ...r.advertencias];
          } else if (actual === a) { toast('info', 'Sin cambios'); guardar.disabled = false; return; }
          toast('exito', 'Asignación actualizada', `${nombre} · ${ETIQUETA_JORNADA[a.jornada]}`);
        }
        if (advertencias.length) toast('aviso', 'Revisa el horario del instructor', [...new Set(advertencias)].join(' · '), 9000);
        editando = null;
        await cargar();
      } catch (e) {
        if (e.codigo === 'DUPLICADO') errorCampo(tipos, e.message); else toast('error', 'No se guardó la asignación', e.message);
        guardar.disabled = false;
      }
    }
  }

  /** Anular en la misma fila: motivo y, si ya empezó, desde qué fecha. */
  function anular(a) {
    if (!a.id || String(a.id).startsWith('p')) { pendientes.splice(pendientes.indexOf(a), 1); pintar(); return; }
    const li = cuerpo.querySelector(`.asig-amb-fila[data-id="${a.id}"]`);
    const empezo = a.fechaInicio <= hoy;
    const motivo = h('input', { type: 'text', maxlength: 300, 'aria-label': 'Motivo de la anulación', placeholder: 'Motivo (obligatorio)' });
    const desde = h('input', { type: 'date', 'aria-label': 'Anular desde', value: empezo ? hoy : a.fechaInicio, min: empezo ? hoy : a.fechaInicio, max: a.fechaFin || undefined, disabled: a.tipo === 'dia' });
    const confirmarBtn = h('button', { class: 'btn btn-peligro btn-sm', type: 'button', onclick: async () => {
      errorCampo(motivo, motivo.value.trim() ? null : 'Escribe el motivo.');
      if (!motivo.value.trim()) return;
      confirmarBtn.disabled = true;
      try {
        await apiAmb.anularAsignacion(a.id, { motivo: motivo.value.trim(), desde: a.tipo === 'dia' ? undefined : desde.value });
        toast('exito', 'Turno anulado', `${a.instructor.nombre} · ${ETIQUETA_JORNADA[a.jornada]}`);
        await cargar();
      } catch (e) { toast('error', 'No se anuló', e.message); confirmarBtn.disabled = false; }
    } }, icono('prohibido'), 'Anular');
    li?.replaceChildren(h('div', { class: 'asig-amb-anular' },
      h('strong', {}, `Anular el turno de ${a.instructor.nombre} (${ETIQUETA_JORNADA[a.jornada].toLowerCase()})`),
      h('div', { class: 'asig-amb-anular-campos' }, a.tipo !== 'dia' && h('label', {}, 'Desde ', desde), motivo),
      h('div', { class: 'asig-amb-botones' }, h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => pintar() }, 'Cancelar'), confirmarBtn)));
    motivo.focus();
  }

  /** Ambiente nuevo: crea las asignaciones pendientes. Devuelve cuántas se crearon. */
  async function guardarPendientes(ambienteId) {
    let creadas = 0;
    for (const p of pendientes) {
      try {
        await apiAmb.crearAsignacion({ ambienteId, instructorId: p.instructorId, jornada: p.jornada, tipo: p.tipo, fechaInicio: p.fechaInicio,
          fechaFin: p.tipo === 'periodo' ? p.fechaFin : undefined, motivo: p.motivo });
        creadas++;
      } catch (e) { toast('error', `No se asignó a ${p.instructor.nombre}`, e.message); }
    }
    return creadas;
  }

  cargar();
  return { el, guardarPendientes };
}
