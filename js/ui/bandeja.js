// Bandeja de notificaciones del backend real (campana de la barra superior).
// Consulta /inbox cada CONFIG.sondeoNotificacionesMs; cuando llega una
// notificación nueva muestra un aviso emergente, vibra (si está activado en
// Ajustes) y emite 'bandeja' para que las vistas abiertas se refresquen.
import { h, icono, vaciar, formato } from './dom.js';
import { anim } from './anim.js';
import { toast, abrirModal } from './avisos.js';
import { apiAmb } from '../api/ambientes.js';
import { emitir } from '../estado.js';
import { CONFIG } from '../config.js';
import { preferencia } from './preferencias.js';

const ICONO = { inspeccion_confirmada: 'check', inspeccion_recibida: 'archivo', dano_grave: 'alerta' };

export function crearBandeja() {
  let vistos = null, lista = [], sinLeer = 0, sondeo = null;
  const insignia = h('span', { class: 'insignia', hidden: true });
  const boton = h('button', { class: 'barra-boton', type: 'button', 'aria-label': 'Notificaciones', onclick: () => abrir() },
    icono('campana'), insignia);

  async function consultar() {
    let datos;
    try { datos = await apiAmb.bandeja(); } catch { return; }
    lista = datos.notificaciones;
    const antes = sinLeer;
    sinLeer = datos.sinLeer;
    insignia.textContent = sinLeer > 9 ? '9+' : String(sinLeer);
    insignia.hidden = !sinLeer;
    boton.setAttribute('aria-label', sinLeer ? `Notificaciones: ${sinLeer} sin leer` : 'Notificaciones');
    if (sinLeer !== antes) anim.latido(insignia);
    const nuevas = vistos ? lista.filter((n) => !n.leida && !vistos.has(n.id)) : [];
    vistos = new Set(lista.map((n) => n.id));
    if (nuevas.length) {
      const n = nuevas[0];
      toast(n.tipo === 'dano_grave' ? 'aviso' : 'info', n.titulo, n.detalle, 7000);
      // El navegador solo permite vibrar si el usuario ya interactuó con la página.
      if (preferencia('vibrar') && navigator.userActivation?.hasBeenActive) navigator.vibrate?.([80, 60, 80]);
      emitir('bandeja', nuevas);
    }
  }

  function abrir() {
    const cuerpo = h('div', { class: 'bandeja' });
    const pintar = () => vaciar(cuerpo, lista.length
      ? h('ul', { class: 'bandeja-lista' }, lista.map((n) => h('li', {},
        h('button', {
          class: `bandeja-item${n.leida ? '' : ' bandeja-item--nueva'} bandeja-item--${n.tipo}`, type: 'button',
          onclick: async () => {
            cerrar();
            if (!n.leida) { n.leida = true; apiAmb.leerNotificacion(n.id).then(consultar).catch(() => {}); }
            if (n.inspeccionId) location.hash = `#/planilla?id=${n.inspeccionId}`;
          },
        },
          h('span', { class: 'bandeja-icono' }, icono(ICONO[n.tipo] || 'campana')),
          h('span', { class: 'bandeja-texto' },
            h('strong', {}, n.titulo), h('span', {}, n.detalle), h('time', { datetime: n.fecha }, formato.fechaHora(n.fecha))),
          !n.leida && h('span', { class: 'bandeja-punto', 'aria-label': 'Sin leer' })))))
      : h('p', { class: 'empty-state' }, 'No tienes notificaciones.'));
    pintar();
    const { cerrar } = abrirModal({
      titulo: 'Notificaciones', subtitulo: sinLeer ? `${sinLeer} sin leer` : 'Todo al día', ancho: 'angosto', contenido: cuerpo,
      acciones: sinLeer ? [h('button', { class: 'btn btn-outline', type: 'button', onclick: async () => {
        await apiAmb.leerTodas().catch(() => {});
        lista.forEach((n) => { n.leida = true; });
        await consultar();
        cerrar();
      } }, icono('check'), 'Marcar todas como leídas')] : [],
    });
  }

  return {
    el: boton,
    iniciar() { vistos = null; sinLeer = 0; consultar(); clearInterval(sondeo); sondeo = setInterval(consultar, CONFIG.sondeoNotificacionesMs); },
    detener() { clearInterval(sondeo); sondeo = null; vistos = null; },
    refrescar: consultar,
  };
}
