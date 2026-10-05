// Excusas por inasistencia.
//  · Aprendiz: sube la excusa con foto de la evidencia (incapacidad,
//    citación…) y el periodo que cubre; ve si se aprobó o se rechazó.
//  · Instructor (de la ficha) y administrativo: revisan las pendientes
//    (aprobar, o rechazar con motivo). Aprobada, las faltas de esos días
//    quedan "justificadas" y no cuentan en el semáforo.
import { h, anexar, icono, vaciar, errorCampo } from '../ui/dom.js';
import { anim } from '../ui/anim.js';
import { toast, abrirModal } from '../ui/avisos.js';
import { cargando, tarjetaError } from '../ui/componentes.js';
import { crearCapturaFoto } from '../ui/camara.js';
import { cabecera, vacio, fecha } from '../ui/ambientes-ui.js';
import { api } from '../api/contratos.js';
import { estado } from '../estado.js';
import { fechaIso, validarExcusa } from '../reglas.js';

const ESTADO = { pendiente: ['Pendiente', 'out'], aprobada: ['Aprobada', 'in'], rechazada: ['Rechazada', 'error'] };
const fmtDia = new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });
const dia = (iso) => fmtDia.format(new Date(`${iso}T12:00:00`));
const periodo = (x) => (x.desde === x.hasta ? `El ${dia(x.desde)}` : `Del ${dia(x.desde)} al ${dia(x.hasta)}`);

export async function render(raiz, { params }) {
  const aprendiz = estado.usuario.rol === 'aprendiz';
  let filtro = aprendiz ? '' : 'pendiente';
  const ficha = params.get('ficha') || '';
  const lista = h('div', { class: 'excusas-lista' }, cargando());
  const pestanas = !aprendiz && h('div', { class: 'segmentos', role: 'tablist', 'aria-label': 'Ver' });

  anexar(raiz,
    cabecera({
      eyebrow: aprendiz ? `Ficha ${estado.usuario.ficha}` : 'Asistencia', titulo: aprendiz ? 'Mis excusas' : 'Excusas de los aprendices',
      subtitulo: aprendiz ? 'Si faltaste por una razón justificada, sube la excusa con una foto de la evidencia y los días que cubre. Tu instructor la revisa.'
        : `Aprueba o rechaza las excusas${ficha ? ` de la ficha ${ficha}` : ' de tus fichas'}. Aprobada, las faltas de esos días quedan justificadas y no cuentan en el semáforo.`,
      acciones: aprendiz ? [h('button', { class: 'btn btn-primary', type: 'button', onclick: () => nueva() }, icono('mas'), 'Nueva excusa')] : [],
    }),
    pestanas && h('div', { 'data-anim': '' }, pestanas),
    lista);

  async function cargar() {
    if (pestanas) {
      vaciar(pestanas, [['pendiente', 'Pendientes'], ['', 'Todas']].map(([clave, texto]) => h('button', {
        class: 'segmento', type: 'button', role: 'tab', 'aria-selected': String(filtro === clave), onclick: () => { filtro = clave; cargar(); },
      }, texto)));
    }
    vaciar(lista, cargando());
    let excusas;
    try { excusas = await api.excusas({ estado: filtro || undefined, ficha: ficha || undefined }); } catch (e) { vaciar(lista, tarjetaError(e, cargar)); return; }
    vaciar(lista, excusas.length ? excusas.map(tarjeta)
      : vacio(aprendiz ? 'No has presentado excusas' : filtro ? 'No hay excusas pendientes' : 'No hay excusas', aprendiz ? 'Usa "Nueva excusa" si necesitas justificar una falta.' : '', 'archivo'));
    anim.lista(lista.children, { autoAlpha: 0, y: 8 });
  }

  function tarjeta(x) {
    const [texto, clase] = ESTADO[x.estado];
    return h('article', { class: `card excusa excusa--${x.estado}` },
      h('a', { class: 'excusa-foto', href: x.foto, target: '_blank', rel: 'noopener', 'aria-label': 'Ver la evidencia' }, h('img', { src: x.foto, alt: 'Evidencia de la excusa', loading: 'lazy' })),
      h('div', { class: 'excusa-datos' },
        !aprendiz && h('span', { class: 'inv-categoria' }, `Ficha ${x.ficha} · ${x.aprendiz.documento}`),
        h('strong', {}, aprendiz ? periodo(x) : x.aprendiz.nombre),
        !aprendiz && h('span', {}, periodo(x)),
        h('p', {}, x.motivo),
        h('div', { class: 'reporte-chips' }, h('span', { class: `status-chip ${clase}` }, texto),
          h('span', { class: 'status-chip neutro' }, `${x.clasesCubiertas} clase${x.clasesCubiertas === 1 ? '' : 's'} en el periodo`)),
        x.revisadaPor && h('span', { class: 'text-muted' }, `${x.estado === 'aprobada' ? 'Aprobó' : 'Rechazó'} ${x.revisadaPor} · ${fecha.completa(x.revisadaEn)}${x.observacion ? ` · ${x.observacion}` : ''}`),
        h('span', { class: 'text-muted' }, `Presentada ${fecha.completa(x.creadaEn)}`)),
      !aprendiz && x.estado === 'pendiente' && h('div', { class: 'novedad-acciones' },
        h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => revisar(x, 'rechazada') }, icono('prohibido'), 'Rechazar'),
        h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => revisar(x, 'aprobada') }, icono('check'), 'Aprobar')));
  }

  function revisar(x, decision) {
    const observacion = h('textarea', { id: 'ex-obs', rows: 3, maxlength: 300, placeholder: decision === 'rechazada' ? 'Ej.: la incapacidad no corresponde a esas fechas' : 'Opcional' });
    const boton = h('button', { class: decision === 'aprobada' ? 'btn btn-primary' : 'btn btn-peligro', type: 'button', onclick: () => enviar() },
      icono(decision === 'aprobada' ? 'check' : 'prohibido'), decision === 'aprobada' ? 'Aprobar excusa' : 'Rechazar excusa');
    const { cerrar } = abrirModal({
      titulo: decision === 'aprobada' ? 'Aprobar excusa' : 'Rechazar excusa', subtitulo: `${x.aprendiz.nombre} · ${periodo(x)}`, ancho: 'angosto',
      contenido: h('div', { class: 'campo' }, h('label', { for: 'ex-obs' }, decision === 'rechazada' ? 'Motivo del rechazo' : 'Observación'), observacion,
        h('span', { class: 'field-hint' }, decision === 'aprobada' ? 'Las faltas de esos días quedarán justificadas. Se avisa al aprendiz.' : 'Se avisa al aprendiz con el motivo.')),
      acciones: [({ cerrar: c }) => h('button', { class: 'btn btn-outline', type: 'button', onclick: () => c() }, 'Cancelar'), boton],
    });
    async function enviar() {
      if (decision === 'rechazada' && observacion.value.trim().length < 5) { errorCampo(observacion, 'Escribe el motivo del rechazo.'); return; }
      boton.disabled = true;
      try {
        await api.revisarExcusa(x.id, { estado: decision, observacion: observacion.value.trim() || undefined });
        toast('exito', decision === 'aprobada' ? 'Excusa aprobada' : 'Excusa rechazada', x.aprendiz.nombre);
        cerrar();
        cargar();
      } catch (e) { toast('error', 'No se guardó', e.message); boton.disabled = false; }
    }
  }

  function nueva() {
    let foto = null;
    const hoy = fechaIso();
    const minimo = fechaIso(Date.now() - 30 * 86_400_000);
    const desde = h('input', { type: 'date', id: 'ex-desde', value: hoy, min: minimo, max: hoy });
    const hasta = h('input', { type: 'date', id: 'ex-hasta', value: hoy, min: minimo });
    const motivo = h('textarea', { id: 'ex-motivo', rows: 3, maxlength: 500, placeholder: 'Ej.: incapacidad médica por 3 días' });
    const captura = crearCapturaFoto({ alCambiar: (f) => { foto = f; errorCampo(captura.el, null); } });
    const c = (id, etiqueta, input) => h('div', { class: 'campo' }, h('label', { for: id }, etiqueta), input);
    const enviarBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => enviar() }, icono('subir'), 'Enviar excusa');
    const { cerrar } = abrirModal({
      titulo: 'Nueva excusa', subtitulo: 'Periodo que cubre (máximo 31 días, de los últimos 30 días en adelante) y foto de la evidencia.', ancho: 'normal',
      contenido: h('div', { class: 'form-grid' },
        c('ex-desde', 'Desde', desde), c('ex-hasta', 'Hasta', hasta),
        h('div', { class: 'full' }, c('ex-motivo', 'Motivo', motivo)),
        h('div', { class: 'full campo' }, h('label', {}, 'Foto de la evidencia ', h('span', { class: 'foto-requisito foto-requisito--obligatoria' }, '(obligatoria)')), captura.el)),
      acciones: [({ cerrar: x }) => h('button', { class: 'btn btn-outline', type: 'button', onclick: () => x() }, 'Cancelar'), enviarBtn],
      alCerrar: () => captura.detener(),
    });
    async function enviar() {
      const datos = { desde: desde.value, hasta: hasta.value, motivo: motivo.value.trim(), foto };
      const errores = validarExcusa(datos, hoy);
      errorCampo(desde, errores.desde); errorCampo(hasta, errores.hasta); errorCampo(motivo, errores.motivo); errorCampo(captura.el, errores.foto);
      if (Object.keys(errores).length) return;
      enviarBtn.disabled = true;
      try {
        await api.crearExcusa(datos);
        toast('exito', 'Excusa enviada', 'Tu instructor la revisará. Te avisaremos cuando la apruebe o la rechace.');
        cerrar();
        cargar();
      } catch (e) { toast('error', 'No se envió', e.message); enviarBtn.disabled = false; }
    }
  }

  await cargar();
  anim.entrarVista(raiz);
}
