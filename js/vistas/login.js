// FormLogin: identificación SENA, contraseña y rol, con validación en el
// cliente y mensajes para cada error de la API (401, 403, 423, red).
import { h, icono, errorCampo } from '../ui/dom.js';
import { anim } from '../ui/anim.js';
import { ROLES, validarLogin } from '../reglas.js';
import { api } from '../api/contratos.js';
import { iniciarSesion } from '../estado.js';
import { CONFIG } from '../config.js';
import { USUARIOS_PRUEBA, PASSWORD_PRUEBA } from '../api/mock/datos.js';

export function render(raiz) {
  let rol = 'instructor';
  const identificacion = h('input', { type: 'text', id: 'login-id', inputmode: 'numeric', autocomplete: 'username', placeholder: 'Ej. 1010101010', maxlength: 12 });
  const password = h('input', { type: 'password', id: 'login-pass', autocomplete: 'current-password', placeholder: '••••••••' });
  const verPass = h('button', { class: 'campo-accion', type: 'button', 'aria-label': 'Mostrar contraseña', onclick: () => {
    password.type = password.type === 'password' ? 'text' : 'password';
    verPass.setAttribute('aria-pressed', String(password.type === 'text'));
  } }, icono('ojo'));
  const errorGeneral = h('div', { class: 'banner error', role: 'alert', hidden: true });
  const enviar = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Ingresar');

  const opcionesRol = h('div', { class: 'rol-selector', role: 'radiogroup', 'aria-label': 'Rol' },
    ROLES.map((r) => h('label', { class: 'rol-opcion' },
      h('input', { type: 'radio', name: 'rol', value: r.clave, checked: r.clave === rol, onchange: () => { rol = r.clave; errorCampo(opcionesRol, null); } }),
      h('span', {}, r.etiqueta))));

  const form = h('form', { class: 'login-form', novalidate: true, onsubmit: ingresar },
    h('div', { class: 'campo' }, h('label', { for: 'login-id' }, 'Identificación SENA'), identificacion),
    h('div', { class: 'campo' }, h('label', { for: 'login-pass' }, 'Contraseña'), h('div', { class: 'campo-con-accion' }, password, verPass)),
    h('div', { class: 'campo' }, h('label', {}, 'Ingresar como'), opcionesRol),
    errorGeneral,
    enviar);

  // Soltar el error de un campo apenas se corrige.
  identificacion.addEventListener('input', () => { identificacion.value = identificacion.value.replace(/\D/g, ''); errorCampo(identificacion, null); });
  password.addEventListener('input', () => errorCampo(password.closest('.campo-con-accion'), null));

  async function ingresar(e) {
    e.preventDefault();
    errorGeneral.hidden = true;
    const datos = { identificacion: identificacion.value.trim(), password: password.value, rol };
    const errores = validarLogin(datos);
    errorCampo(identificacion, errores.identificacion);
    errorCampo(password.closest('.campo-con-accion'), errores.password);
    errorCampo(opcionesRol, errores.rol);
    if (Object.keys(errores).length) { anim.sacudir(form); form.querySelector('[aria-invalid]')?.focus?.(); return; }

    enviar.disabled = true;
    enviar.textContent = 'Validando…';
    try {
      iniciarSesion(await api.login(datos));
    } catch (err) {
      errorGeneral.textContent = err.message;
      errorGeneral.hidden = false;
      if (err.codigo === 'CREDENCIALES') { password.value = ''; password.focus(); }
      anim.sacudir(form);
    } finally {
      enviar.disabled = false;
      enviar.textContent = 'Ingresar';
    }
  }

  const demo = CONFIG.usarMock && h('details', { class: 'login-demo' },
    h('summary', {}, 'Usuarios de prueba (modo demostración)'),
    h('p', { class: 'text-muted' }, `Contraseña para todos: `, h('code', {}, PASSWORD_PRUEBA)),
    h('ul', {}, USUARIOS_PRUEBA.map((u) => h('li', {},
      h('button', { class: 'chip-boton', type: 'button', onclick: () => {
        identificacion.value = u.identificacion; password.value = PASSWORD_PRUEBA;
        form.querySelector(`input[value="${u.rol}"]`).click();
      } }, u.identificacion),
      ` ${u.nombre} · ${u.rol}${u.bloqueado ? ' (bloqueada)' : ''}`))));

  raiz.append(h('div', { class: 'login' },
    h('section', { class: 'login-lado', 'data-anim': '' },
      h('img', { class: 'login-logo', src: 'img/sena-logo-blanco.png', alt: 'SENA' }),
      h('h1', {}, 'Asistencia y ambientes de formación'),
      h('p', {}, 'Registro de asistencia con QR, semáforo de faltas, inventario por ambiente y reporte de daños.'),
      h('ul', { class: 'login-puntos' },
        h('li', {}, icono('qr'), 'QR dinámico por sesión'),
        h('li', {}, icono('alerta'), 'Alertas tempranas de deserción'),
        h('li', {}, icono('caja'), 'Inventario y daños con foto'))),
    h('section', { class: 'card login-card', 'data-anim': '' },
      h('span', { class: 'eyebrow eyebrow-verde' }, 'Ingreso'),
      h('h2', { class: 'section-title' }, 'Inicia sesión'),
      h('p', { class: 'section-sub' }, 'Usa tu número de identificación y la contraseña de la plataforma.'),
      form, demo)));
  identificacion.focus();
}
