// Cuándo vale una asignación, igual en "Nueva asignación" (tablero) y en
// "Editar ambiente": Sin definir, Por semanas, Por días o Por rango de fechas.
//  · Sin definir: desde una fecha, sin fecha final (permanente); se puede
//    limitar a algunos días de la semana.
//  · Por semanas: semana de inicio + número de semanas + días de la semana →
//    periodo de lunes a domingo (rangoSemanas).
//  · Por días: uno o varios días sueltos.
//  · Por rango de fechas: inicio — fin.
// leer() devuelve lo que espera la API: {tipo, fechaInicio, fechaFin?, fechas?, diasSemana?}.
import { h, icono, vaciar, errorCampo } from './dom.js';
import { MODOS_ASIGNACION, DIAS_SEMANA, rangoSemanas, describirDiasSemana } from '../reglas.js';

const fmt = new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });
const dia = (iso) => fmt.format(new Date(`${iso}T12:00:00`));

/** Modo del formulario para una asignación existente. */
export function modoDe(a) {
  if (!a) return 'permanente';
  if (a.tipo === 'periodo' && a.diasSemana?.length) return 'semanas';
  return a.tipo;
}

/**
 * @param {{prefijo:string, hoy:string, modo?:string, asignacion?:object|null, fechaInicio?:string,
 *   jornada?:()=>string, bloquearModos?:(modo:string)=>boolean, inicioFijo?:boolean, variosDias?:boolean}} o
 */
export function crearFechasAsignacion({ prefijo, hoy, modo = 'permanente', asignacion: a = null, fechaInicio, jornada = () => 'manana', bloquearModos = () => false, inicioFijo = false, variosDias = true }) {
  let actual = a ? modoDe(a) : modo;
  const id = (s) => `${prefijo}-${s}`;
  const campo = (clave, etiqueta, input) => h('div', { class: 'campo' }, h('label', { for: id(clave) }, etiqueta), input);
  const desdeInicial = a?.fechaInicio || fechaInicio || hoy;

  const modos = h('div', { class: 'segmentos asig-modos', role: 'radiogroup', 'aria-label': '¿Por cuánto tiempo?' }, MODOS_ASIGNACION.map((m) => h('button', {
    class: 'segmento', type: 'button', role: 'radio', 'aria-checked': String(m.clave === actual), title: m.ayuda, 'data-modo': m.clave,
    disabled: bloquearModos(m.clave),
    onclick: () => { actual = m.clave; modos.querySelectorAll('.segmento').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.modo === actual))); pintar(); },
  }, m.etiqueta)));
  const ayuda = h('p', { class: 'text-muted asig-amb-ayuda' });

  const inicio = h('input', { type: 'date', id: id('inicio'), value: desdeInicial, min: inicioFijo ? undefined : hoy, disabled: inicioFijo });
  const fin = h('input', { type: 'date', id: id('fin'), value: a?.fechaFin || '', min: hoy });
  const semanas = h('input', { type: 'number', id: id('semanas'), min: 1, max: 52, inputmode: 'numeric',
    value: a && modoDe(a) === 'semanas' ? Math.max(1, Math.round((new Date(a.fechaFin) - new Date(a.fechaInicio)) / 604_800_000)) : 4 });
  const resumenSemanas = h('p', { class: 'text-muted asig-amb-ayuda', 'aria-live': 'polite' });
  semanas.addEventListener('input', resumir);
  inicio.addEventListener('change', resumir);

  // Días de la semana (Por semanas y Sin definir). Vacío en "Sin definir" = todos.
  const diasMarcados = new Set(a?.diasSemana?.length ? a.diasSemana : []);
  const dias = h('div', { class: 'opciones-chip asig-dias-semana', role: 'group', 'aria-labelledby': id('dias-t') }, DIAS_SEMANA.map((d) => {
    const input = h('input', { type: 'checkbox', value: d.n, checked: diasMarcados.has(d.n), onchange: (e) => { if (e.target.checked) diasMarcados.add(d.n); else diasMarcados.delete(d.n); resumir(); } });
    return h('label', { class: 'opcion-chip', title: d.nombre }, input, h('span', {}, d.corto));
  }));
  const campoDias = h('div', { class: 'full campo' }, h('label', { id: id('dias-t') }, 'Días de la semana'), dias);
  /** Por semanas: lunes a viernes por defecto (sábado y domingo si la jornada es de fin de semana). */
  function diasPorDefecto() {
    if (diasMarcados.size) return;
    (jornada() === 'fin_semana' ? [6, 7] : [1, 2, 3, 4, 5]).forEach((n) => diasMarcados.add(n));
    dias.querySelectorAll('input').forEach((i) => { i.checked = diasMarcados.has(Number(i.value)); });
  }

  // Por días: varios días sueltos (al editar una asignación de un día, solo ese día).
  const sueltos = new Set(a?.tipo === 'dia' ? [a.fechaInicio] : []);
  const nuevoDia = h('input', { type: 'date', id: id('dia'), value: desdeInicial, min: hoy });
  const listaDias = h('div', { class: 'asig-amb-dias' });
  const agregarDia = h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => {
    if (!nuevoDia.value || nuevoDia.value < hoy) { errorCampo(nuevoDia, 'Elige un día desde hoy.'); return; }
    errorCampo(nuevoDia, null); sueltos.add(nuevoDia.value); pintarDias();
  } }, icono('mas'), 'Agregar día');
  function pintarDias() {
    vaciar(listaDias, [...sueltos].sort().map((f) => h('span', { class: 'status-chip azul asig-amb-dia' }, dia(f),
      h('button', { class: 'boton-enlace', type: 'button', 'aria-label': `Quitar ${dia(f)}`, onclick: () => { sueltos.delete(f); pintarDias(); } }, icono('cerrar')))));
  }

  const zona = h('div', { class: 'form-grid asig-amb-fechas' });
  const el = h('div', { class: 'full asig-fechas' }, h('div', { class: 'campo' }, h('label', {}, '¿Por cuánto tiempo?'), modos, ayuda), zona);

  function resumir() {
    if (actual !== 'semanas') return;
    const { fechaInicio: i, fechaFin: f } = rangoSemanas(inicio.value || hoy, Number(semanas.value) || 1, hoy);
    const d = describirDiasSemana([...diasMarcados]);
    resumenSemanas.textContent = `Del ${dia(i)} al ${dia(f)}${d ? ` · solo ${d}` : ''}.`;
  }

  function pintar() {
    ayuda.textContent = MODOS_ASIGNACION.find((m) => m.clave === actual).ayuda;
    if (actual === 'dia') {
      vaciar(zona, a?.tipo === 'dia' || !variosDias ? campo('inicio', 'Día', inicio)
        : [campo('dia', 'Día', nuevoDia), h('div', { class: 'campo asig-amb-agregar-dia' }, agregarDia), h('div', { class: 'full' }, listaDias)]);
      pintarDias();
    } else if (actual === 'semanas') {
      diasPorDefecto();
      vaciar(zona, campo('inicio', 'Semana que empieza', inicio), campo('semanas', 'Número de semanas', semanas), campoDias, h('div', { class: 'full' }, resumenSemanas));
      resumir();
    } else if (actual === 'periodo') {
      vaciar(zona, campo('inicio', 'Fecha de inicio', inicio), campo('fin', 'Fecha final', fin));
    } else {
      vaciar(zona, campo('inicio', 'Desde', inicio), campoDias,
        h('p', { class: 'full text-muted asig-amb-ayuda' }, 'Sin días marcados vale todos los días de la jornada.'));
    }
  }
  pintar();

  /** Datos para la API. */
  function leer() {
    if (actual === 'dia') {
      const varios = !(a?.tipo === 'dia') && variosDias;
      return { tipo: 'dia', fechaInicio: varios ? [...sueltos].sort()[0] : inicio.value, fechas: varios ? [...sueltos].sort() : undefined };
    }
    if (actual === 'semanas') {
      const rango = rangoSemanas(inicio.value || hoy, Number(semanas.value) || 1, hoy);
      // Si ya empezó, su fecha de inicio no cambia (solo el final y los días).
      if (inicioFijo && a) rango.fechaInicio = a.fechaInicio;
      return { tipo: 'periodo', ...rango, diasSemana: [...diasMarcados].sort() };
    }
    if (actual === 'periodo') return { tipo: 'periodo', fechaInicio: inicio.value, fechaFin: fin.value, diasSemana: a?.diasSemana?.length ? null : undefined };
    return { tipo: 'permanente', fechaInicio: inicio.value, diasSemana: diasMarcados.size ? [...diasMarcados].sort() : (a?.diasSemana?.length ? null : undefined) };
  }

  /** Muestra los errores de validarAsignacion en los campos que están a la vista. */
  function errores(e) {
    [[inicio, e.fechaInicio], [fin, e.fechaFin], [nuevoDia, e.fechas], [dias, e.diasSemana], [modos, e.tipo]]
      .forEach(([c, error]) => { if (c.isConnected) errorCampo(c, error); });
  }

  return { el, modos, leer, errores, modo: () => actual, inicio, repintar: pintar };
}
