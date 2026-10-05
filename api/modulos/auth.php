<?php
/** Autenticación, perfil y listado de usuarios. */

const ROLES = ['instructor', 'administrativo', 'portero', 'aprendiz', 'almacen'];

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
    permitirPrimerIngreso();
    responder(usuarioPublico(usuario()));
}

/** "camila.rojas@soy.sena.edu.co" → "ca•••••••••@soy.sena.edu.co" */
function correoOculto(string $email): string
{
    [$usuario, $dominio] = explode('@', $email) + [1 => ''];
    return mb_substr($usuario, 0, 2) . str_repeat('•', max(3, mb_strlen($usuario) - 2)) . '@' . $dominio;
}

/**
 * POST /me/first-login/code {email?}: primer ingreso, paso 1. Envía un código
 * de 6 dígitos (vale 15 minutos) al correo del usuario (o al que escriba, si
 * lo corrige). En modo 'registro' la respuesta trae codigoDemo para la demostración.
 */
function rutaCodigoPrimerIngreso(): never
{
    permitirPrimerIngreso();
    $u = usuario();
    if (!(int) $u['debe_cambiar_password']) fallar(409, 'Ya hiciste tu primer ingreso.', 'ESTADO');
    $email = texto(cuerpo(), 'email', 160, false, 'el correo') ?? $u['email'];
    if (!$email || !filter_var($email, FILTER_VALIDATE_EMAIL)) fallar(422, 'Escribe un correo válido.', 'VALIDACION');
    $codigo = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
    consulta('UPDATE users SET email = ?, codigo_verificacion = ?, codigo_expira = NOW() + INTERVAL 15 MINUTE WHERE id = ?', [$email, $codigo, (int) $u['id']]);
    enviarCorreo((int) $u['id'], $email, "Tu código de verificación: $codigo",
        "Hola, " . explode(' ', $u['nombre'])[0] . ":

Tu código para confirmar este correo en Ambientes SENA es:

    $codigo

Vence en 15 minutos. Si no lo pediste, ignora este mensaje.
");
    responder(['enviadoA' => correoOculto($email), 'expiraEn' => iso(date('Y-m-d H:i:s', time() + 900))]
        + (CORREO_MODO === 'registro' ? ['codigoDemo' => $codigo] : []));
}

/**
 * POST /me/first-login {codigo, nueva}: primer ingreso, paso 2. Con el código
 * correcto confirma el correo y cambia la contraseña temporal por la nueva.
 */
function rutaPrimerIngreso(): never
{
    permitirPrimerIngreso();
    $u = usuario();
    if (!(int) $u['debe_cambiar_password']) fallar(409, 'Ya hiciste tu primer ingreso.', 'ESTADO');
    $d = cuerpo();
    $codigo = trim((string) ($d['codigo'] ?? ''));
    if (!$u['codigo_verificacion'] || !$u['codigo_expira']) fallar(422, 'Primero pide el código de verificación.', 'VALIDACION');
    if (strtotime($u['codigo_expira']) < time()) fallar(422, 'El código venció. Pide uno nuevo.', 'CODIGO_VENCIDO');
    if (!hash_equals($u['codigo_verificacion'], $codigo)) fallar(422, 'El código no coincide. Revisa el correo.', 'CODIGO');
    $nueva = (string) ($d['nueva'] ?? '');
    validarPasswordNueva($nueva);
    if (password_verify($nueva, $u['password_hash'])) fallar(422, 'La nueva contraseña debe ser distinta de la temporal.', 'VALIDACION');
    consulta('UPDATE users SET password_hash = ?, debe_cambiar_password = 0, email_verificado_en = NOW(), codigo_verificacion = NULL, codigo_expira = NULL WHERE id = ?',
        [password_hash($nueva, PASSWORD_BCRYPT), (int) $u['id']]);
    consulta('DELETE FROM api_tokens WHERE user_id = ? AND token <> ?', [(int) $u['id'], tokenDeLaPeticion()]);
    responder(usuarioPublico(fila('SELECT * FROM users WHERE id = ?', [(int) $u['id']])));
}

function validarPasswordNueva(string $nueva): void
{
    if (strlen($nueva) < 8 || !preg_match('/[A-Za-z]/', $nueva) || !preg_match('/\d/', $nueva)) {
        fallar(422, 'La nueva contraseña debe tener al menos 8 caracteres, con letras y números.', 'VALIDACION');
    }
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
    validarPasswordNueva($nueva);
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
