// Ventana para administrar un catálogo simple (especialidades de ambiente o
// categorías del inventario): lista con cuántos registros lo usan, agregar,
// renombrar, activar/desactivar y borrar (solo si no está en uso).
import { h, icono, vaciar, errorCampo } from './dom.js';
import { toast, abrirModal, confirmar } from './avisos.js';
import { cargando } from './componentes.js';

/**
 * @param {{titulo:string, subtitulo:string, singular:string, usados:string,
 *   listar:()=>Promise<any[]>, crear:(d)=>Promise<any>, editar:(id, d)=>Promise<any>, borrar:(id)=>Promise<any>,
 *   alCambiar?:()=>void}} o
 */
export function gestionarCatalogo(o) {
  let cambios = false;
  const lista = h('ul', { class: 'catalogo-lista' }, h('li', {}, cargando()));
  const nombre = h('input', { type: 'text', id: 'cat-nombre', maxlength: 60, placeholder: `Nueva ${o.singular}`, autocomplete: 'off' });
  const descripcion = h('input', { type: 'text', id: 'cat-desc', maxlength: 200, placeholder: 'Descripción (opcional)', autocomplete: 'off' });
  const agregar = h('button', { class: 'btn btn-primary btn-sm', type: 'submit' }, icono('mas'), 'Agregar');
  const form = h('form', { class: 'catalogo-nuevo', novalidate: true, onsubmit: (e) => { e.preventDefault(); crear(); } },
    h('label', { class: 'sr-only', for: 'cat-nombre' }, `Nombre de la ${o.singular}`), nombre,
    h('label', { class: 'sr-only', for: 'cat-desc' }, 'Descripción'), descripcion, agregar);

  async function cargar() {
    let filas;
    try { filas = await o.listar(); } catch (e) { vaciar(lista, h('li', { class: 'text-muted' }, e.message)); return; }
    vaciar(lista, filas.map((c) => {
      const li = h('li', { class: `catalogo-fila${c.activo ? '' : ' catalogo-fila--inactiva'}` },
        h('div', { class: 'catalogo-datos' },
          h('strong', {}, c.nombre),
          h('span', { class: 'text-muted' }, [c.descripcion, `${c.enUso} ${o.usados}`, !c.activo && 'desactivada'].filter(Boolean).join(' · '))),
        h('div', { class: 'catalogo-acciones' },
          h('button', { class: 'btn btn-outline btn-sm btn-icono', type: 'button', 'aria-label': `Renombrar ${c.nombre}`, onclick: () => renombrar(c, li) }, icono('lapiz')),
          h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => alternar(c) }, c.activo ? 'Desactivar' : 'Activar'),
          !c.enUso && h('button', { class: 'btn btn-outline btn-sm btn-icono', type: 'button', 'aria-label': `Borrar ${c.nombre}`, onclick: () => borrar(c) }, icono('basura'))));
      return li;
    }));
  }

  async function crear() {
    const n = nombre.value.trim();
    errorCampo(nombre, n.length >= 2 ? null : 'Escribe el nombre (mínimo 2 caracteres).');
    if (n.length < 2) return;
    agregar.disabled = true;
    try {
      await o.crear({ nombre: n, descripcion: descripcion.value.trim() });
      nombre.value = ''; descripcion.value = '';
      cambios = true;
      toast('exito', `${o.singular[0].toUpperCase()}${o.singular.slice(1)} agregada`, n);
      cargar();
    } catch (e) { errorCampo(nombre, e.message); }
    agregar.disabled = false;
  }

  /** Edición en la misma fila: nombre y descripción. */
  function renombrar(c, li) {
    const n = h('input', { type: 'text', value: c.nombre, maxlength: 60, 'aria-label': `Nombre de ${c.nombre}` });
    const d = h('input', { type: 'text', value: c.descripcion || '', maxlength: 200, 'aria-label': 'Descripción', placeholder: 'Descripción (opcional)' });
    async function guardar() {
      const nuevo = n.value.trim();
      errorCampo(n, nuevo.length >= 2 ? null : 'Mínimo 2 caracteres.');
      if (nuevo.length < 2) return;
      try { await o.editar(c.id, { nombre: nuevo, descripcion: d.value.trim(), activo: c.activo }); cambios = true; cargar(); } catch (e) { errorCampo(n, e.message); }
    }
    n.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); guardar(); } });
    li.replaceChildren(h('div', { class: 'catalogo-datos catalogo-datos--editando' }, n, d),
      h('div', { class: 'catalogo-acciones' },
        h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: guardar }, icono('check'), 'Guardar'),
        h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: cargar }, 'Cancelar')));
    n.focus();
  }

  async function alternar(c) {
    try { await o.editar(c.id, { nombre: c.nombre, descripcion: c.descripcion, activo: !c.activo }); cambios = true; cargar(); } catch (e) { toast('error', 'No se guardó', e.message); }
  }

  async function borrar(c) {
    if (!await confirmar({ titulo: `¿Borrar "${c.nombre}"?`, mensaje: 'No está asignada a ningún registro.', textoAceptar: 'Borrar', peligro: true })) return;
    try { await o.borrar(c.id); cambios = true; cargar(); } catch (e) { toast('error', 'No se borró', e.message); }
  }

  abrirModal({
    titulo: o.titulo, subtitulo: o.subtitulo, ancho: 'normal',
    contenido: h('div', { class: 'catalogo' }, form, lista),
    alCerrar: () => { if (cambios) o.alCambiar?.(); },
  });
  cargar();
}
