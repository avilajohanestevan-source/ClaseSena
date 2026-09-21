// Vista del aprendiz: clase activa con el tiempo restante de la ventana,
// ScannerView (cámara), ConfirmaciónRegistro (aceptado / falla con motivo)
// e HistorialPersonal.
import { h, icono, vaciar, formato } from '../ui/dom.js';
import { anim } from '../ui/anim.js';
import { toast } from '../ui/avisos.js';
import { crearEscaner } from '../ui/escaner.js';
import { badgeSemaforo, cargando, tarjetaError, encabezado, tablaAsistencias, filtroFechas, exportMock, COLUMNAS_ASISTENCIA } from '../ui/componentes.js';
import { estadoVentana, formatearDuracion, leerQr, prevalidarEscaneo, fechaIso } from '../reglas.js';
import { api } from '../api/contratos.js';
import { estado } from '../estado.js';
import { CONFIG } from '../config.js';

const MENSAJE_BLOQUEO = {
  cerrada: 'Fuera de ventana: el tiempo para registrar asistencia en esta clase terminó.',
  cancelada: 'La clase fue cancelada: no hay registro de asistencia.',
  pendiente: 'La ventana de registro aún no abre.',
  ninguna: 'No tienes clases con registro disponible en este momento.',
};

export async function render(raiz, { alSalir }) {
  const usuario = estado.usuario;
  const panelClase = h('div', { class: 'card clase-aprendiz', 'data-anim': '' }, cargando());
  const resultado = h('div', { class: 'resultado-zona', 'aria-live': 'polite' });
  const historial = h('div', { class: 'card', 'data-anim': '' }, cargando());
  let sesion = null, enviando = false;

  const escaner = crearEscaner({ tipos: ['qr'], etiqueta: 'Escanear QR de la clase', placeholder: 'Pega el texto del QR (pruebas)', alLeer: procesar });
  const demo = CONFIG.usarMock && h('button', { class: 'btn btn-outline btn-sm demo-qr', type: 'button', onclick: () => {
    if (!estado.ultimoQr) { toast('info', 'Aún no hay QR', 'Entra como instructor, genera el QR y vuelve a esta vista.'); return; }
    procesar(estado.ultimoQr.texto);
  } }, icono('qr'), 'Usar el último QR generado (demo)');

  raiz.append(
    encabezado('Registrar asistencia', `${usuario.nombre} · Ficha ${usuario.ficha}`),
    h('div', { class: 'aprendiz-grid' },
      h('div', {}, panelClase,
        h('div', { class: 'card', 'data-anim': '' },
          h('h3', { class: 'bloque-titulo' }, 'Escanear'),
          h('p', { class: 'section-sub' }, 'Apunta la cámara al QR que proyecta tu instructor.'),
          escaner.el, demo),
        resultado),
      historial));
  anim.entrarVista(raiz);
  alSalir(() => escaner.detener());

  /* --- clase activa y ventana --- */
  const reloj = h('strong', { class: 'mono ventana-grande' });
  let ultimoEstado = null;

  async function cargarClase() {
    try {
      const hoy = await api.sesiones({ ficha: usuario.ficha, fecha: fechaIso() });
      // La clase relevante: la que está en su ventana (aunque se haya
      // cancelado, para mostrar el aviso), si no la próxima, si no la última.
      const ahora = Date.now();
      sesion = hoy.find((s) => estadoVentana({ ...s, cancelada: false }, ahora).estado === 'abierta')
        || hoy.find((s) => estadoVentana(s, ahora).estado === 'pendiente')
        || hoy.at(-1) || null;
    } catch (e) { vaciar(panelClase, tarjetaError(e, cargarClase)); return; }
    ultimoEstado = null;
    if (!sesion) {
      vaciar(panelClase, h('div', { class: 'empty-state' }, 'No tienes clases programadas hoy.'));
      escaner.bloquear(MENSAJE_BLOQUEO.ninguna);
      return;
    }
    vaciar(panelClase,
      h('span', { class: 'eyebrow eyebrow-verde' }, 'Clase de hoy'),
      h('h3', { class: 'clase-titulo' }, sesion.competencia),
      h('p', { class: 'clase-meta' }, icono('reloj'), `${formato.hora(sesion.startTime)} – ${formato.hora(sesion.endTime)}`, h('span', { class: 'sep' }), sesion.ambiente),
      h('div', { class: 'ventana-aprendiz' }, h('span', { class: 'ventana-etiqueta' }), reloj));
    tic();
  }

  function tic() {
    if (!sesion) return;
    const v = estadoVentana(sesion);
    reloj.textContent = v.estado === 'abierta' || v.estado === 'pendiente' ? formatearDuracion(v.restanteMs) : '—';
    reloj.classList.toggle('qr-restante--urgente', v.estado === 'abierta' && v.restanteMs < 60_000);
    if (v.estado === ultimoEstado) return;
    ultimoEstado = v.estado;
    panelClase.dataset.estado = v.estado;
    panelClase.querySelector('.ventana-etiqueta').textContent =
      { abierta: 'Tiempo restante para registrarte', pendiente: 'La ventana abre en', cerrada: 'Fuera de ventana', cancelada: `Clase cancelada${sesion.motivoCancelacion ? ': ' + sesion.motivoCancelacion : ''}` }[v.estado];
    escaner.bloquear(v.estado === 'abierta' ? null : MENSAJE_BLOQUEO[v.estado]);
    if (demo) demo.disabled = v.estado !== 'abierta';
  }
  const intervalo = setInterval(tic, 1000);
  // La cancelación puede llegar mientras la vista está abierta.
  const refresco = setInterval(cargarClase, 20_000);
  alSalir(() => { clearInterval(intervalo); clearInterval(refresco); });

  /* --- escaneo → confirmación --- */
  async function procesar(texto) {
    if (enviando) return;
    const leido = leerQr(texto);
    if (!leido.ok) { mostrarResultado({ resultado: 'falla', motivo: leido.motivo }); return; }
    const motivoLocal = prevalidarEscaneo(leido.payload, sesion);
    if (motivoLocal) { mostrarResultado({ resultado: 'falla', motivo: motivoLocal }); return; }
    enviando = true;
    vaciar(resultado, h('div', { class: 'card' }, cargando('Registrando asistencia…')));
    try {
      const r = await api.escanear({ payload: leido.payload, aprendizId: usuario.id, scannedAt: new Date().toISOString() });
      mostrarResultado(r);
      if (r.resultado === 'aceptado') { cargarHistorial(); cargarClase(); }
    } catch (e) {
      mostrarResultado({ resultado: 'falla', motivo: e.message });
    } finally { enviando = false; }
  }

  function mostrarResultado(r) {
    const aceptado = r.resultado === 'aceptado';
    const tarde = aceptado && r.estado === 'tarde';
    const titulo = aceptado ? (tarde ? 'Asistencia registrada (tarde)' : 'Asistencia registrada') : 'No se pudo registrar';
    const detalle = aceptado ? (r.motivo || `Hora: ${formato.hora(r.registro?.hora)}`) : r.motivo;
    toast(aceptado ? (tarde ? 'aviso' : 'exito') : 'error', titulo, detalle);
    const icon = h('svg', { class: 'resultado-icono', viewBox: '0 0 52 52', 'aria-hidden': 'true' },
      h('circle', { __svg: true, cx: 26, cy: 26, r: 23 }),
      h('path', { __svg: true, d: aceptado ? 'M15 27l7 7 15-16' : 'M18 18l16 16M34 18L18 34' }));
    const tarjeta = h('div', { class: `resultado resultado--${aceptado ? (tarde ? 'tarde' : 'aceptado') : 'falla'}`, role: 'status' },
      icon,
      h('div', { class: 'resultado-texto' },
        h('strong', {}, titulo),
        h('span', {}, detalle),
        !aceptado && h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => vaciar(resultado) }, 'Entendido')));
    vaciar(resultado, tarjeta);
    anim.resultado(tarjeta);
  }

  /* --- historial personal --- */
  const tabla = tablaAsistencias({ columnasAprendiz: false, porPagina: 8 });
  const resumen = h('div', { class: 'historial-resumen' });
  let filtros = { desde: fechaIso(Date.now() - 30 * 86400_000), hasta: fechaIso() };
  let filas = [];
  vaciar(historial,
    h('div', { class: 'vista-cabecera' }, h('h3', { class: 'bloque-titulo' }, 'Mi historial'),
      exportMock({ nombre: 'mi-asistencia', obtenerFilas: () => filas, columnas: COLUMNAS_ASISTENCIA })),
    resumen,
    filtroFechas({ ...filtros, alCambiar: (f) => { filtros = f; cargarHistorial(); } }),
    tabla.el);

  async function cargarHistorial() {
    try {
      filas = await api.asistencias({ aprendizId: usuario.id, ...filtros });
    } catch (e) { toast('error', 'No se pudo cargar tu historial', e.message); return; }
    const validas = filas.filter((r) => r.estado !== 'cancelada');
    const ordenadas = [...validas].sort((a, b) => a.fecha.localeCompare(b.fecha));
    let consecutivas = 0;
    for (let i = ordenadas.length - 1; i >= 0 && ordenadas[i].estado === 'falla'; i--) consecutivas++;
    const faltasTotales = validas.filter((r) => r.estado === 'falla').length;
    vaciar(resumen,
      h('div', {}, h('span', { class: 'text-muted' }, 'Asistencias'), h('strong', {}, validas.filter((r) => r.estado !== 'falla').length)),
      h('div', {}, h('span', { class: 'text-muted' }, 'Faltas'), h('strong', {}, faltasTotales)),
      h('div', {}, h('span', { class: 'text-muted' }, 'Mi semáforo'), badgeSemaforo({ faltasConsecutivas: consecutivas, faltasTotales })));
    tabla.mostrar(filas);
  }

  await Promise.all([cargarClase(), cargarHistorial()]);
}

