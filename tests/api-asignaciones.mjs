// Asignación de instructores por jornada contra la API real: por día, por
// periodo y permanente; prioridad día > periodo > permanente en el tablero;
// reasignar y anular turnos; avisos y auditoría.
//   npm run test:api   (Apache y MySQL encendidos, base instalada con db/instalar.php)
import { test } from 'node:test';
import assert from 'node:assert/strict';

const API = process.env.API || 'http://localhost/sena-ambientes/api/index.php';
const CLAVE = 'Sena2026*';

async function pedir(metodo, ruta, { token, cuerpo } = {}) {
  const r = await fetch(API + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  return { status: r.status, datos: r.status === 204 ? null : await r.json() };
}
const ingresar = async (identificacion, rol) => (await pedir('POST', '/auth/login', { cuerpo: { identificacion, password: CLAVE, rol } })).datos.token;
const disponible = () => fetch(API + '/me').then(() => true, () => false);
const dia = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

test('asignar instructores por jornada: día, periodo y permanente; reasignar y anular con auditoría', async (t) => {
  if (!await disponible()) { t.skip('API no disponible (enciende Apache y MySQL en XAMPP)'); return; }
  const admin = await ingresar('2020202021', 'administrativo');
  const laura = await ingresar('1010101010', 'instructor');
  const andres = await ingresar('1010101011', 'instructor');
  const usuarios = (await pedir('GET', '/users?rol=instructor', { token: admin })).datos;
  const id = (nombre) => usuarios.find((u) => u.nombre.startsWith(nombre)).id;
  const amb = (await pedir('GET', '/environments', { token: admin })).datos.find((a) => a.codigo === '111');
  assert.ok(amb.asignadosHoy.every((x) => x.instructor === null), 'el 111 empieza sin asignaciones vigentes');

  // Permanente en la mañana, periodo en la tarde y un reemplazo de un día
  const perm = await pedir('POST', '/assignments', { token: admin, cuerpo: { ambienteId: amb.id, instructorId: id('Laura'), jornada: 'manana', tipo: 'permanente', fechaInicio: dia(0), motivo: 'Ficha 2999001' } });
  assert.equal(perm.status, 201, JSON.stringify(perm.datos));
  assert.equal(perm.datos.asignacion.fechaFin, null);
  // Laura ya tiene la mañana del 107 (seed): se advierte, no se bloquea
  assert.ok(perm.datos.advertencias.some((a) => /107/.test(a)));
  const periodo = (await pedir('POST', '/assignments', { token: admin, cuerpo: { ambienteId: amb.id, instructorId: id('Diana'), jornada: 'tarde', tipo: 'periodo', fechaInicio: dia(0), fechaFin: dia(14) } })).datos.asignacion;
  const reemplazo = await pedir('POST', '/assignments', { token: admin, cuerpo: { ambienteId: amb.id, instructorId: id('Andrés'), jornada: 'manana', tipo: 'dia', fechaInicio: dia(2) } });
  assert.equal(reemplazo.status, 201);
  assert.equal(reemplazo.datos.asignacion.fechaFin, dia(2));

  // Validaciones: mismo tipo cruzado → 409; periodo sin fin, fechas pasadas o instructor que no existe → 422; solo administrativos
  assert.equal((await pedir('POST', '/assignments', { token: admin, cuerpo: { ambienteId: amb.id, instructorId: id('Diana'), jornada: 'manana', tipo: 'permanente', fechaInicio: dia(5) } })).status, 409);
  assert.equal((await pedir('POST', '/assignments', { token: admin, cuerpo: { ambienteId: amb.id, instructorId: id('Diana'), jornada: 'noche', tipo: 'periodo', fechaInicio: dia(0) } })).status, 422);
  assert.equal((await pedir('POST', '/assignments', { token: admin, cuerpo: { ambienteId: amb.id, instructorId: id('Diana'), jornada: 'noche', tipo: 'dia', fechaInicio: dia(-1) } })).status, 422);
  assert.equal((await pedir('POST', '/assignments', { token: admin, cuerpo: { ambienteId: amb.id, instructorId: 4, jornada: 'noche', tipo: 'dia', fechaInicio: dia(1) } })).status, 422, 'un portero no es instructor');
  assert.equal((await pedir('POST', '/assignments', { token: laura, cuerpo: { ambienteId: amb.id, instructorId: id('Laura'), jornada: 'noche', tipo: 'dia', fechaInicio: dia(1) } })).status, 403);

  // Tablero: el día 2 la mañana es de Andrés (día > permanente); los demás, de Laura
  const tablero = (await pedir('GET', `/assignments/board?desde=${dia(0)}&dias=4&ambienteId=${amb.id}`, { token: admin })).datos;
  const celdas = tablero.ambientes[0].celdas;
  assert.deepEqual(tablero.fechas.map((f) => celdas[f].manana.instructor.split(' ')[0]), ['Laura', 'Laura', 'Andrés', 'Laura']);
  assert.ok(tablero.fechas.every((f) => celdas[f].tarde.instructor.startsWith('Diana') && celdas[f].noche === null));
  assert.equal((await pedir('GET', '/environments', { token: admin })).datos.find((a) => a.codigo === '111').asignadosHoy[0].instructor, 'Laura Gómez Patiño');
  assert.ok((await pedir('GET', '/inbox', { token: laura })).datos.notificaciones.some((n) => n.tipo === 'asignacion' && /111/.test(n.titulo)));

  // Reasignar la permanente desde dentro de 5 días: Laura queda hasta el día 4 y Andrés sigue sin fecha final
  const r = await pedir('POST', `/assignments/${perm.datos.asignacion.id}/reassign`, { token: admin, cuerpo: { instructorId: id('Andrés'), desde: dia(5), motivo: 'Laura pasa a la jornada de la tarde' } });
  assert.equal(r.status, 200, JSON.stringify(r.datos));
  assert.deepEqual([r.datos.anterior.estado, r.datos.anterior.fechaFin], ['vigente', dia(4)]);
  assert.deepEqual([r.datos.asignacion.instructor.nombre, r.datos.asignacion.fechaInicio, r.datos.asignacion.fechaFin, r.datos.asignacion.reemplazaId],
    ['Andrés Felipe Castro', dia(5), null, perm.datos.asignacion.id]);
  assert.equal((await pedir('POST', `/assignments/${perm.datos.asignacion.id}/reassign`, { token: admin, cuerpo: { instructorId: id('Diana'), desde: dia(6), motivo: 'x' } })).status, 422, 'fuera de su rango');
  const t2 = (await pedir('GET', `/assignments/board?desde=${dia(4)}&dias=2&ambienteId=${amb.id}`, { token: admin })).datos.ambientes[0].celdas;
  assert.deepEqual([t2[dia(4)].manana.instructor, t2[dia(5)].manana.instructor], ['Laura Gómez Patiño', 'Andrés Felipe Castro']);
  assert.ok((await pedir('GET', '/inbox', { token: andres })).datos.notificaciones.some((n) => n.tipo === 'asignacion'));

  // Reasignar el turno de un día desde su primer día: queda "reasignada"
  const rd = (await pedir('POST', `/assignments/${reemplazo.datos.asignacion.id}/reassign`, { token: admin, cuerpo: { instructorId: id('Diana'), motivo: 'Andrés tiene comité' } })).datos;
  assert.equal(rd.anterior.estado, 'reasignada');

  // Anular el periodo desde dentro de 3 días: vale hasta el día 2
  const an = await pedir('POST', `/assignments/${periodo.id}/cancel`, { token: admin, cuerpo: { motivo: 'Se cerró la ficha', desde: dia(3) } });
  assert.deepEqual([an.datos.estado, an.datos.fechaFin], ['vigente', dia(2)]);
  const anulado = await pedir('POST', `/assignments/${rd.asignacion.id}/cancel`, { token: admin, cuerpo: { motivo: 'Se suspende la clase' } });
  assert.equal(anulado.datos.estado, 'anulada');
  assert.equal((await pedir('POST', `/assignments/${rd.asignacion.id}/cancel`, { token: admin, cuerpo: { motivo: 'otra vez' } })).status, 409);

  // Todo queda en la auditoría, con fecha y usuario
  const creadas = [perm.datos.asignacion.id, periodo.id, reemplazo.datos.asignacion.id, r.datos.asignacion.id, rd.asignacion.id];
  const eventos = (await pedir('GET', `/audit?entidad=asignacion&ambienteId=${amb.id}`, { token: admin })).datos.filter((e) => creadas.includes(e.entidadId));
  const acciones = eventos.map((e) => e.accion);
  for (const a of ['creada', 'reasignada', 'recortada', 'anulada']) assert.ok(acciones.includes(a), `falta el evento ${a}`);
  assert.ok(eventos.every((e) => e.usuario === 'Patricia Rondón Gil' && e.fecha));
  const det = (await pedir('GET', `/assignments/${perm.datos.asignacion.id}`, { token: admin })).datos;
  assert.deepEqual(det.eventos.map((e) => e.accion), ['creada', 'reasignada']);
  // El instructor solo ve las suyas
  const mias = (await pedir('GET', '/assignments', { token: laura })).datos;
  assert.ok(mias.length && mias.every((a) => a.instructor.nombre === 'Laura Gómez Patiño'));
});

test('desde el formulario del ambiente: varios días de una vez y editar una asignación', async (t) => {
  if (!await disponible()) { t.skip('API no disponible'); return; }
  const admin = await ingresar('2020202020', 'administrativo');
  const usuarios = (await pedir('GET', '/users?rol=instructor', { token: admin })).datos;
  const id = (nombre) => usuarios.find((u) => u.nombre.startsWith(nombre)).id;
  const amb = (await pedir('GET', '/environments', { token: admin })).datos.find((a) => a.codigo === '109');

  // Por días: tres fechas sueltas en una sola petición
  const dias = await pedir('POST', '/assignments', { token: admin, cuerpo: { ambienteId: amb.id, instructorId: id('Andrés'), jornada: 'noche', tipo: 'dia', fechas: [dia(3), dia(1), dia(5)], motivo: 'Refuerzo' } });
  assert.equal(dias.status, 201, JSON.stringify(dias.datos));
  assert.deepEqual(dias.datos.asignaciones.map((a) => a.fechaInicio), [dia(1), dia(3), dia(5)]);
  assert.equal((await pedir('POST', '/assignments', { token: admin, cuerpo: { ambienteId: amb.id, instructorId: id('Andrés'), jornada: 'noche', tipo: 'dia', fechas: [dia(-1)] } })).status, 422);

  // Una que aún no empieza: se cambia todo (instructor, tipo y fechas)
  const futura = dias.datos.asignaciones[2];
  const ed = await pedir('PATCH', `/assignments/${futura.id}`, { token: admin, cuerpo: { instructorId: id('Laura'), tipo: 'periodo', fechaInicio: dia(5), fechaFin: dia(9) } });
  assert.equal(ed.status, 200, JSON.stringify(ed.datos));
  assert.deepEqual([ed.datos.asignacion.instructor.nombre, ed.datos.asignacion.tipo, ed.datos.asignacion.fechaFin], ['Laura Gómez Patiño', 'periodo', dia(9)]);
  const ev = (await pedir('GET', `/assignments/${futura.id}`, { token: admin })).datos.eventos.at(-1);
  assert.equal(ev.accion, 'modificada');
  assert.ok(ev.datos.antes.instructor === 'Andrés Felipe Castro' && ev.datos.despues.instructor === 'Laura Gómez Patiño');
  assert.equal((await pedir('PATCH', `/assignments/${futura.id}`, { token: admin, cuerpo: {} })).status, 422, 'sin cambios');

  // Una que ya empezó (Diana, 109 mañana, permanente): se le pone fecha final, pero el instructor se cambia con reasignar
  const permanente = (await pedir('GET', `/assignments?ambienteId=${amb.id}`, { token: admin })).datos.find((a) => a.jornada === 'manana' && a.tipo === 'permanente');
  const fin = await pedir('PATCH', `/assignments/${permanente.id}`, { token: admin, cuerpo: { tipo: 'periodo', fechaFin: dia(60) } });
  assert.equal(fin.status, 200, JSON.stringify(fin.datos));
  assert.deepEqual([fin.datos.asignacion.tipo, fin.datos.asignacion.fechaFin], ['periodo', dia(60)]);
  assert.equal((await pedir('PATCH', `/assignments/${permanente.id}`, { token: admin, cuerpo: { instructorId: id('Laura') } })).datos.codigo, 'USAR_REASIGNAR');
  assert.equal((await pedir('PATCH', `/assignments/${permanente.id}`, { token: admin, cuerpo: { fechaInicio: dia(2) } })).status, 422);
  // Volver a "sin tiempo definido"
  assert.equal((await pedir('PATCH', `/assignments/${permanente.id}`, { token: admin, cuerpo: { tipo: 'permanente', fechaFin: null } })).datos.asignacion.fechaFin, null);

  // La revisión del instructor muestra solo sus propias jornadas de hoy en el ambiente
  const diana = await ingresar('1010101012', 'instructor');
  const insp = (await pedir('POST', '/inspections', { token: diana, cuerpo: { ambienteId: amb.id } })).datos;
  assert.deepEqual(insp.asignadosHoy.map((j) => [j.jornada, j.instructor]), [['manana', 'Diana Marcela Ruiz']]);
  await pedir('POST', `/inspections/${insp.id}/cancel`, { token: diana });
});

test('permisos: el administrativo ve y cambia todo; el portero ve todo sin cambiar; el instructor solo ve dónde está asignado', async (t) => {
  if (!await disponible()) { t.skip('API no disponible'); return; }
  const admin = await ingresar('2020202020', 'administrativo');
  const portero = await ingresar('4040404040', 'portero');
  const laura = await ingresar('1010101010', 'instructor');
  const andres = await ingresar('1010101011', 'instructor');
  const amb107 = (await pedir('GET', '/environments', { token: admin })).datos.find((a) => a.codigo === '107');

  // Portero: ve todas las asignaciones y el tablero completo…
  const todas = (await pedir('GET', '/assignments', { token: portero })).datos;
  assert.ok(new Set(todas.map((a) => a.instructor.nombre)).size >= 2, 'el portero ve las de todos los instructores');
  const tabPortero = (await pedir('GET', `/assignments/board?desde=${dia(0)}&dias=1`, { token: portero })).datos;
  assert.equal(tabPortero.soloMias, false);
  assert.equal(tabPortero.ambientes.find((a) => a.codigo === '107').celdas[dia(0)].tarde.instructor, 'Andrés Felipe Castro');
  assert.equal((await pedir('GET', `/assignments/${todas[0].id}`, { token: portero })).status, 200);
  assert.equal((await pedir('GET', '/environments', { token: portero })).datos.find((a) => a.codigo === '107').asignadosHoy.length, 3);
  // …pero no puede cambiar nada
  const una = todas[0];
  assert.equal((await pedir('POST', '/assignments', { token: portero, cuerpo: { ambienteId: amb107.id, instructorId: 1, jornada: 'noche', tipo: 'dia', fechaInicio: dia(1) } })).status, 403);
  assert.equal((await pedir('PATCH', `/assignments/${una.id}`, { token: portero, cuerpo: { motivo: 'x' } })).status, 403);
  assert.equal((await pedir('POST', `/assignments/${una.id}/reassign`, { token: portero, cuerpo: { instructorId: 2, motivo: 'x' } })).status, 403);
  assert.equal((await pedir('POST', `/assignments/${una.id}/cancel`, { token: portero, cuerpo: { motivo: 'x' } })).status, 403);

  // Instructor: solo sus asignaciones, en la lista, el tablero, los ambientes y la revisión
  const mias = (await pedir('GET', '/assignments', { token: laura })).datos;
  assert.ok(mias.length && mias.every((a) => a.instructor.nombre === 'Laura Gómez Patiño'));
  const ajena = todas.find((a) => a.instructor.nombre !== 'Laura Gómez Patiño');
  assert.equal((await pedir('GET', `/assignments/${ajena.id}`, { token: laura })).status, 403);
  const tabLaura = (await pedir('GET', `/assignments/board?desde=${dia(0)}&dias=7`, { token: laura })).datos;
  assert.equal(tabLaura.soloMias, true);
  const celdas = tabLaura.ambientes.flatMap((a) => Object.values(a.celdas).flatMap((c) => Object.values(c))).filter(Boolean);
  assert.ok(celdas.length && celdas.every((c) => c.instructor === 'Laura Gómez Patiño'), 'en el tablero solo ve sus turnos');
  assert.ok(tabLaura.ambientes.every((a) => Object.values(a.celdas).some((c) => Object.values(c).some(Boolean))), 'y solo los ambientes donde está asignada');
  const ambLaura = (await pedir('GET', '/environments', { token: laura })).datos.find((a) => a.codigo === '107');
  assert.ok(ambLaura.asignadosHoy.every((j) => j.instructor === 'Laura Gómez Patiño'));
  const ambAndres = (await pedir('GET', '/environments', { token: andres })).datos.find((a) => a.codigo === '107');
  assert.deepEqual(ambAndres.asignadosHoy.map((j) => j.jornada), ['tarde'], 'Andrés solo ve su tarde en el 107');
  assert.equal((await pedir('POST', '/assignments', { token: laura, cuerpo: { ambienteId: amb107.id, instructorId: 1, jornada: 'noche', tipo: 'dia', fechaInicio: dia(1) } })).status, 403);
});

test('fines de semana, por semanas con días de la semana y tablero mensual', async (t) => {
  if (!await disponible()) { t.skip('API no disponible (enciende Apache y MySQL en XAMPP)'); return; }
  const admin = await ingresar('2020202020', 'administrativo');
  const usuarios = (await pedir('GET', '/users?rol=instructor', { token: admin })).datos;
  const id = (nombre) => usuarios.find((u) => u.nombre.startsWith(nombre)).id;
  const amb = (await pedir('GET', '/environments', { token: admin })).datos.find((a) => a.codigo === '108');
  const isoDia = (iso) => { const d = new Date(`${iso}T12:00:00`).getDay(); return d === 0 ? 7 : d; };
  // Próximo lunes (al menos dentro de una semana, para no chocar con hoy)
  let lunes = dia(7); while (isoDia(lunes) !== 1) lunes = (() => { const d = new Date(`${lunes}T12:00:00`); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  const sumar = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  // Fin de semana: un día entre semana no se acepta; el sábado sí
  const base = { ambienteId: amb.id, instructorId: id('Laura'), jornada: 'fin_semana', tipo: 'dia' };
  assert.equal((await pedir('POST', '/assignments', { token: admin, cuerpo: { ...base, fechaInicio: lunes } })).status, 422);
  const sab = await pedir('POST', '/assignments', { token: admin, cuerpo: { ...base, fechaInicio: sumar(lunes, 5) } });
  assert.equal(sab.status, 201, JSON.stringify(sab.datos));

  // Por semanas: 2 semanas, lunes y miércoles (Andrés) y martes y jueves (Diana) en la misma jornada: no chocan
  const semanas = { ambienteId: amb.id, jornada: 'manana', tipo: 'periodo', fechaInicio: lunes, fechaFin: sumar(lunes, 13) };
  const lm = await pedir('POST', '/assignments', { token: admin, cuerpo: { ...semanas, instructorId: id('Andrés'), diasSemana: [1, 3] } });
  assert.equal(lm.status, 201, JSON.stringify(lm.datos));
  assert.deepEqual(lm.datos.asignacion.diasSemana, [1, 3]);
  const mj = await pedir('POST', '/assignments', { token: admin, cuerpo: { ...semanas, instructorId: id('Diana'), diasSemana: [2, 4] } });
  assert.equal(mj.status, 201, JSON.stringify(mj.datos));
  // Pero otro periodo el lunes sí choca
  assert.equal((await pedir('POST', '/assignments', { token: admin, cuerpo: { ...semanas, instructorId: id('Laura'), diasSemana: [1] } })).status, 409);
  // Días de la semana inválidos
  assert.equal((await pedir('POST', '/assignments', { token: admin, cuerpo: { ...semanas, instructorId: id('Laura'), diasSemana: [9] } })).status, 422);

  // Tablero mensual (42 días): cada día muestra quien corresponde según el día de la semana
  const tab = (await pedir('GET', `/assignments/board?desde=${lunes}&dias=42&ambienteId=${amb.id}`, { token: admin })).datos;
  assert.equal(tab.fechas.length, 42);
  assert.ok(tab.jornadas.some((j) => j.clave === 'fin_semana'));
  const celdas = tab.ambientes[0].celdas;
  assert.equal(celdas[lunes].manana.instructor, 'Andrés Felipe Castro');
  assert.equal(celdas[sumar(lunes, 1)].manana.instructor, 'Diana Marcela Ruiz');
  assert.equal(celdas[sumar(lunes, 4)].manana, null);           // viernes: nadie
  assert.equal(celdas[sumar(lunes, 14)].manana, null);          // tercera semana: ya terminó
  assert.equal(celdas[sumar(lunes, 5)].fin_semana.instructor, 'Laura Gómez Patiño');
  assert.equal(celdas[lunes].fin_semana, null);                 // fin de semana no aplica el lunes
});
