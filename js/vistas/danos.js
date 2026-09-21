// Reporte de daños: FormDaño (activo vinculado por escaneo o selección,
// prioridad y descripción), CameraCapture y UploadPreview. Regla: la foto
// es obligatoria cuando la prioridad es grave.
import { h, icono, vaciar, errorCampo } from '../ui/dom.js';
import { anim } from '../ui/anim.js';
import { toast } from '../ui/avisos.js';
import { crearEscaner } from '../ui/escaner.js';
import { crearCapturaFoto } from '../ui/camara.js';
import { chipActivo, encabezado } from '../ui/componentes.js';
import { PRIORIDADES, validarDano } from '../reglas.js';
import { api } from '../api/contratos.js';
import { estado, catalogos } from '../estado.js';

const TEXTO_PRIORIDAD = {
  leve: 'No impide usar el activo.',
  moderada: 'Funciona con limitaciones.',
  grave: 'Inutilizable o riesgo para las personas.',
};

export async function render(raiz, { params, alSalir }) {
  const cat = await catalogos();
  const usuario = estado.usuario;
  const ambientes = usuario.ambienteIds ? cat.ambientes.filter((a) => usuario.ambienteIds.includes(a.id)) : cat.ambientes;
  let activo = null, prioridad = '', foto = null, enviando = false;

  /* --- activo vinculado --- */
  const tarjetaActivo = h('div', { class: 'activo-vinculado', hidden: true });
  const selectAmbiente = h('select', { onchange: () => cargarActivos() }, ambientes.map((a) => h('option', { value: a.id }, a.nombre)));
  const selectActivo = h('select', { onchange: () => { const a = listaActivos.find((x) => x.id === selectActivo.value); if (a) vincular(a); } });
  let listaActivos = [];

  const escaner = crearEscaner({
    tipos: ['barras'], etiqueta: 'Escanear activo', placeholder: 'Código del activo',
    alLeer: async (codigo) => {
      try { vincular(await api.activoPorCodigo(codigo)); toast('exito', 'Activo vinculado', codigo); } catch (e) { toast('error', 'Código no encontrado', e.message); }
    },
  });
  alSalir(() => { escaner.detener(); captura.detener(); });

  const bloqueActivo = h('fieldset', { class: 'campo bloque-form' },
    h('legend', {}, h('span', { class: 'paso' }, '1'), 'Activo vinculado'),
    tarjetaActivo,
    h('div', { class: 'elegir-activo' },
      escaner.el,
      h('div', { class: 'o-separador' }, 'o selecciónalo'),
      h('div', { class: 'filtros filtros--2' },
        h('div', {}, h('label', {}, 'Ambiente'), selectAmbiente),
        h('div', {}, h('label', {}, 'Activo'), selectActivo))));

  async function cargarActivos(preseleccion) {
    vaciar(selectActivo, h('option', { value: '' }, 'Cargando…'));
    try { listaActivos = await api.activos(selectAmbiente.value); } catch (e) { toast('error', 'No se cargaron los activos', e.message); return; }
    vaciar(selectActivo, h('option', { value: '' }, 'Elige un activo'), listaActivos.map((a) => h('option', { value: a.id, selected: a.id === preseleccion }, `${a.nombre} · ${a.codigo}`)));
  }

  function vincular(a) {
    activo = a;
    errorCampo(tarjetaActivo, null);
    if (selectAmbiente.value !== a.ambienteId && ambientes.some((x) => x.id === a.ambienteId)) {
      selectAmbiente.value = a.ambienteId;
      cargarActivos(a.id);
    } else selectActivo.value = a.id;
    tarjetaActivo.hidden = false;
    vaciar(tarjetaActivo,
      icono('caja', 'icon activo-vinculado-icono'),
      h('div', {}, h('strong', {}, a.nombre), h('span', { class: 'mono text-muted' }, `${a.codigo} · ${a.tipo}`)),
      chipActivo(a.estado),
      h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => { activo = null; tarjetaActivo.hidden = true; selectActivo.value = ''; } }, 'Cambiar'));
    anim.lista([tarjetaActivo], { autoAlpha: 0, y: -6 });
  }

  /* --- prioridad --- */
  const etiquetaFoto = h('span', { class: 'foto-requisito' }, '(opcional)');
  const bloquePrioridad = h('fieldset', { class: 'campo bloque-form' },
    h('legend', {}, h('span', { class: 'paso' }, '2'), 'Prioridad'),
    h('div', { class: 'prioridades', role: 'radiogroup' }, PRIORIDADES.map((p) => h('label', { class: `prioridad prioridad--${p.clave}` },
      h('input', { type: 'radio', name: 'prioridad', value: p.clave, onchange: () => cambiarPrioridad(p.clave) }),
      h('strong', {}, p.etiqueta), h('span', {}, TEXTO_PRIORIDAD[p.clave])))));

  function cambiarPrioridad(valor) {
    prioridad = valor;
    errorCampo(bloquePrioridad.querySelector('.prioridades'), null);
    const grave = valor === 'grave';
    etiquetaFoto.textContent = grave ? '(obligatoria para daños graves)' : '(opcional)';
    etiquetaFoto.classList.toggle('foto-requisito--obligatoria', grave);
    if (grave) anim.latido(etiquetaFoto);
    if (!grave) errorCampo(captura.el, null);
  }

  /* --- descripción --- */
  const descripcion = h('textarea', { maxlength: 500, rows: 4, placeholder: '¿Qué pasó? ¿Dónde está el daño? ¿Desde cuándo?', style: { minHeight: '110px' } });
  const contador = h('span', { class: 'contador-caracteres' }, '0/500');
  descripcion.addEventListener('input', () => { contador.textContent = `${descripcion.value.length}/500`; errorCampo(descripcion, null); });

  /* --- foto --- */
  const captura = crearCapturaFoto({ alCambiar: (f) => { foto = f; if (f) errorCampo(captura.el, null); } });

  const enviar = h('button', { class: 'btn btn-primary btn-lg', type: 'submit' }, icono('check'), 'Enviar reporte');
  const form = h('form', { class: 'form-dano', novalidate: true, onsubmit: enviarReporte },
    bloqueActivo,
    bloquePrioridad,
    h('div', { class: 'campo bloque-form' }, h('label', { class: 'legend' }, h('span', { class: 'paso' }, '3'), 'Descripción'), descripcion, contador),
    h('div', { class: 'campo bloque-form' }, h('label', { class: 'legend' }, h('span', { class: 'paso' }, '4'), 'Foto del daño ', etiquetaFoto), captura.el),
    h('div', { class: 'form-actions' }, enviar, h('a', { class: 'btn btn-outline', href: '#/inventario' }, 'Ver inventario')));

  const exito = h('div', { class: 'resultado-zona' });
  raiz.append(
    encabezado('Reportar daño', 'Vincula el activo, describe el daño y adjunta una foto. Los daños graves notifican a coordinación.'),
    h('div', { class: 'card', 'data-anim': '' }, form),
    exito);
  anim.entrarVista(raiz);

  async function enviarReporte(e) {
    e.preventDefault();
    if (enviando) return;
    const datos = { activoId: activo?.id, prioridad, descripcion: descripcion.value.trim(), foto };
    const errores = validarDano(datos);
    errorCampo(tarjetaActivo.hidden ? bloqueActivo.querySelector('.elegir-activo') : tarjetaActivo, errores.activoId);
    errorCampo(bloquePrioridad.querySelector('.prioridades'), errores.prioridad);
    errorCampo(descripcion, errores.descripcion);
    errorCampo(captura.el, errores.foto);
    if (Object.keys(errores).length) {
      const primero = form.querySelector('.field-error');
      primero?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      anim.sacudir(primero?.parentElement);
      toast('error', 'Revisa el formulario', Object.values(errores)[0]);
      return;
    }
    enviando = true;
    enviar.disabled = true;
    enviar.lastChild.textContent = 'Enviando…';
    try {
      const dano = await api.reportarDano(datos);
      toast('exito', 'Daño reportado', prioridad === 'grave' ? 'Coordinación fue notificada.' : `${activo.nombre} quedó marcado como dañado.`);
      mostrarExito(dano);
    } catch (err) {
      toast('error', 'No se pudo enviar el reporte', err.message);
    } finally {
      enviando = false;
      enviar.disabled = false;
      enviar.lastChild.textContent = 'Enviar reporte';
    }
  }

  function mostrarExito(dano) {
    const tarjeta = h('div', { class: 'resultado resultado--aceptado' },
      h('svg', { class: 'resultado-icono', viewBox: '0 0 52 52', 'aria-hidden': 'true' }, h('circle', { __svg: true, cx: 26, cy: 26, r: 23 }), h('path', { __svg: true, d: 'M15 27l7 7 15-16' })),
      h('div', { class: 'resultado-texto' },
        h('strong', {}, `Reporte ${dano.id} enviado`),
        h('span', {}, `${activo.nombre} · prioridad ${dano.prioridad}${dano.foto ? ' · con foto' : ''}`),
        h('div', { class: 'form-actions' },
          h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: reiniciar }, 'Reportar otro'),
          h('a', { class: 'btn btn-outline btn-sm', href: `#/inventario?ambiente=${activo.ambienteId}` }, 'Ir al inventario'))));
    form.closest('.card').hidden = true;
    vaciar(exito, tarjeta);
    anim.resultado(tarjeta);
  }

  function reiniciar() {
    activo = null; prioridad = ''; foto = null;
    form.reset();
    tarjetaActivo.hidden = true;
    captura.limpiar();
    cambiarPrioridad('');
    contador.textContent = '0/500';
    vaciar(exito);
    form.closest('.card').hidden = false;
    anim.entrarVista(raiz);
  }

  await cargarActivos();
  const preseleccion = params.get('activo');
  if (preseleccion) {
    try { vincular(await api.activo(preseleccion)); } catch (e) { toast('error', 'No se encontró el activo', e.message); }
  }
}
