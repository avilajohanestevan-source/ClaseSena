// Hoja imprimible de pegatinas del inventario. Cada pegatina lleva el QR
// ("SENA-INV:<código>") y el código de barras Code 128 del código, que es lo
// que leen la revisión y el registro por escáner.
//  · #/etiquetas?ambiente=ID   → todo el ambiente, con filtro por categoría.
//  · #/etiquetas?items=1,2,3   → reimpresión de pegatinas sueltas.
// Al imprimir se registra en la trazabilidad de cada ítem (impresa o reimpresa).
import { h, anexar, icono, vaciar } from '../ui/dom.js';
import { toast } from '../ui/avisos.js';
import { cabecera, pegatina, vacio } from '../ui/ambientes-ui.js';
import { apiAmb } from '../api/ambientes.js';

export async function render(raiz, { params }) {
  const id = Number(params.get('ambiente'));
  const sueltos = (params.get('items') || '').split(',').map(Number).filter(Boolean);
  const motivo = params.get('motivo') || '';
  let items, titulo, volver;
  if (sueltos.length) {
    const amb = await apiAmb.ambiente(Number(params.get('de')) || 0).catch(() => null);
    const todos = amb ? await apiAmb.items(amb.id) : [];
    items = todos.filter((i) => sueltos.includes(i.id));
    titulo = items.length === 1 ? `Reimprimir pegatina · ${items[0].codigo}` : `Reimprimir ${items.length} pegatinas`;
    volver = amb ? `#/inventario?ambiente=${amb.id}` : '#/inventario';
  } else {
    const [amb, lista] = await Promise.all([apiAmb.ambiente(id), apiAmb.items(id)]);
    items = lista.filter((i) => i.estado !== 'baja');
    titulo = `Pegatinas · ambiente ${amb.codigo}`;
    volver = `#/inventario?ambiente=${id}`;
  }

  let categoria = '';
  const hoja = h('div', { class: 'etiquetas' });
  const filtros = h('div', { class: 'pestanas pestanas--desplazable no-imprimir', role: 'tablist', 'aria-label': 'Categoría' });
  const imprimir = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => imprimirHoja() }, icono('imprimir'), 'Imprimir');
  const visibles = () => items.filter((i) => !categoria || i.categoria === categoria);

  function pintar() {
    const categorias = [...new Set(items.map((i) => i.categoria))].sort();
    vaciar(filtros, categorias.length > 1 && !sueltos.length ? ['', ...categorias].map((c) => h('button', {
      class: 'pestana', type: 'button', role: 'tab', 'aria-selected': String(c === categoria),
      onclick: () => { categoria = c; pintar(); },
    }, c || 'Todas', h('span', { class: 'pestana-cuenta' }, c ? items.filter((i) => i.categoria === c).length : items.length))) : null);
    const lista = visibles();
    vaciar(hoja, lista.length ? lista.map(pegatina) : vacio('No hay pegatinas para imprimir', '', 'qr'));
    imprimir.lastChild.textContent = `Imprimir (${lista.length})`;
    imprimir.disabled = !lista.length;
  }

  async function imprimirHoja() {
    const lista = visibles();
    window.print();
    try {
      await apiAmb.etiquetasImpresas(lista.map((i) => i.id), motivo || undefined);
      toast('exito', sueltos.length ? 'Reimpresión registrada' : 'Impresión registrada', `${lista.length} pegatina(s) quedan en la trazabilidad de cada ítem.`);
    } catch (e) { toast('error', 'No se registró la impresión', e.message); }
  }

  anexar(raiz,
    h('div', { class: 'no-imprimir' },
      cabecera({ eyebrow: 'Inventario', titulo,
        subtitulo: 'Cada pegatina tiene QR y código de barras: sirve con la cámara del celular o con un lector.',
        acciones: [imprimir, h('a', { class: 'btn btn-outline', href: volver }, 'Volver al inventario')] })),
    filtros,
    hoja);
  pintar();
}
