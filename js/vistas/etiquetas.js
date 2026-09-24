// Hoja imprimible con las etiquetas QR del inventario de un ambiente.
// Cada QR lleva "SENA-INV:<código>", que es lo que lee la inspección.
import { h, anexar, icono } from '../ui/dom.js';
import { cabecera, qr } from '../ui/ambientes-ui.js';
import { apiAmb } from '../api/ambientes.js';

export async function render(raiz, { params }) {
  const id = Number(params.get('ambiente'));
  const [amb, items] = await Promise.all([apiAmb.ambiente(id), apiAmb.items(id)]);
  anexar(raiz,
    h('div', { class: 'no-imprimir' },
      cabecera({ eyebrow: 'Inventario', titulo: `Etiquetas QR · ambiente ${amb.codigo}`,
        subtitulo: 'Imprime la hoja y pega cada etiqueta en su equipo o mueble.',
        acciones: [
          h('button', { class: 'btn btn-primary', type: 'button', onclick: () => window.print() }, icono('imprimir'), 'Imprimir'),
          h('a', { class: 'btn btn-outline', href: `#/inventario?ambiente=${id}` }, 'Volver al inventario')] })),
    h('div', { class: 'etiquetas' }, items.filter((i) => i.estado !== 'baja').map((i) => h('figure', { class: 'etiqueta' },
      qr(i.qr, 112, `QR de ${i.nombre}`),
      h('figcaption', {},
        h('strong', {}, i.nombre),
        h('span', { class: 'mono' }, i.codigo),
        h('span', {}, `SENA · Ambiente ${amb.codigo}`))))));
}
