// Perfil: solo nombre y rol (lo demás lo gestiona coordinación) y cambio de contraseña.
// Se entra únicamente desde la tarjeta con nombre y rol de la cabecera del menú.
import { h, anexar, errorCampo } from '../ui/dom.js';
import { anim } from '../ui/anim.js';
import { toast } from '../ui/avisos.js';
import { cabecera } from '../ui/ambientes-ui.js';
import { iniciales } from '../ui/drawer.js';
import { apiAmb } from '../api/ambientes.js';
import { ETIQUETA_ROL, passwordValida } from '../reglas.js';

export async function render(raiz) {
  const u = await apiAmb.yo();
  const campo = (etiqueta, input, ayuda) => h('div', { class: 'campo' }, h('label', { for: input.id }, etiqueta), input, ayuda && h('span', { class: 'field-hint' }, ayuda));

  const actual = h('input', { type: 'password', id: 'perfil-actual', autocomplete: 'current-password' });
  const nueva = h('input', { type: 'password', id: 'perfil-nueva', autocomplete: 'new-password' });
  const repetir = h('input', { type: 'password', id: 'perfil-repetir', autocomplete: 'new-password' });
  const cambiar = h('button', { class: 'btn btn-outline', type: 'submit' }, 'Cambiar contraseña');
  const clave = h('form', { class: 'card', 'data-anim': '', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    const valida = passwordValida(nueva.value);
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

  anexar(raiz,
    cabecera({ eyebrow: 'Cuenta', titulo: 'Mi perfil' }),
    h('section', { class: 'card perfil-tarjeta', 'data-anim': '', 'aria-label': 'Nombre y rol' },
      h('span', { class: 'avatar-iniciales avatar-iniciales--grande', 'aria-hidden': 'true' }, iniciales(u.nombre)),
      h('dl', { class: 'perfil-datos' },
        h('div', {}, h('dt', {}, 'Nombre'), h('dd', {}, h('strong', {}, u.nombre))),
        h('div', {}, h('dt', {}, 'Rol'), h('dd', {}, h('span', { class: 'status-chip azul' }, ETIQUETA_ROL[u.rol]))))),
    clave);
  anim.entrarVista(raiz);
}
