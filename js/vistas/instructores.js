// Instructores (administrativo): registrar, editar, activar o desactivar y
// enviar credenciales. Al registrar uno se le envía un correo (plantilla de
// instructores, editable antes de enviar) con su documento, una contraseña
// temporal (generada o escrita) y el botón "Ingresar a Ambientes SENA"; en
// su primer ingreso confirma el correo y cambia la contraseña.
import { h, anexar, icono, vaciar, errorCampo } from '../ui/dom.js';
import { anim } from '../ui/anim.js';
import { toast, abrirModal } from '../ui/avisos.js';
import { cargando, tarjetaError } from '../ui/componentes.js';
import { cabecera, vacio, fecha } from '../ui/ambientes-ui.js';
import { crearEditorCorreo } from '../ui/editor-correo.js';
import { formularioPersona, enviarCredenciales, abrirPlantillas, abrirCorreos } from '../ui/credenciales.js';
import { apiAmb } from '../api/ambientes.js';

export async function render(raiz) {
  const lista = h('div', { class: 'card' }, cargando());
  let instructores = [], busqueda = '';
  const buscar = h('input', { type: 'search', placeholder: 'Buscar por nombre, documento o correo', 'aria-label': 'Buscar instructor',
    oninput: () => { busqueda = buscar.value.trim().toLowerCase(); pintar(); } });

  anexar(raiz,
    cabecera({
      eyebrow: 'Personal', titulo: 'Instructores',
      subtitulo: 'Registra a los instructores: cada uno recibe por correo su usuario, una contraseña temporal y el botón para ingresar. En su primer ingreso confirma el correo y la cambia.',
      acciones: [
        h('button', { class: 'btn btn-outline', type: 'button', onclick: () => abrirPlantillas('credenciales_instructor') }, icono('lapiz'), 'Plantilla del correo'),
        h('button', { class: 'btn btn-outline', type: 'button', onclick: () => abrirCorreos() }, icono('campana'), 'Correos enviados'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => formulario() }, icono('mas'), 'Nuevo instructor')],
    }),
    h('div', { class: 'adm-buscar', 'data-anim': '' }, icono('buscar'), buscar),
    lista);

  async function cargar() {
    vaciar(lista, cargando());
    try { instructores = await apiAmb.instructores(); } catch (e) { vaciar(lista, tarjetaError(e, cargar)); return; }
    pintar();
  }

  function pintar() {
    const visibles = instructores.filter((i) => !busqueda || [i.nombre, i.documento, i.email].some((v) => (v || '').toLowerCase().includes(busqueda)));
    vaciar(lista, visibles.length ? h('ul', { class: 'inv-lista' }, visibles.map((i) => h('li', { class: `inv-fila instructor-fila${i.activo ? '' : ' amb-tarjeta--inactivo'}` },
      h('span', { class: 'avatar-iniciales', 'aria-hidden': 'true' }, i.nombre.split(' ').slice(0, 2).map((p) => p[0]).join('')),
      h('div', { class: 'inv-fila-datos' },
        h('strong', {}, i.nombre),
        h('span', { class: 'text-muted' }, `${i.tipoDocumento} ${i.documento} · ${i.email || 'sin correo'}`),
        h('span', { class: 'text-muted' }, [i.fichas.length ? `Líder de ${i.fichas.join(', ')}` : null, i.asignacionesVigentes ? `${i.asignacionesVigentes} asignación(es) vigente(s)` : null].filter(Boolean).join(' · ') || 'Sin fichas ni asignaciones')),
      h('div', { class: 'reporte-chips' },
        !i.activo ? h('span', { class: 'status-chip neutro' }, 'Inactivo')
          : i.primerIngresoPendiente ? h('span', { class: 'status-chip out', title: i.credencialesEnviadasEn ? `Credenciales enviadas ${fecha.completa(i.credencialesEnviadasEn)}` : '' }, 'Primer ingreso pendiente')
            : h('span', { class: 'status-chip in' }, 'Activo')),
      h('div', { class: 'inv-fila-acciones' },
        i.activo && h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => reenviar(i) }, icono('campana'), 'Enviar credenciales'),
        h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => formulario(i) }, icono('lapiz'), 'Editar')))))
      : vacio(busqueda ? 'Ningún instructor coincide' : 'No hay instructores', busqueda ? '' : 'Registra el primero con "Nuevo instructor".', 'usuarios'));
    anim.lista(lista.querySelectorAll('.inv-fila'), { autoAlpha: 0, y: 6 });
  }

  /* --- nuevo (con su correo) o editar --- */
  function formulario(i = null) {
    const persona = formularioPersona({ prefijo: 'ins', p: i || {}, alCambiar: () => editor?.refrescar() });
    const editor = i ? null : crearEditorCorreo({ plantilla: 'credenciales_instructor', prefijo: 'ins-correo', persona: () => persona.valores() });
    const activo = i && h('input', { type: 'checkbox', role: 'switch', checked: i.activo });
    const boton = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => ir() }, icono('check'), i ? 'Guardar' : 'Registrar y enviar credenciales');
    const { cerrar } = abrirModal({
      titulo: i ? `Editar a ${i.nombre}` : 'Nuevo instructor', ancho: i ? 'normal' : 'ancho',
      subtitulo: i ? 'Si cambias el correo, deberá confirmarlo de nuevo.' : 'Revisa el correo antes de enviarlo: puedes cambiar el texto y la contraseña temporal.',
      contenido: h('div', { class: 'form-grid' }, persona.el,
        i && h('label', { class: 'interruptor full' }, activo, h('span', { class: 'interruptor-pista', 'aria-hidden': 'true' }), 'Activo (puede ingresar y ser asignado)'),
        editor?.el),
      acciones: [({ cerrar: x }) => h('button', { class: 'btn btn-outline', type: 'button', onclick: () => x() }, 'Cancelar'), boton],
    });
    async function ir() {
      const p = persona.leer();
      const op = editor ? editor.datos() : {};
      if (!p || !op) return;
      boton.disabled = true;
      try {
        if (i) await apiAmb.editarInstructor(i.id, { ...p, activo: activo.checked });
        else await apiAmb.crearInstructor({ ...p, ...op });
        editor?.despuesDeEnviar();
        toast('exito', i ? 'Instructor actualizado' : 'Instructor registrado', i ? p.nombre : `Se enviaron las credenciales a ${p.email}.`);
        cerrar();
        cargar();
      } catch (e) {
        if (e.codigo === 'DUPLICADO') errorCampo(e.message.includes('correo') ? persona.campos.email : persona.campos.documento, e.message);
        else toast('error', 'No se guardó', e.message);
        boton.disabled = false;
      }
    }
  }

  function reenviar(i) {
    enviarCredenciales({
      titulo: 'Enviar credenciales', persona: i, plantilla: 'credenciales_instructor',
      enviar: (datos) => apiAmb.credencialesInstructor(i.id, datos), alTerminar: () => cargar(),
    });
  }

  await cargar();
  anim.entrarVista(raiz);
}
