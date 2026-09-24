// Inspecciones (entrega de ambientes) según el rol:
//  · Portero: elige el ambiente y pulsa "Iniciar revisión"; lo revisa con el
//    instructor, lo entrega y genera el QR. Pestañas: esperando al instructor
//    (vuelve a mostrar el QR) y entregados hoy.
//  · Instructor: "Recibir ambiente" escanea el QR del portero; lista de los
//    ambientes que ha recibido.
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
  if (u.rol === 'portero') return portero(raiz, params, alSalir);
  if (u.rol === 'instructor') return instructor(raiz, alSalir);
  return administrativo(raiz);
}

/* ---------------- portero ---------------- */

async function portero(raiz, params, alSalir) {
  const u = estado.usuario;
  const [ambientes, abiertas] = await Promise.all([apiAmb.ambientes(), apiAmb.inspecciones({ estado: 'en_curso' })]);
  const enCurso = abiertas.find((s) => s.portero.id === u.id);
  // Primero los ambientes asignados al portero.
  const activos = ambientes.filter((a) => a.activo).sort((a, b) => (b.porteroId === u.id) - (a.porteroId === u.id));
  const ocupado = (a) => ABIERTAS.includes(a.ultimaInspeccion?.estado);
  let elegido = Number(params.get('ambiente')) || null;
  if (!activos.some((a) => a.id === elegido && !ocupado(a))) elegido = null;

  const iniciar = h('button', { class: 'btn btn-primary btn-block btn-lg inicio-inspeccion', type: 'button', disabled: !elegido, onclick: () => arrancar() },
    icono('inspeccion'), h('span', {}, 'Iniciar revisión'));
  const opciones = h('div', { class: 'amb-selector', role: 'radiogroup', 'aria-label': 'Ambiente a entregar' },
    activos.map((a) => {
      const ult = a.ultimaInspeccion;
      const hoy = ult && esHoy(ult.iniciadaEn);
      return h('label', { class: `amb-opcion${ocupado(a) ? ' amb-opcion--ocupado' : ''}` },
        h('input', { type: 'radio', name: 'ambiente', value: a.id, checked: a.id === elegido, disabled: ocupado(a), onchange: () => { elegido = a.id; actualizar(); } }),
        h('span', { class: 'amb-opcion-caja' },
          h('span', { class: 'amb-numero amb-numero--grande' }, a.codigo),
          h('span', { class: 'amb-opcion-datos' },
            h('strong', {}, a.nombre),
            h('span', { class: 'text-muted' }, `${a.itemsTotal} ítems · ${a.porteroId === u.id ? 'asignado a ti' : (a.portero || 'sin portero')}`),
            ocupado(a) ? h('span', { class: 'status-chip azul' }, `${ESTADOS_INSPECCION[ult.estado][0]} · ${ult.portero}`)
              : hoy ? chipInspeccion(ult.estado) : h('span', { class: 'status-chip neutro' }, 'Sin entrega hoy')),
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
      toast('exito', `Revisión iniciada · ambiente ${s.ambiente.codigo}`, `Inicio registrado a las ${fecha.hora(s.iniciadaEn)}`);
      location.hash = `#/inspeccion?id=${s.id}`;
    } catch (e) {
      toast('error', 'No se pudo iniciar', e.message);
      iniciar.disabled = false;
      iniciar.classList.remove('cargando-boton');
    }
  }

  let pestana = 'esperando';
  const cuerpo = h('div', { class: 'insp-lista' }, cargando());
  const pestanas = h('div', { class: 'pestanas', role: 'tablist', 'aria-label': 'Entregas' });

  anexar(raiz,
    cabecera({ eyebrow: 'Entrega de ambientes', titulo: 'Inspecciones',
      subtitulo: 'Revisa el ambiente con el instructor, entrégalo y muéstrale el QR para que lo reciba.' }),
    enCurso ? h('a', { class: 'accion-grande accion-grande--continuar', href: `#/inspeccion?id=${enCurso.id}`, 'data-anim': '' },
      h('span', { class: 'accion-grande-icono' }, icono('inspeccion')),
      h('span', {}, h('strong', {}, `Tienes una revisión en curso · ambiente ${enCurso.ambiente.codigo}`),
        h('span', {}, `Iniciada ${fecha.relativa(enCurso.iniciadaEn)}. Termínala para generar el QR.`)),
      icono('flecha'))
      : h('section', { class: 'card', 'data-anim': '' },
        h('h3', { class: 'bloque-titulo' }, 'Elige el ambiente que vas a entregar'), opciones,
        h('div', { class: 'accion-fija' }, iniciar)),
    h('div', { class: 'barra-filtros', 'data-anim': '' }, pestanas),
    cuerpo);

  async function cargar() {
    vaciar(cuerpo, cargando());
    let esperando, entregados;
    try {
      [esperando, entregados] = await Promise.all([
        apiAmb.inspecciones({ estado: 'pendiente_recepcion', asignados: 1 }),
        apiAmb.inspecciones({ estado: 'recibida', desde: fechaIso(), asignados: 1 }),
      ]);
    } catch (e) { vaciar(cuerpo, tarjetaError(e, cargar)); return; }
    const tab = (clave, texto, n) => h('button', {
      class: 'pestana', type: 'button', role: 'tab', 'aria-selected': String(pestana === clave),
      onclick: () => { pestana = clave; cargar(); },
    }, texto, h('span', { class: 'pestana-cuenta' }, n));
    vaciar(pestanas, tab('esperando', 'Esperando al instructor', esperando.length), tab('entregados', 'Entregados hoy', entregados.length));
    const lista = pestana === 'esperando' ? esperando : entregados;
    vaciar(cuerpo, lista.length ? lista.map((s) => tarjetaInspeccion(s, pestana === 'esperando' && s.portero.id === u.id ? {
      accion: h('a', { class: 'btn btn-primary btn-sm insp-tarjeta-ir', href: `#/planilla?id=${s.id}` }, icono('qr'), 'Mostrar QR'),
    } : {})) : vacio(pestana === 'esperando' ? 'No hay entregas esperando al instructor' : 'Aún no has entregado ambientes hoy',
      pestana === 'esperando' ? 'Cuando confirmes una entrega, su QR queda aquí hasta que el instructor lo escanee.' : '', 'portero'));
    anim.lista(cuerpo.children);
  }

  actualizar();
  alSalir(escuchar('bandeja', cargar));
  await cargar();
  anim.entrarVista(raiz);
}

/* ---------------- instructor ---------------- */

async function instructor(raiz, alSalir) {
  const cuerpo = h('div', { class: 'insp-instructor' }, cargando());
  anexar(raiz,
    cabecera({ eyebrow: 'Recepción de ambientes', titulo: 'Inspecciones',
      subtitulo: 'Revisa el salón con el portero y escanea el QR que te muestra para recibirlo.' }),
    h('button', { class: 'accion-grande', type: 'button', onclick: escanearEntrega, 'data-anim': '' },
      h('span', { class: 'accion-grande-icono' }, icono('escanear')),
      h('span', {}, h('strong', {}, 'Recibir ambiente'), h('span', {}, 'Escanea el QR del portero')),
      icono('flecha')),
    cuerpo);

  async function cargar() {
    let ambientes, mias;
    try { [ambientes, mias] = await Promise.all([apiAmb.ambientes(), apiAmb.inspecciones()]); } catch (e) { vaciar(cuerpo, tarjetaError(e, cargar)); return; }
    const listos = ambientes.filter((a) => a.ultimaInspeccion?.estado === 'pendiente_recepcion');
    vaciar(cuerpo,
      listos.length ? h('section', { class: 'card' },
        h('h3', { class: 'bloque-titulo' }, 'Listos para recibir'),
        h('ul', { class: 'lista-ambientes' }, listos.map((a) => h('li', { class: 'fila-ambiente' },
          h('span', { class: 'amb-numero' }, a.codigo),
          h('div', { class: 'fila-ambiente-datos' }, h('strong', {}, a.nombre), h('span', { class: 'text-muted' }, `Entrega ${a.ultimaInspeccion.portero}`)),
          h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: escanearEntrega, 'aria-label': `Recibir ambiente ${a.codigo}` }, icono('escanear'), 'Escanear'))))) : null,
      h('section', {},
        h('h3', { class: 'bloque-titulo bloque-titulo--fuera' }, 'Ambientes que he recibido'),
        mias.length ? h('div', { class: 'insp-lista' }, mias.map((s) => tarjetaInspeccion(s)))
          : vacio('Todavía no has recibido ambientes', 'Cuando escanees el QR de un portero, aparecerá aquí.', 'inspeccion')));
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
