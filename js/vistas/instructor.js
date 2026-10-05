// Dashboard del instructor: clases de hoy con su ventana de registro,
// GenerarQRButton (modal con QR dinámico), historial de la sesión,
// inspección del ambiente, acceso a reportar daño y modo clase cancelada.
// "Programar clase" crea una sesión para una de sus fichas (por defecto,
// ahora mismo); las excusas de sus aprendices se revisan en Excusas.
import { h, icono, vaciar, formato } from '../ui/dom.js';
import { anim } from '../ui/anim.js';
import { toast, abrirModal } from '../ui/avisos.js';
import { chipAsistencia, cargando, tarjetaError, encabezado } from '../ui/componentes.js';
import { estadoVentana, formatearDuracion, fechaIso } from '../reglas.js';
import { api } from '../api/contratos.js';
import { estado, usuarioAsistencia, catalogos } from '../estado.js';
import { apiAmb } from '../api/ambientes.js';
import { CONFIG } from '../config.js';

const TEXTO_VENTANA = {
  pendiente: ['Abre en', 'azul'], abierta: ['Ventana abierta', 'in'], cerrada: ['Ventana cerrada', 'neutro'], cancelada: ['Cancelada', 'error'],
};

export async function render(raiz, { alSalir }) {
  const usuario = usuarioAsistencia();
  const lista = h('div', { class: 'clases' }, cargando());
  const resumen = h('div', { class: 'stat-grid', 'data-anim': '' });
  raiz.append(
    encabezado(`Hola, ${usuario.nombre.split(' ')[0]}`, 'Tus clases de hoy. Genera el QR mientras la ventana de registro esté abierta.',
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => programarClase(cargar) }, icono('mas'), 'Programar clase'),
      h('a', { class: 'btn btn-outline', href: '#/excusas' }, icono('archivo'), 'Excusas'),
      h('a', { class: 'btn btn-outline', href: '#/inspecciones' }, icono('inspeccion'), 'Inspección del ambiente')),
    resumen,
    h('h3', { class: 'bloque-titulo', 'data-anim': '' }, 'Clases activas hoy'),
    lista);
  anim.entrarVista(raiz);

  let sesiones = [];
  const tarjetas = new Map();

  async function cargar() {
    try {
      sesiones = await api.sesiones({ instructorId: usuario.id, fecha: fechaIso() });
    } catch (e) {
      vaciar(lista, tarjetaError(e, cargar));
      return;
    }
    pintarResumen();
    tarjetas.clear();
    vaciar(lista, sesiones.length ? sesiones.map((s) => { const t = tarjetaClase(s); tarjetas.set(s.id, t); return t.el; })
      : h('div', { class: 'card empty-state' }, h('strong', {}, 'No hay asistencias registradas'), h('p', {}, 'No tienes clases programadas para hoy.')));
    anim.lista(lista.children, { autoAlpha: 0, y: 16 });
  }

  function pintarResumen() {
    const abiertas = sesiones.filter((s) => estadoVentana(s).estado === 'abierta').length;
    const registrados = sesiones.reduce((n, s) => n + s.registrados, 0);
    const inscritos = sesiones.filter((s) => !s.cancelada).reduce((n, s) => n + s.inscritos, 0);
    const tarjeta = (clase, etiqueta, valor, extra) => {
      const num = h('div', { class: 'value' }, '0');
      queueMicrotask(() => anim.contar(num, valor));
      return h('div', { class: `stat-card ${clase}` }, h('div', { class: 'label' }, etiqueta), num, extra && h('div', { class: 'stat-extra' }, extra));
    };
    vaciar(resumen,
      tarjeta('total', 'Clases hoy', sesiones.length),
      tarjeta('in', 'Ventanas abiertas', abiertas),
      tarjeta('out', 'Aprendices registrados', registrados, `de ${inscritos} inscritos`));
  }

  function tarjetaClase(s) {
    const chip = h('span', { class: 'status-chip' });
    const reloj = h('span', { class: 'ventana-reloj mono' });
    const barra = h('span', { class: 'ventana-barra-relleno' });
    const conteo = h('span', {}, `${s.registrados}/${s.inscritos}`);
    const botonQr = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => abrirModalQr(s, cargar) }, icono('qr'), 'Generar QR');
    const botonCancelar = h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => cancelarClase(s) }, icono('prohibido'), 'Marcar cancelada');
    const motivo = h('p', { class: 'clase-cancelada', hidden: !s.cancelada }, icono('prohibido'), `Clase cancelada: ${s.motivoCancelacion || ''}`);

    const el = h('article', { class: `card clase${s.cancelada ? ' clase--cancelada' : ''}` },
      h('div', { class: 'clase-cabecera' },
        h('div', {},
          h('span', { class: 'eyebrow eyebrow-verde' }, `Ficha ${s.ficha} · ${s.programa}`),
          h('h4', { class: 'clase-titulo' }, s.competencia),
          h('p', { class: 'clase-meta' }, icono('reloj'), `${formato.hora(s.startTime)} – ${formato.hora(s.endTime)}`, h('span', { class: 'sep' }), icono('caja'), s.ambiente)),
        chip),
      h('div', { class: 'ventana' },
        h('div', { class: 'ventana-texto' }, h('span', { class: 'ventana-etiqueta' }), reloj),
        h('div', { class: 'ventana-barra' }, barra),
        h('div', { class: 'ventana-pie' }, h('span', {}, `Ventana de ${s.ventanaMin} min`), h('span', {}, icono('usuarios'), conteo, ' registrados'))),
      motivo,
      h('div', { class: 'clase-acciones' },
        botonQr,
        h('button', { class: 'btn btn-outline', type: 'button', onclick: () => historialSesion(s) }, icono('historial'), 'Historial de la sesión'),
        h('a', { class: 'btn btn-outline', href: '#/inspecciones' }, icono('inspeccion'), 'Inspeccionar ambiente'),
        botonCancelar));

    let ultimoEstado = null;
    function tic() {
      const v = estadoVentana(s);
      const [texto, clase] = TEXTO_VENTANA[v.estado];
      if (v.estado !== ultimoEstado) {
        chip.className = `status-chip ${clase}`;
        chip.textContent = v.estado === 'pendiente' ? 'Programada' : texto;
        el.querySelector('.ventana-etiqueta').textContent = v.estado === 'abierta' ? 'Tiempo restante' : v.estado === 'pendiente' ? 'Abre en' : texto;
        botonQr.disabled = v.estado !== 'abierta';
        botonQr.title = v.estado === 'abierta' ? '' : v.estado === 'cancelada' ? 'La clase está cancelada' : v.estado === 'pendiente' ? 'La ventana aún no abre' : 'Fuera de ventana';
        botonCancelar.disabled = s.cancelada;
        el.classList.toggle('clase--abierta', v.estado === 'abierta');
        if (ultimoEstado) anim.latido(chip);
        ultimoEstado = v.estado;
      }
      reloj.textContent = v.estado === 'abierta' || v.estado === 'pendiente' ? formatearDuracion(v.restanteMs) : '—';
      const total = s.ventanaMin * 60_000;
      const avance = v.estado === 'abierta' ? v.restanteMs / total : 0;
      barra.style.transform = `scaleX(${avance})`;
      el.classList.toggle('clase--por-cerrar', v.estado === 'abierta' && v.restanteMs < 60_000);
    }
    tic();
    return { el, tic };
  }

  async function cancelarClase(s) {
    const motivo = h('textarea', { rows: 3, placeholder: 'Ej. Corte de energía en la sede', style: { minHeight: '90px' } });
    const error = h('div', { class: 'field-error', hidden: true });
    abrirModal({
      titulo: 'Marcar clase como cancelada',
      subtitulo: `${s.competencia} · Ficha ${s.ficha}`,
      ancho: 'angosto',
      contenido: h('div', {},
        h('div', { class: 'banner warning' }, 'Se deshabilitan la generación de QR y el registro de asistencia, y coordinación recibe una notificación.'),
        h('div', { class: 'campo' }, h('label', {}, 'Motivo'), motivo, error)),
      acciones: [
        ({ cerrar }) => h('button', { class: 'btn btn-outline', type: 'button', onclick: () => cerrar() }, 'Volver'),
        ({ cerrar }) => h('button', { class: 'btn btn-peligro', type: 'button', onclick: async (e) => {
          if (motivo.value.trim().length < 5) { error.textContent = 'Escribe el motivo (mínimo 5 caracteres).'; error.hidden = false; anim.sacudir(motivo); return; }
          const boton = e.currentTarget;
          boton.disabled = true;
          try {
            await api.cancelarSesion(s.id, motivo.value.trim());
            toast('aviso', 'Clase cancelada', 'Se notificó al panel administrativo.');
            cerrar();
            cargar();
          } catch (err) { toast('error', 'No se pudo cancelar', err.message); boton.disabled = false; }
        } }, 'Cancelar clase'),
      ],
    });
    motivo.focus();
  }

  const reloj = setInterval(() => tarjetas.forEach((t) => t.tic()), 1000);
  alSalir(() => clearInterval(reloj));
  await cargar();
}

/* ---------------- programar una clase ---------------- */

async function programarClase(alCrear) {
  let fichas = [], cat;
  try { [fichas, cat] = await Promise.all([apiAmb.fichas(), catalogos()]); } catch (e) { toast('error', 'No se cargaron tus fichas', e.message); return; }
  if (!fichas.length) { toast('aviso', 'No tienes fichas', 'Coordinación te asigna como instructor líder de una ficha.'); return; }
  const ahora = new Date();
  const hh = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const c = (id, etiqueta, input) => h('div', { class: 'campo' }, h('label', { for: id }, etiqueta), input);
  const ficha = h('select', { id: 'pc-ficha', onchange: () => { const f = fichas.find((x) => String(x.id) === ficha.value); if (f?.ambiente) ambiente.value = f.ambiente.id; } },
    fichas.filter((f) => f.activo).map((f) => h('option', { value: f.id }, `${f.codigo} · ${f.programa}`)));
  const competencia = h('input', { type: 'text', id: 'pc-comp', list: 'pc-competencias', maxlength: 160, placeholder: 'Elige o escribe la competencia' });
  const opciones = h('datalist', { id: 'pc-competencias' }, cat.competencias.map((x) => h('option', { value: x.nombre })));
  const ambiente = h('select', { id: 'pc-amb' }, cat.ambientes.map((a) => h('option', { value: a.id }, a.nombre)));
  const dia = h('input', { type: 'date', id: 'pc-dia', value: fechaIso(), min: fechaIso() });
  const inicio = h('input', { type: 'time', id: 'pc-ini', value: hh(ahora) });
  const fin = h('input', { type: 'time', id: 'pc-fin', value: hh(new Date(ahora.getTime() + 2 * 3600_000)) > hh(ahora) ? hh(new Date(ahora.getTime() + 2 * 3600_000)) : '23:59' });
  const ventana = h('select', { id: 'pc-ventana' }, [10, 15, 20, 30, 45, 60].map((m) => h('option', { value: m, selected: m === CONFIG.ventanaPorDefectoMin }, `${m} minutos`)));
  ficha.dispatchEvent(new Event('change'));
  const guardar = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => enviar() }, icono('check'), 'Programar');
  const { cerrar } = abrirModal({
    titulo: 'Programar clase', subtitulo: 'Por defecto empieza ahora: la ventana de registro abre al inicio y el QR se genera desde la tarjeta de la clase.', ancho: 'normal',
    contenido: h('div', { class: 'form-grid' },
      h('div', { class: 'full' }, c('pc-ficha', 'Ficha', ficha)),
      h('div', { class: 'full' }, c('pc-comp', 'Competencia', competencia), opciones),
      c('pc-amb', 'Ambiente', ambiente), c('pc-dia', 'Día', dia),
      c('pc-ini', 'Hora de inicio', inicio), c('pc-fin', 'Hora final', fin),
      c('pc-ventana', 'Ventana de registro', ventana)),
    acciones: [({ cerrar: x }) => h('button', { class: 'btn btn-outline', type: 'button', onclick: () => x() }, 'Cancelar'), guardar],
  });
  async function enviar() {
    const nombre = competencia.value.trim();
    const existente = cat.competencias.find((x) => x.nombre.toLowerCase() === nombre.toLowerCase());
    if (nombre.length < 3) { toast('aviso', 'Falta la competencia', 'Elige o escribe la competencia de la clase.'); competencia.focus(); return; }
    if (fin.value <= inicio.value) { toast('aviso', 'Revisa las horas', 'La hora final debe ser posterior a la de inicio.'); return; }
    guardar.disabled = true;
    try {
      const s = await api.crearSesion({ fichaId: Number(ficha.value), ...(existente ? { competenciaId: existente.id } : { competencia: nombre }),
        ambienteId: Number(ambiente.value), fecha: dia.value, horaInicio: inicio.value, horaFin: fin.value, ventanaMin: Number(ventana.value) });
      if (!existente) estado.catalogos = null; // la competencia nueva aparece la próxima vez
      toast('exito', 'Clase programada', `${s.competencia} · ficha ${s.ficha} · ${formato.hora(s.startTime)}`);
      cerrar();
      alCrear?.();
    } catch (e) { toast('error', 'No se programó', e.message); guardar.disabled = false; }
  }
}

/* ---------------- modal del QR ---------------- */

function abrirModalQr(sesion, alCerrar) {
  let validez = CONFIG.validezQrPorDefecto;
  let actual = null, generando = false, ultimos = -1;

  const lienzo = h('div', { class: 'qr-lienzo' });
  // Marco de progreso cuadrado alrededor del QR (un círculo taparía las esquinas).
  const marco = { __svg: true, x: 6, y: 6, width: 268, height: 268, rx: 26 };
  const circulo = h('rect', { ...marco, class: 'qr-anillo-progreso' });
  const anillo = h('svg', { class: 'qr-anillo', viewBox: '0 0 280 280', 'aria-hidden': 'true' }, h('rect', { ...marco, class: 'qr-anillo-fondo' }), circulo);
  const velo = h('div', { class: 'qr-velo', hidden: true });
  const restante = h('strong', { class: 'qr-restante mono' }, '--:--');
  const ventana = h('span', { class: 'mono' });
  const datos = h('dl', { class: 'qr-datos' });
  const registrados = h('strong', { class: 'qr-registrados' }, String(sesion.registrados));
  const recientes = h('ul', { class: 'qr-recientes' });
  const selector = h('select', { 'aria-label': 'Validez del QR', onchange: () => { validez = Number(selector.value); generar(); } },
    CONFIG.validecesQr.map((v) => h('option', { value: v, selected: v === validez }, v < 60 ? `${v} segundos` : `${v / 60} min`)));

  const contenido = h('div', { class: 'qr-modal' },
    h('div', { class: 'qr-marco' }, anillo, lienzo, velo),
    h('div', { class: 'qr-info' },
      h('div', { class: 'qr-contador' }, h('span', {}, 'El QR vence en'), restante, h('span', { class: 'text-muted' }, 'y se renueva solo')),
      h('div', { class: 'campo' }, h('label', {}, 'Validez de cada QR'), selector),
      h('div', { class: 'qr-ventana' }, icono('reloj'), h('span', {}, 'La ventana cierra en '), ventana),
      h('div', { class: 'qr-asistencia' }, h('span', {}, icono('usuarios'), 'Registrados'), registrados, h('span', { class: 'text-muted' }, `/ ${sesion.inscritos}`)),
      recientes,
      h('details', { class: 'qr-detalle' }, h('summary', {}, 'Contenido del QR'), datos)));

  const { cerrar } = abrirModal({
    titulo: 'QR de asistencia',
    subtitulo: `${sesion.competencia} · Ficha ${sesion.ficha}`,
    ancho: 'ancho',
    contenido,
    acciones: [({ cerrar }) => h('button', { class: 'btn btn-outline', type: 'button', onclick: () => cerrar() }, 'Cerrar')],
    alCerrar: () => { clearInterval(tic); clearInterval(sondeo); alCerrar?.(); },
  });

  async function generar() {
    if (generando) return;
    generando = true;
    try {
      actual = await api.generarQr(sesion.id, validez);
    } catch (e) {
      generando = false;
      velo.hidden = false;
      vaciar(velo, icono('prohibido'), h('span', {}, e.message));
      toast('error', 'No se pudo generar el QR', e.message);
      return;
    }
    generando = false;
    velo.hidden = true;
    vaciar(lienzo);
    new window.QRCode(lienzo, { text: actual.texto, width: 232, height: 232, colorDark: '#00304D', colorLight: '#ffffff', correctLevel: window.QRCode.CorrectLevel.M });
    estado.ultimoQr = { texto: actual.texto, sessionId: sesion.id };
    const p = actual.payload;
    vaciar(datos,
      h('dt', {}, 'sessionId'), h('dd', { class: 'mono' }, p.sessionId),
      h('dt', {}, 'startTime'), h('dd', { class: 'mono' }, p.startTime),
      h('dt', {}, 'expiryTime'), h('dd', { class: 'mono' }, p.expiryTime));
    const total = (Date.parse(p.expiryTime) - Date.now()) / 1000;
    anim.anillo(circulo, total, total);
    anim.lista([lienzo], { autoAlpha: 0, scale: 0.9 });
  }

  const tic = setInterval(() => {
    const v = estadoVentana(sesion);
    ventana.textContent = v.estado === 'abierta' ? formatearDuracion(v.restanteMs) : 'cerrada';
    if (v.estado !== 'abierta') {
      if (velo.hidden) {
        velo.hidden = false;
        vaciar(velo, icono('prohibido'), h('span', {}, 'Fuera de ventana: el registro terminó.'));
        restante.textContent = '00:00';
      }
      return;
    }
    if (!actual) return;
    const ms = Date.parse(actual.payload.expiryTime) - Date.now();
    restante.textContent = formatearDuracion(ms);
    restante.classList.toggle('qr-restante--urgente', ms < 10_000);
    if (ms <= 0) generar();
  }, 250);

  const sondeo = setInterval(async () => {
    try {
      const lista = await api.asistenciaSesion(sesion.id);
      const ok = lista.filter((r) => r.estado === 'presente' || r.estado === 'tarde');
      if (ok.length !== ultimos) {
        if (ultimos !== -1) anim.latido(registrados);
        ultimos = ok.length;
        registrados.textContent = ok.length;
        vaciar(recientes, ok.slice(0, 3).map((r) => h('li', {}, h('span', {}, r.aprendiz), chipAsistencia(r.estado))));
      }
    } catch { /* el siguiente sondeo lo intenta de nuevo */ }
  }, 3000);

  generar();
  return cerrar;
}

/* ---------------- historial de la sesión ---------------- */

function historialSesion(sesion) {
  const cuerpo = h('div', {}, cargando());
  abrirModal({ titulo: 'Historial de la sesión', subtitulo: `${sesion.competencia} · ${formato.fechaHora(sesion.startTime)}`, ancho: 'ancho', contenido: cuerpo });
  api.asistenciaSesion(sesion.id).then((lista) => {
    const ok = lista.filter((r) => r.estado === 'presente' || r.estado === 'tarde').length;
    vaciar(cuerpo,
      h('p', { class: 'section-sub' }, `${ok} de ${sesion.inscritos} aprendices registrados · ${sesion.inscritos - ok} pendientes`),
      lista.length ? h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Aprendiz'), h('th', {}, 'Documento'), h('th', {}, 'Hora'), h('th', {}, 'Estado'))),
        h('tbody', {}, lista.map((r) => h('tr', {}, h('td', {}, r.aprendiz), h('td', { class: 'mono' }, r.documento), h('td', {}, formato.hora(r.hora)), h('td', {}, chipAsistencia(r.estado)))))))
        : h('div', { class: 'empty-state' }, 'Aún no hay registros en esta sesión.'));
    anim.lista(cuerpo.querySelectorAll('tbody tr'));
  }).catch((e) => vaciar(cuerpo, tarjetaError(e)));
}
