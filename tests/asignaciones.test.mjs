// Reglas de la asignación de instructores por jornada. Ejecutar con: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarAsignacion, JORNADAS, TIPOS_ASIGNACION, ESTADOS_NOVEDAD } from '../js/reglas.js';

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
  assert.deepEqual(JORNADAS.map((j) => j.clave), ['manana', 'tarde', 'noche']);
  assert.deepEqual(TIPOS_ASIGNACION.map((t) => t.etiqueta), ['Por periodo', 'Por días', 'Sin tiempo definido']);
  // Por días: varios días sueltos
  assert.deepEqual(validarAsignacion({ ...base, tipo: 'dia', fechas: [HOY, '2026-10-09'] }, HOY), {});
  assert.ok(validarAsignacion({ ...base, tipo: 'dia', fechas: [] }, HOY).fechas);
  assert.ok(validarAsignacion({ ...base, tipo: 'dia', fechas: ['2026-09-30'] }, HOY).fechas);
  assert.equal(ESTADOS_NOVEDAD.en_curso[0], 'En curso');
});
