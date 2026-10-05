// Fichas (cursos) y sus aprendices.
//  · Administrativo: crea y edita fichas (programa, jornada, ambiente
//    habitual, instructor líder), importa aprendices desde Excel/CSV con
//    vista previa (los nuevos reciben sus credenciales por correo y deben
//    confirmar el correo y cambiar la contraseña en su primer ingreso),
//    reenvía credenciales y consulta los correos enviados.
//  · Instructor: consulta las fichas que dirige o en las que dicta clase.
// Desde cada ficha se va al semáforo de faltas y a las excusas de la ficha.
import { h, anexar, icono, vaciar, errorCampo, descargar } from '../ui/dom.js';
import { anim } from '../ui/anim.js';
import { toast, abrirModal, confirmar } from '../ui/avisos.js';
import { cargando, tarjetaError } from '../ui/componentes.js';
import { cabecera, vacio, fecha } from '../ui/ambientes-ui.js';
import { apiAmb } from '../api/ambientes.js';
import { estado } from '../estado.js';
import { JORNADAS, ETIQUETA_JORNADA } from '../reglas.js';

const COLUMNAS = ['tipo_documento', 'documento', 'nombre', 'email', 'telefono'];

export async function render(raiz) {
  const admin = estado.usuario.rol === 'administrativo';
  const [ambientes, instructores] = await Promise.all([apiAmb.ambientes(), admin ? apiAmb.usuarios('instructor') : Promise.resolve([])]);
  const lista = h('div', { class: 'fichas-lista' }, cargando());

  anexar(raiz,
    cabecera({
      eyebrow: 'Formación', titulo: 'Fichas',
      subtitulo: admin ? 'Carga los cursos y sus aprendices. Cada aprendiz nuevo recibe por correo su usuario y una contraseña temporal; en su primer ingreso confirma el correo y la cambia.'
        : 'Las fichas que diriges o en las que dictas clase.',
      acciones: admin ? [
        h('button', { class: 'btn btn-outline', type: 'button', onclick: () => correos() }, icono('campana'), 'Correos enviados'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => formulario() }, icono('mas'), 'Nueva ficha')] : [],
    }),
    lista);

  async function cargar() {
    vaciar(lista, cargando());
    let fichas;
    try { fichas = await apiAmb.fichas(); } catch (e) { vaciar(lista, tarjetaError(e, cargar)); return; }
    vaciar(lista, fichas.length ? fichas.map(tarjeta) : vacio('No hay fichas', admin ? 'Crea la primera con "Nueva ficha".' : 'Aún no diriges ni dictas clase en ninguna ficha.', 'usuarios'));
    anim.lista(lista.children, { autoAlpha: 0, y: 10 });
  }

  function tarjeta(f) {
    return h('article', { class: `card ficha-tarjeta${f.activo ? '' : ' amb-tarjeta--inactivo'}` },
      h('div', { class: 'amb-tarjeta-cab' },
        h('span', { class: 'amb-numero amb-numero--grande ficha-numero mono' }, f.codigo),
        h('div', {}, h('h3', {}, f.programa), h('span', { class: 'text-muted' }, [ETIQUETA_JORNADA[f.jornada], f.ambiente && `Ambiente ${f.ambiente.codigo}`].filter(Boolean).join(' · '))),
        !f.activo && h('span', { class: 'status-chip neutro' }, 'Inactiva')),
      h('dl', { class: 'amb-datos' },
        h('div', {}, h('dt', {}, 'Instructor líder'), h('dd', {}, f.instructor?.nombre || 'Sin asignar')),
        h('div', {}, h('dt', {}, 'Aprendices'), h('dd', {}, String(f.aprendices),
          f.primerIngresoPendiente ? h('span', { class: 'amb-novedad' }, ` · ${f.primerIngresoPendiente} sin primer ingreso`) : '')),
        (f.fechaInicio || f.fechaFin) && h('div', { class: 'amb-datos-ancho' }, h('dt', {}, 'Formación'), h('dd', {}, `${f.fechaInicio || '—'} a ${f.fechaFin || '—'}`))),
      h('div', { class: 'amb-acciones' },
        h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => detalle(f.id) }, icono('usuarios'), 'Aprendices'),
        admin && h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => importar(f) }, icono('subir'), 'Importar aprendices'),
        admin && h('a', { class: 'btn btn-outline btn-sm', href: `#/semaforo?ficha=${f.codigo}` }, icono('alerta'), 'Semáforo'),
        h('a', { class: 'btn btn-outline btn-sm', href: `#/excusas?ficha=${f.codigo}` }, icono('archivo'), 'Excusas'),
        admin && h('button', { class: 'btn btn-outline btn-sm btn-icono', type: 'button', 'aria-label': `Editar ficha ${f.codigo}`, onclick: () => formulario(f) }, icono('lapiz'))));
  }

  /* --- crear / editar --- */
  function formulario(f = null) {
    const c = (id, etiqueta, input) => h('div', { class: 'campo' }, h('label', { for: id }, etiqueta), input);
    const codigo = h('input', { type: 'text', id: 'fi-codigo', value: f?.codigo || '', maxlength: 12, inputmode: 'numeric', class: 'mono' });
    const programa = h('input', { type: 'text', id: 'fi-programa', value: f?.programa || '', maxlength: 160 });
    const jornada = h('select', { id: 'fi-jornada' }, JORNADAS.map((j) => h('option', { value: j.clave, selected: j.clave === (f?.jornada || 'manana') }, j.etiqueta)));
    const ambiente = h('select', { id: 'fi-amb' }, h('option', { value: '' }, 'Sin ambiente habitual'),
      ambientes.filter((a) => a.activo).map((a) => h('option', { value: a.id, selected: a.id === f?.ambiente?.id }, `${a.codigo} · ${a.nombre}`)));
    const lider = h('select', { id: 'fi-lider' }, h('option', { value: '' }, 'Sin instructor líder'),
      instructores.map((i) => h('option', { value: i.id, selected: i.id === f?.instructor?.id }, i.nombre)));
    const inicio = h('input', { type: 'date', id: 'fi-inicio', value: f?.fechaInicio || '' });
    const fin = h('input', { type: 'date', id: 'fi-fin', value: f?.fechaFin || '' });
    const activo = h('input', { type: 'checkbox', role: 'switch', checked: f ? f.activo : true });
    const guardar = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => enviar() }, icono('check'), f ? 'Guardar' : 'Crear ficha');
    const { cerrar } = abrirModal({
      titulo: f ? `Editar ficha ${f.codigo}` : 'Nueva ficha', ancho: 'normal',
      contenido: h('form', { class: 'form-grid', novalidate: true, onsubmit: (e) => { e.preventDefault(); enviar(); } },
        c('fi-codigo', 'Número de la ficha', codigo), c('fi-jornada', 'Jornada', jornada),
        h('div', { class: 'full' }, c('fi-programa', 'Programa de formación', programa)),
        c('fi-amb', 'Ambiente habitual', ambiente), c('fi-lider', 'Instructor líder (revisa las excusas)', lider),
        c('fi-inicio', 'Inicio de la formación', inicio), c('fi-fin', 'Fin de la formación', fin),
        h('label', { class: 'interruptor full' }, activo, h('span', { class: 'interruptor-pista', 'aria-hidden': 'true' }), 'Ficha activa')),
      acciones: [({ cerrar: x }) => h('button', { class: 'btn btn-outline', type: 'button', onclick: () => x() }, 'Cancelar'), guardar],
    });
    async function enviar() {
      errorCampo(codigo, /^\d{5,12}$/.test(codigo.value.trim()) ? null : 'Entre 5 y 12 dígitos.');
      errorCampo(programa, programa.value.trim().length >= 3 ? null : 'Escribe el programa.');
      if (!/^\d{5,12}$/.test(codigo.value.trim()) || programa.value.trim().length < 3) return;
      const datos = { codigo: codigo.value.trim(), programa: programa.value.trim(), jornada: jornada.value, ambienteId: ambiente.value || null,
        instructorId: lider.value || null, fechaInicio: inicio.value || null, fechaFin: fin.value || null, activo: activo.checked };
      guardar.disabled = true;
      try {
        if (f) await apiAmb.editarFicha(f.id, datos); else await apiAmb.crearFicha(datos);
        toast('exito', f ? 'Ficha actualizada' : 'Ficha creada', `Ficha ${datos.codigo}`);
        cerrar();
        cargar();
      } catch (e) {
        if (e.codigo === 'DUPLICADO') errorCampo(codigo, e.message); else toast('error', 'No se guardó', e.message);
        guardar.disabled = false;
      }
    }
  }

  /* --- aprendices de la ficha --- */
  async function detalle(id) {
    let f;
    try { f = await apiAmb.ficha(id); } catch (e) { toast('error', 'No se abrió la ficha', e.message); return; }
    const cuerpo = h('div', {});
    const pintar = () => vaciar(cuerpo,
      f.listaAprendices.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'tabla-aprendices' },
        h('thead', {}, h('tr', {}, ['Aprendiz', 'Correo', 'Cuenta', 'P004', admin ? '' : null].filter((t) => t !== null).map((t) => h('th', {}, t)))),
        h('tbody', {}, f.listaAprendices.map((a) => h('tr', {},
          h('td', {}, h('strong', {}, a.nombre), h('span', { class: 'text-muted mono' }, ` ${a.tipoDocumento} ${a.documento}`)),
          h('td', {}, a.email || '—', a.emailVerificado ? h('span', { class: 'status-chip in', title: 'Correo confirmado' }, 'Confirmado') : null),
          h('td', {}, a.primerIngresoPendiente
            ? h('span', { class: 'status-chip out', title: a.credencialesEnviadasEn ? `Credenciales enviadas ${fecha.completa(a.credencialesEnviadasEn)}` : '' }, 'Primer ingreso pendiente')
            : h('span', { class: 'status-chip in' }, 'Activa')),
          h('td', {}, a.p004 ? h('span', { class: `status-chip ${['EN FORMACION', 'CONDICIONADO'].includes(a.p004) ? 'neutro' : 'error'}` }, a.p004) : '—'),
          admin && h('td', {}, h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => reenviar(a) }, icono('reintentar'), 'Reenviar credenciales')))))))
        : vacio('La ficha no tiene aprendices', admin ? 'Impórtalos desde Excel o CSV.' : '', 'usuarios'));
    async function reenviar(a) {
      if (!await confirmar({ titulo: `¿Reenviar credenciales a ${a.nombre}?`, mensaje: `Se genera una contraseña temporal nueva y se envía a ${a.email}. En su próximo ingreso deberá cambiarla.`, textoAceptar: 'Reenviar' })) return;
      try {
        const r = await apiAmb.reenviarCredenciales(f.id, a.id);
        Object.assign(a, r.aprendiz);
        pintar();
        toast('exito', 'Credenciales enviadas', a.email);
      } catch (e) { toast('error', 'No se enviaron', e.message); }
    }
    pintar();
    abrirModal({ titulo: `Ficha ${f.codigo}`, subtitulo: `${f.programa} · ${f.listaAprendices.length} aprendices`, ancho: 'ancho', contenido: cuerpo,
      acciones: admin ? [({ cerrar }) => h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { cerrar(); importar(f); } }, icono('subir'), 'Importar aprendices')] : [] });
  }

  /* --- importación masiva de aprendices --- */
  function importar(f) {
    let archivo = null;
    const entrada = h('input', { type: 'file', id: 'ia-archivo', accept: '.xlsx,.xls,.ods,.csv', onchange: () => elegir(entrada.files[0]) });
    const resultado = h('div', { class: 'carga-resultado', 'aria-live': 'polite' });
    const cargarBtn = h('button', { class: 'btn btn-primary', type: 'button', disabled: true, onclick: () => enviar(false) }, icono('subir'), h('span', {}, 'Importar'));
    const plantilla = () => descargar(`aprendices-ficha-${f.codigo}.csv`, '﻿' + [COLUMNAS.join(';'), 'CC;1099887766;Nombre Apellido Apellido;correo@soy.sena.edu.co;3001234567'].join('\r\n'), 'text/csv;charset=utf-8');
    const { cerrar } = abrirModal({
      titulo: `Importar aprendices · ficha ${f.codigo}`, subtitulo: f.programa, ancho: 'ancho',
      contenido: h('div', { class: 'carga' },
        h('ol', { class: 'carga-pasos' },
          h('li', {}, 'Prepara un Excel (.xlsx) o CSV con los títulos ', h('code', {}, COLUMNAS.join(', ')), '. ',
            h('button', { class: 'boton-enlace', type: 'button', onclick: plantilla }, 'Descargar plantilla CSV'), '.'),
          h('li', {}, 'Súbelo y revisa la vista previa: nuevos, actualizados y filas con error.'),
          h('li', {}, 'Al confirmar, cada aprendiz nuevo recibe por correo su usuario y una contraseña temporal.')),
        h('div', { class: 'campo' }, h('label', { for: 'ia-archivo' }, 'Archivo'), entrada),
        resultado),
      acciones: [({ cerrar: x }) => h('button', { class: 'btn btn-outline', type: 'button', onclick: () => x() }, 'Cancelar'), cargarBtn],
    });

    function elegir(file) {
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) { errorCampo(entrada, 'El archivo supera 5 MB.'); return; }
      errorCampo(entrada, null);
      const lector = new FileReader();
      lector.onload = () => { archivo = { nombre: file.name, archivo: lector.result }; enviar(true); };
      lector.readAsDataURL(file);
    }

    async function enviar(simular) {
      if (!archivo) return;
      cargarBtn.disabled = true;
      vaciar(resultado, cargando(simular ? 'Leyendo el archivo…' : 'Importando y enviando credenciales…'));
      let r;
      try { r = await apiAmb.importarAprendices(f.id, { ...archivo, simular }); } catch (e) { vaciar(resultado, h('div', { class: 'banner error' }, e.message)); return; }
      if (!simular) {
        cerrar();
        toast('exito', 'Aprendices importados', `${r.nuevos} nuevos (${r.correos} correos con credenciales), ${r.actualizados} actualizados${r.errores.length ? `, ${r.errores.length} filas omitidas` : ''}.`, 8000);
        cargar();
        return;
      }
      const cifra = (n, t, c) => h('div', { class: `carga-cifra carga-cifra--${c}` }, h('strong', {}, n), h('span', {}, t));
      const ACCION = { nuevo: ['Nuevo', 'in'], actualizado: ['Actualiza', 'azul'], sin_cambios: ['Sin cambios', 'neutro'] };
      const validas = r.nuevos + r.actualizados;
      vaciar(resultado,
        h('div', { class: 'carga-cifras' }, cifra(r.nuevos, 'nuevos', 'nuevo'), cifra(r.actualizados, 'actualizados', 'actualiza'),
          cifra(r.sinCambios, 'sin cambios', 'igual'), cifra(r.errores.length, 'con error', 'error')),
        r.errores.length ? h('div', { class: 'banner error carga-errores' }, h('strong', {}, 'Estas filas no se importarán:'),
          h('ul', {}, r.errores.slice(0, 50).map((e) => h('li', {}, `Fila ${e.fila}: ${e.mensaje}`)))) : null,
        r.filas.length ? h('div', { class: 'table-wrap' }, h('table', {},
          h('thead', {}, h('tr', {}, ['Fila', 'Documento', 'Nombre', 'Correo', ''].map((t) => h('th', {}, t)))),
          h('tbody', {}, r.filas.slice(0, 200).map((x) => h('tr', {},
            h('td', {}, x.fila), h('td', { class: 'mono' }, x.documento), h('td', {}, x.nombre), h('td', {}, x.email),
            h('td', {}, h('span', { class: `status-chip ${ACCION[x.accion][1]}`, title: x.cambios?.join(', ') || '' }, ACCION[x.accion][0]))))))) : null);
      cargarBtn.disabled = !validas;
      cargarBtn.lastChild.textContent = validas ? `Importar ${validas} aprendiz(es)` : 'Nada para importar';
    }
  }

  /* --- correos enviados (bandeja de salida de la prueba de concepto) --- */
  async function correos() {
    const cuerpo = h('div', {}, cargando());
    abrirModal({ titulo: 'Correos enviados', subtitulo: 'Credenciales y códigos de verificación. En la prueba de concepto quedan registrados aquí (api/config.php → CORREO_MODO).', ancho: 'ancho', contenido: cuerpo });
    let lista;
    try { lista = await apiAmb.correos(); } catch (e) { vaciar(cuerpo, tarjetaError(e)); return; }
    vaciar(cuerpo, lista.length ? h('ul', { class: 'correos-lista' }, lista.map((c) => h('li', { class: 'correo' },
      h('details', {},
        h('summary', {}, h('strong', {}, c.asunto), h('span', { class: 'text-muted' }, ` · ${c.para} · ${fecha.completa(c.fecha)}`),
          h('span', { class: `status-chip ${c.estado === 'error' ? 'error' : c.estado === 'enviado' ? 'in' : 'neutro'}` }, c.estado === 'registrado' ? 'Registrado' : c.estado === 'enviado' ? 'Enviado' : 'Error')),
        h('pre', { class: 'correo-cuerpo' }, c.cuerpo), c.error && h('p', { class: 'field-error' }, c.error)))))
      : vacio('Aún no se han enviado correos', '', 'campana'));
  }

  await cargar();
  anim.entrarVista(raiz);
}
