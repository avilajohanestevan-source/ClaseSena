// FormLogin (rediseño móvil v1): fondo blanco con dos piezas decorativas
// (rectángulos con bordes circulares) ancladas a las esquinas de la
// tarjeta, selector de rol segmentado, campos con etiqueta flotante y
// mensajes para cada error de la API (401, 403, 423, red). Al validar,
// la tarjeta hace un micro-rebote y las piezas salen de la pantalla antes
// de pasar al panel (ver anim.salidaLogin).
import { h, icono, errorCampo } from '../ui/dom.js';
import { anim } from '../ui/anim.js';
import { ROLES, validarLogin } from '../reglas.js';
import { api } from '../api/contratos.js';
import { apiAmb } from '../api/ambientes.js';
import { iniciarSesion } from '../estado.js';
import { CONFIG } from '../config.js';
import { PASSWORD_PRUEBA } from '../api/mock/datos.js';

// Usuarios de db/seed.sql (contraseña Sena2026*), para la demostración.
const USUARIOS_DEMO = [
  { identificacion: '1010101010', nombre: 'Laura Gómez Patiño', rol: 'instructor' },
  { identificacion: '1010101011', nombre: 'Andrés Felipe Castro', rol: 'instructor' },
  { identificacion: '4040404040', nombre: 'Jorge Enrique Salazar', rol: 'portero' },
  { identificacion: '4040404041', nombre: 'Martha Lucía Peña', rol: 'portero' },
  { identificacion: '2020202020', nombre: 'Carlos Méndez Ruiz', rol: 'administrativo' },
  { identificacion: '1122334455', nombre: 'Camila Rojas Herrera', rol: 'aprendiz', tipo: 'TI' },
];
// Los módulos de asistencia siguen con datos simulados: tras el login real
// se abre también una sesión simulada con el usuario demo del mismo rol.
const DEMO_ASISTENCIA = { instructor: '1010101010', administrativo: '2020202020', aprendiz: '1122334455' };

const TIPOS_DOCUMENTO = [['CC', 'Cédula de ciudadanía'], ['TI', 'Tarjeta de identidad'], ['CE', 'Cédula de extranjería'], ['PPT', 'Permiso por protección temporal']];

export function render(raiz, { desdeSalida = false } = {}) {
  let rol = 'instructor';

  /* --- campos --- */
  const tipoDocumento = h('select', { class: 'campo-flotante-prefijo', id: 'login-tipo', 'aria-label': 'Tipo de documento' },
    TIPOS_DOCUMENTO.map(([v, t]) => h('option', { value: v, title: t }, v)));
  const identificacion = h('input', { class: 'campo-flotante-input', type: 'text', id: 'login-id', inputmode: 'numeric', autocomplete: 'username', placeholder: ' ', maxlength: 12 });
  const password = h('input', { class: 'campo-flotante-input', type: 'password', id: 'login-pass', autocomplete: 'current-password', placeholder: ' ' });
  const verPass = h('button', { class: 'campo-flotante-accion', type: 'button', 'aria-label': 'Mostrar contraseña', 'aria-pressed': 'false', onclick: () => {
    const ver = password.type === 'password';
    password.type = ver ? 'text' : 'password';
    verPass.setAttribute('aria-pressed', String(ver));
    verPass.setAttribute('aria-label', ver ? 'Ocultar contraseña' : 'Mostrar contraseña');
  } }, icono('ojo'));
  const errorGeneral = h('div', { class: 'banner error login-error', role: 'alert', hidden: true });
  const textoEnviar = h('span', {}, 'Ingresar');
  const enviar = h('button', { class: 'btn btn-primary btn-block login-enviar', type: 'submit' }, textoEnviar, icono('flecha'));

  /* --- selector de rol segmentado: el indicador se desliza con rebote --- */
  const indicador = h('span', { class: 'segmento-indicador', 'aria-hidden': 'true' });
  const opcionesRol = h('div', { class: 'segmento', role: 'radiogroup', 'aria-label': 'Rol' },
    indicador,
    ROLES.map((r, i) => h('label', { class: 'segmento-opcion' },
      h('input', { type: 'radio', name: 'rol', value: r.clave, checked: r.clave === rol, onchange: () => {
        rol = r.clave;
        indicador.style.setProperty('--x', i % 2);
        indicador.style.setProperty('--y', Math.floor(i / 2));
        errorCampo(opcionesRol, null);
      } }),
      h('span', {}, icono(r.clave), r.etiqueta))));

  const form = h('form', { class: 'login-form', novalidate: true, onsubmit: ingresar },
    h('div', { class: 'campo' }, opcionesRol),
    h('div', { class: 'campo' },
      h('div', { class: 'campo-flotante campo-flotante--prefijo' },
        tipoDocumento, identificacion, h('label', { class: 'campo-flotante-etiqueta', for: 'login-id' }, 'Número de documento'))),
    h('div', { class: 'campo' },
      h('div', { class: 'campo-flotante campo-flotante--accion' },
        password, h('label', { class: 'campo-flotante-etiqueta', for: 'login-pass' }, 'Contraseña'), verPass)),
    h('div', { class: 'login-fila' },
      h('label', { class: 'login-recordar' }, h('input', { type: 'checkbox' }), 'Recordarme'),
      h('button', { class: 'login-olvido', type: 'button', onclick: () => {
        errorGeneral.textContent = 'Para restablecer tu contraseña comunícate con la coordinación académica de tu centro.';
        errorGeneral.className = 'banner info login-error';
        errorGeneral.hidden = false;
      } }, 'Olvidé mi contraseña')),
    errorGeneral,
    enviar);

  // Soltar el error de un campo apenas se corrige.
  identificacion.addEventListener('input', () => { identificacion.value = identificacion.value.replace(/\D/g, ''); errorCampo(identificacion, null); });
  password.addEventListener('input', () => errorCampo(password, null));

  /* --- escena: piezas decorativas ancladas a la tarjeta --- */
  const tarjeta = h('section', { class: 'login-tarjeta', 'aria-labelledby': 'login-titulo' },
    h('span', { class: 'eyebrow eyebrow-verde' }, 'Ingreso a la plataforma'),
    h('h2', { class: 'login-titulo', id: 'login-titulo' }, 'Hola de nuevo'),
    h('p', { class: 'login-sub' }, 'Elige tu rol e ingresa con tu documento.'),
    form,
    CONFIG.mostrarUsuariosDemo && demo());
  const piezaA = pieza('a', 'img/fondo/pildora-verde.svg');
  const piezaB = pieza('b', 'img/fondo/pildora-azul.svg');
  const linea = h('span', { class: 'login-pieza login-pieza--linea', 'aria-hidden': 'true' });
  const aro = h('span', { class: 'login-pieza login-pieza--aro', 'aria-hidden': 'true' });

  raiz.append(h('div', { class: 'login' },
    h('div', { class: 'login-fondo', 'aria-hidden': 'true' }, h('img', { src: 'img/fondo/trazos-fondo.svg', alt: '' })),
    h('header', { class: 'login-cabecera' },
      h('img', { class: 'login-logo', src: 'img/sena-logo-verde.png', alt: 'SENA' }),
      h('div', { class: 'login-marca' }, h('strong', {}, 'Asistencia y ambientes'), h('span', {}, 'Servicio Nacional de Aprendizaje'))),
    h('div', { class: 'login-centro' },
      h('div', { class: 'login-escena' }, piezaA, piezaB, linea, aro, tarjeta)),
    h('footer', { class: 'login-pie' }, '© SENA · Ministerio del Trabajo')));

  // Después de cerrar sesión las piezas regresan desde fuera de la pantalla.
  if (desdeSalida) anim.entradaLogin({ tarjeta, piezaA, piezaB, extras: [linea, aro] });
  if (window.matchMedia('(pointer: fine)').matches) identificacion.focus();

  // Parallax suave de las piezas con el puntero (solo escritorio, respeta "reducir movimiento").
  if (window.matchMedia('(pointer: fine) and (prefers-reduced-motion: no-preference)').matches) {
    raiz.querySelector('.login').addEventListener('pointermove', (e) => {
      const x = e.clientX / innerWidth - 0.5, y = e.clientY / innerHeight - 0.5;
      piezaA.firstChild.style.transform = `translate(${x * -20}px, ${y * -20}px)`;
      piezaB.firstChild.style.transform = `translate(${x * 16}px, ${y * 16}px)`;
    });
  }

  async function ingresar(e) {
    e.preventDefault();
    errorGeneral.hidden = true;
    const datos = { tipoDocumento: tipoDocumento.value, identificacion: identificacion.value.trim(), password: password.value, rol };
    const errores = validarLogin(datos);
    errorCampo(identificacion, errores.identificacion);
    errorCampo(password, errores.password);
    errorCampo(opcionesRol, errores.rol);
    if (Object.keys(errores).length) { anim.sacudir(tarjeta); form.querySelector('[aria-invalid]')?.focus?.(); return; }

    enviar.disabled = true;
    enviar.classList.add('cargando-boton');
    textoEnviar.textContent = 'Validando…';
    let respuesta;
    try {
      respuesta = await apiAmb.login(datos);
    } catch (err) {
      errorGeneral.textContent = err.message;
      errorGeneral.className = 'banner error login-error';
      errorGeneral.hidden = false;
      if (err.codigo === 'CREDENCIALES') { password.value = ''; password.focus(); }
      anim.sacudir(tarjeta);
      enviar.disabled = false;
      enviar.classList.remove('cargando-boton');
      textoEnviar.textContent = 'Ingresar';
      return;
    }
    enviar.classList.remove('cargando-boton');
    enviar.classList.add('login-enviar--ok');
    enviar.replaceChildren(icono('check'), h('span', {}, `¡Hola, ${respuesta.usuario.nombre.split(' ')[0]}!`));
    await anim.salidaLogin({ tarjeta, piezaA, piezaB, extras: [linea, aro] });
    let tokenMock = null, usuarioMock = null;
    if (DEMO_ASISTENCIA[rol]) {
      try { ({ token: tokenMock, usuario: usuarioMock } = await api.login({ identificacion: DEMO_ASISTENCIA[rol], password: PASSWORD_PRUEBA, rol })); } catch { /* asistencia no disponible */ }
    }
    iniciarSesion({ token: respuesta.token, usuario: respuesta.usuario, tokenMock, usuarioMock });
  }

  function demo() {
    return h('details', { class: 'login-demo' },
      h('summary', {}, 'Usuarios de prueba (modo demostración)'),
      h('p', { class: 'text-muted' }, 'Contraseña para todos: ', h('code', {}, 'Sena2026*')),
      h('ul', {}, USUARIOS_DEMO.map((u) => h('li', {},
        h('button', { class: 'chip-boton', type: 'button', onclick: () => {
          identificacion.value = u.identificacion; password.value = 'Sena2026*'; tipoDocumento.value = u.tipo || 'CC';
          form.querySelector(`input[value="${u.rol}"]`).click();
          errorCampo(identificacion, null); errorCampo(password, null);
        } }, u.identificacion),
        h('span', {}, `${u.nombre} · ${u.rol}`)))));
  }
}

function pieza(letra, src) {
  return h('div', { class: `login-pieza login-pieza--${letra}`, 'aria-hidden': 'true' },
    h('div', { class: 'login-pieza-parallax' }, h('img', { src, alt: '' })));
}
