// Piezas compartidas por Fichas e Instructores (administrativo):
//  · formularioPersona: tipo y número de documento, nombre, correo y teléfono;
//  · enviarCredenciales: modal con el editor del correo (contraseña temporal,
//    asunto, cuerpo y vista previa) antes de enviar o reenviar;
//  · abrirPlantillas: editar las plantillas guardadas de aprendices e instructores;
//  · abrirCorreos: los correos enviados, con la vista HTML tal como llegan.
import { h, icono, vaciar, errorCampo } from './dom.js';
import { toast, abrirModal } from './avisos.js';
import { cargando, tarjetaError } from './componentes.js';
import { vacio, fecha } from './ambientes-ui.js';
import { crearEditorCorreo, olvidarPlantillas } from './editor-correo.js';
import { apiAmb } from '../api/ambientes.js';

const TIPOS = [['CC', 'Cédula de ciudadanía'], ['TI', 'Tarjeta de identidad'], ['CE', 'Cédula de extranjería'], ['PPT', 'Permiso por protección temporal']];

/** @returns {{el:HTMLElement, leer:()=>object|null, valores:()=>object}} */
export function formularioPersona({ prefijo = 'per', p = {}, documentoFijo = false, alCambiar = () => {} } = {}) {
  const id = (s) => `${prefijo}-${s}`;
  const c = (clave, etiqueta, input) => h('div', { class: 'campo' }, h('label', { for: id(clave) }, etiqueta), input);
  const tipo = h('select', { id: id('tipo'), disabled: documentoFijo }, TIPOS.map(([v, t]) => h('option', { value: v, selected: v === (p.tipoDocumento || 'CC') }, `${v} · ${t}`)));
  const documento = h('input', { type: 'text', id: id('doc'), inputmode: 'numeric', maxlength: 12, value: p.documento || '', class: 'mono', disabled: documentoFijo });
  const nombre = h('input', { type: 'text', id: id('nombre'), maxlength: 120, value: p.nombre || '', autocomplete: 'off' });
  const email = h('input', { type: 'email', id: id('email'), maxlength: 160, value: p.email || '', autocomplete: 'off' });
  const telefono = h('input', { type: 'tel', id: id('tel'), maxlength: 20, value: p.telefono || '', inputmode: 'tel' });
  documento.addEventListener('input', () => { documento.value = documento.value.replace(/\D/g, ''); });
  [tipo, documento, nombre, email, telefono].forEach((x) => x.addEventListener('input', () => { errorCampo(x, null); alCambiar(); }));
  const el = h('div', { class: 'form-grid full' },
    c('tipo', 'Tipo de documento', tipo), c('doc', 'Número de documento', documento),
    h('div', { class: 'full' }, c('nombre', 'Nombre completo', nombre)),
    c('email', 'Correo (aquí llegan las credenciales)', email), c('tel', 'Teléfono (opcional)', telefono));
  const valores = () => ({ tipoDocumento: tipo.value, documento: documento.value.trim(), nombre: nombre.value.trim().replace(/\s+/g, ' '),
    email: email.value.trim().toLowerCase(), telefono: telefono.value.trim() || undefined });
  function leer() {
    const v = valores();
    const errores = [
      [documento, /^\d{6,12}$/.test(v.documento) ? null : 'Entre 6 y 12 dígitos.'],
      [nombre, v.nombre.length >= 5 ? null : 'Escribe el nombre completo.'],
      [email, /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email) ? null : 'Escribe un correo válido.'],
      [telefono, !v.telefono || /^[0-9 +()-]{7,20}$/.test(v.telefono) ? null : 'Teléfono no válido.'],
    ];
    errores.forEach(([x, e]) => errorCampo(x, e));
    return errores.some(([, e]) => e) ? null : v;
  }
  return { el, leer, valores, campos: { documento, email } };
}

/**
 * Modal para (re)enviar credenciales a una persona ya registrada: contraseña
 * temporal nueva y correo editable. enviar(datos) llama a la API.
 */
export function enviarCredenciales({ titulo, persona, plantilla, fichaId, enviar, alTerminar }) {
  const editor = crearEditorCorreo({ plantilla, fichaId, prefijo: 'reenv', persona: () => persona });
  const boton = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => ir() }, icono('campana'), 'Enviar credenciales');
  const { cerrar } = abrirModal({
    titulo, subtitulo: `${persona.nombre} · ${persona.email}. Se genera una contraseña temporal nueva; en su próximo ingreso deberá cambiarla.`, ancho: 'ancho',
    contenido: h('div', { class: 'form-grid' }, editor.el),
    acciones: [({ cerrar: x }) => h('button', { class: 'btn btn-outline', type: 'button', onclick: () => x() }, 'Cancelar'), boton],
  });
  async function ir() {
    const datos = editor.datos();
    if (!datos) return;
    boton.disabled = true;
    try {
      const r = await enviar(datos);
      editor.despuesDeEnviar();
      toast('exito', 'Credenciales enviadas', persona.email);
      cerrar();
      alTerminar?.(r);
    } catch (e) { toast('error', 'No se enviaron', e.message); boton.disabled = false; }
  }
}

/** Editar las plantillas guardadas del correo de credenciales. */
export function abrirPlantillas(inicial = 'credenciales_aprendiz') {
  let actual = inicial, editor = null;
  const pestanas = h('div', { class: 'segmentos', role: 'tablist', 'aria-label': 'Plantilla' });
  const zona = h('div', { class: 'form-grid' });
  const guardar = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => ir() }, icono('check'), 'Guardar plantilla');
  function pintar() {
    vaciar(pestanas, [['credenciales_aprendiz', 'Aprendices'], ['credenciales_instructor', 'Instructores']].map(([clave, texto]) => h('button', {
      class: 'segmento', type: 'button', role: 'tab', 'aria-selected': String(actual === clave), onclick: () => { actual = clave; pintar(); },
    }, texto)));
    editor = crearEditorCorreo({ plantilla: actual, prefijo: `pl-${actual}`, soloPlantilla: true });
    vaciar(zona, editor.el);
  }
  pintar();
  abrirModal({
    titulo: 'Plantillas del correo de credenciales', subtitulo: 'Lo que reciben los aprendices al importarlos o agregarlos a una ficha y los instructores al registrarlos. En cada envío también se puede cambiar.',
    ancho: 'ancho', contenido: h('div', {}, pestanas, zona),
    acciones: [({ cerrar }) => h('button', { class: 'btn btn-outline', type: 'button', onclick: () => cerrar() }, 'Cerrar'), guardar],
  });
  async function ir() {
    const datos = editor.datos();
    if (!datos) return;
    guardar.disabled = true;
    try {
      await apiAmb.guardarPlantillaCorreo(actual, datos);
      olvidarPlantillas();
      toast('exito', 'Plantilla guardada', actual === 'credenciales_aprendiz' ? 'Correo de aprendices' : 'Correo de instructores');
    } catch (e) { toast('error', 'No se guardó', e.message); } finally { guardar.disabled = false; }
  }
}

/** Correos enviados (bandeja de salida de la prueba de concepto), con la versión HTML. */
export async function abrirCorreos() {
  const cuerpo = h('div', {}, cargando());
  abrirModal({ titulo: 'Correos enviados', subtitulo: 'Credenciales y códigos de verificación. En la prueba de concepto quedan registrados aquí (api/config.php → CORREO_MODO).', ancho: 'ancho', contenido: cuerpo });
  let lista;
  try { lista = await apiAmb.correos(); } catch (e) { vaciar(cuerpo, tarjetaError(e)); return; }
  vaciar(cuerpo, lista.length ? h('ul', { class: 'correos-lista' }, lista.map((c) => {
    const detalle = h('details', {},
      h('summary', {}, h('strong', {}, c.asunto), h('span', { class: 'text-muted' }, ` · ${c.para} · ${fecha.completa(c.fecha)}`),
        h('span', { class: `status-chip ${c.estado === 'error' ? 'error' : c.estado === 'enviado' ? 'in' : 'neutro'}` }, c.estado === 'registrado' ? 'Registrado' : c.estado === 'enviado' ? 'Enviado' : 'Error')));
    // La vista HTML se arma al abrirlo (puede haber muchos correos).
    detalle.addEventListener('toggle', () => {
      if (!detalle.open || detalle.dataset.listo) return;
      detalle.dataset.listo = '1';
      detalle.append(c.html ? h('iframe', { class: 'editor-correo-marco', title: `Correo: ${c.asunto}`, sandbox: '', srcdoc: c.html }) : h('pre', { class: 'correo-cuerpo' }, c.cuerpo),
        c.error && h('p', { class: 'field-error' }, c.error));
    });
    return h('li', { class: 'correo' }, detalle);
  })) : vacio('Aún no se han enviado correos', '', 'campana'));
}
