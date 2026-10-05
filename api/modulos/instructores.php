<?php
/**
 * Instructores (administrativo): registrarlos, editarlos, activarlos o
 * desactivarlos y enviarles las credenciales. Igual que los aprendices de una
 * ficha, cada instructor nuevo recibe un correo (plantilla editable,
 * credenciales_instructor) con su documento, una contraseña temporal (la
 * genera el sistema o la escribe el administrativo) y el botón para ingresar;
 * en su primer ingreso confirma el correo y cambia la contraseña.
 */

/** Datos personales recibidos (instructor o aprendiz agregado a mano). → [tipo, documento, nombre, email, telefono] */
function datosPersona(array $d, int $excepto = 0): array
{
    $tipo = opcion($d, 'tipoDocumento', TIPOS_DOCUMENTO, false, 'el tipo de documento') ?? 'CC';
    $doc = preg_replace('/[.\s]/', '', (string) ($d['documento'] ?? ''));
    if (!preg_match('/^\d{6,12}$/', $doc)) fallar(422, 'El documento debe tener entre 6 y 12 dígitos.', 'VALIDACION');
    $nombre = preg_replace('/\s+/', ' ', texto($d, 'nombre', 120, true, 'el nombre completo'));
    if (mb_strlen($nombre) < 5) fallar(422, 'Escribe el nombre completo.', 'VALIDACION');
    $email = mb_strtolower(texto($d, 'email', 160, true, 'el correo'));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) fallar(422, 'El correo no es válido.', 'VALIDACION');
    $tel = texto($d, 'telefono', 20, false, 'el teléfono');
    if ($tel !== null && !preg_match('/^[0-9 +()-]{7,20}$/', $tel)) fallar(422, 'El teléfono no es válido.', 'VALIDACION');
    if ($otro = fila('SELECT id, rol FROM users WHERE documento = ? AND id <> ?', [$doc, $excepto])) {
        fallar(409, "Ya existe un usuario ({$otro['rol']}) con el documento $doc.", 'DUPLICADO');
    }
    if (fila('SELECT id FROM users WHERE email = ? AND id <> ?', [$email, $excepto])) fallar(409, "El correo $email ya lo usa otro usuario.", 'DUPLICADO');
    return [$tipo, $doc, $nombre, $email, $tel];
}

function instructorPublico(array $u): array
{
    return [
        'id' => (int) $u['id'], 'tipoDocumento' => $u['tipo_documento'], 'documento' => $u['documento'], 'nombre' => $u['nombre'],
        'email' => $u['email'], 'telefono' => $u['telefono'], 'activo' => (bool) $u['activo'],
        'primerIngresoPendiente' => (bool) $u['debe_cambiar_password'], 'emailVerificado' => !empty($u['email_verificado_en']),
        'credencialesEnviadasEn' => iso($u['credenciales_enviadas_en']),
        'fichas' => array_column(filas('SELECT codigo FROM fichas WHERE instructor_id = ? AND activo = 1 ORDER BY codigo', [(int) $u['id']]), 'codigo'),
        'asignacionesVigentes' => (int) fila("SELECT COUNT(*) n FROM instructor_assignments WHERE instructor_id = ? AND estado = 'vigente' AND COALESCE(fecha_fin, '9999-12-31') >= CURDATE()", [(int) $u['id']])['n'],
    ];
}

function buscarInstructor(int $id): array
{
    $u = fila("SELECT * FROM users WHERE id = ? AND rol = 'instructor'", [$id]);
    if (!$u) fallar(404, 'El instructor no existe.', 'NO_ENCONTRADO');
    return $u;
}

/** GET /instructors (administrativo): todos, activos primero. */
function rutaInstructores(): never
{
    exigirRol('administrativo');
    responder(array_map('instructorPublico', filas("SELECT * FROM users WHERE rol = 'instructor' ORDER BY activo DESC, nombre")));
}

/**
 * POST /instructors {tipoDocumento?, documento, nombre, email, telefono?, clave?, correo?: {asunto, cuerpo}, guardarPlantilla?}
 * Crea el instructor con contraseña temporal y le envía las credenciales.
 */
function rutaCrearInstructor(): never
{
    $admin = exigirRol('administrativo');
    $d = cuerpo();
    [$tipo, $doc, $nombre, $email, $tel] = datosPersona($d);
    $op = opcionesCredenciales($d, 'credenciales_instructor', (int) $admin['id']);
    $clave = $op['clave'] ?? passwordTemporal();
    db()->begin_transaction();
    $id = insertar("INSERT INTO users (tipo_documento, documento, nombre, email, telefono, rol, password_hash, debe_cambiar_password) VALUES (?, ?, ?, ?, ?, 'instructor', ?, 1)",
        [$tipo, $doc, $nombre, $email, $tel, password_hash($clave, PASSWORD_BCRYPT)]);
    $correo = enviarCredenciales(fila('SELECT * FROM users WHERE id = ?', [$id]), $clave, null, $op['plantilla']);
    db()->commit();
    responder(['instructor' => instructorPublico(buscarInstructor($id)), 'correo' => $correo], 201);
}

/** PATCH /instructors/{id} {tipoDocumento?, documento, nombre, email, telefono?, activo?} */
function rutaEditarInstructor(int $id): never
{
    exigirRol('administrativo');
    $antes = buscarInstructor($id);
    $d = cuerpo();
    [$tipo, $doc, $nombre, $email, $tel] = datosPersona($d + ['documento' => $antes['documento'], 'tipoDocumento' => $antes['tipo_documento']], $id);
    $activo = array_key_exists('activo', $d) ? (int) (bool) $d['activo'] : (int) $antes['activo'];
    consulta('UPDATE users SET tipo_documento = ?, documento = ?, nombre = ?, email = ?, telefono = ?, activo = ?,
                     email_verificado_en = IF(email = ?, email_verificado_en, NULL) WHERE id = ?',
        [$tipo, $doc, $nombre, $email, $tel, $activo, $email, $id]);
    if (!$activo) consulta('DELETE FROM api_tokens WHERE user_id = ?', [$id]);
    responder(instructorPublico(buscarInstructor($id)));
}

/** POST /instructors/{id}/credentials {clave?, correo?, guardarPlantilla?}: contraseña temporal nueva, correo y primer ingreso de nuevo. */
function rutaCredencialesInstructor(int $id): never
{
    $admin = exigirRol('administrativo');
    $u = buscarInstructor($id);
    if (!$u['activo']) fallar(409, 'El instructor está desactivado.', 'ESTADO');
    $op = opcionesCredenciales(cuerpo(), 'credenciales_instructor', (int) $admin['id']);
    $clave = $op['clave'] ?? passwordTemporal();
    consulta('UPDATE users SET password_hash = ?, debe_cambiar_password = 1 WHERE id = ?', [password_hash($clave, PASSWORD_BCRYPT), $id]);
    consulta('DELETE FROM api_tokens WHERE user_id = ?', [$id]);
    $correo = enviarCredenciales(buscarInstructor($id), $clave, null, $op['plantilla']);
    responder(['instructor' => instructorPublico(buscarInstructor($id)), 'correo' => $correo]);
}
