// Hoja imprimible de pegatinas del inventario. Cada pegatina lleva el QR
// (el qr_value del ítem: "SENA-INV:<código>" o la placa que ya traía) y el
// código de barras Code 128 del código, que es lo que leen la revisión y el
// registro por escáner. Las familias tienen su propia pegatina
// ("SENA-FAM:<código>") para reportar el conjunto completo.
//  · #/etiquetas?ambiente=ID            → todo el ambiente, con filtro por categoría y las familias.
//  · #/etiquetas?items=1,2&familias=3   → reimpresión de pegatinas sueltas (de=ID del ambiente).
// Al imprimir se registra en la trazabilidad de cada ítem (impresa o reimpresa).
import { h, anexar, icono, vaciar } from '../ui/dom.js';
import { toast } from '../ui/avisos.js';
import { cabecera, pegatina, pegatinaFamilia, vacio } from '../ui/ambientes-ui.js';
import { apiAmb } from '../api/ambientes.js';

const FAMILIAS = '__familias';

export async function render(raiz, { params }) {
  const id = Number(params.get('ambiente'));
  const lista = (clave) => (params.get(clave) || '').split(',').map(Number).filter(Boolean);
  const itemsSueltos = lista('items'), familiasSueltas = lista('familias');
  const sueltos = itemsSueltos.length + familiasSueltas.length > 0;
  const motivo = params.get('motivo') || '';
  const ambId = sueltos ? Number(params.get('de')) || 0 : id;
  const [amb, todos, todasFamilias] = await Promise.all([
    apiAmb.ambiente(ambId).catch(() => null), ambId ? apiAmb.items(ambId) : [], ambId ? apiAmb.familias(ambId) : [],
  ]);
  if (!amb) { anexar(raiz, vacio('No se encontró el ambiente', '', 'ambiente')); return; }
  const items = sueltos ? todos.filter((i) => itemsSueltos.includes(i.id)) : todos.filter((i) => i.estado !== 'baja');
  const familias = sueltos ? todasFamilias.filter((f) => familiasSueltas.includes(f.id)) : todasFamilias;
  const total = items.length + familias.length;
  const titulo = sueltos ? (total === 1 ? `Reimprimir pegatina · ${(items[0] || familias[0]).codigo}` : `Reimprimir ${total} pegatinas`) : `Pegatinas · ambiente ${amb.codigo}`;

  let categoria = '';
  const hoja = h('div', { class: 'etiquetas' });
  const filtros = h('div', { class: 'pestanas pestanas--desplazable no-imprimir', role: 'tablist', 'aria-label': 'Categoría' });
  const imprimir = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => imprimirHoja() }, icono('imprimir'), 'Imprimir');
  const visibles = () => ({
    items: categoria === FAMILIAS ? [] : items.filter((i) => !categoria || i.categoria === categoria),
    familias: !categoria || categoria === FAMILIAS ? familias : [],
  });

  function pintar() {
    const categorias = [...new Set(items.map((i) => i.categoria))].sort();
    const opciones = ['', ...categorias, ...(familias.length ? [FAMILIAS] : [])];
    vaciar(filtros, opciones.length > 2 && !sueltos ? opciones.map((c) => h('button', {
      class: 'pestana', type: 'button', role: 'tab', 'aria-selected': String(c === categoria),
      onclick: () => { categoria = c; pintar(); },
    }, c === FAMILIAS ? 'Familias' : c || 'Todas', h('span', { class: 'pestana-cuenta' },
      c === FAMILIAS ? familias.length : c ? items.filter((i) => i.categoria === c).length : total))) : null);
    const v = visibles();
    const n = v.items.length + v.familias.length;
    vaciar(hoja, n ? [...v.familias.map(pegatinaFamilia), ...v.items.map(pegatina)] : vacio('No hay pegatinas para imprimir', '', 'qr'));
    imprimir.lastChild.textContent = `Imprimir (${n})`;
    imprimir.disabled = !n;
  }

  async function imprimirHoja() {
    const v = visibles();
    window.print();
    try {
      const r = await apiAmb.etiquetasImpresas({ ids: v.items.map((i) => i.id), familiaIds: v.familias.map((f) => f.id), motivo: motivo || undefined });
      toast('exito', sueltos ? 'Reimpresión registrada' : 'Impresión registrada', `${r.registradas} pegatina(s) quedan en la trazabilidad de cada ítem.`);
    } catch (e) { toast('error', 'No se registró la impresión', e.message); }
  }

  anexar(raiz,
    h('div', { class: 'no-imprimir' },
      cabecera({ eyebrow: 'Inventario', titulo,
        subtitulo: 'Cada pegatina tiene QR y código de barras: sirve con la cámara del celular o con un lector. Las de familia permiten reportar el conjunto completo.',
        acciones: [imprimir, h('a', { class: 'btn btn-outline', href: `#/inventario?ambiente=${amb.id}` }, 'Volver al inventario')] })),
    filtros,
    hoja);
  pintar();
}
