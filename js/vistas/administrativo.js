// Dashboard administrativo: alertas y notificaciones (clases canceladas,
// daños graves, riesgo de deserción), Filtros (ambiente, competencia,
// fecha) y PanelSemaforo con badge y tooltip por aprendiz.
import { h, icono, vaciar, formato } from '../ui/dom.js';
import { anim } from '../ui/anim.js';
import { badgeSemaforo, cargando, tarjetaError, encabezado } from '../ui/componentes.js';
import { calcularSemaforo, NIVELES_SEMAFORO, fechaIso, estadoVentana } from '../reglas.js';
import { api } from '../api/contratos.js';
import { catalogos, emitir } from '../estado.js';

const ICONO_NOTI = { 'clase-cancelada': 'prohibido', 'dano-grave': 'herramienta', riesgo: 'alerta', p004: 'archivo' };

export async function render(raiz, { alSalir }) {
  const cat = await catalogos();
  const filtros = { ambienteId: '', competenciaId: '', fecha: fechaIso() };
  let datos = [], colorActivo = '', busqueda = '';

  const selectAmbiente = h('select', { onchange: () => { filtros.ambienteId = selectAmbiente.value; cargarSemaforo(); } },
    h('option', { value: '' }, 'Todos los ambientes'), cat.ambientes.map((a) => h('option', { value: a.id }, a.nombre)));
  const selectCompetencia = h('select', { onchange: () => { filtros.competenciaId = selectCompetencia.value; cargarSemaforo(); } },
    h('option', { value: '' }, 'Todas las competencias'), cat.competencias.map((c) => h('option', { value: c.id }, c.nombre)));
  const inputFecha = h('input', { type: 'date', value: filtros.fecha, max: fechaIso(), onchange: () => { filtros.fecha = inputFecha.value; cargarSemaforo(); } });
  const inputBuscar = h('input', { type: 'search', placeholder: 'Nombre o documento', oninput: () => { busqueda = inputBuscar.value.trim().toLowerCase(); pintarLista(); } });

  const alertas = h('div', { class: 'alertas', 'data-anim': '' });
  const notificaciones = h('div', { class: 'card notificaciones', 'data-anim': '' }, cargando());
  const leyenda = h('div', { class: 'leyenda-semaforo' });
  const lista = h('ul', { class: 'lista-semaforo' });
  const contador = h('span', { class: 'text-muted' });

  raiz.append(
    encabezado('Panel administrativo', 'Seguimiento de asistencia, alertas tempranas y novedades de los ambientes.',
      h('a', { class: 'btn btn-outline', href: '#/p004' }, icono('archivo'), 'Gestión P004')),
    alertas,
    h('div', { class: 'admin-grid' },
      h('section', { class: 'card', 'data-anim': '' },
        h('div', { class: 'vista-cabecera' }, h('h3', { class: 'bloque-titulo' }, 'Semáforo de faltas'), contador),
        h('div', { class: 'filtros' },
          h('div', { class: 'campo' }, h('label', {}, 'Ambiente'), selectAmbiente),
          h('div', { class: 'campo' }, h('label', {}, 'Competencia'), selectCompetencia),
          h('div', { class: 'campo' }, h('label', {}, 'Corte a la fecha'), inputFecha),
          h('div', { class: 'campo' }, h('label', {}, 'Buscar'), inputBuscar)),
        leyenda,
        lista),
      notificaciones));
  anim.entrarVista(raiz);

  /* --- semáforo --- */
  async function cargarSemaforo() {
    vaciar(lista, h('li', {}, cargando()));
    try {
      datos = (await api.semaforo(filtros)).map((d) => ({ ...d, semaforo: calcularSemaforo(d) }));
    } catch (e) { vaciar(lista, h('li', {}, tarjetaError(e, cargarSemaforo))); return; }
    datos.sort((a, b) => b.semaforo.nivel - a.semaforo.nivel || b.faltasTotales - a.faltasTotales || a.nombre.localeCompare(b.nombre));
    pintarLeyenda();
    pintarLista(true);
    pintarAlertas();
  }

  function pintarLeyenda() {
    const conteo = Object.fromEntries(NIVELES_SEMAFORO.map((n) => [n.clave, 0]));
    datos.forEach((d) => conteo[d.semaforo.clave]++);
    vaciar(leyenda,
      h('button', { class: `leyenda-item${colorActivo === '' ? ' seleccionado' : ''}`, type: 'button', onclick: () => { colorActivo = ''; pintarLeyenda(); pintarLista(); } }, 'Todos', h('strong', {}, datos.length)),
      NIVELES_SEMAFORO.map((n) => h('button', {
        class: `leyenda-item leyenda-item--${n.clave}${colorActivo === n.clave ? ' seleccionado' : ''}`, type: 'button', 'aria-pressed': String(colorActivo === n.clave),
        onclick: () => { colorActivo = colorActivo === n.clave ? '' : n.clave; pintarLeyenda(); pintarLista(); },
      }, h('span', { class: 'semaforo-punto' }), n.etiqueta, h('strong', {}, conteo[n.clave]))));
  }

  function pintarLista(entrada = false) {
    const estadoFlip = entrada ? null : anim.capturarFlip(lista.querySelectorAll('.fila-semaforo'));
    const visibles = datos.filter((d) => (!colorActivo || d.semaforo.clave === colorActivo)
      && (!busqueda || d.nombre.toLowerCase().includes(busqueda) || d.documento.includes(busqueda)));
    contador.textContent = `${visibles.length} aprendices`;
    vaciar(lista, visibles.length ? visibles.map((d) => h('li', { class: `fila-semaforo fila-semaforo--${d.semaforo.clave}`, 'data-flip-id': d.aprendizId },
      badgeSemaforo(d, { compacto: true }),
      h('div', { class: 'fila-semaforo-datos' },
        h('strong', {}, d.nombre),
        h('span', { class: 'text-muted' }, `${d.documento} · Ficha ${d.ficha}`)),
      h('div', { class: 'fila-semaforo-conteo' },
        h('span', { title: 'Faltas consecutivas' }, h('strong', {}, d.faltasConsecutivas), ' consec.'),
        h('span', { title: 'Faltas totales' }, h('strong', {}, d.faltasTotales), ` / ${d.sesiones}`)),
      badgeSemaforo(d)))
      : h('li', { class: 'empty-state' }, 'Ningún aprendiz coincide con los filtros.'));
    if (entrada) anim.lista(lista.children, { autoAlpha: 0, x: -12 });
    else anim.aplicarFlip(estadoFlip);
  }

  /* --- alertas visuales --- */
  let canceladasHoy = [];
  async function cargarCanceladas() {
    try {
      canceladasHoy = (await api.sesiones({ fecha: fechaIso() })).filter((s) => estadoVentana(s).estado === 'cancelada');
    } catch { canceladasHoy = []; }
    pintarAlertas();
  }

  function pintarAlertas() {
    const rojos = datos.filter((d) => d.semaforo.clave === 'rojo').length;
    const rojosClaros = datos.filter((d) => d.semaforo.clave === 'rojo-claro').length;
    vaciar(alertas,
      canceladasHoy.map((s) => h('div', { class: 'alerta alerta--cancelada', role: 'alert' },
        icono('prohibido'),
        h('div', {}, h('strong', {}, 'Clase cancelada hoy'), h('span', {}, `${s.competencia} · Ficha ${s.ficha} · ${s.ambiente}. Motivo: ${s.motivoCancelacion}`)))),
      rojos > 0 && h('div', { class: 'alerta alerta--rojo' },
        icono('alerta'),
        h('div', {}, h('strong', {}, `${rojos} aprendices en riesgo de deserción`), h('span', {}, 'Requieren contacto inmediato y revisión del P004.')),
        h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => { colorActivo = 'rojo'; pintarLeyenda(); pintarLista(); } }, 'Ver')),
      rojosClaros > 0 && h('div', { class: 'alerta alerta--naranja' },
        icono('alerta'),
        h('div', {}, h('strong', {}, `${rojosClaros} aprendices en riesgo alto`), h('span', {}, 'Programar seguimiento con el instructor.')),
        h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => { colorActivo = 'rojo-claro'; pintarLeyenda(); pintarLista(); } }, 'Ver')));
  }

  /* --- notificaciones --- */
  let vistas = new Set();
  async function cargarNotificaciones() {
    let lista;
    try { lista = await api.notificaciones(); } catch (e) { vaciar(notificaciones, tarjetaError(e, cargarNotificaciones)); return; }
    const nuevas = lista.filter((n) => !vistas.has(n.id));
    const primeraCarga = vistas.size === 0;
    vistas = new Set(lista.map((n) => n.id));
    emitir('notificaciones', lista.filter((n) => !n.leida).length);
    vaciar(notificaciones,
      h('div', { class: 'vista-cabecera' }, h('h3', { class: 'bloque-titulo' }, 'Notificaciones'),
        h('span', { class: 'status-chip azul' }, `${lista.filter((n) => !n.leida).length} sin leer`)),
      lista.length ? h('ul', { class: 'notis' }, lista.map((n) => h('li', {
        class: `noti noti--${n.tipo}${n.leida ? '' : ' noti--nueva'}`, 'data-id': n.id,
        onclick: async (e) => {
          if (n.leida) return;
          const li = e.currentTarget;
          n.leida = true;
          li.classList.remove('noti--nueva');
          await api.marcarLeida(n.id).catch(() => {});
          cargarNotificaciones();
        },
      },
        h('span', { class: 'noti-icono' }, icono(ICONO_NOTI[n.tipo] || 'campana')),
        h('div', {}, h('strong', {}, n.titulo), h('span', {}, n.detalle), h('time', {}, formato.fechaHora(n.fecha)))))) : h('p', { class: 'empty-state' }, 'Sin notificaciones.'));
    if (!primeraCarga && nuevas.length) {
      nuevas.forEach((n) => anim.latido(notificaciones.querySelector(`[data-id="${n.id}"]`)));
      if (nuevas.some((n) => n.tipo === 'clase-cancelada')) cargarCanceladas();
    }
  }

  const sondeo = setInterval(cargarNotificaciones, 10_000);
  alSalir(() => clearInterval(sondeo));
  await Promise.all([cargarSemaforo(), cargarNotificaciones(), cargarCanceladas()]);
}
