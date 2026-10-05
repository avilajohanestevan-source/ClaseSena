<?php
/**
 * Correos de la app: credenciales de los aprendices importados y códigos de
 * verificación del primer ingreso. Todos quedan en la tabla correos; con
 * CORREO_MODO = 'mail' además se envían con mail() de PHP.
 */

/** Registra (y, si está configurado, envía) un correo. → ['id' => …, 'estado' => registrado|enviado|error] */
function enviarCorreo(?int $userId, string $para, string $asunto, string $cuerpo): array
{
    $estado = 'registrado';
    $error = null;
    if (CORREO_MODO === 'mail') {
        $cabeceras = 'From: ' . CORREO_REMITENTE . "\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8";
        $ok = @mail($para, '=?UTF-8?B?' . base64_encode($asunto) . '?=', $cuerpo, $cabeceras);
        $estado = $ok ? 'enviado' : 'error';
        if (!$ok) $error = 'mail() no pudo enviar el correo: revisa la configuración SMTP de PHP.';
    }
    $id = insertar('INSERT INTO correos (user_id, para, asunto, cuerpo, estado, error) VALUES (?, ?, ?, ?, ?, ?)',
        [$userId, $para, mb_substr($asunto, 0, 200), $cuerpo, $estado, $error]);
    return ['id' => $id, 'estado' => $estado];
}

/** Contraseña temporal legible que cumple la regla (8+ caracteres, letras y números): "Sena-4821-kq". */
function passwordTemporal(): string
{
    $letras = 'abcdefghjkmnpqrstuvwxyz';
    return 'Sena-' . random_int(1000, 9999) . '-' . $letras[random_int(0, strlen($letras) - 1)] . $letras[random_int(0, strlen($letras) - 1)];
}

/** Correo con el usuario y la contraseña temporal; marca credenciales_enviadas_en. */
function enviarCredenciales(array $u, string $clave, ?array $ficha = null): array
{
    $nombre = explode(' ', $u['nombre'])[0];
    $cuerpo = "Hola, $nombre:\n\n"
        . ($ficha ? "Te inscribieron en la ficha {$ficha['codigo']} ({$ficha['programa']}) del SENA.\n\n" : '')
        . "Tus datos para ingresar a Ambientes SENA:\n\n"
        . "  Dirección: " . URL_APP . "\n"
        . "  Ingresar como: Aprendiz\n"
        . "  Documento: {$u['tipo_documento']} {$u['documento']}\n"
        . "  Contraseña temporal: $clave\n\n"
        . "La primera vez que ingreses te pediremos confirmar este correo con un código y cambiar la contraseña.\n\n"
        . "Si no esperabas este mensaje, comunícate con coordinación académica.\n";
    $r = enviarCorreo((int) $u['id'], $u['email'], 'Tus credenciales de Ambientes SENA', $cuerpo);
    consulta('UPDATE users SET credenciales_enviadas_en = NOW() WHERE id = ?', [(int) $u['id']]);
    return $r;
}

/** GET /mail-outbox?userId (administrativo): últimos correos registrados o enviados. */
function rutaCorreos(): never
{
    exigirRol('administrativo');
    $userId = entero($_GET, 'userId', false);
    $lista = filas('SELECT c.*, u.nombre, u.documento FROM correos c LEFT JOIN users u ON u.id = c.user_id'
        . ($userId ? ' WHERE c.user_id = ?' : '') . ' ORDER BY c.id DESC LIMIT 200', $userId ? [$userId] : []);
    responder(array_map(fn($c) => [
        'id' => (int) $c['id'], 'para' => $c['para'], 'asunto' => $c['asunto'], 'cuerpo' => $c['cuerpo'],
        'estado' => $c['estado'], 'error' => $c['error'], 'fecha' => iso($c['created_at']),
        'usuario' => $c['user_id'] ? ['id' => (int) $c['user_id'], 'nombre' => $c['nombre'], 'documento' => $c['documento']] : null,
    ], $lista));
}
