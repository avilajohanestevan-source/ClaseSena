// Ajustes de este dispositivo (tamaño de texto, animaciones, vibración,
// menú plegado) e información de la sesión y de los datos.
import { h, anexar, icono } from '../ui/dom.js';
import { anim } from '../ui/anim.js';
import { toast, confirmar } from '../ui/avisos.js';
import { cabecera } from '../ui/ambientes-ui.js';
import { preferencia, guardarPreferencia } from '../ui/preferencias.js';
import { estado, cerrarSesion } from '../estado.js';
import { CONFIG } from '../config.js';

export function render(raiz) {
  const opcion = (clave, nombre, valores) => h('div', { class: 'ajuste' },
    h('span', { class: 'ajuste-etiqueta', id: `aj-${clave}` }, nombre),
    h('div', { class: 'segmento-simple', role: 'radiogroup', 'aria-labelledby': `aj-${clave}` }, valores.map(([v, t]) => h('label', {},
      h('input', { type: 'radio', name: `aj-${clave}`, value: v, checked: preferencia(clave) === v, onchange: () => { guardarPreferencia(clave, v); toast('exito', 'Ajuste guardado'); } }),
      h('span', {}, t)))));
  const interruptor = (clave, nombre, ayuda) => h('label', { class: 'interruptor ajuste' },
    h('input', { type: 'checkbox', role: 'switch', checked: !!preferencia(clave), onchange: (e) => guardarPreferencia(clave, e.target.checked) }),
    h('span', { class: 'interruptor-pista', 'aria-hidden': 'true' }),
    h('span', {}, h('span', { class: 'ajuste-etiqueta' }, nombre), ayuda && h('span', { class: 'ajuste-ayuda' }, ayuda)));

  let plegado = false;
  try { plegado = localStorage.getItem('sena-ambientes.menu-plegado') === '1'; } catch { /* sin almacenamiento */ }

  anexar(raiz,
    cabecera({ eyebrow: 'Cuenta', titulo: 'Ajustes', subtitulo: 'Estas preferencias se guardan solo en este dispositivo.' }),
    h('section', { class: 'card', 'data-anim': '' },
      h('h3', { class: 'bloque-titulo' }, 'Pantalla'),
      opcion('texto', 'Tamaño del texto', [['normal', 'Normal'], ['grande', 'Grande'], ['muy-grande', 'Muy grande']]),
      opcion('movimiento', 'Animaciones', [['sistema', 'Como el sistema'], ['reducido', 'Reducidas']]),
      h('label', { class: 'interruptor ajuste' },
        h('input', { type: 'checkbox', role: 'switch', checked: plegado, onchange: (e) => {
          try { localStorage.setItem('sena-ambientes.menu-plegado', e.target.checked ? '1' : '0'); } catch { /* sin almacenamiento */ }
          toast('info', 'Menú', 'Se aplica al recargar. También puedes plegarlo con el botón ☰ en escritorio.');
        } }),
        h('span', { class: 'interruptor-pista', 'aria-hidden': 'true' }),
        h('span', {}, h('span', { class: 'ajuste-etiqueta' }, 'Menú plegado en escritorio'), h('span', { class: 'ajuste-ayuda' }, 'Muestra solo los íconos del menú lateral.')))),
    h('section', { class: 'card', 'data-anim': '' },
      h('h3', { class: 'bloque-titulo' }, 'Notificaciones'),
      interruptor('vibrar', 'Vibrar al recibir una notificación', 'En celulares compatibles.'),
      h('p', { class: 'text-muted' }, `La campana se actualiza cada ${Math.round(CONFIG.sondeoNotificacionesMs / 1000)} segundos.`)),
    h('section', { class: 'card', 'data-anim': '' },
      h('h3', { class: 'bloque-titulo' }, 'Sesión y datos'),
      h('dl', { class: 'detalle-datos' },
        h('dt', {}, 'Usuario'), h('dd', {}, `${estado.usuario.nombre} · ${estado.usuario.identificacion}`),
        h('dt', {}, 'Ambientes e inspecciones'), h('dd', {}, 'Base de datos MySQL (XAMPP)'),
        h('dt', {}, 'Asistencia a clases'), h('dd', {}, CONFIG.usarMock ? 'Datos simulados en el navegador' : 'Servidor')),
      h('div', { class: 'form-actions' },
        h('button', { class: 'btn btn-outline', type: 'button', onclick: async () => {
          if (await confirmar({ titulo: '¿Cerrar sesión?', mensaje: 'Tendrás que volver a ingresar con tu documento.', textoAceptar: 'Cerrar sesión' })) cerrarSesion();
        } }, icono('salir'), 'Cerrar sesión'))));
  anim.entrarVista(raiz);
}
