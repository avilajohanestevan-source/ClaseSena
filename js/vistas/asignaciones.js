// Asignación de instructores por jornada.
//  · Tablero semanal: quién está asignado a cada ambiente en cada jornada
//    (mañana, tarde, noche) cada día. Vale la asignación más específica:
//    un día > un periodo > permanente.
//  · Administrativo: asignar (por un día, por un periodo o permanente),
//    reasignar o anular un turno desde una fecha; cada cambio queda en el
//    historial de la asignación y en Auditoría, y se avisa al instructor.
//  · Instructor: ve el tablero y sus turnos.
import { h, anexar, icono, vaciar, errorCampo } from '../ui/dom.js';
import { anim } from '../ui/anim.js';
import { toast, abrirModal } from '../ui/avisos.js';
import { cargando, tarjetaError } from '../ui/componentes.js';
import { cabecera, vacio, lineaDeTiempo } from '../ui/ambientes-ui.js';
import { apiAmb } from '../api/ambientes.js';
import { estado } from '../estado.js';
import { fechaIso, JORNADAS, ETIQUETA_JORNADA, TIPOS_ASIGNACION, validarAsignacion } from '../reglas.js';

const DIAS = 7;
const fmtDia = new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });
const aFecha = (iso) => new Date(`${iso}T12:00:00`);
const sumarDias = (iso, n) => { const d = aFecha(iso); d.setDate(d.getDate() + n); return fechaIso(d); };
/** Lunes de la semana de la fecha. */
const lunes = (iso) => { const d = aFecha(iso); return sumarDias(iso, -((d.getDay() + 6) % 7)); };
const SIGLA_TIPO = { dia: ['1 día', 'azul'], periodo: ['Periodo', 'out'], permanente: ['Permanente', 'in'] };

export async function render(raiz, { params }) {
  const admin = estado.usuario.rol === 'administrativo';
  const hoy = fechaIso();
  let desde = lunes(params.get('desde') || hoy);
  let ambienteId = params.get('ambiente') || '';
  const [ambientes, instructores] = await Promise.all([apiAmb.ambientes(), admin ? apiAmb.usuarios('instructor') : Promise.resolve([])]);
  let tablero = null;

  const rango = h('strong', { class: 'asig-rango', 'aria-live': 'polite' });
  const cuerpo = h('div', { class: 'asig-cuerpo' }, cargando());
  const misTurnos = !admin && h('section', { class: 'card', 'data-anim': '' }, cargando());
  const filtroAmb = h('select', { 'aria-label': 'Ambiente', onchange: (e) => { ambienteId = e.target.value; cargar(); } },
    h('option', { value: '' }, 'Todos los ambientes'), ambientes.filter((a) => a.activo).map((a) => h('option', { value: a.id, selected: String(a.id) === ambienteId }, `${a.codigo} · ${a.nombre}`)));
  const mover = (n) => { desde = n === 0 ? lunes(hoy) : sumarDias(desde, n * DIAS); cargar(); };

  anexar(raiz,
    cabecera({
      eyebrow: 'Ambientes · Jornadas', titulo: admin ? 'Asignación de instructores' : 'Asignaciones por jornada',
      subtitulo: admin ? 'Asigna instructores a cada ambiente por jornada: por un día, por un periodo o de forma permanente. Reasigna o anula turnos; todo queda en el historial.'
        : 'Quién está asignado a cada ambiente en cada jornada.',
      acciones: admin ? [
        h('a', { class: 'btn btn-outline', href: '#/auditoria?entidad=asignacion' }, icono('historial'), 'Historial'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => formulario({}) }, icono('mas'), 'Nueva asignación')] : [],
    }),
    misTurnos,
    h('div', { class: 'barra-filtros asig-barra', 'data-anim': '' },
      h('div', { class: 'asig-semana' },
        h('button', { class: 'btn btn-outline btn-sm btn-icono', type: 'button', 'aria-label': 'Semana anterior', onclick: () => mover(-1) }, h('span', { class: 'asig-flecha-izq' }, icono('flecha'))),
        h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => mover(0) }, 'Esta semana'),
        h('button', { class: 'btn btn-outline btn-sm btn-icono', type: 'button', 'aria-label': 'Semana siguiente', onclick: () => mover(1) }, icono('flecha')),
        rango),
      filtroAmb),
    cuerpo,
    h('p', { class: 'text-muted asig-leyenda' }, 'Si un ambiente tiene varias asignaciones en la misma jornada, vale la más específica: un día > periodo > permanente.'));

  async function cargar() {
    history.replaceState(null, '', `#/asignaciones?desde=${desde}${ambienteId ? `&ambiente=${ambienteId}` : ''}`);
    rango.textContent = `${fmtDia.format(aFecha(desde))} – ${fmtDia.format(aFecha(sumarDias(desde, DIAS - 1)))}`;
    vaciar(cuerpo, cargando());
    try { tablero = await apiAmb.tableroAsignaciones({ desde, dias: DIAS, ambienteId: ambienteId || undefined }); } catch (e) { vaciar(cuerpo, tarjetaError(e, cargar)); return; }
    pintar();
    if (misTurnos) pintarMisTurnos();
  }

  function pintar() {
    if (!tablero.ambientes.length) { vaciar(cuerpo, vacio('No hay ambientes activos', '', 'ambiente')); return; }
    const celda = (amb, dia, jornada) => {
      const a = amb.celdas[dia][jornada];
      const pasado = dia < hoy;
      const etiqueta = `${amb.codigo}, ${ETIQUETA_JORNADA[jornada].toLowerCase()}, ${fmtDia.format(aFecha(dia))}: ${a ? a.instructor : 'sin asignar'}`;
      if (!a) {
        return h('td', { class: `asig-celda asig-celda--vacia${dia === hoy ? ' asig-hoy' : ''}` },
          admin && !pasado ? h('button', { class: 'asig-boton', type: 'button', 'aria-label': `Asignar: ${etiqueta}`, onclick: () => formulario({ ambienteId: amb.id, jornada, fechaInicio: dia }) }, icono('mas'))
            : h('span', { class: 'text-muted', 'aria-label': etiqueta }, '—'));
      }
      const [sigla, clase] = SIGLA_TIPO[a.tipo];
      const contenido = [h('strong', {}, a.instructor.split(' ').slice(0, 2).join(' ')), h('span', { class: `status-chip ${clase}` }, sigla)];
      return h('td', { class: `asig-celda asig-celda--${a.tipo}${dia === hoy ? ' asig-hoy' : ''}${a.instructorId === estado.usuario.id ? ' asig-celda--mia' : ''}` },
        admin ? h('button', { class: 'asig-boton', type: 'button', 'aria-label': `Ver asignación: ${etiqueta}`, onclick: () => detalle(a.id) }, contenido)
          : h('span', { class: 'asig-boton', 'aria-label': etiqueta }, contenido));
    };
    vaciar(cuerpo, h('section', { class: 'card asig-tablero' }, h('div', { class: 'table-wrap' }, h('table', { class: 'tabla-asignaciones' },
      h('caption', { class: 'sr-only' }, `Asignación de instructores del ${tablero.desde} al ${tablero.hasta}`),
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Ambiente'), h('th', { scope: 'col' }, 'Jornada'),
        tablero.fechas.map((f) => h('th', { scope: 'col', class: f === hoy ? 'asig-hoy' : '' }, fmtDia.format(aFecha(f)))))),
      tablero.ambientes.map((amb) => h('tbody', {}, JORNADAS.map((j, n) => h('tr', {},
        n === 0 && h('th', { scope: 'rowgroup', rowspan: JORNADAS.length, class: 'asig-amb' }, h('strong', {}, amb.codigo), h('span', { class: 'text-muted' }, amb.nombre)),
        h('th', { scope: 'row', class: 'asig-jornada' }, j.etiqueta, h('span', { class: 'text-muted' }, j.horario)),
        tablero.fechas.map((dia) => celda(amb, dia, j.clave))))))))));
    anim.lista(cuerpo.children, { autoAlpha: 0, y: 6 });
  }

  async function pintarMisTurnos() {
    let lista;
    try { lista = await apiAmb.asignaciones(); } catch (e) { vaciar(misTurnos, h('p', { class: 'text-muted' }, e.message)); return; }
    vaciar(misTurnos, h('h3', { class: 'bloque-titulo' }, `Mis turnos vigentes (${lista.length})`),
      lista.length ? h('ul', { class: 'inv-lista' }, lista.map((a) => h('li', { class: 'inv-fila' },
        h('div', { class: 'inv-fila-datos' }, h('strong', {}, `Ambiente ${a.ambiente.codigo} · ${ETIQUETA_JORNADA[a.jornada]}`), h('span', { class: 'text-muted' }, describir(a))),
        h('span', { class: `status-chip ${SIGLA_TIPO[a.tipo][1]}` }, SIGLA_TIPO[a.tipo][0]))))
        : h('p', { class: 'text-muted' }, 'No tienes turnos asignados desde hoy.'));
  }

  function describir(a) {
    return a.tipo === 'dia' ? `Solo el ${a.fechaInicio}` : a.fechaFin ? `Del ${a.fechaInicio} al ${a.fechaFin}` : `Desde el ${a.fechaInicio}, sin fecha final`;
  }

  /* ---------------- detalle: reasignar o anular ---------------- */

  async function detalle(id) {
    let a;
    try { a = await apiAmb.asignacion(id); } catch (e) { toast('error', 'No se abrió la asignación', e.message); return; }
    const vigente = a.estado === 'vigente' && (a.fechaFin === null || a.fechaFin >= hoy);
    abrirModal({
      titulo: `${a.instructor.nombre}`, subtitulo: `Ambiente ${a.ambiente.codigo} · ${ETIQUETA_JORNADA[a.jornada]} · ${describir(a)}`, ancho: 'normal',
      contenido: h('div', { class: 'novedad-detalle' },
        h('dl', { class: 'detalle-datos' },
          h('dt', {}, 'Tipo'), h('dd', {}, TIPOS_ASIGNACION.find((t) => t.clave === a.tipo).etiqueta),
          h('dt', {}, 'Estado'), h('dd', {}, a.estado === 'vigente' ? 'Vigente' : a.estado === 'reasignada' ? 'Reasignada' : 'Anulada'),
          a.motivo && [h('dt', {}, 'Motivo'), h('dd', {}, a.motivo)],
          h('dt', {}, 'Asignó'), h('dd', {}, `${a.creadaPor || '—'}`)),
        h('h3', { class: 'bloque-titulo' }, 'Historial'),
        lineaDeTiempo(a.eventos)),
      acciones: vigente ? [
        ({ cerrar }) => h('button', { class: 'btn btn-outline', type: 'button', onclick: () => { cerrar(); anular(a); } }, icono('prohibido'), 'Anular turno'),
        ({ cerrar }) => h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { cerrar(); reasignar(a); } }, icono('usuarios'), 'Reasignar'),
      ] : [],
    });
  }

  /** Fecha desde la que aplica un cambio: entre max(hoy, inicio) y el fin. */
  function campoDesde(a, id) {
    const min = a.fechaInicio > hoy ? a.fechaInicio : hoy;
    return h('input', { type: 'date', id, value: min, min, max: a.fechaFin || undefined, disabled: a.tipo === 'dia' });
  }

  function reasignar(a) {
    const instructor = h('select', { id: 'ra-inst' }, h('option', { value: '' }, 'Elige el instructor'),
      instructores.filter((i) => i.id !== a.instructor.id).map((i) => h('option', { value: i.id }, i.nombre)));
    const desdeInput = campoDesde(a, 'ra-desde');
    const motivo = h('input', { type: 'text', id: 'ra-motivo', maxlength: 300, placeholder: 'Ej.: cambio de horario, incapacidad…' });
    const guardar = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => enviar() }, icono('check'), 'Reasignar');
    const c = (id, etiqueta, input) => h('div', { class: 'campo' }, h('label', { for: id }, etiqueta), input);
    const { cerrar } = abrirModal({
      titulo: 'Reasignar turno', subtitulo: `Ambiente ${a.ambiente.codigo} · ${ETIQUETA_JORNADA[a.jornada]} · ahora: ${a.instructor.nombre}`, ancho: 'angosto',
      contenido: h('div', { class: 'form-grid' },
        h('div', { class: 'full' }, c('ra-inst', 'Nuevo instructor', instructor)),
        h('div', { class: 'full' }, c('ra-desde', a.tipo === 'dia' ? 'Día' : 'Desde', desdeInput)),
        h('div', { class: 'full' }, c('ra-motivo', 'Motivo', motivo)),
        h('p', { class: 'full text-muted' }, `${a.instructor.nombre} conserva los días anteriores. Se avisa a ambos instructores.`)),
      acciones: [({ cerrar: x }) => h('button', { class: 'btn btn-outline', type: 'button', onclick: () => x() }, 'Cancelar'), guardar],
    });
    async function enviar() {
      errorCampo(instructor, instructor.value ? null : 'Elige el instructor.');
      errorCampo(motivo, motivo.value.trim() ? null : 'Escribe el motivo.');
      if (!instructor.value || !motivo.value.trim()) return;
      guardar.disabled = true;
      try {
        const r = await apiAmb.reasignar(a.id, { instructorId: Number(instructor.value), motivo: motivo.value.trim(), desde: a.tipo === 'dia' ? undefined : desdeInput.value });
        toast('exito', 'Turno reasignado', `${r.asignacion.instructor.nombre} · ${ETIQUETA_JORNADA[a.jornada]} desde el ${r.asignacion.fechaInicio}`);
        avisar(r.advertencias);
        cerrar();
        cargar();
      } catch (e) { toast('error', 'No se reasignó', e.message); guardar.disabled = false; }
    }
  }

  function anular(a) {
    const desdeInput = campoDesde(a, 'an-desde');
    const motivo = h('input', { type: 'text', id: 'an-motivo', maxlength: 300, placeholder: 'Ej.: se cerró la ficha' });
    const guardar = h('button', { class: 'btn btn-peligro', type: 'button', onclick: () => enviar() }, icono('prohibido'), 'Anular turno');
    const c = (id, etiqueta, input) => h('div', { class: 'campo' }, h('label', { for: id }, etiqueta), input);
    const { cerrar } = abrirModal({
      titulo: 'Anular turno', subtitulo: `${a.instructor.nombre} · ambiente ${a.ambiente.codigo} · ${ETIQUETA_JORNADA[a.jornada]}`, ancho: 'angosto',
      contenido: h('div', { class: 'form-grid' },
        h('div', { class: 'full' }, c('an-desde', a.tipo === 'dia' ? 'Día' : 'Anular desde', desdeInput)),
        h('div', { class: 'full' }, c('an-motivo', 'Motivo', motivo)),
        h('p', { class: 'full text-muted' }, 'Los días anteriores quedan como estaban. Se avisa al instructor.')),
      acciones: [({ cerrar: x }) => h('button', { class: 'btn btn-outline', type: 'button', onclick: () => x() }, 'Cancelar'), guardar],
    });
    async function enviar() {
      errorCampo(motivo, motivo.value.trim() ? null : 'Escribe el motivo.');
      if (!motivo.value.trim()) return;
      guardar.disabled = true;
      try {
        await apiAmb.anularAsignacion(a.id, { motivo: motivo.value.trim(), desde: a.tipo === 'dia' ? undefined : desdeInput.value });
        toast('exito', 'Turno anulado', `${a.instructor.nombre} · ambiente ${a.ambiente.codigo}`);
        cerrar();
        cargar();
      } catch (e) { toast('error', 'No se anuló', e.message); guardar.disabled = false; }
    }
  }

  function avisar(advertencias = []) {
    if (advertencias.length) toast('aviso', 'Revisa el horario del instructor', advertencias.join(' · '), 9000);
  }

  /* ---------------- nueva asignación ---------------- */

  function formulario({ ambienteId: amb = ambienteId, jornada = 'manana', fechaInicio = hoy > desde ? hoy : desde }) {
    let tipo = 'permanente';
    const c = (id, etiqueta, input) => h('div', { class: 'campo' }, h('label', { for: id }, etiqueta), input);
    const ambSel = h('select', { id: 'as-amb' }, h('option', { value: '' }, 'Elige el ambiente'),
      ambientes.filter((a) => a.activo).map((a) => h('option', { value: a.id, selected: String(a.id) === String(amb) }, `${a.codigo} · ${a.nombre}`)));
    const instSel = h('select', { id: 'as-inst' }, h('option', { value: '' }, 'Elige el instructor'), instructores.map((i) => h('option', { value: i.id }, i.nombre)));
    const jornadas = h('div', { class: 'opciones-chip', role: 'radiogroup', 'aria-labelledby': 'as-jornada' }, JORNADAS.map((j) => h('label', { class: 'opcion-chip' },
      h('input', { type: 'radio', name: 'as-jornada', value: j.clave, checked: j.clave === jornada }), h('span', {}, `${j.etiqueta} · ${j.horario}`))));
    const tipos = h('div', { class: 'prioridades', role: 'radiogroup', 'aria-labelledby': 'as-tipo' }, TIPOS_ASIGNACION.map((t) => h('label', { class: 'prioridad naturaleza--temporal' },
      h('input', { type: 'radio', name: 'as-tipo', value: t.clave, checked: t.clave === tipo, onchange: () => { tipo = t.clave; pintarFechas(); } }),
      h('strong', {}, t.etiqueta), h('span', {}, t.ayuda))));
    const inicio = h('input', { type: 'date', id: 'as-inicio', value: fechaInicio, min: hoy });
    const fin = h('input', { type: 'date', id: 'as-fin', value: sumarDias(fechaInicio, 30), min: hoy });
    const campoFin = h('div', {}, c('as-fin', 'Fecha final', fin));
    const etiquetaInicio = h('label', { for: 'as-inicio' }, 'Desde');
    const motivo = h('input', { type: 'text', id: 'as-motivo', maxlength: 300, placeholder: 'Ej.: ficha 2758432, reemplazo por incapacidad…' });
    function pintarFechas() {
      campoFin.hidden = tipo !== 'periodo';
      etiquetaInicio.textContent = tipo === 'dia' ? 'Día' : 'Desde';
    }
    pintarFechas();
    const guardar = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => enviar() }, icono('check'), 'Asignar');
    const { cerrar } = abrirModal({
      titulo: 'Nueva asignación', subtitulo: 'El instructor recibe un aviso con el ambiente, la jornada y las fechas.', ancho: 'normal',
      contenido: h('div', { class: 'form-grid' },
        c('as-amb', 'Ambiente', ambSel), c('as-inst', 'Instructor', instSel),
        h('div', { class: 'full campo' }, h('label', { id: 'as-jornada' }, 'Jornada'), jornadas),
        h('div', { class: 'full campo' }, h('label', { id: 'as-tipo' }, '¿Por cuánto tiempo?'), tipos),
        h('div', { class: 'campo' }, etiquetaInicio, inicio), campoFin,
        h('div', { class: 'full' }, c('as-motivo', 'Motivo o ficha (opcional)', motivo))),
      acciones: [({ cerrar: x }) => h('button', { class: 'btn btn-outline', type: 'button', onclick: () => x() }, 'Cancelar'), guardar],
    });
    async function enviar() {
      const datos = {
        ambienteId: Number(ambSel.value) || null, instructorId: Number(instSel.value) || null,
        jornada: jornadas.querySelector('input:checked')?.value, tipo, fechaInicio: inicio.value, fechaFin: tipo === 'periodo' ? fin.value : undefined,
        motivo: motivo.value.trim() || undefined,
      };
      const errores = validarAsignacion(datos, hoy);
      errorCampo(ambSel, errores.ambienteId); errorCampo(instSel, errores.instructorId); errorCampo(jornadas, errores.jornada);
      errorCampo(inicio, errores.fechaInicio); errorCampo(fin, errores.fechaFin);
      if (Object.keys(errores).length) return;
      guardar.disabled = true;
      try {
        const r = await apiAmb.crearAsignacion(datos);
        toast('exito', 'Instructor asignado', `${r.asignacion.instructor.nombre} · ambiente ${r.asignacion.ambiente.codigo} · ${ETIQUETA_JORNADA[r.asignacion.jornada]}`);
        avisar(r.advertencias);
        cerrar();
        cargar();
      } catch (e) {
        if (e.codigo === 'DUPLICADO') errorCampo(tipos, e.message); else toast('error', 'No se asignó', e.message);
        guardar.disabled = false;
      }
    }
  }

  await cargar();
  anim.entrarVista(raiz);
}
