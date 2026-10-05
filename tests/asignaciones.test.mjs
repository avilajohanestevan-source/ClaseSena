// Reglas de la asignación de instructores por jornada. Ejecutar con: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarAsignacion, JORNADAS, TIPOS_ASIGNACION, MODOS_ASIGNACION, ESTADOS_NOVEDAD, rangoSemanas, describirDiasSemana, diaSemana } from '../js/reglas.js';

const HOY = '2026-10-02';
const base = { ambienteId: 1, instructorId: 2, jornada: 'manana', fechaInicio: HOY };

test('asignación por día, por periodo y permanente', () => {
  assert.deepEqual(validarAsignacion({ ...base, tipo: 'dia' }, HOY), {});
  assert.deepEqual(validarAsignacion({ ...base, tipo: 'permanente' }, HOY), {});
  assert.deepEqual(validarAsignacion({ ...base, tipo: 'periodo', fechaFin: '2026-10-30' }, HOY), {});
  assert.ok(validarAsignacion({ ...base, tipo: 'periodo' }, HOY).fechaFin, 'el periodo necesita fecha final');
  assert.ok(validarAsignacion({ ...base, tipo: 'periodo', fechaFin: '2026-09-30' }, HOY).fechaFin, 'fin antes del inicio');
  assert.ok(validarAsignacion({ ...base, tipo: 'periodo', fechaFin: '2027-12-31' }, HOY).fechaFin, 'máximo un año');
});

test('asignación: campos obligatorios y fechas pasadas', () => {
  const e = validarAsignacion({ tipo: 'x', jornada: 'madrugada' }, HOY);
  assert.ok(e.ambienteId && e.instructorId && e.jornada && e.tipo && e.fechaInicio);
  assert.ok(validarAsignacion({ ...base, tipo: 'dia', fechaInicio: '2026-10-01' }, HOY).fechaInicio, 'un día que ya pasó');
  // Un permanente que empezó antes sigue siendo válido (no tiene fin)
  assert.deepEqual(validarAsignacion({ ...base, tipo: 'permanente', fechaInicio: '2026-09-01' }, HOY), {});
  assert.deepEqual(JORNADAS.map((j) => j.clave), ['manana', 'tarde', 'noche', 'fin_semana']);
  assert.deepEqual(TIPOS_ASIGNACION.map((t) => t.etiqueta), ['Por rango de fechas', 'Por días', 'Sin definir']);
  assert.deepEqual(MODOS_ASIGNACION.map((t) => t.etiqueta), ['Sin definir', 'Por semanas', 'Por días', 'Por rango de fechas']);
  // Por días: varios días sueltos
  assert.deepEqual(validarAsignacion({ ...base, tipo: 'dia', fechas: [HOY, '2026-10-09'] }, HOY), {});
  assert.ok(validarAsignacion({ ...base, tipo: 'dia', fechas: [] }, HOY).fechas);
  assert.ok(validarAsignacion({ ...base, tipo: 'dia', fechas: ['2026-09-30'] }, HOY).fechas);
  assert.equal(ESTADOS_NOVEDAD.en_curso[0], 'En curso');
});

test('por semanas y fines de semana', () => {
  // 2026-10-02 es viernes: la semana empieza el lunes 2026-09-28, pero ya pasó → desde hoy
  assert.equal(diaSemana('2026-10-02'), 5);
  assert.equal(diaSemana('2026-10-04'), 7);
  assert.deepEqual(rangoSemanas('2026-10-02', 2, HOY), { fechaInicio: HOY, fechaFin: '2026-10-11' });
  assert.deepEqual(rangoSemanas('2026-10-07', 1, HOY), { fechaInicio: '2026-10-05', fechaFin: '2026-10-11' });
  assert.equal(describirDiasSemana([1, 3, 5]), 'lun, mié, vie');
  assert.equal(describirDiasSemana([1, 2, 3, 4, 5, 6, 7]), '');
  const semanas = { ...base, tipo: 'periodo', fechaInicio: '2026-10-05', fechaFin: '2026-10-18' };
  assert.deepEqual(validarAsignacion({ ...semanas, diasSemana: [1, 3] }, HOY), {});
  assert.ok(validarAsignacion({ ...semanas, diasSemana: [] }, HOY).diasSemana, 'al menos un día');
  assert.ok(validarAsignacion({ ...semanas, jornada: 'fin_semana', diasSemana: [1, 2] }, HOY).diasSemana, 'fin de semana sin sábado ni domingo');
  // Jornada de fin de semana por días: solo sábados y domingos
  assert.deepEqual(validarAsignacion({ ...base, jornada: 'fin_semana', tipo: 'dia', fechas: ['2026-10-03', '2026-10-04'] }, HOY), {});
  assert.ok(validarAsignacion({ ...base, jornada: 'fin_semana', tipo: 'dia', fechas: ['2026-10-05'] }, HOY).fechas);
});
