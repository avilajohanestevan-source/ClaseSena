// Cuenta antes: el inventario con que se entrega el ambiente, en Excel.
//  · En "Editar ambiente": descargarla y subirla corregida (con vista previa).
//    Al crear el ambiente, el archivo elegido se carga apenas se guarda.
//  · Al asignar un instructor: se adjunta la cuenta antes y se carga al
//    asignar; el instructor revisa si es conforme a lo que hay en el ambiente
//    (js/vistas/revision-inventario.js).
import { h, icono, vaciar } from './dom.js';
import { toast } from './avisos.js';
import { cargando } from './componentes.js';
import { apiAmb } from '../api/ambientes.js';

/**
 * @param {{ambiente?:?{id:number, itemsTotal:number}, ambienteId?:() => ?number, prefijo?:string, ayuda?:string, alGuardar?:boolean}} op
 *   alGuardar: el archivo no se carga al elegirlo sino con cargarPendiente
 *   (si ya hay ambiente se muestra la vista previa).
 * @returns {{el:HTMLElement, tieneArchivo:() => boolean, previsualizar:() => void, cargarPendiente:(id:number) => Promise<?object>}}
 */
export function seccionCuentaAntes({ ambiente = null, ambienteId = () => ambiente?.id ?? null, prefijo = 'amb-inv', ayuda, alGuardar = !ambiente } = {}) {
  let archivo = null;
  const entrada = h('input', { type: 'file', id: `${prefijo}-archivo`, accept: '.xlsx,.xls,.ods,.csv', onchange: () => elegir(entrada.files[0]) });
  entrada.hidden = true;
  const resultado = h('div', { class: 'carga-resultado', 'aria-live': 'polite' });
  const cargarBtn = h('button', { class: 'btn btn-primary btn-sm', type: 'button', hidden: true, onclick: () => importar(false) }, icono('subir'), h('span', {}, 'Cargar'));
  const quitar = h('button', { class: 'btn btn-outline btn-sm', type: 'button', hidden: true, onclick: () => limpiar() }, 'Quitar archivo');
  const el = h('fieldset', { class: 'full asig-amb inv-cuentadante' },
    h('legend', {}, icono('caja'), ' Cuenta antes'),
    h('p', { class: 'text-muted asig-amb-ayuda' }, ayuda ?? (ambiente
      ? `${ambiente.itemsTotal} ítems. Descarga la cuenta antes en Excel (con el ambiente, el responsable y el valor), corrígela o complétala y vuelve a subirla. Los ítems nuevos se suman a la revisión pendiente.`
      : 'Opcional: el Excel con la cuenta antes, el inventario que tenía el ambiente (placa, descripción, serial, categoría, valor…). Se carga al crear el ambiente y quien lo recibe revisa si es conforme.')),
    h('div', { class: 'inv-cuentadante-acciones' },
      ambiente && h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: async () => {
        try { toast('exito', 'Excel descargado', await apiAmb.exportarInventarioCuentadante(ambiente.id)); } catch (e) { toast('error', 'No se descargó', e.message); }
      } }, icono('descargar'), 'Descargar Excel'),
      h('label', { class: 'btn btn-outline btn-sm', for: entrada.id }, icono('subir'), alGuardar ? 'Elegir Excel' : 'Subir Excel'), entrada, cargarBtn, quitar),
    resultado);

  function limpiar() {
    archivo = null;
    entrada.value = '';
    cargarBtn.hidden = quitar.hidden = true;
    vaciar(resultado);
  }

  function elegir(f) {
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { vaciar(resultado, h('div', { class: 'banner error' }, 'El archivo supera 5 MB.')); return; }
    const lector = new FileReader();
    lector.onload = () => {
      archivo = { nombre: f.name, archivo: lector.result };
      quitar.hidden = !alGuardar;
      if (!alGuardar || ambienteId()) importar(true);
      else vaciar(resultado, h('p', { class: 'field-hint' }, `${f.name}: se carga al guardar.`));
    };
    lector.readAsDataURL(f);
  }

  async function importar(simular, id = ambienteId()) {
    if (!archivo || !id) return null;
    cargarBtn.disabled = true;
    vaciar(resultado, cargando(simular ? 'Leyendo el archivo…' : 'Cargando la cuenta antes…'));
    let r;
    try { r = await apiAmb.importarInventarioCuentadante(id, { ...archivo, simular }); }
    catch (e) { vaciar(resultado, h('div', { class: 'banner error' }, e.message)); cargarBtn.disabled = false; return null; }
    const validas = r.nuevos + r.actualizados;
    vaciar(resultado,
      h('p', {}, h('strong', {}, simular ? (alGuardar ? 'Vista previa (se carga al guardar): ' : 'Vista previa: ') : 'Cargada: '),
        `${r.nuevos} nuevos, ${r.actualizados} actualizados, ${r.sinCambios} sin cambios`,
        r.familiasNuevas ? `, ${r.familiasNuevas} familias nuevas` : '', r.errores.length ? `, ${r.errores.length} con error` : '', '.'),
      r.errores.length ? h('div', { class: 'banner error carga-errores' }, h('ul', {}, r.errores.slice(0, 20).map((e) => h('li', {}, `Fila ${e.fila}: ${e.mensaje}`)))) : null);
    cargarBtn.hidden = alGuardar || !simular || !validas;
    cargarBtn.disabled = false;
    cargarBtn.lastChild.textContent = `Cargar ${validas} ítem(s)`;
    if (!simular) { archivo = null; entrada.value = ''; cargarBtn.hidden = quitar.hidden = true; }
    return r;
  }

  return {
    el,
    tieneArchivo: () => !!archivo,
    previsualizar: () => { if (archivo && alGuardar) ambienteId() ? importar(true) : vaciar(resultado); },
    cargarPendiente: (id) => importar(false, id),
  };
}
