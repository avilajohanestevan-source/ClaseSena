// Horario del aprendiz: su ficha (programa, jornada, ambiente habitual e
// instructor líder) y las clases de hoy en adelante con el profesor, el
// ambiente y la competencia de cada una, agrupadas por día.
import { h, anexar, icono } from '../ui/dom.js';
import { anim } from '../ui/anim.js';
import { cabecera, vacio, fecha } from '../ui/ambientes-ui.js';
import { api } from '../api/contratos.js';
import { ETIQUETA_JORNADA, fechaIso } from '../reglas.js';

const fmtDia = new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });

export async function render(raiz) {
  const { ficha, clases } = await api.miHorario(14);
  const hoy = fechaIso();
  const porDia = new Map();
  clases.forEach((c) => {
    const dia = fechaIso(new Date(c.startTime));
    if (!porDia.has(dia)) porDia.set(dia, []);
    porDia.get(dia).push(c);
  });
  const profesores = [...new Map(clases.map((c) => [c.instructorId, c.instructor])).values()];

  anexar(raiz,
    cabecera({ eyebrow: ficha ? `Ficha ${ficha.codigo}` : 'Mi formación', titulo: 'Mi horario', subtitulo: 'Tus clases de las próximas dos semanas, con el profesor y el ambiente.',
      acciones: [h('a', { class: 'btn btn-primary', href: '#/asistencia' }, icono('escanear'), 'Registrar asistencia'),
        h('a', { class: 'btn btn-outline', href: '#/excusas' }, icono('archivo'), 'Mis excusas')] }),
    ficha ? h('section', { class: 'card horario-ficha', 'data-anim': '' },
      h('dl', { class: 'amb-datos' },
        h('div', { class: 'amb-datos-ancho' }, h('dt', {}, 'Programa'), h('dd', {}, h('strong', {}, ficha.programa))),
        h('div', {}, h('dt', {}, 'Jornada'), h('dd', {}, ETIQUETA_JORNADA[ficha.jornada])),
        h('div', {}, h('dt', {}, 'Ambiente'), h('dd', {}, ficha.ambiente ? `${ficha.ambiente.codigo} · ${ficha.ambiente.nombre}` : '—')),
        h('div', {}, h('dt', {}, 'Instructor líder'), h('dd', {}, ficha.instructor?.nombre || '—')),
        h('div', {}, h('dt', {}, 'Profesores'), h('dd', {}, profesores.join(', ') || '—'))))
      : h('div', { class: 'banner warning', 'data-anim': '' }, 'No estás inscrito en ninguna ficha. Comunícate con coordinación.'),
    porDia.size ? h('section', { class: 'horario', 'data-anim': '' }, [...porDia].map(([dia, lista]) => h('div', { class: `card horario-dia${dia === hoy ? ' horario-dia--hoy' : ''}` },
      h('h3', { class: 'bloque-titulo' }, dia === hoy ? `Hoy · ${fmtDia.format(new Date(`${dia}T12:00:00`))}` : fmtDia.format(new Date(`${dia}T12:00:00`)).replace(/^./, (x) => x.toUpperCase())),
      h('ul', { class: 'horario-lista' }, lista.map((c) => h('li', { class: `horario-clase${c.cancelada ? ' horario-clase--cancelada' : ''}` },
        h('span', { class: 'horario-hora mono' }, `${fecha.hora(c.startTime)} – ${fecha.hora(c.endTime)}`),
        h('div', {},
          h('strong', {}, c.competencia),
          h('span', { class: 'text-muted' }, `Profesor: ${c.instructor} · Ambiente ${c.ambiente}`)),
        c.cancelada ? h('span', { class: 'status-chip error', title: c.motivoCancelacion || '' }, 'Cancelada')
          : c.miRegistro ? h('span', { class: `status-chip ${c.miRegistro === 'tarde' ? 'out' : 'in'}` }, c.miRegistro === 'tarde' ? 'Registrada (tarde)' : 'Registrada')
            : null))))))
      : vacio('No tienes clases programadas', 'Cuando coordinación o tu instructor programen clases aparecerán aquí.', 'calendario'));
  anim.entrarVista(raiz);
}
