// GestiónP004: importar el reporte (CSV o JSON), validar los campos antes
// de enviarlo y ver/cambiar el estado de cada aprendiz. Todo cambio pide
// confirmación mostrando el usuario actual.
import { h, icono, vaciar, formato } from '../ui/dom.js';
import { anim } from '../ui/anim.js';
import { toast, confirmar } from '../ui/avisos.js';
import { cargando, tarjetaError, encabezado, exportMock } from '../ui/componentes.js';
import { parsearCsv, validarRegistrosP004, ESTADOS_P004, CAMPOS_P004 } from '../reglas.js';
import { api } from '../api/contratos.js';
import { estado } from '../estado.js';

const CLASE_ESTADO = {
  'EN FORMACION': 'in', CONDICIONADO: 'out', APLAZADO: 'out', TRASLADADO: 'azul',
  'RETIRO VOLUNTARIO': 'error', CANCELADO: 'error', 'POR CERTIFICAR': 'azul', CERTIFICADO: 'neutro',
};

const EJEMPLO_CSV = `documento;nombre;ficha;programa;estado
1122334455;Camila Rojas Herrera;2758432;Análisis y Desarrollo de Software;EN FORMACION
1000239895;Samuel Vargas Ortiz;2758432;Análisis y Desarrollo de Software;CONDICIONADO
1000200300;Persona Nueva Prueba;2758432;Análisis y Desarrollo de Software;APLAZADO
12AB;Documento Malo;2758432;ADSO;EN FORMACION
1000999111;Sin Estado;2758432;ADSO;VACACIONES`;

export async function render(raiz) {
  const usuario = estado.usuario;
  let registros = [], pendientes = null, filtroTexto = '', filtroEstado = '';

  /* --- importación --- */
  const archivo = h('input', { type: 'file', accept: '.csv,.json,text/csv,application/json', hidden: true, onchange: () => leerArchivo(archivo.files[0]) });
  const zona = h('div', { class: 'zona-archivo', tabindex: '0', role: 'button', 'aria-label': 'Elegir archivo CSV o JSON',
    onclick: () => archivo.click(), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); archivo.click(); } },
    ondragover: (e) => { e.preventDefault(); zona.classList.add('arrastrando'); },
    ondragleave: () => zona.classList.remove('arrastrando'),
    ondrop: (e) => { e.preventDefault(); zona.classList.remove('arrastrando'); leerArchivo(e.dataTransfer.files[0]); },
  }, icono('subir', 'icon zona-icono'), h('strong', {}, 'Arrastra el P004 aquí o haz clic para elegirlo'), h('span', { class: 'text-muted' }, `CSV (, o ;) o JSON · columnas: ${CAMPOS_P004.join(', ')}`));
  const resultadoValidacion = h('div', { class: 'validacion-p004' });

  function leerArchivo(file) {
    archivo.value = '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast('error', 'Archivo muy grande', 'El máximo es 2 MB.'); return; }
    const lector = new FileReader();
    lector.onload = () => procesarTexto(String(lector.result), file.name);
    lector.onerror = () => toast('error', 'No se pudo leer el archivo');
    lector.readAsText(file, 'utf-8');
  }

  function procesarTexto(texto, nombre) {
    let filas;
    try {
      if (nombre.toLowerCase().endsWith('.json') || texto.trim().startsWith('[')) {
        filas = JSON.parse(texto);
        if (!Array.isArray(filas)) throw new Error('El JSON debe ser una lista de registros.');
      } else filas = parsearCsv(texto);
    } catch (e) {
      vaciar(resultadoValidacion, h('div', { class: 'banner error' }, `No se pudo interpretar ${nombre}: ${e.message}`));
      return;
    }
    const { validos, errores } = validarRegistrosP004(filas);
    pendientes = validos;
    vaciar(resultadoValidacion,
      h('div', { class: 'validacion-resumen' },
        h('span', { class: 'status-chip in' }, `${validos.length} válidos`),
        errores.length ? h('span', { class: 'status-chip error' }, `${errores.length} con errores`) : null,
        h('span', { class: 'text-muted' }, nombre)),
      errores.length ? h('div', { class: 'table-wrap table-wrap--errores' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Fila'), h('th', {}, 'Documento'), h('th', {}, 'Problema'))),
        h('tbody', {}, errores.map((e) => h('tr', {}, h('td', {}, e.fila), h('td', { class: 'mono' }, e.documento), h('td', {}, e.mensaje)))))) : null,
      validos.length ? h('div', { class: 'form-actions' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: importar }, icono('subir'), `Importar ${validos.length} registros`),
        h('button', { class: 'btn btn-outline', type: 'button', onclick: () => { pendientes = null; vaciar(resultadoValidacion); } }, 'Descartar'),
        errores.length ? h('span', { class: 'text-muted' }, 'Las filas con errores no se importan.') : null) : null);
    anim.lista(resultadoValidacion.children);
  }

  async function importar() {
    const ok = await confirmar({
      titulo: 'Confirmar importación del P004',
      mensaje: `Se actualizarán ${pendientes.length} registros. Los aprendices que ya existen toman el estado del archivo.`,
      detalle: firma(),
      textoAceptar: 'Importar',
    });
    if (!ok) return;
    try {
      const r = await api.importarP004(pendientes);
      toast('exito', 'P004 importado', `${r.importados} registros · ${r.total} en total.`);
      pendientes = null;
      vaciar(resultadoValidacion);
      cargar();
    } catch (e) { toast('error', 'No se pudo importar', e.message); }
  }

  function firma() {
    return h('div', { class: 'firma-cambio' }, icono('usuarios'),
      h('div', {}, h('span', { class: 'text-muted' }, 'Confirmado por'), h('strong', {}, usuario.nombre), h('span', { class: 'mono text-muted' }, `${usuario.identificacion} · ${usuario.rol} · ${formato.fechaHora(new Date())}`)));
  }

  /* --- lista de estudiantes --- */
  const cuerpoTabla = h('tbody', {}, h('tr', {}, h('td', { colspan: 6 }, cargando())));
  const buscar = h('input', { type: 'search', placeholder: 'Buscar por nombre, documento o ficha', oninput: () => { filtroTexto = buscar.value.trim().toLowerCase(); pintar(); } });
  const selectEstado = h('select', { onchange: () => { filtroEstado = selectEstado.value; pintar(); } },
    h('option', { value: '' }, 'Todos los estados'), ESTADOS_P004.map((e) => h('option', { value: e }, e)));
  const conteos = h('div', { class: 'conteos-p004' });

  function visibles() {
    return registros.filter((r) => (!filtroEstado || r.estado === filtroEstado)
      && (!filtroTexto || `${r.nombre} ${r.documento} ${r.ficha}`.toLowerCase().includes(filtroTexto)));
  }

  function pintar() {
    const porEstado = {};
    registros.forEach((r) => { porEstado[r.estado] = (porEstado[r.estado] || 0) + 1; });
    vaciar(conteos, Object.entries(porEstado).map(([e, n]) => h('span', { class: `status-chip ${CLASE_ESTADO[e] || 'neutro'}` }, `${e}: ${n}`)));
    const lista = visibles();
    vaciar(cuerpoTabla, lista.length ? lista.map((r) => {
      const select = h('select', { class: 'select-estado', 'aria-label': `Estado de ${r.nombre}` }, ESTADOS_P004.map((e) => h('option', { value: e, selected: e === r.estado }, e)));
      select.addEventListener('change', async () => {
        const nuevo = select.value;
        const ok = await confirmar({
          titulo: 'Cambiar estado en P004',
          mensaje: h('p', { class: 'modal-texto' }, `${r.nombre} (${r.documento}) pasará de `, h('strong', {}, r.estado), ' a ', h('strong', {}, nuevo), '.'),
          detalle: firma(),
          textoAceptar: 'Confirmar cambio',
          peligro: ['CANCELADO', 'RETIRO VOLUNTARIO'].includes(nuevo),
        });
        if (!ok) { select.value = r.estado; return; }
        try {
          Object.assign(r, await api.cambiarEstadoP004(r.documento, nuevo));
          toast('exito', 'Estado actualizado', `${r.nombre}: ${nuevo}`);
          pintar();
        } catch (e) { select.value = r.estado; toast('error', 'No se pudo actualizar', e.message); }
      });
      return h('tr', {},
        h('td', {}, r.nombre), h('td', { class: 'mono' }, r.documento), h('td', {}, r.ficha),
        h('td', {}, h('span', { class: `status-chip ${CLASE_ESTADO[r.estado] || 'neutro'}` }, r.estado)),
        h('td', {}, select),
        h('td', { class: 'text-muted celda-chica' }, r.actualizadoPor, h('br'), formato.fechaHora(r.actualizadoEn)));
    }) : h('tr', {}, h('td', { colspan: 6, class: 'empty-state' }, 'Sin resultados.')));
    anim.lista(cuerpoTabla.children, { autoAlpha: 0 });
  }

  async function cargar() {
    try { registros = await api.p004(); } catch (e) { vaciar(cuerpoTabla, h('tr', {}, h('td', { colspan: 6 }, tarjetaError(e, cargar)))); return; }
    registros.sort((a, b) => a.ficha.localeCompare(b.ficha) || a.nombre.localeCompare(b.nombre));
    pintar();
  }

  raiz.append(
    encabezado('Gestión P004', 'Importa el reporte de novedades y mantén al día el estado académico de cada aprendiz.',
      h('a', { class: 'btn btn-outline btn-volver', href: '#/semaforo' }, 'Volver al semáforo')),
    h('section', { class: 'card', 'data-anim': '' },
      h('h3', { class: 'bloque-titulo' }, 'Importar'),
      zona, archivo,
      h('div', { class: 'form-actions' },
        h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => procesarTexto(EJEMPLO_CSV, 'ejemplo-p004.csv') }, icono('archivo'), 'Cargar ejemplo (mock)'),
        h('span', { class: 'text-muted' }, 'Incluye filas con errores para ver la validación.')),
      resultadoValidacion),
    h('section', { class: 'card', 'data-anim': '' },
      h('div', { class: 'vista-cabecera' }, h('h3', { class: 'bloque-titulo' }, 'Aprendices'),
        exportMock({ nombre: 'p004', obtenerFilas: visibles, columnas: CAMPOS_P004.map((c) => [c, c]) })),
      conteos,
      h('div', { class: 'filtros filtros--2' }, h('div', { class: 'campo' }, buscar), h('div', { class: 'campo' }, selectEstado)),
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Nombre'), h('th', {}, 'Documento'), h('th', {}, 'Ficha'), h('th', {}, 'Estado'), h('th', {}, 'Cambiar a'), h('th', {}, 'Última actualización'))),
        cuerpoTabla))));
  anim.entrarVista(raiz);
  await cargar();
}
