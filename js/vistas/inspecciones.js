// Inspecciones (entrega de ambientes) según el rol:
//  · Instructor: elige el ambiente y pulsa "Iniciar revisión"; si ya la
//    terminó, "Escanear QR del portero" para recibirlo. Lista de sus revisiones.
//  · Portero: pestañas "Por entregar" (revisiones terminadas: generar o
//    mostrar el QR) y "Entregados hoy".
//  · Administrativo: historial con filtros.
import { h, anexar, icono, vaciar } from '../ui/dom.js';
import { anim } from '../ui/anim.js';
import { toast } from '../ui/avisos.js';
import { cargando, tarjetaError } from '../ui/componentes.js';
import { escanearEntrega } from '../ui/recibir.js';
import { cabecera, tarjetaInspeccion, chipInspeccion, fecha, esHoy, vacio } from '../ui/ambientes-ui.js';
import { apiAmb } from '../api/ambientes.js';
import { estado, escuchar, emitir } from '../estado.js';
import { ESTADOS_INSPECCION, fechaIso } from '../reglas.js';

const ABIERTAS = ['en_curso', 'pendiente_recepcion'];

export async function render(raiz, { params, alSalir }) {
  const u = estado.usuario;
  if (u.rol === 'instructor') return instructor(raiz, params);
  if (u.rol === 'portero') return portero(raiz, alSalir);
  return administrativo(raiz);
}

/* ---------------- instructor ---------------- */

async function instructor(raiz, params) {
  const u = estado.usuario;
  const [ambientes, mias] = await Promise.all([apiAmb.ambientes(), apiAmb.inspecciones()]);
  const enCurso = mias.find((s) => s.estado === 'en_curso');
  const porRecibir = mias.filter((s) => s.estado === 'pendiente_recepcion');
  const ocupado = (a) => ABIERTAS.includes(a.ultimaInspeccion?.estado) && a.ultimaInspeccion.instructorId !== u.id;
  let elegido = Number(params.get('ambiente')) || null;

  const iniciar = h('button', { class: 'btn btn-primary btn-block btn-lg inicio-inspeccion', type: 'button', disabled: !elegido, onclick: () => arrancar() },
    icono('inspeccion'), h('span', {}, 'Iniciar revisión'));
  const opciones = h('div', { class: 'amb-selector', role: 'radiogroup', 'aria-label': 'Ambiente a revisar' },
    ambientes.filter((a) => a.activo).map((a) => {
      const ult = a.ultimaInspeccion;
      const hoy = ult && esHoy(ult.iniciadaEn);
      return h('label', { class: `amb-opcion${ocupado(a) ? ' amb-opcion--ocupado' : ''}` },
        h('input', { type: 'radio', name: 'ambiente', value: a.id, checked: a.id === elegido, disabled: ocupado(a), onchange: () => { elegido = a.id; actualizar(); } }),
        h('span', { class: 'amb-opcion-caja' },
          h('span', { class: 'amb-numero amb-numero--grande' }, a.codigo),
          h('span', { class: 'amb-opcion-datos' },
            h('strong', {}, a.nombre),
            h('span', { class: 'text-muted' }, `${a.itemsTotal} ítems · ${a.bloque || ''}`),
            ocupado(a) ? h('span', { class: 'status-chip azul' }, `${ESTADOS_INSPECCION[ult.estado][0]} · ${ult.instructor}`)
              : hoy ? chipInspeccion(ult.estado) : h('span', { class: 'status-chip neutro' }, 'Sin revisión hoy')),
          h('span', { class: 'amb-opcion-marca', 'aria-hidden': 'true' }, icono('check'))));
    }));

  function actualizar() {
    iniciar.disabled = !elegido;
    const a = ambientes.find((x) => x.id === elegido);
    iniciar.lastChild.textContent = a ? `Iniciar revisión · ${a.codigo}` : 'Iniciar revisión';
  }

  async function arrancar() {
    iniciar.disabled = true;
    iniciar.classList.add('cargando-boton');
    try {
      const s = await apiAmb.iniciarInspeccion(elegido);
      emitir('inspecciones');
      if (s.estado === 'pendiente_recepcion') { location.hash = `#/planilla?id=${s.id}`; return; }
      toast('exito', `Revisión iniciada · ambiente ${s.ambiente.codigo}`, `Inicio registrado a las ${fecha.hora(s.iniciadaEn)}`);
      location.hash = `#/inspeccion?id=${s.id}`;
    } catch (e) {
      toast('error', 'No se pudo iniciar', e.message);
      iniciar.disabled = false;
      iniciar.classList.remove('cargando-boton');
    }
  }

  const anteriores = mias.filter((s) => !ABIERTAS.includes(s.estado));
  anexar(raiz,
    cabecera({ eyebrow: 'Revisión al entrar', titulo: 'Inspecciones', subtitulo: 'Revisa el salón, reporta los daños con foto y recíbelo escaneando el QR del portero.' }),
    porRecibir.map((s) => h('button', { class: 'accion-grande accion-grande--alerta', type: 'button', onclick: escanearEntrega, 'data-anim': '' },
      h('span', { class: 'accion-grande-icono' }, icono('escanear')),
      h('span', {}, h('strong', {}, `Escanear QR del portero · ambiente ${s.ambiente.codigo}`),
        h('span', {}, s.qrGeneradoEn ? 'El portero ya generó el QR de entrega' : 'Revisión terminada: pide al portero que genere el QR')),
      icono('flecha'))),
    enCurso && h('a', { class: 'accion-grande accion-grande--continuar', href: `#/inspeccion?id=${enCurso.id}`, 'data-anim': '' },
      h('span', { class: 'accion-grande-icono' }, icono('inspeccion')),
      h('span', {}, h('strong', {}, `Tienes una revisión en curso · ambiente ${enCurso.ambiente.codigo}`),
        h('span', {}, `Iniciada ${fecha.relativa(enCurso.iniciadaEn)}. Termínala o cancélala antes de iniciar otra.`)),
      icono('flecha')),
    !enCurso && h('section', { class: 'card', 'data-anim': '' },
      h('h3', { class: 'bloque-titulo' }, 'Elige el ambiente que vas a recibir'), opciones,
      h('div', { class: 'accion-fija' }, iniciar)),
    h('section', { 'data-anim': '' },
      h('h3', { class: 'bloque-titulo bloque-titulo--fuera' }, 'Mis ambientes recibidos'),
      anteriores.length ? h('div', { class: 'insp-lista' }, anteriores.map((s) => tarjetaInspeccion(s)))
        : vacio('Todavía no has recibido ambientes', 'Cuando escanees el QR de un portero, aparecerán aquí.', 'inspeccion')));
  actualizar();
  anim.entrarVista(raiz);
}

/* ---------------- portero ---------------- */

async function portero(raiz, alSalir) {
  const u = estado.usuario;
  let pestana = 'pendientes';
  const cuerpo = h('div', { class: 'insp-lista' }, cargando());
  const pestanas = h('div', { class: 'pestanas', role: 'tablist', 'aria-label': 'Entregas' });

  anexar(raiz,
    cabecera({ eyebrow: 'Entrega de ambientes', titulo: 'Inspecciones',
      subtitulo: 'Cuando el instructor termine la revisión, genera el QR de entrega y muéstraselo para que lo escanee.' }),
    h('div', { class: 'barra-filtros', 'data-anim': '' }, pestanas),
    cuerpo);

  async function cargar() {
    vaciar(cuerpo, cargando());
    let pendientes, entregados;
    try {
      [pendientes, entregados] = await Promise.all([
        apiAmb.inspecciones({ estado: 'pendiente_recepcion' }),
        apiAmb.inspecciones({ estado: 'recibida', desde: fechaIso(), asignados: 1 }),
      ]);
    } catch (e) { vaciar(cuerpo, tarjetaError(e, cargar)); return; }
    // Primero las de los ambientes asignados a este portero.
    pendientes.sort((a, b) => (b.ambiente.porteroId === u.id) - (a.ambiente.porteroId === u.id));
    const tab = (clave, texto, n) => h('button', {
      class: 'pestana', type: 'button', role: 'tab', 'aria-selected': String(pestana === clave),
      onclick: () => { pestana = clave; cargar(); },
    }, texto, h('span', { class: 'pestana-cuenta' }, n));
    vaciar(pestanas, tab('pendientes', 'Por entregar', pendientes.length), tab('entregados', 'Entregados hoy', entregados.length));
    const lista = pestana === 'pendientes' ? pendientes : entregados;
    vaciar(cuerpo, lista.length ? lista.map((s) => tarjetaInspeccion(s, pestana === 'pendientes' ? {
      accion: h('a', { class: 'btn btn-primary btn-sm insp-tarjeta-ir', href: `#/planilla?id=${s.id}` }, icono('qr'), s.qrGeneradoEn ? 'Mostrar QR' : 'Generar QR'),
    } : {})) : vacio(pestana === 'pendientes' ? 'No hay ambientes por entregar' : 'Aún no has entregado ambientes hoy',
      pestana === 'pendientes' ? 'Te avisaremos cuando un instructor termine la revisión de un ambiente.' : '', 'portero'));
    anim.lista(cuerpo.children);
  }

  alSalir(escuchar('bandeja', cargar));
  await cargar();
  anim.entrarVista(raiz);
}

/* ---------------- administrativo ---------------- */

async function administrativo(raiz) {
  const [ambientes, instructores] = await Promise.all([apiAmb.ambientes(), apiAmb.usuarios('instructor')]);
  const f = { desde: '', hasta: '', ambienteId: '', instructorId: '', estado: '', resultado: '' };
  const cuerpo = h('div', { class: 'insp-lista' }, cargando());
  const contador = h('span', { class: 'text-muted' });
  const sel = (clave, etiqueta, opciones) => h('div', { class: 'campo' }, h('label', { for: `f-${clave}` }, etiqueta),
    h('select', { id: `f-${clave}`, onchange: (e) => { f[clave] = e.target.value; cargar(); } }, h('option', { value: '' }, 'Todos'), opciones));
  const fechaInput = (clave, etiqueta) => h('div', { class: 'campo' }, h('label', { for: `f-${clave}` }, etiqueta),
    h('input', { type: 'date', id: `f-${clave}`, max: fechaIso(), onchange: (e) => { f[clave] = e.target.value; cargar(); } }));

  anexar(raiz,
    cabecera({ eyebrow: 'Historial', titulo: 'Inspecciones', subtitulo: 'Consulta todas las inspecciones registradas.',
      acciones: [h('a', { class: 'btn btn-outline', href: '#/reportes' }, icono('reporte'), 'Ver reportes')] }),
    h('details', { class: 'card adm-filtros-card', 'data-anim': '', open: window.matchMedia('(min-width: 900px)').matches },
      h('summary', {}, icono('filtro'), 'Filtros'),
      h('div', { class: 'filtros' },
        fechaInput('desde', 'Desde'), fechaInput('hasta', 'Hasta'),
        sel('ambienteId', 'Ambiente', ambientes.map((a) => h('option', { value: a.id }, `${a.codigo} · ${a.nombre}`))),
        sel('instructorId', 'Instructor', instructores.map((i) => h('option', { value: i.id }, i.nombre))),
        sel('estado', 'Estado', Object.entries(ESTADOS_INSPECCION).map(([k, [t]]) => h('option', { value: k }, t))),
        sel('resultado', 'Resultado', [h('option', { value: 'ok' }, 'Sin novedad'), h('option', { value: 'con_danos' }, 'Con novedades')]))),
    h('p', { class: 'contador-resultados', 'data-anim': '' }, contador),
    cuerpo);

  async function cargar() {
    vaciar(cuerpo, cargando());
    let lista;
    try { lista = await apiAmb.inspecciones(f); } catch (e) { vaciar(cuerpo, tarjetaError(e, cargar)); return; }
    contador.textContent = `${lista.length} inspección${lista.length === 1 ? '' : 'es'}`;
    vaciar(cuerpo, lista.length ? lista.map((s) => tarjetaInspeccion(s)) : vacio('Ninguna inspección coincide con los filtros', '', 'filtro'));
    anim.lista(cuerpo.children);
  }
  await cargar();
  anim.entrarVista(raiz);
}
