// Dashboard administrativo (rediseño móvil v1, simplificado): saludo,
// cuatro indicadores con contador animado, alertas (clases canceladas,
// riesgo de deserción), PanelSemaforo con distribución, filtros plegables
// y lista por aprendiz, y notificaciones. En móvil todo va en una sola
// columna; desde 1000 px el semáforo y las notificaciones van lado a lado.
import { h, icono, vaciar, formato } from '../ui/dom.js';
import { anim } from '../ui/anim.js';
import { badgeSemaforo, cargando, tarjetaError } from '../ui/componentes.js';
import { calcularSemaforo, NIVELES_SEMAFORO, fechaIso, estadoVentana } from '../reglas.js';
import { api } from '../api/contratos.js';
import { catalogos, emitir, estado } from '../estado.js';

const ICONO_NOTI = { 'clase-cancelada': 'prohibido', 'dano-grave': 'herramienta', riesgo: 'alerta', p004: 'archivo' };
const fmtDia = new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });

export async function render(raiz, { alSalir }) {
  const cat = await catalogos();
  const filtros = { ambienteId: '', competenciaId: '', fecha: fechaIso() };
  let datos = [], colorActivo = '', busqueda = '', canceladasHoy = [], sinLeer = 0;

  /* --- filtros (plegables en móvil) --- */
  const selectAmbiente = h('select', { onchange: () => { filtros.ambienteId = selectAmbiente.value; alFiltrar(); } },
    h('option', { value: '' }, 'Todos los ambientes'), cat.ambientes.map((a) => h('option', { value: a.id }, a.nombre)));
  const selectCompetencia = h('select', { onchange: () => { filtros.competenciaId = selectCompetencia.value; alFiltrar(); } },
    h('option', { value: '' }, 'Todas las competencias'), cat.competencias.map((c) => h('option', { value: c.id }, c.nombre)));
  const inputFecha = h('input', { type: 'date', value: filtros.fecha, max: fechaIso(), onchange: () => { filtros.fecha = inputFecha.value; alFiltrar(); } });
  const inputBuscar = h('input', { type: 'search', placeholder: 'Buscar por nombre o documento', 'aria-label': 'Buscar aprendiz', oninput: () => { busqueda = inputBuscar.value.trim().toLowerCase(); pintarLista(); } });
  const contadorFiltros = h('span', { class: 'adm-filtros-cuenta', hidden: true });
  const panelFiltros = h('details', { class: 'adm-filtros' },
    h('summary', {}, icono('filtro'), 'Filtros', contadorFiltros),
    h('div', { class: 'filtros' },
      h('div', { class: 'campo' }, h('label', {}, 'Ambiente'), selectAmbiente),
      h('div', { class: 'campo' }, h('label', {}, 'Competencia'), selectCompetencia),
      h('div', { class: 'campo' }, h('label', {}, 'Corte a la fecha'), inputFecha)));
  // En escritorio los filtros arrancan abiertos.
  if (window.matchMedia('(min-width: 1000px)').matches) panelFiltros.open = true;

  /* --- indicadores --- */
  const kpi = (clave, etiqueta, ic, pie, accion) => {
    const valor = h('strong', { class: 'adm-kpi-valor' }, '0');
    const nodo = h(accion ? 'button' : 'div', { class: `adm-kpi adm-kpi--${clave}`, type: accion ? 'button' : false, onclick: accion || false },
      h('span', { class: 'adm-kpi-icono' }, icono(ic)),
      h('span', { class: 'adm-kpi-etiqueta' }, etiqueta),
      valor,
      h('span', { class: 'adm-kpi-pie' }, pie));
    return { nodo, valor };
  };
  const semaforoCard = h('section', { class: 'card adm-semaforo', 'data-anim': '', 'aria-labelledby': 'adm-t-semaforo' });
  const notificaciones = h('section', { class: 'card adm-notis', 'data-anim': '', 'aria-labelledby': 'adm-t-notis' }, cargando());
  const irA = (el) => el.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  const K = {
    riesgo: kpi('riesgo', 'En riesgo', 'alerta', 'aprendices en rojo', () => { colorActivo = 'rojo'; pintarLeyenda(); pintarLista(); irA(semaforoCard); }),
    total: kpi('total', 'En seguimiento', 'usuarios', 'aprendices', () => { colorActivo = ''; pintarLeyenda(); pintarLista(); irA(semaforoCard); }),
    canceladas: kpi('canceladas', 'Canceladas hoy', 'prohibido', 'clases'),
    notis: kpi('notis', 'Sin leer', 'campana', 'notificaciones', () => irA(notificaciones)),
  };

  const alertas = h('div', { class: 'alertas', 'data-anim': '' });
  const distribucion = h('div', { class: 'adm-distribucion', role: 'img' });
  const leyenda = h('div', { class: 'leyenda-semaforo' });
  const lista = h('ul', { class: 'lista-semaforo' });
  const contador = h('span', { class: 'text-muted adm-contador' });

  const nombre = estado.usuario?.nombre?.split(' ')[0] || '';
  const hoy = fmtDia.format(new Date());
  vaciar(semaforoCard,
    h('div', { class: 'adm-bloque-cabecera' },
      h('h3', { class: 'bloque-titulo', id: 'adm-t-semaforo' }, 'Semáforo de faltas'), contador),
    distribucion,
    h('div', { class: 'adm-buscar' }, icono('buscar'), inputBuscar),
    panelFiltros,
    leyenda,
    lista);

  raiz.append(
    h('div', { class: 'adm-saludo', 'data-anim': '' },
      h('div', {},
        h('span', { class: 'eyebrow eyebrow-verde' }, hoy[0].toUpperCase() + hoy.slice(1)),
        h('h2', { class: 'vista-titulo' }, nombre ? `Hola, ${nombre}` : 'Panel administrativo'),
        h('p', { class: 'section-sub' }, 'Lo más importante de asistencia y ambientes hoy.')),
      h('a', { class: 'btn btn-outline btn-sm', href: '#/p004' }, icono('archivo'), 'Gestión P004')),
    h('section', { class: 'adm-kpis', 'data-anim': '', 'aria-label': 'Indicadores del día' }, Object.values(K).map((k) => k.nodo)),
    alertas,
    h('div', { class: 'admin-grid' }, semaforoCard, notificaciones));
  anim.entrarVista(raiz);

  function alFiltrar() {
    const activos = [filtros.ambienteId, filtros.competenciaId, filtros.fecha !== fechaIso() && filtros.fecha].filter(Boolean).length;
    contadorFiltros.textContent = activos;
    contadorFiltros.hidden = !activos;
    cargarSemaforo();
  }

  function pintarKpis() {
    anim.contar(K.riesgo.valor, datos.filter((d) => d.semaforo.clave === 'rojo').length);
    anim.contar(K.total.valor, datos.length);
    anim.contar(K.canceladas.valor, canceladasHoy.length);
    anim.contar(K.notis.valor, sinLeer);
  }

  /* --- semáforo --- */
  async function cargarSemaforo() {
    vaciar(lista, h('li', {}, cargando()));
    try {
      datos = (await api.semaforo(filtros)).map((d) => ({ ...d, semaforo: calcularSemaforo(d) }));
    } catch (e) { vaciar(lista, h('li', {}, tarjetaError(e, cargarSemaforo))); return; }
    datos.sort((a, b) => b.semaforo.nivel - a.semaforo.nivel || b.faltasTotales - a.faltasTotales || a.nombre.localeCompare(b.nombre));
    pintarDistribucion();
    pintarLeyenda();
    pintarLista(true);
    pintarAlertas();
    pintarKpis();
  }

  // Barra apilada: cada tramo crece hasta su proporción (out-cúbico).
  function pintarDistribucion() {
    const total = datos.length || 1;
    const partes = NIVELES_SEMAFORO.map((n) => [n, datos.filter((d) => d.semaforo.clave === n.clave).length]).filter(([, c]) => c);
    distribucion.setAttribute('aria-label', partes.map(([n, c]) => `${n.etiqueta}: ${c}`).join(', ') || 'Sin datos');
    vaciar(distribucion, partes.map(([n, c]) => h('span', { class: `adm-tramo leyenda-item--${n.clave}`, style: `--p:${(c / total) * 100}%`, title: `${n.etiqueta}: ${c}` })));
    requestAnimationFrame(() => requestAnimationFrame(() => distribucion.classList.add('adm-distribucion--llena')));
  }

  function pintarLeyenda() {
    const conteo = Object.fromEntries(NIVELES_SEMAFORO.map((n) => [n.clave, 0]));
    datos.forEach((d) => conteo[d.semaforo.clave]++);
    vaciar(leyenda,
      h('button', { class: `leyenda-item${colorActivo === '' ? ' seleccionado' : ''}`, type: 'button', 'aria-pressed': String(colorActivo === ''), onclick: () => { colorActivo = ''; pintarLeyenda(); pintarLista(); } }, 'Todos', h('strong', {}, datos.length)),
      NIVELES_SEMAFORO.map((n) => h('button', {
        class: `leyenda-item leyenda-item--${n.clave}${colorActivo === n.clave ? ' seleccionado' : ''}`, type: 'button', 'aria-pressed': String(colorActivo === n.clave),
        onclick: () => { colorActivo = colorActivo === n.clave ? '' : n.clave; pintarLeyenda(); pintarLista(); },
      }, h('span', { class: 'semaforo-punto' }), n.etiqueta, h('strong', {}, conteo[n.clave]))));
  }

  function pintarLista(entrada = false) {
    const estadoFlip = entrada ? null : anim.capturarFlip(lista.querySelectorAll('.fila-semaforo'));
    const visibles = datos.filter((d) => (!colorActivo || d.semaforo.clave === colorActivo)
      && (!busqueda || d.nombre.toLowerCase().includes(busqueda) || d.documento.includes(busqueda)));
    contador.textContent = `${visibles.length} de ${datos.length}`;
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
    if (entrada) anim.lista(lista.children, { autoAlpha: 0, y: 8 });
    else anim.aplicarFlip(estadoFlip);
  }

  /* --- alertas visuales --- */
  async function cargarCanceladas() {
    try {
      canceladasHoy = (await api.sesiones({ fecha: fechaIso() })).filter((s) => estadoVentana(s).estado === 'cancelada');
    } catch { canceladasHoy = []; }
    pintarAlertas();
    pintarKpis();
  }

  function pintarAlertas() {
    const rojos = datos.filter((d) => d.semaforo.clave === 'rojo').length;
    const rojosClaros = datos.filter((d) => d.semaforo.clave === 'rojo-claro').length;
    const ver = (clave) => () => { colorActivo = clave; pintarLeyenda(); pintarLista(); irA(semaforoCard); };
    vaciar(alertas,
      canceladasHoy.map((s) => h('div', { class: 'alerta alerta--cancelada', role: 'alert' },
        icono('prohibido'),
        h('div', {}, h('strong', {}, 'Clase cancelada hoy'), h('span', {}, `${s.competencia} · Ficha ${s.ficha} · ${s.ambiente}. Motivo: ${s.motivoCancelacion}`)))),
      rojos > 0 && h('div', { class: 'alerta alerta--rojo' },
        icono('alerta'),
        h('div', {}, h('strong', {}, `${rojos} aprendices en riesgo de deserción`), h('span', {}, 'Requieren contacto inmediato y revisión del P004.')),
        h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: ver('rojo') }, 'Ver')),
      rojosClaros > 0 && h('div', { class: 'alerta alerta--naranja' },
        icono('alerta'),
        h('div', {}, h('strong', {}, `${rojosClaros} aprendices en riesgo alto`), h('span', {}, 'Programar seguimiento con el instructor.')),
        h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: ver('rojo-claro') }, 'Ver')));
  }

  /* --- notificaciones --- */
  let vistas = new Set();
  async function cargarNotificaciones() {
    let lista;
    try { lista = await api.notificaciones(); } catch (e) { vaciar(notificaciones, tarjetaError(e, cargarNotificaciones)); return; }
    const nuevas = lista.filter((n) => !vistas.has(n.id));
    const primeraCarga = vistas.size === 0;
    vistas = new Set(lista.map((n) => n.id));
    sinLeer = lista.filter((n) => !n.leida).length;
    emitir('notificaciones', sinLeer);
    pintarKpis();
    vaciar(notificaciones,
      h('div', { class: 'adm-bloque-cabecera' }, h('h3', { class: 'bloque-titulo', id: 'adm-t-notis' }, 'Notificaciones'),
        h('span', { class: 'status-chip azul' }, `${sinLeer} sin leer`)),
      lista.length ? h('ul', { class: 'notis' }, lista.map((n) => h('li', {
        class: `noti noti--${n.tipo}${n.leida ? '' : ' noti--nueva'}`, 'data-id': n.id,
        tabindex: n.leida ? false : '0', role: n.leida ? false : 'button', 'aria-label': n.leida ? false : `${n.titulo}. Marcar como leída`,
        onclick: marcar(n), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); marcar(n)(e); } },
      },
        h('span', { class: 'noti-icono' }, icono(ICONO_NOTI[n.tipo] || 'campana')),
        h('div', {}, h('strong', {}, n.titulo), h('span', {}, n.detalle), h('time', {}, formato.fechaHora(n.fecha)))))) : h('p', { class: 'empty-state' }, 'Sin notificaciones.'));
    if (!primeraCarga && nuevas.length) {
      nuevas.forEach((n) => anim.latido(notificaciones.querySelector(`[data-id="${n.id}"]`)));
      if (nuevas.some((n) => n.tipo === 'clase-cancelada')) cargarCanceladas();
    }
  }
  const marcar = (n) => async (e) => {
    if (n.leida) return;
    e.currentTarget.classList.remove('noti--nueva');
    n.leida = true;
    await api.marcarLeida(n.id).catch(() => {});
    cargarNotificaciones();
  };

  const sondeo = setInterval(cargarNotificaciones, 10_000);
  alSalir(() => clearInterval(sondeo));
  await Promise.all([cargarSemaforo(), cargarNotificaciones(), cargarCanceladas()]);
}
