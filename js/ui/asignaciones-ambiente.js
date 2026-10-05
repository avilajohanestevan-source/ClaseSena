// Instructores asignados a un ambiente, dentro del mismo formulario de
// "Editar ambiente" (no es otra pantalla):
//  · lista de asignaciones vigentes por jornada (mañana, tarde, noche y fin
//    de semana) y quién está hoy;
//  · agregar: sin definir, por semanas (con días de la semana), por días
//    (uno o varios días sueltos) o por rango de fechas (js/ui/fechas-asignacion.js);
//  · editar en la misma fila (si ya empezó: fecha final, tipo, o cambiar de
//    instructor desde una fecha) y anular desde una fecha.
// Con un ambiente nuevo (sin id) las asignaciones quedan pendientes y se
// crean al guardar el ambiente (guardarPendientes). Cada cambio queda en el
// historial de auditoría y se avisa al instructor.
import { h, icono, vaciar, errorCampo } from './dom.js';
import { toast } from './avisos.js';
import { cargando } from './componentes.js';
import { apiAmb } from '../api/ambientes.js';
import { seccionCuentaAntes } from './cuenta-antes.js';
import { crearFechasAsignacion, modoDe } from './fechas-asignacion.js';
import { fechaIso, JORNADAS, ETIQUETA_JORNADA, MODOS_ASIGNACION, validarAsignacion, describirDiasSemana } from '../reglas.js';

const ETIQUETA_MODO = Object.fromEntries(MODOS_ASIGNACION.map((t) => [t.clave, t.etiqueta]));
const fmt = new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });
const dia = (iso) => fmt.format(new Date(`${iso}T12:00:00`));

/** "Del lun, 5 oct al vie, 30 oct", "Solo el mar, 6 oct", "Desde el lun, 5 oct". */
export function describirAsignacion(a) {
  const dias = describirDiasSemana(a.diasSemana);
  const solo = dias ? ` · solo ${dias}` : '';
  if (a.tipo === 'dia') return `Solo el ${dia(a.fechaInicio)}`;
  if (a.tipo === 'periodo') return `Del ${dia(a.fechaInicio)} al ${dia(a.fechaFin)}${solo}`;
  return `Desde el ${dia(a.fechaInicio)}${solo}`;
}

/** Aviso tras asignar: el instructor debe revisar si la cuenta antes es conforme (nuevo en el ambiente, cuenta antes nueva o responsable). */
export function avisoRevisionInventario(r, nombre, cuentadante, cargada) {
  if (!r?.revisionInventarioId) return;
  toast('info', cuentadante ? `${nombre} recibirá la cuenta antes como responsable` : `${nombre} debe revisar la cuenta antes`,
    (cargada ? `Se cargaron ${cargada.nuevos + cargada.actualizados} ítems. ` : '')
    + (cuentadante ? 'Queda como responsable cuando revise que la cuenta antes es conforme y la acepte.' : 'Antes de su primera entrega revisará si la cuenta antes es conforme a lo que hay en el ambiente.'), 9000);
}

/**
 * Asigna y, si se adjuntó, carga la cuenta antes; el instructor queda con su
 * revisión pendiente (cuentaAntes: true la abre aunque ya conozca el ambiente).
 */
export async function asignarConCuentaAntes(datos, cuentaAntes) {
  const conArchivo = cuentaAntes?.tieneArchivo();
  const r = await apiAmb.crearAsignacion({ ...datos, cuentaAntes: conArchivo || undefined });
  const cargada = conArchivo ? await cuentaAntes.cargarPendiente(datos.ambienteId) : null;
  if (conArchivo && !cargada) toast('error', 'Se asignó, pero no se cargó la cuenta antes', 'Súbela desde Editar ambiente → Cuenta antes.');
  return { r, cargada };
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
        h('span', { class: 'text-muted' }, `${ETIQUETA_MODO[modoDe(a)]} · ${describirAsignacion(a)}${a.motivo ? ` · ${a.motivo}` : ''}`)),
      pendiente ? h('span', { class: 'status-chip neutro' }, 'Se asigna al guardar')
        : a.fechaInicio <= hoy && (!a.fechaFin || a.fechaFin >= hoy) ? h('span', { class: 'status-chip in' }, 'Hoy') : h('span', { class: 'status-chip azul' }, 'Próxima'),
      h('div', { class: 'inv-fila-acciones' },
        !pendiente && h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => { editando = a.id; pintar(); } }, icono('lapiz'), 'Editar'),
        h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => anular(a) }, icono('prohibido'), pendiente ? 'Quitar' : 'Anular')));
  }

  /** Formulario en línea para agregar (a = null) o editar una asignación. */
  function editor(a) {
    const empezo = a && a.fechaInicio <= hoy;
    const id = (s) => `asig-${a?.id || 'nueva'}-${s}`;
    const campo = (clave, etiqueta, input) => h('div', { class: 'campo' }, h('label', { for: id(clave) }, etiqueta), input);
    const jornada = h('select', { id: id('jornada'), disabled: !!a }, JORNADAS.map((j) => h('option', { value: j.clave, selected: j.clave === a?.jornada }, `${j.etiqueta} (${j.horario})`)));
    const instructor = h('select', { id: id('inst') }, h('option', { value: '' }, 'Elige el instructor'),
      instructores.map((i) => h('option', { value: i.id, selected: i.id === a?.instructor.id }, i.nombre)));
    // Si ya empezó no se cambia entre "por días" y los demás, ni la fecha de inicio.
    const fechas = crearFechasAsignacion({
      prefijo: `asig-${a?.id || 'nueva'}`, hoy, asignacion: a, modo: 'permanente', jornada: () => jornada.value,
      bloquearModos: (m) => !!empezo && (m === 'dia') !== (a.tipo === 'dia'), inicioFijo: !!empezo,
    });
    jornada.addEventListener('change', () => fechas.repintar());
    const desde = h('input', { type: 'date', id: id('desde'), value: hoy, min: hoy, max: a?.fechaFin || undefined });
    const campoDesde = empezo && a.tipo !== 'dia' ? campo('desde', 'Si cambias el instructor, desde', desde) : null;
    const motivo = h('input', { type: 'text', id: id('motivo'), maxlength: 300, value: a?.motivo || '', placeholder: 'Ficha, competencia o motivo (opcional)' });
    // Solo al asignar: la cuenta antes que recibe (Excel) y si queda además como responsable.
    const esCuentadante = !a && h('input', { type: 'checkbox', id: id('cuentadante') });
    const cuentaAntes = !a && ambiente ? seccionCuentaAntes({ ambiente, prefijo: id('cuenta-antes'), alGuardar: true,
      ayuda: 'Opcional: el Excel con la cuenta antes que recibe el instructor. Se carga al asignar y él revisa si es conforme a lo que hay en el ambiente antes de su primera entrega.' }) : null;

    const guardar = h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => enviar() }, icono('check'), a ? 'Guardar cambios' : (ambiente ? 'Asignar' : 'Agregar'));
    const caja = h('div', { class: 'asig-amb-editor' },
      h('div', { class: 'form-grid' }, campo('jornada', 'Jornada', jornada), campo('inst', a && empezo ? 'Instructor (para cambiarlo se reasigna)' : 'Instructor', instructor), campoDesde),
      fechas.el,
      campo('motivo', 'Motivo', motivo),
      cuentaAntes?.el,
      esCuentadante && h('label', { class: 'interruptor' }, esCuentadante, h('span', { class: 'interruptor-pista', 'aria-hidden': 'true' }),
        'Queda como responsable de la cuenta antes (la revisa y la acepta)'),
      empezo && h('p', { class: 'text-muted asig-amb-ayuda' }, 'Esta asignación ya empezó: se conserva su fecha de inicio y los días anteriores quedan con quien los tuvo.'),
      h('div', { class: 'asig-amb-botones' },
        h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => { editando = null; pintar(); } }, 'Cancelar'), guardar));
    setTimeout(() => instructor.focus(), 0);
    return caja;

    async function enviar() {
      const datos = {
        ambienteId: ambiente?.id || -1, instructorId: Number(instructor.value) || null, jornada: jornada.value,
        ...fechas.leer(), motivo: motivo.value.trim() || undefined, cuentadante: esCuentadante?.checked || undefined,
      };
      // Al editar algo que ya empezó, la fecha de inicio pasada es válida.
      const errores = validarAsignacion({ ...datos, fechaInicio: empezo ? hoy : datos.fechaInicio }, hoy);
      errorCampo(instructor, errores.instructorId);
      fechas.errores(errores);
      if (Object.keys(errores).length) return;
      const nombre = instructores.find((i) => i.id === datos.instructorId)?.nombre;

      if (!ambiente) { // ambiente nuevo: queda pendiente
        const lista = datos.fechas || [null];
        lista.forEach((f) => pendientes.push({ id: `p${pendientes.length}`, ...datos, fechaInicio: f || datos.fechaInicio,
          fechaFin: f || datos.fechaFin || null, fechas: undefined, diasSemana: datos.diasSemana || [], instructor: { id: datos.instructorId, nombre } }));
        editando = null;
        pintar();
        return;
      }
      guardar.disabled = true;
      try {
        let advertencias = [];
        if (!a) {
          const { r, cargada } = await asignarConCuentaAntes(datos, cuentaAntes);
          advertencias = r.advertencias;
          avisoRevisionInventario(r, nombre, datos.cuentadante, cargada);
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
          if (datos.tipo !== actual.tipo) cambios.tipo = datos.tipo;
          if (!empezo && datos.fechaInicio !== actual.fechaInicio) cambios.fechaInicio = datos.fechaInicio;
          if (datos.tipo === 'periodo' && datos.fechaFin !== actual.fechaFin) cambios.fechaFin = datos.fechaFin;
          if (datos.tipo === 'permanente' && actual.fechaFin) cambios.fechaFin = null;
          if (datos.diasSemana !== undefined && String(datos.diasSemana || []) !== String(actual.diasSemana || [])) cambios.diasSemana = datos.diasSemana;
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
        if (e.codigo === 'DUPLICADO') errorCampo(fechas.modos, e.message); else toast('error', 'No se guardó la asignación', e.message);
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
          fechaFin: p.tipo === 'periodo' ? p.fechaFin : undefined, diasSemana: p.diasSemana?.length ? p.diasSemana : undefined, motivo: p.motivo, cuentadante: p.cuentadante });
        creadas++;
      } catch (e) { toast('error', `No se asignó a ${p.instructor.nombre}`, e.message); }
    }
    return creadas;
  }

  cargar();
  return { el, guardarPendientes };
}
