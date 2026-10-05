// Correo de credenciales antes de enviarlo (aprendices de una ficha e
// instructores): el administrativo elige la contraseña temporal (generada o
// escrita), cambia el asunto y el cuerpo (con campos como {nombre} o {clave})
// y ve la vista previa tal como llega, con el botón "Ingresar a Ambientes
// SENA" que abre la página de ingreso con el documento y el rol puestos.
// Puede dejar el texto como plantilla para los próximos envíos.
import { h, icono, vaciar, errorCampo } from './dom.js';
import { apiAmb } from '../api/ambientes.js';
import { passwordValida } from '../reglas.js';

const AYUDA_CAMPO = {
  nombre: 'Primer nombre', nombre_completo: 'Nombre completo', tipo_documento: 'CC, TI…', documento: 'Número de documento',
  rol: 'Aprendiz o Instructor', ficha: 'Número de la ficha', programa: 'Programa de la ficha', clave: 'Contraseña temporal', enlace: 'Enlace directo al ingreso',
};

let cache = null;
async function plantillas() {
  cache ||= apiAmb.plantillasCorreo().catch((e) => { cache = null; throw e; });
  return cache;
}
/** Después de guardar una plantilla, la próxima vez se vuelve a pedir. */
export function olvidarPlantillas() { cache = null; }

/** "Sena-4821-kq": misma forma que las que genera el servidor. */
export function claveSugerida() {
  const letras = 'abcdefghjkmnpqrstuvwxyz';
  const l = () => letras[Math.floor(Math.random() * letras.length)];
  return `Sena-${1000 + Math.floor(Math.random() * 9000)}-${l()}${l()}`;
}

/**
 * @param {{plantilla:'credenciales_aprendiz'|'credenciales_instructor', fichaId?:number,
 *   persona?:()=>({nombre?:string, documento?:string, tipoDocumento?:string}), variasPersonas?:boolean, prefijo?:string, soloPlantilla?:boolean}} o
 * @returns {{el:HTMLElement, datos:()=>object|null}} datos() valida y devuelve {clave?, correo?, guardarPlantilla?}
 *   (con soloPlantilla: {asunto, cuerpo}); null si hay errores
 */
export function crearEditorCorreo({ plantilla, fichaId, persona = () => ({}), variasPersonas = false, prefijo = 'ec', soloPlantilla = false }) {
  const id = (s) => `${prefijo}-${s}`;
  let base = null;   // plantilla guardada (para saber si el texto cambió)
  let espera = null;

  /* --- contraseña temporal --- */
  const modoClave = (valor, texto) => h('label', { class: 'opcion-chip' },
    h('input', { type: 'radio', name: id('modo-clave'), value: valor, checked: valor === 'auto', onchange: () => pintarClave() }), h('span', {}, texto));
  const modos = h('div', { class: 'opciones-chip', role: 'radiogroup', 'aria-labelledby': id('clave-t') },
    modoClave('auto', variasPersonas ? 'Generar una para cada persona' : 'Generarla automáticamente'),
    modoClave('escrita', variasPersonas ? 'La misma para todos' : 'Escribirla yo'));
  const clave = h('input', { type: 'text', id: id('clave'), class: 'mono', maxlength: 64, autocomplete: 'off', spellcheck: false, value: claveSugerida() });
  clave.addEventListener('input', () => { errorCampo(clave, null); previaLuego(); });
  const otra = h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => { clave.value = claveSugerida(); errorCampo(clave, null); previaLuego(); } }, icono('reintentar'), 'Otra');
  const zonaClave = h('div', { class: 'editor-correo-clave', hidden: true }, clave, otra);
  const escrita = () => modos.querySelector('input:checked')?.value === 'escrita';
  function pintarClave() { zonaClave.hidden = !escrita(); if (escrita()) clave.focus(); previaLuego(); }

  /* --- asunto y cuerpo --- */
  const asunto = h('input', { type: 'text', id: id('asunto'), maxlength: 200 });
  const cuerpo = h('textarea', { id: id('cuerpo'), rows: 11, maxlength: 4000, class: 'editor-correo-cuerpo' });
  [asunto, cuerpo].forEach((c) => c.addEventListener('input', () => { errorCampo(c, null); previaLuego(); }));
  const campos = h('div', { class: 'editor-correo-campos', 'aria-label': 'Insertar un campo en el cuerpo' });
  const guardar = h('input', { type: 'checkbox', id: id('guardar') });
  const restablecer = h('button', { class: 'boton-enlace', type: 'button', onclick: () => { if (!base) return; asunto.value = base.porDefecto.asunto; cuerpo.value = base.porDefecto.cuerpo; previaLuego(); } }, 'Volver al texto de fábrica');

  /* --- vista previa --- */
  const marco = h('iframe', { class: 'editor-correo-marco', title: 'Vista previa del correo', sandbox: '' });
  const asuntoPrevio = h('strong', { class: 'editor-correo-asunto' });
  const estadoPrevia = h('span', { class: 'field-hint', 'aria-live': 'polite' });
  const previa = h('details', { class: 'editor-correo-previa', open: true },
    h('summary', {}, icono('ojo'), 'Vista previa del correo'), h('p', {}, 'Asunto: ', asuntoPrevio), marco, estadoPrevia);

  const el = h('fieldset', { class: 'full editor-correo' },
    !soloPlantilla && h('legend', {}, icono('campana'), ' Correo de credenciales'),
    !soloPlantilla && h('div', { class: 'campo' }, h('label', { id: id('clave-t') }, 'Contraseña temporal'), modos, zonaClave,
      h('span', { class: 'field-hint' }, 'Mínimo 8 caracteres, con letras y números. La persona la cambia en su primer ingreso.')),
    h('div', { class: 'campo' }, h('label', { for: id('asunto') }, 'Asunto'), asunto),
    h('div', { class: 'campo' }, h('label', { for: id('cuerpo') }, 'Cuerpo del correo'), campos, cuerpo,
      h('span', { class: 'field-hint' }, 'Debe incluir {clave}. Al final del correo siempre va el botón "Ingresar a Ambientes SENA" con el enlace directo. ', restablecer)),
    !soloPlantilla && h('label', { class: 'interruptor' }, guardar, h('span', { class: 'interruptor-pista', 'aria-hidden': 'true' }), 'Guardar este texto como plantilla para los próximos envíos'),
    previa);

  plantillas().then(({ plantillas: lista, campos: nombres }) => {
    base = lista.find((p) => p.clave === plantilla);
    asunto.value = base.asunto;
    cuerpo.value = base.cuerpo;
    vaciar(campos, nombres.map((c) => h('button', { class: 'chip-campo', type: 'button', title: AYUDA_CAMPO[c] || c, onclick: () => insertar(`{${c}}`) }, `{${c}}`)));
    previaLuego(0);
  }).catch((e) => { estadoPrevia.textContent = `No se cargó la plantilla: ${e.message}`; });

  function insertar(texto) {
    const { selectionStart: i = cuerpo.value.length, selectionEnd: j = i } = cuerpo;
    cuerpo.setRangeText(texto, i, j, 'end');
    cuerpo.focus();
    previaLuego();
  }

  function previaLuego(ms = 450) {
    clearTimeout(espera);
    espera = setTimeout(pintarPrevia, ms);
  }
  async function pintarPrevia() {
    if (!base) return;
    const p = persona();
    try {
      const r = await apiAmb.vistaPreviaCorreo(plantilla, { asunto: asunto.value, cuerpo: cuerpo.value, clave: escrita() ? clave.value : '',
        nombre: p.nombre, documento: p.documento, tipoDocumento: p.tipoDocumento, fichaId });
      asuntoPrevio.textContent = r.asunto;
      marco.srcdoc = r.html;
      estadoPrevia.textContent = escrita() || !variasPersonas ? '' : 'La contraseña de la vista previa es un ejemplo: cada persona recibe la suya.';
    } catch (e) { estadoPrevia.textContent = e.message; }
  }
  /** Datos del envío para la API, o null si algo no es válido. */
  function datos() {
    let ok = true;
    if (escrita() && !passwordValida(clave.value)) { errorCampo(clave, 'Mínimo 8 caracteres, con letras y números.'); ok = false; }
    if (asunto.value.trim().length < 3) { errorCampo(asunto, 'Escribe el asunto.'); ok = false; }
    if (!cuerpo.value.includes('{clave}')) { errorCampo(cuerpo, 'El cuerpo debe incluir {clave} (la contraseña temporal).'); ok = false; }
    if (!ok) return null;
    if (soloPlantilla) return { asunto: asunto.value.trim(), cuerpo: cuerpo.value };
    const cambio = !base || asunto.value !== base.asunto || cuerpo.value !== base.cuerpo;
    return {
      clave: escrita() ? clave.value : undefined,
      correo: cambio || guardar.checked ? { asunto: asunto.value.trim(), cuerpo: cuerpo.value } : undefined,
      guardarPlantilla: guardar.checked || undefined,
    };
  }

  return { el, datos, refrescar: () => previaLuego(), despuesDeEnviar: () => { if (guardar.checked) olvidarPlantillas(); } };
}
