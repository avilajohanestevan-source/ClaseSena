// Primer ingreso obligatorio (aprendices importados con su ficha): antes de
// usar la app hay que
//  1. confirmar el correo: se envía un código de 6 dígitos (se puede corregir
//     el correo antes de pedirlo);
//  2. cambiar la contraseña temporal que llegó con las credenciales.
// main.js trae aquí a cualquier usuario con debeCambiarPassword y no deja
// salir hasta terminar (el backend responde 403 PRIMER_INGRESO a lo demás).
import { h, anexar, icono, errorCampo } from '../ui/dom.js';
import { anim } from '../ui/anim.js';
import { toast } from '../ui/avisos.js';
import { cabecera } from '../ui/ambientes-ui.js';
import { apiAmb } from '../api/ambientes.js';
import { estado, actualizarUsuario, cerrarSesion } from '../estado.js';
import { passwordValida } from '../reglas.js';

export async function render(raiz) {
  const u = await apiAmb.yo();
  if (!u.debeCambiarPassword) { actualizarUsuario(u); location.replace('#/inicio'); return; }
  const campo = (id, etiqueta, input, ayuda) => h('div', { class: 'campo' }, h('label', { for: id }, etiqueta), input, ayuda && h('span', { class: 'field-hint' }, ayuda));

  /* --- paso 1: correo y código --- */
  const email = h('input', { type: 'email', id: 'pi-email', value: u.email || '', autocomplete: 'email', maxlength: 160, required: true });
  const enviarBtn = h('button', { class: 'btn btn-outline', type: 'button', onclick: () => pedirCodigo() }, icono('campana'), 'Enviar código');
  const enviado = h('p', { class: 'field-hint', role: 'status', 'aria-live': 'polite' });
  const codigo = h('input', { type: 'text', id: 'pi-codigo', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, pattern: '\\d{6}', class: 'mono pi-codigo', disabled: true, placeholder: '000000' });

  async function pedirCodigo() {
    const valor = email.value.trim();
    errorCampo(email, /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(valor) ? null : 'Escribe un correo válido.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(valor)) return;
    enviarBtn.disabled = true;
    try {
      const r = await apiAmb.codigoPrimerIngreso(valor);
      codigo.disabled = false;
      codigo.focus();
      enviado.replaceChildren(`Enviamos un código a ${r.enviadoA}. Vence en 15 minutos.`,
        r.codigoDemo ? h('span', { class: 'pi-demo' }, ` Modo demostración: el código es `, h('strong', { class: 'mono' }, r.codigoDemo), '.') : '');
      enviarBtn.lastChild.textContent = 'Reenviar código';
      toast('exito', 'Código enviado', `Revisa ${r.enviadoA}.`);
    } catch (e) { errorCampo(email, e.message); } finally { enviarBtn.disabled = false; }
  }

  /* --- paso 2: contraseña nueva --- */
  const nueva = h('input', { type: 'password', id: 'pi-nueva', autocomplete: 'new-password' });
  const repetir = h('input', { type: 'password', id: 'pi-repetir', autocomplete: 'new-password' });
  const guardar = h('button', { class: 'btn btn-primary btn-lg', type: 'submit' }, icono('check'), 'Confirmar y entrar');

  const form = h('form', { class: 'card pi-form', 'data-anim': '', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    const okCodigo = /^\d{6}$/.test(codigo.value.trim());
    const okClave = passwordValida(nueva.value);
    errorCampo(codigo, codigo.disabled ? 'Primero pide el código.' : okCodigo ? null : 'Escribe los 6 dígitos del código.');
    errorCampo(nueva, okClave ? null : 'Mínimo 8 caracteres, con letras y números.');
    errorCampo(repetir, repetir.value === nueva.value ? null : 'Las contraseñas no coinciden.');
    if (codigo.disabled || !okCodigo || !okClave || repetir.value !== nueva.value) { anim.sacudir(form); return; }
    guardar.disabled = true;
    try {
      const nuevo = await apiAmb.primerIngreso(codigo.value.trim(), nueva.value);
      actualizarUsuario(nuevo);
      toast('exito', 'Listo, ya puedes usar la app', 'Correo confirmado y contraseña actualizada.');
      location.replace('#/inicio');
    } catch (err) {
      if (['CODIGO', 'CODIGO_VENCIDO'].includes(err.codigo)) errorCampo(codigo, err.message); else errorCampo(nueva, err.message);
    } finally { guardar.disabled = false; }
  } },
    h('ol', { class: 'pi-pasos' },
      h('li', {},
        h('h3', { class: 'bloque-titulo' }, '1. Confirma tu correo'),
        h('p', { class: 'text-muted' }, 'Te enviaremos un código para comprobar que el correo es tuyo. Si está mal escrito, corrígelo antes de pedirlo.'),
        h('div', { class: 'form-grid' },
          h('div', { class: 'full pi-correo' }, campo('pi-email', 'Correo', email), enviarBtn),
          h('div', { class: 'full' }, enviado),
          campo('pi-codigo', 'Código de 6 dígitos', codigo))),
      h('li', {},
        h('h3', { class: 'bloque-titulo' }, '2. Cambia tu contraseña temporal'),
        h('div', { class: 'form-grid' },
          campo('pi-nueva', 'Nueva contraseña', nueva, 'Mínimo 8 caracteres, con letras y números.'),
          campo('pi-repetir', 'Repite la nueva', repetir)))),
    h('div', { class: 'form-actions' },
      h('button', { class: 'btn btn-outline', type: 'button', onclick: () => cerrarSesion() }, 'Salir'), guardar));

  anexar(raiz,
    cabecera({ eyebrow: 'Primer ingreso', titulo: `Bienvenido, ${(estado.usuario?.nombre || u.nombre).split(' ')[0]}`,
      subtitulo: 'Antes de empezar confirma tu correo y cambia la contraseña temporal que te llegó con tus credenciales.' }),
    form);
  anim.entrarVista(raiz);
}
