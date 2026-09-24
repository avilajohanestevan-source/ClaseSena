// Perfil: datos del usuario (el documento y el rol no se editan) y cambio de contraseña.
import { h, anexar, icono, errorCampo } from '../ui/dom.js';
import { anim } from '../ui/anim.js';
import { toast } from '../ui/avisos.js';
import { cabecera } from '../ui/ambientes-ui.js';
import { iniciales } from '../ui/drawer.js';
import { apiAmb } from '../api/ambientes.js';
import { actualizarUsuario } from '../estado.js';
import { ETIQUETA_ROL } from '../reglas.js';

export async function render(raiz) {
  const u = await apiAmb.yo();
  const campo = (etiqueta, input, ayuda) => h('div', { class: 'campo' }, h('label', { for: input.id }, etiqueta), input, ayuda && h('span', { class: 'field-hint' }, ayuda));

  const nombre = h('input', { type: 'text', id: 'perfil-nombre', value: u.nombre, autocomplete: 'name', maxlength: 120, required: true });
  const email = h('input', { type: 'email', id: 'perfil-email', value: u.email || '', autocomplete: 'email', maxlength: 160 });
  const telefono = h('input', { type: 'tel', id: 'perfil-tel', value: u.telefono || '', autocomplete: 'tel', inputmode: 'tel', maxlength: 20 });
  const guardar = h('button', { class: 'btn btn-primary', type: 'submit' }, icono('check'), 'Guardar cambios');
  const datos = h('form', { class: 'card', 'data-anim': '', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    errorCampo(nombre, nombre.value.trim().length < 3 ? 'Escribe tu nombre completo.' : null);
    if (nombre.value.trim().length < 3) { nombre.focus(); return; }
    guardar.disabled = true;
    try {
      const nuevo = await apiAmb.actualizarPerfil({ nombre: nombre.value.trim(), email: email.value.trim(), telefono: telefono.value.trim() });
      actualizarUsuario(nuevo);
      titulo.textContent = nuevo.nombre;
      toast('exito', 'Perfil actualizado');
    } catch (err) { toast('error', 'No se guardó', err.message); } finally { guardar.disabled = false; }
  } },
    h('h3', { class: 'bloque-titulo' }, 'Datos personales'),
    h('div', { class: 'form-grid' }, h('div', { class: 'full' }, campo('Nombre completo', nombre)), campo('Correo', email), campo('Teléfono', telefono)),
    h('div', { class: 'form-actions' }, guardar));

  const actual = h('input', { type: 'password', id: 'perfil-actual', autocomplete: 'current-password' });
  const nueva = h('input', { type: 'password', id: 'perfil-nueva', autocomplete: 'new-password' });
  const repetir = h('input', { type: 'password', id: 'perfil-repetir', autocomplete: 'new-password' });
  const cambiar = h('button', { class: 'btn btn-outline', type: 'submit' }, 'Cambiar contraseña');
  const clave = h('form', { class: 'card', 'data-anim': '', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    const valida = nueva.value.length >= 8 && /[A-Za-z]/.test(nueva.value) && /\d/.test(nueva.value);
    errorCampo(actual, actual.value ? null : 'Escribe tu contraseña actual.');
    errorCampo(nueva, valida ? null : 'Mínimo 8 caracteres, con letras y números.');
    errorCampo(repetir, repetir.value === nueva.value ? null : 'Las contraseñas no coinciden.');
    if (!actual.value || !valida || repetir.value !== nueva.value) { anim.sacudir(clave); return; }
    cambiar.disabled = true;
    try {
      await apiAmb.cambiarPassword(actual.value, nueva.value);
      clave.reset();
      toast('exito', 'Contraseña cambiada', 'Se cerraron tus otras sesiones abiertas.');
    } catch (err) { errorCampo(actual, err.message); } finally { cambiar.disabled = false; }
  } },
    h('h3', { class: 'bloque-titulo' }, 'Contraseña'),
    h('div', { class: 'form-grid' }, h('div', { class: 'full' }, campo('Contraseña actual', actual)), campo('Nueva contraseña', nueva, 'Mínimo 8 caracteres, con letras y números.'), campo('Repite la nueva', repetir)),
    h('div', { class: 'form-actions' }, cambiar));

  const titulo = h('strong', {}, u.nombre);
  anexar(raiz,
    cabecera({ eyebrow: 'Cuenta', titulo: 'Mi perfil' }),
    h('section', { class: 'card perfil-tarjeta', 'data-anim': '' },
      h('span', { class: 'avatar-iniciales avatar-iniciales--grande', 'aria-hidden': 'true' }, iniciales(u.nombre)),
      h('div', {}, titulo,
        h('span', { class: 'text-muted' }, `${u.tipoDocumento} ${u.identificacion}${u.ficha ? ` · Ficha ${u.ficha}` : ''}`),
        h('span', { class: 'status-chip azul' }, ETIQUETA_ROL[u.rol]))),
    datos, clave);
  anim.entrarVista(raiz);
}
