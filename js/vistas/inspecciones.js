// Inspecciones según el rol:
//  · Instructor: elige el ambiente y pulsa "Iniciar inspección" (se registra
//    el inicio en el servidor) + sus inspecciones anteriores.
//  · Portero: pendientes de recibir (sus ambientes o todos), recibidas hoy y
//    botón para escanear el QR de una inspección.
//  · Administrativo: historial con filtros.
import { h, anexar, icono, vaciar } from '../ui/dom.js';
import { anim } from '../ui/anim.js';
import { toast, abrirModal } from '../ui/avisos.js';
import { cargando, tarjetaError } from '../ui/componentes.js';
import { crearEscaner } from '../ui/escaner.js';
import { cabecera, tarjetaInspeccion, chipInspeccion, fecha, esHoy, vacio } from '../ui/ambientes-ui.js';
import { apiAmb } from '../api/ambientes.js';
import { estado, escuchar, emitir } from '../estado.js';
import { leerQrInspeccion, ESTADOS_INSPECCION, fechaIso } from '../reglas.js';

export async function render(raiz, { params, alSalir }) {
  const u = estado.usuario;
  if (u.rol === 'instructor') return instructor(raiz, params);
  if (u.rol === 'portero') return portero(raiz, alSalir);
  return administrativo(raiz);
}

/* ---------------- instructor ---------------- */

async function instructor(raiz, params) {
  const [ambientes, mias] = await Promise.all([apiAmb.ambientes(), apiAmb.inspecciones()]);
  const enCurso = mias.find((s) => s.estado === 'en_curso');
  let elegido = Number(params.get('ambiente')) || null;

  const iniciar = h('button', { class: 'btn btn-primary btn-block btn-lg inicio-inspeccion', type: 'button', disabled: !elegido, onclick: () => arrancar() },
    icono('inspeccion'), h('span', {}, 'Iniciar inspección'));
  const opciones = h('div', { class: 'amb-selector', role: 'radiogroup', 'aria-label': 'Ambiente a inspeccionar' },
    ambientes.filter((a) => a.activo).map((a) => {
      const ult = a.ultimaInspeccion;
      const hoy = ult && esHoy(ult.iniciadaEn);
      const ocupado = ult?.estado === 'en_curso' && ult.instructorId !== u.id;
      return h('label', { class: `amb-opcion${ocupado ? ' amb-opcion--ocupado' : ''}` },
        h('input', { type: 'radio', name: 'ambiente', value: a.id, checked: a.id === elegido, disabled: ocupado, onchange: () => { elegido = a.id; actualizar(); } }),
        h('span', { class: 'amb-opcion-caja' },
          h('span', { class: 'amb-numero amb-numero--grande' }, a.codigo),
          h('span', { class: 'amb-opcion-datos' },
            h('strong', {}, a.nombre),
            h('span', { class: 'text-muted' }, `${a.itemsTotal} ítems · ${a.bloque || ''}`),
            ocupado ? h('span', { class: 'status-chip azul' }, `En inspección · ${ult.instructor}`)
              : hoy ? chipInspeccion(ult.estado) : h('span', { class: 'status-chip neutro' }, 'Sin inspección hoy')),
          h('span', { class: 'amb-opcion-marca', 'aria-hidden': 'true' }, icono('check'))));
    }));

  function actualizar() {
    iniciar.disabled = !elegido;
    const a = ambientes.find((x) => x.id === elegido);
    iniciar.lastChild.textContent = a ? `Iniciar inspección · ${a.codigo}` : 'Iniciar inspección';
  }

  async function arrancar() {
    iniciar.disabled = true;
    iniciar.classList.add('cargando-boton');
    try {
      const s = await apiAmb.iniciarInspeccion(elegido);
      emitir('inspecciones');
      toast('exito', `Inspección iniciada · ambiente ${s.ambiente.codigo}`, `Inicio registrado a las ${fecha.hora(s.iniciadaEn)}`);
      location.hash = `#/inspeccion?id=${s.id}`;
    } catch (e) {
      toast('error', 'No se pudo iniciar', e.message);
      iniciar.disabled = false;
      iniciar.classList.remove('cargando-boton');
    }
  }

  const anteriores = mias.filter((s) => s.estado !== 'en_curso');
  anexar(raiz,
    cabecera({ eyebrow: 'Inspección matutina', titulo: 'Inspecciones', subtitulo: 'Elige el ambiente que vas a recibir y revísalo antes de empezar.' }),
    enCurso && h('a', { class: 'accion-grande accion-grande--continuar', href: `#/inspeccion?id=${enCurso.id}`, 'data-anim': '' },
      h('span', { class: 'accion-grande-icono' }, icono('inspeccion')),
      h('span', {}, h('strong', {}, `Tienes una inspección en curso · ambiente ${enCurso.ambiente.codigo}`),
        h('span', {}, `Iniciada ${fecha.relativa(enCurso.iniciadaEn)}. Termínala o cancélala antes de iniciar otra.`)),
      icono('flecha')),
    !enCurso && h('section', { class: 'card', 'data-anim': '' },
      h('h3', { class: 'bloque-titulo' }, '1. Elige el ambiente'), opciones,
      h('div', { class: 'accion-fija' }, iniciar)),
    h('section', { 'data-anim': '' },
      h('h3', { class: 'bloque-titulo bloque-titulo--fuera' }, 'Mis inspecciones'),
      anteriores.length ? h('div', { class: 'insp-lista' }, anteriores.map((s) => tarjetaInspeccion(s)))
        : vacio('Todavía no has confirmado inspecciones', '', 'inspeccion')));
  actualizar();
  anim.entrarVista(raiz);
}

/* ---------------- portero ---------------- */

async function portero(raiz, alSalir) {
  let soloMios = true, pestana = 'pendientes';
  const cuerpo = h('div', { class: 'insp-lista' }, cargando());
  const pestanas = h('div', { class: 'pestanas', role: 'tablist', 'aria-label': 'Inspecciones' });
  const interruptor = h('label', { class: 'interruptor' },
    h('input', { type: 'checkbox', role: 'switch', checked: true, onchange: (e) => { soloMios = e.target.checked; cargar(); } }),
    h('span', { class: 'interruptor-pista', 'aria-hidden': 'true' }), 'Solo mis ambientes');

  anexar(raiz,
    cabecera({ eyebrow: 'Recepción de ambientes', titulo: 'Inspecciones',
      subtitulo: 'Revisa la planilla de cada ambiente y firma la recepción.',
      acciones: [h('button', { class: 'btn btn-outline', type: 'button', onclick: escanear }, icono('escanear'), 'Escanear QR de inspección')] }),
    h('div', { class: 'barra-filtros', 'data-anim': '' }, pestanas, interruptor),
    cuerpo);

  async function cargar() {
    vaciar(cuerpo, cargando());
    let pendientes, recibidas;
    try {
      [pendientes, recibidas] = await Promise.all([
        apiAmb.inspecciones({ estado: 'pendiente_recepcion', asignados: soloMios ? 1 : undefined }),
        apiAmb.inspecciones({ estado: 'recibida', desde: fechaIso(), asignados: soloMios ? 1 : undefined }),
      ]);
    } catch (e) { vaciar(cuerpo, tarjetaError(e, cargar)); return; }
    const tab = (clave, texto, n) => h('button', {
      class: 'pestana', type: 'button', role: 'tab', 'aria-selected': String(pestana === clave),
      onclick: () => { pestana = clave; cargar(); },
    }, texto, h('span', { class: 'pestana-cuenta' }, n));
    vaciar(pestanas, tab('pendientes', 'Por recibir', pendientes.length), tab('recibidas', 'Recibidas hoy', recibidas.length));
    const lista = pestana === 'pendientes' ? pendientes : recibidas;
    vaciar(cuerpo, lista.length ? lista.map((s) => tarjetaInspeccion(s, pestana === 'pendientes' ? {
      accion: h('a', { class: 'btn btn-primary btn-sm insp-tarjeta-ir', href: `#/planilla?id=${s.id}` }, icono('portero'), 'Revisar y firmar'),
    } : {})) : vacio(pestana === 'pendientes' ? 'No hay planillas por recibir' : 'Aún no has recibido planillas hoy',
      pestana === 'pendientes' ? 'Te avisaremos cuando un instructor confirme una inspección.' : '', 'portero'));
    anim.lista(cuerpo.children);
  }

  function escanear() {
    let escaner;
    const { cerrar } = abrirModal({
      titulo: 'Escanear QR de inspección', subtitulo: 'El instructor lo muestra en su pantalla de inspección.', ancho: 'angosto',
      contenido: () => {
        escaner = crearEscaner({
          tipos: ['qr'], etiqueta: 'Abrir cámara', placeholder: 'SENA-INSP:…',
          alLeer: async (texto) => {
            const token = leerQrInspeccion(texto);
            if (!token) { toast('error', 'Ese QR no es de una inspección', texto.slice(0, 60)); return; }
            try {
              const s = await apiAmb.inspeccionPorQr(token);
              cerrar();
              location.hash = `#/planilla?id=${s.id}`;
            } catch (e) { toast('error', 'No se encontró la inspección', e.message); }
          },
        });
        return escaner.el;
      },
      alCerrar: () => escaner?.detener(),
    });
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
