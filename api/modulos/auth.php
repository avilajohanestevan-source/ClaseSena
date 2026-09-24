<?php
/** Autenticación, perfil y listado de usuarios. */

const ROLES = ['instructor', 'administrativo', 'portero', 'aprendiz'];

function rutaLogin(): never
{
    $d = cuerpo();
    $documento = texto($d, 'identificacion', 12, true, 'el número de documento');
    $password = (string) ($d['password'] ?? '');
    $rol = opcion($d, 'rol', ROLES, true, 'el rol');
    if (!ctype_digit($documento) || strlen($documento) < 6) fallar(422, 'El documento debe tener entre 6 y 12 dígitos.', 'VALIDACION');

    $u = fila('SELECT * FROM users WHERE documento = ?', [$documento]);
    // Mismo mensaje si el documento no existe o la contraseña no coincide.
    if (!$u || !password_verify($password, $u['password_hash'])) {
        fallar(401, 'Documento o contraseña incorrectos.', 'CREDENCIALES');
    }
    if (!$u['activo']) fallar(423, 'La cuenta está desactivada. Comunícate con coordinación.', 'BLOQUEADA');
    if ($u['rol'] !== $rol) fallar(403, 'Tu usuario no tiene el rol seleccionado.', 'ROL');
    if (!empty($d['tipoDocumento']) && $d['tipoDocumento'] !== $u['tipo_documento']) {
        fallar(401, 'Documento o contraseña incorrectos.', 'CREDENCIALES');
    }

    consulta('DELETE FROM api_tokens WHERE expires_at < NOW()');
    $token = bin2hex(random_bytes(32));
    insertar('INSERT INTO api_tokens (token, user_id, expires_at) VALUES (?, ?, NOW() + INTERVAL ? HOUR)', [$token, (int) $u['id'], HORAS_SESION]);
    responder(['token' => $token, 'usuario' => usuarioPublico($u)]);
}

function rutaLogout(): never
{
    $token = tokenDeLaPeticion();
    if ($token) consulta('DELETE FROM api_tokens WHERE token = ?', [$token]);
    responder(null, 204);
}

function rutaYo(): never
{
    responder(usuarioPublico(usuario()));
}

function rutaActualizarPerfil(): never
{
    $u = usuario();
    $d = cuerpo();
    $nombre = texto($d, 'nombre', 120, true, 'el nombre');
    $email = texto($d, 'email', 160, false, 'el correo');
    $telefono = texto($d, 'telefono', 20, false, 'el teléfono');
    if ($email !== null && !filter_var($email, FILTER_VALIDATE_EMAIL)) fallar(422, 'El correo no es válido.', 'VALIDACION');
    if ($telefono !== null && !preg_match('/^[0-9 +()-]{7,20}$/', $telefono)) fallar(422, 'El teléfono no es válido.', 'VALIDACION');
    consulta('UPDATE users SET nombre = ?, email = ?, telefono = ? WHERE id = ?', [$nombre, $email, $telefono, (int) $u['id']]);
    responder(usuarioPublico(fila('SELECT * FROM users WHERE id = ?', [(int) $u['id']])));
}

function rutaCambiarPassword(): never
{
    $u = usuario();
    $d = cuerpo();
    if (!password_verify((string) ($d['actual'] ?? ''), $u['password_hash'])) fallar(422, 'La contraseña actual no coincide.', 'VALIDACION');
    $nueva = (string) ($d['nueva'] ?? '');
    if (strlen($nueva) < 8 || !preg_match('/[A-Za-z]/', $nueva) || !preg_match('/\d/', $nueva)) {
        fallar(422, 'La nueva contraseña debe tener al menos 8 caracteres, con letras y números.', 'VALIDACION');
    }
    consulta('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash($nueva, PASSWORD_BCRYPT), (int) $u['id']]);
    // Cierra las otras sesiones abiertas de este usuario.
    consulta('DELETE FROM api_tokens WHERE user_id = ? AND token <> ?', [(int) $u['id'], tokenDeLaPeticion()]);
    responder(null, 204);
}

/** Lista para selects (porteros, instructores). Solo administrativos. */
function rutaUsuarios(): never
{
    exigirRol('administrativo');
    $rol = opcion($_GET, 'rol', ROLES, false);
    $sql = 'SELECT * FROM users WHERE activo = 1' . ($rol ? ' AND rol = ?' : '') . ' ORDER BY nombre';
    responder(array_map('usuarioPublico', filas($sql, $rol ? [$rol] : [])));
}
