// Asignación de instructores por jornada.
//  · Tablero por semana o por mes: quién está asignado a cada ambiente en
//    cada jornada (mañana, tarde, noche y fin de semana) cada día, con filtro
//    por jornada y por ambiente. Vale la asignación más específica: un día >
//    un periodo > sin definir.
//  · Administrativo: ve todas y las cambia: asignar (sin definir, por
//    semanas, por días o por rango de fechas), reasignar o anular un turno desde una fecha; cada
//    cambio queda en el historial de la asignación y en Auditoría, y se avisa
//    al instructor.
//  · Portero: ve todas (tablero y detalle con su historial) sin cambiar nada.
//  · Instructor: solo ve dónde está asignado él (el servidor no le envía las
//    asignaciones de los demás).
import { h, anexar, icono, vaciar, errorCampo } from '../ui/dom.js';
import { anim } from '../ui/anim.js';
import { toast, abrirModal } from '../ui/avisos.js';
import { cargando, tarjetaError } from '../ui/componentes.js';
import { cabecera, vacio, lineaDeTiempo } from '../ui/ambientes-ui.js';
import { apiAmb } from '../api/ambientes.js';
import { estado } from '../estado.js';
import { crearFechasAsignacion, modoDe } from '../ui/fechas-asignacion.js';
import { describirAsignacion as describirFechas, avisoRevisionInventario, asignarConCuentaAntes } from '../ui/asignaciones-ambiente.js';
import { seccionCuentaAntes } from '../ui/cuenta-antes.js';
import { fechaIso, JORNADAS, ETIQUETA_JORNADA, MODOS_ASIGNACION, DIAS_SEMANA, validarAsignacion, diaSemana } from '../reglas.js';

const DIAS = 7;
const fmtDia = new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtMes = new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric' });
const SIGLA_JORNADA = { manana: 'M', tarde: 'T', noche: 'N', fin_semana: 'FS' };
/** Primer día del mes de la fecha. */
const primeroDeMes = (iso) => `${iso.slice(0, 7)}-01`;
const sumarMeses = (iso, n) => { const d = aFechaMes(iso); d.setMonth(d.getMonth() + n); return fechaIso(d); };
function aFechaMes(iso) { return new Date(`${primeroDeMes(iso)}T12:00:00`); }
const aFecha = (iso) => new Date(`${iso}T12:00:00`);
const sumarDias = (iso, n) => { const d = aFecha(iso); d.setDate(d.getDate() + n); return fechaIso(d); };
/** Lunes de la semana de la fecha. */
const lunes = (iso) => { const d = aFecha(iso); return sumarDias(iso, -((d.getDay() + 6) % 7)); };
const SIGLA_TIPO = { dia: ['Día', 'azul'], periodo: ['Rango', 'out'], semanas: ['Semanas', 'out'], permanente: ['Sin definir', 'in'] };
const sigla = (a) => SIGLA_TIPO[a.tipo === 'periodo' && a.diasSemana?.length ? 'semanas' : a.tipo];
/** La jornada de fin de semana solo existe sábados y domingos. */
const jornadaAplica = (jornada, dia) => jornada !== 'fin_semana' || diaSemana(dia) >= 6;

export async function render(raiz, { params }) {
  const admin = estado.usuario.rol === 'administrativo';
  const instructor = estado.usuario.rol === 'instructor';
  const veDetalle = !instructor; // administrativo y portero abren el detalle (el portero, sin acciones)
  const hoy = fechaIso();
  let vista = params.get('vista') === 'mes' ? 'mes' : 'semana';
  let desde = vista === 'mes' ? primeroDeMes(params.get('desde') || hoy) : lunes(params.get('desde') || hoy);
  let ambienteId = params.get('ambiente') || '';
  let jornadaFiltro = JORNADAS.some((j) => j.clave === params.get('jornada')) ? params.get('jornada') : '';
  const [ambientes, instructores] = await Promise.all([apiAmb.ambientes(), admin ? apiAmb.usuarios('instructor') : Promise.resolve([])]);
  let tablero = null;

  const rango = h('strong', { class: 'asig-rango', 'aria-live': 'polite' });
  const cuerpo = h('div', { class: 'asig-cuerpo' }, cargando());
  const misTurnos = instructor && h('section', { class: 'card', 'data-anim': '' }, cargando());
  const filtroAmb = h('select', { 'aria-label': 'Ambiente', onchange: (e) => { ambienteId = e.target.value; cargar(); } },
    h('option', { value: '' }, 'Todos los ambientes'), ambientes.filter((a) => a.activo).map((a) => h('option', { value: a.id, selected: String(a.id) === ambienteId }, `${a.codigo} · ${a.nombre}`)));
  const mover = (n) => {
    if (vista === 'mes') desde = n === 0 ? primeroDeMes(hoy) : sumarMeses(desde, n);
    else desde = n === 0 ? lunes(hoy) : sumarDias(desde, n * DIAS);
    cargar();
  };
  const botonHoy = h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => mover(0) }, 'Esta semana');
  const etiquetaAnterior = () => (vista === 'mes' ? 'Mes anterior' : 'Semana anterior');
  const anterior = h('button', { class: 'btn btn-outline btn-sm btn-icono', type: 'button', 'aria-label': 'Semana anterior', onclick: () => mover(-1) }, h('span', { class: 'asig-flecha-izq' }, icono('flecha')));
  const siguiente = h('button', { class: 'btn btn-outline btn-sm btn-icono', type: 'button', 'aria-label': 'Semana siguiente', onclick: () => mover(1) }, icono('flecha'));
  const vistas = h('div', { class: 'segmentos', role: 'tablist', 'aria-label': 'Vista' }, [['semana', 'Semana'], ['mes', 'Mes']].map(([clave, texto]) => h('button', {
    class: 'segmento', type: 'button', role: 'tab', 'data-vista': clave, 'aria-selected': String(vista === clave),
    onclick: () => {
      if (vista === clave) return;
      vista = clave;
      desde = vista === 'mes' ? primeroDeMes(desde < hoy && sumarDias(desde, 6) >= hoy ? hoy : desde) : lunes(desde.slice(0, 7) === hoy.slice(0, 7) ? hoy : desde);
      vistas.querySelectorAll('.segmento').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.vista === vista)));
      cargar();
    },
  }, icono('calendario'), texto)));
  const filtroJornada = h('select', { 'aria-label': 'Jornada', onchange: (e) => { jornadaFiltro = e.target.value; cargar(); } },
    h('option', { value: '' }, 'Todas las jornadas'), JORNADAS.map((j) => h('option', { value: j.clave, selected: j.clave === jornadaFiltro }, j.etiqueta)));

  anexar(raiz,
    cabecera({
      eyebrow: 'Ambientes · Jornadas', titulo: admin ? 'Asignación de instructores' : instructor ? 'Mis asignaciones' : 'Asignaciones por jornada',
      subtitulo: admin ? 'Asigna instructores a cada ambiente por jornada (mañana, tarde, noche o fin de semana): sin definir, por semanas, por días o por rango de fechas. Reasigna o anula turnos; todo queda en el historial.'
        : instructor ? 'Los ambientes y jornadas donde estás asignado. Si algo no coincide, habla con coordinación.'
          : 'Quién está asignado a cada ambiente en cada jornada. Solo coordinación puede cambiar las asignaciones.',
      acciones: admin ? [
        h('a', { class: 'btn btn-outline', href: '#/auditoria?entidad=asignacion' }, icono('historial'), 'Historial'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => formulario({}) }, icono('mas'), 'Nueva asignación')] : [],
    }),
    misTurnos,
    h('div', { class: 'barra-filtros asig-barra', 'data-anim': '' },
      vistas,
      h('div', { class: 'asig-semana' }, anterior, botonHoy, siguiente, rango),
      filtroJornada,
      instructor ? null : filtroAmb),
    cuerpo,
    h('p', { class: 'text-muted asig-leyenda' }, 'Si un ambiente tiene varias asignaciones en la misma jornada, vale la más específica: por días > por semanas o rango de fechas > sin definir. La jornada de fin de semana solo aplica sábados y domingos.'));

  /** Mes: las semanas completas (lunes a domingo) que cubren el mes. */
  function rangoVista() {
    if (vista === 'semana') return { inicio: desde, dias: DIAS };
    const inicio = lunes(desde);
    const ultimo = sumarDias(sumarMeses(desde, 1), -1);
    const fin = sumarDias(lunes(ultimo), 6);
    return { inicio, dias: Math.round((aFecha(fin) - aFecha(inicio)) / 86_400_000) + 1 };
  }

  async function cargar() {
    history.replaceState(null, '', `#/asignaciones?vista=${vista}&desde=${desde}${ambienteId ? `&ambiente=${ambienteId}` : ''}${jornadaFiltro ? `&jornada=${jornadaFiltro}` : ''}`);
    const r = rangoVista();
    rango.textContent = vista === 'mes' ? fmtMes.format(aFecha(desde)).replace(/^./, (c) => c.toUpperCase())
      : `${fmtDia.format(aFecha(desde))} – ${fmtDia.format(aFecha(sumarDias(desde, DIAS - 1)))}`;
    botonHoy.textContent = vista === 'mes' ? 'Este mes' : 'Esta semana';
    anterior.setAttribute('aria-label', etiquetaAnterior());
    siguiente.setAttribute('aria-label', vista === 'mes' ? 'Mes siguiente' : 'Semana siguiente');
    vaciar(cuerpo, cargando());
    try { tablero = await apiAmb.tableroAsignaciones({ desde: r.inicio, dias: r.dias, ambienteId: ambienteId || undefined }); } catch (e) { vaciar(cuerpo, tarjetaError(e, cargar)); return; }
    if (vista === 'mes') pintarMes(); else pintar();
    if (misTurnos) pintarMisTurnos();
  }

  const jornadasVisibles = () => JORNADAS.filter((j) => !jornadaFiltro || j.clave === jornadaFiltro);

  function sinAmbientes() {
    vaciar(cuerpo, instructor ? vacio(`No tienes turnos ${vista === 'mes' ? 'este mes' : 'esta semana'}`, 'Usa las flechas para ver otras fechas.', 'calendario') : vacio('No hay ambientes activos', '', 'ambiente'));
  }

  /* --- vista mensual: calendario; cada día lista las jornadas asignadas de cada ambiente --- */
  function pintarMes() {
    if (!tablero.ambientes.length) { sinAmbientes(); return; }
    const mes = desde.slice(0, 7);
    const varios = tablero.ambientes.length > 1;
    const semanas = [];
    for (let i = 0; i < tablero.fechas.length; i += 7) semanas.push(tablero.fechas.slice(i, i + 7));
    const entradas = (dia) => tablero.ambientes.flatMap((amb) => jornadasVisibles().filter((j) => jornadaAplica(j.clave, dia)).map((j) => ({ amb, j, a: amb.celdas[dia][j.clave] })))
      .filter((x) => x.a || (admin && !varios && dia >= hoy));
    const celdaDia = (dia) => {
      const fuera = dia.slice(0, 7) !== mes;
      const lista = entradas(dia);
      return h('td', { class: `asig-mes-dia${fuera ? ' asig-mes-dia--fuera' : ''}${dia === hoy ? ' asig-hoy' : ''}` },
        h('span', { class: 'asig-mes-numero' }, String(Number(dia.slice(8)))),
        h('ul', { class: 'asig-mes-lista' }, lista.map(({ amb, j, a }) => {
          const texto = [varios && h('strong', {}, amb.codigo), h('span', { class: `asig-mes-jornada asig-mes-jornada--${j.clave}`, title: j.etiqueta }, SIGLA_JORNADA[j.clave]),
            a ? [h('span', { class: 'asig-mes-nombre' }, ` ${a.instructor.split(' ').slice(0, 2).join(' ')}`),
              h('span', { class: 'asig-mes-iniciales', 'aria-hidden': 'true' }, ` ${a.instructor.split(' ').slice(0, 2).map((p) => p[0]).join('')}`)]
              : h('span', { class: 'text-muted' }, h('span', { class: 'asig-mes-nombre' }, ' sin asignar'), h('span', { class: 'asig-mes-iniciales', 'aria-hidden': 'true' }, ' —'))];
          const etiqueta = `${amb.codigo}, ${j.etiqueta.toLowerCase()}, ${fmtDia.format(aFecha(dia))}: ${a ? a.instructor : 'sin asignar'}`;
          return h('li', { class: `asig-mes-item${a ? ` asig-celda--${a.tipo}` : ''}${a?.instructorId === estado.usuario.id ? ' asig-celda--mia' : ''}` },
            a && veDetalle ? h('button', { class: 'asig-mes-boton', type: 'button', 'aria-label': `Ver asignación: ${etiqueta}`, onclick: () => detalle(a.id) }, texto)
              : !a && admin ? h('button', { class: 'asig-mes-boton', type: 'button', 'aria-label': `Asignar: ${etiqueta}`, onclick: () => formulario({ ambienteId: amb.id, jornada: j.clave, fechaInicio: dia }) }, texto)
                : h('span', { 'aria-label': etiqueta }, texto));
        })));
    };
    vaciar(cuerpo, h('section', { class: 'card asig-tablero' },
      h('div', { class: 'table-wrap' }, h('table', { class: 'tabla-mes' },
        h('caption', { class: 'sr-only' }, `Asignaciones de ${fmtMes.format(aFecha(desde))}`),
        h('thead', {}, h('tr', {}, DIAS_SEMANA.map((d) => h('th', { scope: 'col' }, d.corto)))),
        h('tbody', {}, semanas.map((sem) => h('tr', {}, sem.map(celdaDia)))))),
      h('p', { class: 'text-muted asig-leyenda asig-mes-leyenda' },
        JORNADAS.map((j) => h('span', {}, h('span', { class: `asig-mes-jornada asig-mes-jornada--${j.clave}` }, SIGLA_JORNADA[j.clave]), ` ${j.etiqueta.toLowerCase()}`)),
        admin && varios ? h('span', {}, 'Elige un ambiente para asignar desde el calendario.') : null)));
    anim.lista(cuerpo.children, { autoAlpha: 0, y: 6 });
  }

  function pintar() {
    if (!tablero.ambientes.length) { sinAmbientes(); return; }
    const celda = (amb, dia, jornada) => {
      const a = amb.celdas[dia][jornada];
      const pasado = dia < hoy;
      // El instructor solo recibe sus turnos: una celda vacía es "no te toca", no "sin asignar".
      const etiqueta = `${amb.codigo}, ${ETIQUETA_JORNADA[jornada].toLowerCase()}, ${fmtDia.format(aFecha(dia))}: ${a ? a.instructor : instructor ? 'no tienes turno' : 'sin asignar'}`;
      if (!jornadaAplica(jornada, dia)) return h('td', { class: 'asig-celda asig-celda--no-aplica', 'aria-label': `${amb.codigo}: el fin de semana no aplica entre semana` });
      if (!a) {
        return h('td', { class: `asig-celda asig-celda--vacia${dia === hoy ? ' asig-hoy' : ''}` },
          admin && !pasado ? h('button', { class: 'asig-boton', type: 'button', 'aria-label': `Asignar: ${etiqueta}`, onclick: () => formulario({ ambienteId: amb.id, jornada, fechaInicio: dia }) }, icono('mas'))
            : h('span', { class: 'text-muted', 'aria-label': etiqueta }, instructor ? '' : '—'));
      }
      const [texto, clase] = sigla(a);
      const contenido = [h('strong', {}, a.instructor.split(' ').slice(0, 2).join(' ')), h('span', { class: `status-chip ${clase}` }, texto)];
      return h('td', { class: `asig-celda asig-celda--${a.tipo}${dia === hoy ? ' asig-hoy' : ''}${a.instructorId === estado.usuario.id ? ' asig-celda--mia' : ''}` },
        veDetalle ? h('button', { class: 'asig-boton', type: 'button', 'aria-label': `Ver asignación: ${etiqueta}`, onclick: () => detalle(a.id) }, contenido)
          : h('span', { class: 'asig-boton', 'aria-label': etiqueta }, contenido));
    };
    vaciar(cuerpo, h('section', { class: 'card asig-tablero' }, h('div', { class: 'table-wrap' }, h('table', { class: 'tabla-asignaciones' },
      h('caption', { class: 'sr-only' }, `Asignación de instructores del ${tablero.desde} al ${tablero.hasta}`),
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Ambiente'), h('th', { scope: 'col' }, 'Jornada'),
        tablero.fechas.map((f) => h('th', { scope: 'col', class: f === hoy ? 'asig-hoy' : '' }, fmtDia.format(aFecha(f)))))),
      tablero.ambientes.map((amb) => h('tbody', {}, jornadasVisibles().map((j, n, visibles) => h('tr', {},
        n === 0 && h('th', { scope: 'rowgroup', rowspan: visibles.length, class: 'asig-amb' }, h('strong', {}, amb.codigo), h('span', { class: 'text-muted' }, amb.nombre)),
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
        h('span', { class: `status-chip ${sigla(a)[1]}` }, sigla(a)[0]))))
        : h('p', { class: 'text-muted' }, 'No tienes turnos asignados desde hoy.'));
  }

  function describir(a) {
    return describirFechas(a) + (a.tipo === 'permanente' ? ', sin fecha final' : '');
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
          h('dt', {}, 'Tipo'), h('dd', {}, MODOS_ASIGNACION.find((t) => t.clave === modoDe(a)).etiqueta),
          h('dt', {}, 'Estado'), h('dd', {}, a.estado === 'vigente' ? 'Vigente' : a.estado === 'reasignada' ? 'Reasignada' : 'Anulada'),
          a.motivo && [h('dt', {}, 'Motivo'), h('dd', {}, a.motivo)],
          h('dt', {}, 'Asignó'), h('dd', {}, `${a.creadaPor || '—'}`)),
        h('h3', { class: 'bloque-titulo' }, 'Historial'),
        lineaDeTiempo(a.eventos)),
      // Solo el administrativo cambia asignaciones; el portero solo consulta.
      acciones: vigente && admin ? [
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

  function formulario({ ambienteId: amb = ambienteId, jornada = jornadaFiltro || 'manana', fechaInicio = hoy > desde ? hoy : desde }) {
    const c = (id, etiqueta, input) => h('div', { class: 'campo' }, h('label', { for: id }, etiqueta), input);
    const ambSel = h('select', { id: 'as-amb' }, h('option', { value: '' }, 'Elige el ambiente'),
      ambientes.filter((a) => a.activo).map((a) => h('option', { value: a.id, selected: String(a.id) === String(amb) }, `${a.codigo} · ${a.nombre}`)));
    const instSel = h('select', { id: 'as-inst' }, h('option', { value: '' }, 'Elige el instructor'), instructores.map((i) => h('option', { value: i.id }, i.nombre)));
    const jornadas = h('div', { class: 'opciones-chip', role: 'radiogroup', 'aria-labelledby': 'as-jornada' }, JORNADAS.map((j) => h('label', { class: 'opcion-chip' },
      h('input', { type: 'radio', name: 'as-jornada', value: j.clave, checked: j.clave === jornada, onchange: () => fechas.repintar() }), h('span', {}, `${j.etiqueta} · ${j.horario}`))));
    const jornadaElegida = () => jornadas.querySelector('input:checked')?.value;
    // Sin definir, por semanas, por días o por rango de fechas (js/ui/fechas-asignacion.js).
    const fechas = crearFechasAsignacion({ prefijo: 'as', hoy, fechaInicio, jornada: jornadaElegida, modo: 'permanente' });
    const motivo = h('input', { type: 'text', id: 'as-motivo', maxlength: 300, placeholder: 'Ej.: ficha 2758432, reemplazo por incapacidad…' });
    const esCuentadante = h('input', { type: 'checkbox', id: 'as-cuentadante' });
    const cuentaAntes = seccionCuentaAntes({ ambienteId: () => Number(ambSel.value) || null, prefijo: 'as-cuenta-antes', alGuardar: true,
      ayuda: 'Opcional: el Excel con la cuenta antes que recibe el instructor (placa, descripción, serial, categoría, valor…). Se carga al asignar y él revisa si es conforme a lo que hay en el ambiente.' });
    ambSel.addEventListener('change', () => cuentaAntes.previsualizar());
    const guardar = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => enviar() }, icono('check'), 'Asignar');
    const { cerrar } = abrirModal({
      titulo: 'Nueva asignación', subtitulo: 'El instructor recibe un aviso con el ambiente, la jornada y las fechas.', ancho: 'normal',
      contenido: h('div', { class: 'form-grid' },
        c('as-amb', 'Ambiente', ambSel), c('as-inst', 'Instructor', instSel),
        h('div', { class: 'full campo' }, h('label', { id: 'as-jornada' }, 'Jornada'), jornadas),
        fechas.el,
        h('div', { class: 'full' }, c('as-motivo', 'Motivo o ficha (opcional)', motivo)),
        cuentaAntes.el,
        h('label', { class: 'interruptor full' }, esCuentadante, h('span', { class: 'interruptor-pista', 'aria-hidden': 'true' }),
          'Queda como responsable de la cuenta antes (la revisa y la acepta)'),
        h('p', { class: 'full text-muted' }, 'Si el instructor nunca ha estado en este ambiente o le adjuntas una cuenta antes, antes de su primera entrega debe revisar si es conforme.')),
      acciones: [({ cerrar: x }) => h('button', { class: 'btn btn-outline', type: 'button', onclick: () => x() }, 'Cancelar'), guardar],
    });
    async function enviar() {
      const datos = {
        ambienteId: Number(ambSel.value) || null, instructorId: Number(instSel.value) || null,
        jornada: jornadaElegida(), ...fechas.leer(), motivo: motivo.value.trim() || undefined, cuentadante: esCuentadante.checked || undefined,
      };
      const errores = validarAsignacion(datos, hoy);
      errorCampo(ambSel, errores.ambienteId); errorCampo(instSel, errores.instructorId); errorCampo(jornadas, errores.jornada);
      fechas.errores(errores);
      if (Object.keys(errores).length) return;
      guardar.disabled = true;
      try {
        const { r, cargada } = await asignarConCuentaAntes(datos, cuentaAntes);
        toast('exito', 'Instructor asignado', `${r.asignacion.instructor.nombre} · ambiente ${r.asignacion.ambiente.codigo} · ${ETIQUETA_JORNADA[r.asignacion.jornada]}`
          + (r.asignaciones.length > 1 ? ` · ${r.asignaciones.length} días` : ` · ${describirFechas(r.asignacion)}`));
        avisar(r.advertencias);
        avisoRevisionInventario(r, r.asignacion.instructor.nombre, datos.cuentadante, cargada);
        cerrar();
        cargar();
      } catch (e) {
        if (e.codigo === 'DUPLICADO') errorCampo(fechas.modos, e.message); else toast('error', 'No se asignó', e.message);
        guardar.disabled = false;
      }
    }
  }

  await cargar();
  anim.entrarVista(raiz);
}
