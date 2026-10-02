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
  const tablero = (await pedir('GET', `/assignments/board?desde=${dia(0)}&dias=4&ambienteId=${amb.id}`, { token: laura })).datos;
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

  // La revisión del instructor muestra quién está asignado hoy en cada jornada
  const diana = await ingresar('1010101012', 'instructor');
  const insp = (await pedir('POST', '/inspections', { token: diana, cuerpo: { ambienteId: amb.id } })).datos;
  assert.deepEqual(insp.asignadosHoy.map((j) => j.jornada), ['manana', 'tarde', 'noche']);
  assert.equal(insp.asignadosHoy[0].instructor, 'Diana Marcela Ruiz');
  await pedir('POST', `/inspections/${insp.id}/cancel`, { token: diana });
});
