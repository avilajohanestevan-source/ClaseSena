// Fichas, aprendices y asistencia contra la API real:
//  · importar aprendices (CSV) a una ficha → usuarios con contraseña temporal y
//    correo con credenciales; el primer ingreso obliga a confirmar el correo
//    con un código y cambiar la contraseña;
//  · programar una clase, QR del instructor, escaneo del aprendiz (presente,
//    duplicado, otra ficha, P004);
//  · excusa con foto y periodo → aprobada → faltas justificadas en el semáforo.
//   npm run test:api   (Apache y MySQL encendidos, base instalada con db/instalar.php)
import { test } from 'node:test';
import assert from 'node:assert/strict';

const API = process.env.API || 'http://localhost/sena-ambientes/api/index.php';
const CLAVE = 'Sena2026*';
const FOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function pedir(metodo, ruta, { token, cuerpo } = {}) {
  const r = await fetch(API + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  return { status: r.status, datos: r.status === 204 ? null : await r.json() };
}
const login = (identificacion, rol, password = CLAVE) => pedir('POST', '/auth/login', { cuerpo: { identificacion, password, rol } });
const ingresar = async (identificacion, rol) => (await login(identificacion, rol)).datos.token;
const disponible = () => fetch(API + '/me').then(() => true, () => false);
const hoy = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const csv = (filas) => `data:text/csv;base64,${Buffer.from(filas.join('\n'), 'utf8').toString('base64')}`;

test('fichas: importar aprendices, credenciales por correo y primer ingreso obligatorio', async (t) => {
  if (!await disponible()) { t.skip('API no disponible (enciende Apache y MySQL en XAMPP)'); return; }
  const admin = await ingresar('2020202020', 'administrativo');
  const instructor = await ingresar('1010101010', 'instructor');
  const sufijo = String(Date.now()).slice(-6);

  // Crear ficha (solo administrativo)
  const datosFicha = { codigo: `99${sufijo}`, programa: 'Programa de prueba', jornada: 'tarde', ambienteId: 2, instructorId: 1 };
  assert.equal((await pedir('POST', '/fichas', { token: instructor, cuerpo: datosFicha })).status, 403);
  const ficha = await pedir('POST', '/fichas', { token: admin, cuerpo: datosFicha });
  assert.equal(ficha.status, 201, JSON.stringify(ficha.datos));
  assert.equal((await pedir('POST', '/fichas', { token: admin, cuerpo: datosFicha })).status, 409);

  // Vista previa: 2 nuevos, 1 actualizado (Camila ya existe y pasa a esta ficha), 3 con error
  const doc1 = `77${sufijo}1`, doc2 = `77${sufijo}2`;
  const archivo = csv([
    'tipo_documento;documento;nombre;email;telefono',
    `CC;${doc1};Aprendiz Uno Prueba;uno.${sufijo}@soy.sena.edu.co;3001112222`,
    `TI;${doc2};Aprendiz Dos Prueba;dos.${sufijo}@soy.sena.edu.co;`,
    'TI;1122334455;Camila Rojas Herrera;crojas@soy.sena.edu.co;',
    'CC;12;Documento corto;corto@soy.sena.edu.co;',
    `CC;88${sufijo}3;Correo malo;no-es-correo;`,
    `CC;4040404040;Un portero;portero.${sufijo}@sena.edu.co;`,
  ]);
  const previa = await pedir('POST', `/fichas/${ficha.datos.id}/students/import`, { token: admin, cuerpo: { nombre: 'aprendices.csv', archivo, simular: true } });
  assert.equal(previa.status, 200, JSON.stringify(previa.datos));
  assert.deepEqual([previa.datos.nuevos, previa.datos.actualizados, previa.datos.errores.length, previa.datos.correos], [2, 1, 3, 0]);
  assert.equal((await pedir('GET', `/fichas/${ficha.datos.id}`, { token: admin })).datos.listaAprendices.length, 0, 'la vista previa no guarda');

  // Importar de verdad: correos con credenciales en la bandeja de salida
  const imp = await pedir('POST', `/fichas/${ficha.datos.id}/students/import`, { token: admin, cuerpo: { nombre: 'aprendices.csv', archivo } });
  assert.equal(imp.status, 200, JSON.stringify(imp.datos));
  assert.equal(imp.datos.correos, 2);
  const detalle = (await pedir('GET', `/fichas/${ficha.datos.id}`, { token: admin })).datos;
  assert.equal(detalle.listaAprendices.length, 3);
  const uno = detalle.listaAprendices.find((a) => a.documento === doc1);
  assert.ok(uno.primerIngresoPendiente && uno.credencialesEnviadasEn);
  const correos = (await pedir('GET', `/mail-outbox?userId=${uno.id}`, { token: admin })).datos;
  assert.equal(correos.length, 1);
  assert.match(correos[0].asunto, /credenciales/i);
  const temporal = /Contraseña temporal: (\S+)/.exec(correos[0].cuerpo)[1];
  assert.equal((await pedir('GET', '/mail-outbox', { token: instructor })).status, 403);

  // Primer ingreso: con la temporal entra, pero todo lo demás responde 403 PRIMER_INGRESO
  const sesion = await login(doc1, 'aprendiz', temporal);
  assert.equal(sesion.status, 200, JSON.stringify(sesion.datos));
  assert.equal(sesion.datos.usuario.debeCambiarPassword, true);
  const tok = sesion.datos.token;
  const bloqueado = await pedir('GET', '/sessions', { token: tok });
  assert.equal(bloqueado.status, 403);
  assert.equal(bloqueado.datos.codigo, 'PRIMER_INGRESO');
  assert.equal((await pedir('GET', '/me', { token: tok })).status, 200);
  // Sin código no se puede; con el código del correo y una contraseña nueva, sí
  assert.equal((await pedir('POST', '/me/first-login', { token: tok, cuerpo: { codigo: '000000', nueva: 'NuevaClave2026' } })).status, 422);
  const codigo = await pedir('POST', '/me/first-login/code', { token: tok, cuerpo: {} });
  assert.equal(codigo.status, 200, JSON.stringify(codigo.datos));
  const correoCodigo = (await pedir('GET', `/mail-outbox?userId=${uno.id}`, { token: admin })).datos[0];
  const elCodigo = /\b(\d{6})\b/.exec(correoCodigo.asunto)[1];
  assert.equal((await pedir('POST', '/me/first-login', { token: tok, cuerpo: { codigo: elCodigo === '111111' ? '222222' : '111111', nueva: 'NuevaClave2026' } })).status, 422);
  assert.equal((await pedir('POST', '/me/first-login', { token: tok, cuerpo: { codigo: elCodigo, nueva: 'corta' } })).status, 422);
  assert.equal((await pedir('POST', '/me/first-login', { token: tok, cuerpo: { codigo: elCodigo, nueva: temporal } })).status, 422, 'debe ser distinta de la temporal');
  const listo = await pedir('POST', '/me/first-login', { token: tok, cuerpo: { codigo: elCodigo, nueva: 'NuevaClave2026' } });
  assert.equal(listo.status, 200, JSON.stringify(listo.datos));
  assert.equal(listo.datos.debeCambiarPassword, false);
  assert.equal(listo.datos.emailVerificado, true);
  assert.equal((await pedir('GET', '/sessions', { token: tok })).status, 200);
  assert.equal((await login(doc1, 'aprendiz', temporal)).status, 401, 'la temporal ya no sirve');
  assert.equal((await login(doc1, 'aprendiz', 'NuevaClave2026')).status, 200);

  // Reenviar credenciales vuelve a pedir el primer ingreso
  const re = await pedir('POST', `/fichas/${ficha.datos.id}/students/${uno.id}/credentials`, { token: admin });
  assert.equal(re.status, 200, JSON.stringify(re.datos));
  assert.equal(re.datos.aprendiz.primerIngresoPendiente, true);
  // Camila vuelve a su ficha para no afectar otras pruebas
  await pedir('POST', `/fichas/1/students/import`, { token: admin, cuerpo: { nombre: 'c.csv', archivo: csv(['documento;nombre;email', '1122334455;Camila Rojas Herrera;crojas@soy.sena.edu.co']) } });
});

test('clase: programar, QR del instructor y registro de entrada del aprendiz', async (t) => {
  if (!await disponible()) { t.skip('API no disponible (enciende Apache y MySQL en XAMPP)'); return; }
  const andres = await ingresar('1010101011', 'instructor');   // líder de la ficha 2901122 (cocina)
  const laura = await ingresar('1010101010', 'instructor');
  const natalia = await ingresar('1122334468', 'aprendiz');    // 2901122
  const esteban = await ingresar('1122334469', 'aprendiz');    // 2901122
  const sara = await ingresar('1122334457', 'aprendiz');       // 2834519

  // Andrés programa una clase que empezó hace un minuto (ventana de 20 min)
  const ahora = new Date();
  const hh = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const fin = new Date(ahora.getTime() + 60 * 60_000);
  const datos = { fichaId: 3, competencia: 'Cocina colombiana', fecha: hoy(), horaInicio: hh(new Date(ahora.getTime() - 60_000)), horaFin: hh(fin) > hh(ahora) ? hh(fin) : '23:59', ventanaMin: 20 };
  assert.equal((await pedir('POST', '/sessions', { token: natalia, cuerpo: datos })).status, 403);
  const nueva = await pedir('POST', '/sessions', { token: andres, cuerpo: datos });
  assert.ok([201, 409].includes(nueva.status), JSON.stringify(nueva.datos)); // 409 si la prueba se repite en el mismo minuto
  const clases = (await pedir('GET', `/sessions?fecha=${hoy()}&ficha=2901122`, { token: andres })).datos;
  const abierta = clases.find((c) => !c.cancelada && Date.parse(c.startTime) <= Date.now() && Date.parse(c.startTime) + c.ventanaMin * 60_000 > Date.now());
  assert.ok(abierta, 'la clase recién programada tiene la ventana abierta');
  assert.equal(abierta.competencia, 'Cocina colombiana');
  assert.ok(abierta.inscritos >= 3);

  // Solo su instructor genera el QR
  assert.equal((await pedir('POST', `/sessions/${abierta.id}/qr`, { token: laura, cuerpo: { validezSeg: 60 } })).status, 403);
  const qr = await pedir('POST', `/sessions/${abierta.id}/qr`, { token: andres, cuerpo: { validezSeg: 60 } });
  assert.equal(qr.status, 200, JSON.stringify(qr.datos));
  assert.ok(qr.datos.texto.startsWith('SENA-ASIS:'));
  const payload = qr.datos.payload;

  // Escaneos: QR falso, otra ficha, aceptado y duplicado
  assert.equal((await pedir('POST', '/attendance/scan', { token: natalia, cuerpo: { payload: { ...payload, nonce: 'falso' } } })).datos.codigo, 'QR_INVALIDO');
  assert.equal((await pedir('POST', '/attendance/scan', { token: sara, cuerpo: { payload } })).datos.codigo, 'NO_INSCRITO');
  const ok = await pedir('POST', '/attendance/scan', { token: natalia, cuerpo: { payload, scannedAt: new Date().toISOString() } });
  assert.ok(ok.datos.resultado === 'aceptado' || ok.datos.codigo === 'DUPLICADO', JSON.stringify(ok.datos));
  if (ok.datos.resultado === 'aceptado') assert.equal(ok.datos.estado, 'presente');
  assert.equal((await pedir('POST', '/attendance/scan', { token: natalia, cuerpo: { payload } })).datos.codigo, 'DUPLICADO');

  // El instructor ve los registros; el aprendiz solo los suyos
  const registros = (await pedir('GET', `/sessions/${abierta.id}/attendance`, { token: andres })).datos;
  assert.ok(registros.some((r) => r.documento === '1122334468'));
  const mias = (await pedir('GET', '/attendance', { token: natalia })).datos;
  assert.ok(mias.length && mias.every((r) => r.documento === '1122334468'));

  // Horario del aprendiz: ficha, profesor y ambiente
  const horario = (await pedir('GET', '/my/schedule', { token: esteban })).datos;
  assert.equal(horario.ficha.codigo, '2901122');
  assert.ok(horario.clases.length && horario.clases.every((c) => c.instructor && c.ambiente));

  // Cancelar: deshabilita el QR y el registro, y avisa a coordinación
  const cancelar = await pedir('POST', `/sessions/${abierta.id}/cancel`, { token: andres, cuerpo: { motivo: 'Prueba automática de cancelación' } });
  assert.equal(cancelar.status, 200);
  assert.equal((await pedir('POST', `/sessions/${abierta.id}/qr`, { token: andres, cuerpo: {} })).status, 409);
  assert.equal((await pedir('POST', '/attendance/scan', { token: esteban, cuerpo: { payload } })).datos.codigo, 'CANCELADA');
});

test('excusas con foto y periodo; aprobada justifica las faltas; semáforo y P004', async (t) => {
  if (!await disponible()) { t.skip('API no disponible (enciende Apache y MySQL en XAMPP)'); return; }
  const admin = await ingresar('2020202020', 'administrativo');
  const diana = await ingresar('1010101012', 'instructor');   // líder de la 2834519
  const andres = await ingresar('1010101011', 'instructor');  // no dicta en la 2834519
  const kevin = await ingresar('1122334465', 'aprendiz');     // 2834519, rojo y aplazado

  const antes = (await pedir('GET', '/students/absences?ficha=2834519', { token: admin })).datos.find((x) => x.documento === '1122334465');
  assert.ok(antes.faltasConsecutivas >= 4, 'Kevin empieza en rojo');
  // Excusa de los últimos días (cubre sus faltas recientes)
  const desde = new Date(Date.now() - 9 * 86_400_000);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  assert.equal((await pedir('POST', '/excuses', { token: kevin, cuerpo: { desde: iso(desde), hasta: iso(new Date(Date.now() - 86_400_000)), motivo: 'Incapacidad' } })).status, 422, 'motivo corto y sin foto');
  const ex = await pedir('POST', '/excuses', { token: kevin, cuerpo: { desde: iso(desde), hasta: iso(new Date(Date.now() - 86_400_000)), motivo: 'Incapacidad médica por cirugía menor.', foto: FOTO } });
  assert.equal(ex.status, 201, JSON.stringify(ex.datos));
  assert.equal(ex.datos.estado, 'pendiente');
  assert.ok(ex.datos.clasesCubiertas > 0);
  // Avisos al instructor líder
  assert.ok((await pedir('GET', '/inbox', { token: diana })).datos.notificaciones.some((n) => n.tipo === 'excusa'));
  // Andrés no la ve ni la revisa; Diana la aprueba
  assert.ok(!(await pedir('GET', '/excuses?estado=pendiente', { token: andres })).datos.some((x) => x.id === ex.datos.id));
  assert.equal((await pedir('POST', `/excuses/${ex.datos.id}/review`, { token: andres, cuerpo: { estado: 'aprobada' } })).status, 403);
  assert.equal((await pedir('POST', `/excuses/${ex.datos.id}/review`, { token: diana, cuerpo: { estado: 'rechazada' } })).status, 422, 'rechazar exige motivo');
  const ap = await pedir('POST', `/excuses/${ex.datos.id}/review`, { token: diana, cuerpo: { estado: 'aprobada', observacion: 'Soporte revisado' } });
  assert.equal(ap.status, 200, JSON.stringify(ap.datos));
  assert.ok((await pedir('GET', '/inbox', { token: kevin })).datos.notificaciones.some((n) => n.tipo === 'excusa_revisada'));

  // Sus faltas de esos días quedan justificadas y bajan del semáforo
  const despues = (await pedir('GET', '/students/absences?ficha=2834519', { token: admin })).datos.find((x) => x.documento === '1122334465');
  assert.ok(despues.justificadas > 0);
  assert.ok(despues.faltasTotales < antes.faltasTotales);
  assert.ok(despues.faltasConsecutivas < antes.faltasConsecutivas);
  // Aviso de riesgo (rojo) a coordinación: Mateo de la 2758432
  await pedir('GET', '/students/absences', { token: admin });
  assert.ok((await pedir('GET', '/notifications', { token: admin })).datos.some((n) => n.tipo === 'riesgo'));

  // P004: Kevin está aplazado; el administrativo lo pasa a EN FORMACION
  const p004 = (await pedir('GET', '/p004', { token: admin })).datos;
  assert.equal(p004.find((r) => r.documento === '1122334465').estado, 'APLAZADO');
  const cambio = await pedir('PATCH', '/p004/1122334465', { token: admin, cuerpo: { estado: 'EN FORMACION' } });
  assert.equal(cambio.status, 200, JSON.stringify(cambio.datos));
  assert.equal(cambio.datos.actualizadoPor, 'Carlos Méndez Ruiz');
  assert.equal((await pedir('GET', '/p004', { token: diana })).status, 403);
});
