<?php
/**
 * Correos de la app: credenciales (aprendices de una ficha e instructores) y
 * códigos de verificación del primer ingreso. Todos quedan en la tabla
 * correos; con CORREO_MODO = 'mail' además se envían con mail() de PHP.
 *
 * El correo de credenciales sale de una plantilla editable (tabla
 * plantillas_correo; el administrativo la cambia en Fichas o en Instructores,
 * o solo para un envío) con estos campos:
 *   {nombre} {nombre_completo} {tipo_documento} {documento} {rol} {ficha} {programa} {clave} {enlace}
 * Va en HTML con un botón "Ingresar a Ambientes SENA" que abre la página de
 * ingreso con el documento y el rol ya puestos, y en texto plano.
 */

const PLANTILLAS_CORREO = [
    'credenciales_aprendiz' => [
        'nombre' => 'Credenciales de aprendices (fichas)',
        'asunto' => 'Tus credenciales de Ambientes SENA · ficha {ficha}',
        'cuerpo' => "Hola, {nombre}:\n\nTe inscribieron en la ficha {ficha} ({programa}) del SENA. Con Ambientes SENA registras tu asistencia con el QR de tu instructor, consultas tu horario y presentas excusas.\n\nPara ingresar elige el rol Aprendiz y usa:\nDocumento: {tipo_documento} {documento}\nContraseña temporal: {clave}\n\nLa primera vez que ingreses te pediremos confirmar este correo con un código y cambiar la contraseña.\n\nSi no esperabas este mensaje, comunícate con coordinación académica.",
    ],
    'credenciales_instructor' => [
        'nombre' => 'Credenciales de instructores',
        'asunto' => 'Tu acceso como instructor a Ambientes SENA',
        'cuerpo' => "Hola, {nombre}:\n\nCoordinación te registró como instructor en Ambientes SENA. Desde ahí revisas y recibes los ambientes, programas tus clases con QR de asistencia y revisas las excusas de tus aprendices.\n\nPara ingresar elige el rol Instructor y usa:\nDocumento: {tipo_documento} {documento}\nContraseña temporal: {clave}\n\nLa primera vez que ingreses te pediremos confirmar este correo con un código y cambiar la contraseña.",
    ],
];
const CAMPOS_CORREO = ['nombre', 'nombre_completo', 'tipo_documento', 'documento', 'rol', 'ficha', 'programa', 'clave', 'enlace'];
const ETIQUETA_ROL_CORREO = ['aprendiz' => 'Aprendiz', 'instructor' => 'Instructor', 'administrativo' => 'Administrativo', 'portero' => 'Portero', 'almacen' => 'Almacén'];

/** Registra (y, si está configurado, envía) un correo. Con $html sale como HTML + texto. → ['id', 'estado'] */
function enviarCorreo(?int $userId, string $para, string $asunto, string $cuerpo, ?string $html = null): array
{
    $estado = 'registrado';
    $error = null;
    if (CORREO_MODO === 'mail') {
        $cabeceras = 'From: ' . CORREO_REMITENTE . "\r\nMIME-Version: 1.0\r\n";
        if ($html) {
            $limite = 'sena-' . bin2hex(random_bytes(8));
            $cabeceras .= "Content-Type: multipart/alternative; boundary=\"$limite\"";
            $mensaje = "--$limite\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n$cuerpo\r\n"
                . "--$limite\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n$html\r\n--$limite--";
        } else {
            $cabeceras .= 'Content-Type: text/plain; charset=UTF-8';
            $mensaje = $cuerpo;
        }
        $ok = @mail($para, '=?UTF-8?B?' . base64_encode($asunto) . '?=', $mensaje, $cabeceras);
        $estado = $ok ? 'enviado' : 'error';
        if (!$ok) $error = 'mail() no pudo enviar el correo: revisa la configuración SMTP de PHP.';
    }
    $id = insertar('INSERT INTO correos (user_id, para, asunto, cuerpo, html, estado, error) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [$userId, $para, mb_substr($asunto, 0, 200), $cuerpo, $html, $estado, $error]);
    return ['id' => $id, 'estado' => $estado];
}

/** Contraseña temporal legible que cumple la regla (8+ caracteres, letras y números): "Sena-4821-kq". */
function passwordTemporal(): string
{
    $letras = 'abcdefghjkmnpqrstuvwxyz';
    return 'Sena-' . random_int(1000, 9999) . '-' . $letras[random_int(0, strlen($letras) - 1)] . $letras[random_int(0, strlen($letras) - 1)];
}

/** Contraseña temporal escrita por el administrativo: misma regla que una contraseña nueva. */
function validarClaveTemporal(string $clave): string
{
    if (strlen($clave) < 8 || strlen($clave) > 64 || !preg_match('/[A-Za-z]/', $clave) || !preg_match('/\d/', $clave)) {
        fallar(422, 'La contraseña temporal debe tener entre 8 y 64 caracteres, con letras y números.', 'VALIDACION');
    }
    return $clave;
}

/** Plantilla guardada (o la de fábrica): ['asunto', 'cuerpo']. */
function plantillaCorreo(string $clave): array
{
    if (!isset(PLANTILLAS_CORREO[$clave])) fallar(404, 'La plantilla no existe.', 'NO_ENCONTRADO');
    $p = fila('SELECT asunto, cuerpo FROM plantillas_correo WHERE clave = ?', [$clave]);
    return $p ?: ['asunto' => PLANTILLAS_CORREO[$clave]['asunto'], 'cuerpo' => PLANTILLAS_CORREO[$clave]['cuerpo']];
}

/**
 * Opciones de un envío de credenciales que manda el administrativo:
 *   clave            contraseña temporal escrita (vacía = se genera una por persona)
 *   correo           {asunto, cuerpo} para este envío (vacío = la plantilla guardada)
 *   guardarPlantilla además la deja como plantilla para los próximos envíos
 * → ['clave' => ?string, 'plantilla' => ?array]
 */
function opcionesCredenciales(array $d, string $plantilla, int $usuarioId): array
{
    $clave = isset($d['clave']) && trim((string) $d['clave']) !== '' ? validarClaveTemporal(trim((string) $d['clave'])) : null;
    $correo = $d['correo'] ?? null;
    if (is_string($correo)) $correo = json_decode($correo, true); // multipart: llega como texto JSON
    $p = null;
    if (is_array($correo) && (($correo['asunto'] ?? '') !== '' || ($correo['cuerpo'] ?? '') !== '')) {
        $p = validarPlantilla($correo);
        if (!empty($d['guardarPlantilla']) && $d['guardarPlantilla'] !== 'false' && $d['guardarPlantilla'] !== '0') guardarPlantilla($plantilla, $p, $usuarioId);
    }
    return ['clave' => $clave, 'plantilla' => $p];
}

function validarPlantilla(array $d): array
{
    $asunto = texto($d, 'asunto', 200, true, 'el asunto del correo');
    $cuerpo = texto($d, 'cuerpo', 4000, true, 'el cuerpo del correo');
    if (!str_contains($cuerpo, '{clave}')) fallar(422, 'El cuerpo del correo debe incluir {clave}: es la contraseña temporal con la que la persona entra.', 'VALIDACION');
    if (preg_match_all('/\{([a-z_]+)\}/', $asunto . $cuerpo, $m)) {
        $desconocidos = array_diff(array_unique($m[1]), CAMPOS_CORREO);
        if ($desconocidos) fallar(422, 'Campos que no existen en el correo: {' . implode('}, {', $desconocidos) . '}. Usa: {' . implode('}, {', CAMPOS_CORREO) . '}.', 'VALIDACION');
    }
    return ['asunto' => $asunto, 'cuerpo' => str_replace("\r\n", "\n", $cuerpo)];
}

function guardarPlantilla(string $clave, array $p, int $usuarioId): void
{
    consulta('INSERT INTO plantillas_correo (clave, asunto, cuerpo, actualizado_por, actualizado_en) VALUES (?, ?, ?, ?, NOW())
              ON DUPLICATE KEY UPDATE asunto = VALUES(asunto), cuerpo = VALUES(cuerpo), actualizado_por = VALUES(actualizado_por), actualizado_en = NOW()',
        [$clave, $p['asunto'], $p['cuerpo'], $usuarioId]);
}

/** Enlace que abre la página de ingreso con el documento y el rol ya puestos. */
function enlaceIngreso(array $u): string
{
    return URL_APP . '#/login?' . http_build_query(['documento' => $u['documento'], 'tipo' => $u['tipo_documento'], 'rol' => $u['rol']]);
}

/** Reemplaza los campos de la plantilla. → ['asunto', 'texto', 'html'] */
function componerCorreo(array $plantilla, array $vars): array
{
    $reemplazar = fn(string $t, bool $html) => preg_replace_callback('/\{([a-z_]+)\}/', function ($m) use ($vars, $html) {
        if (!array_key_exists($m[1], $vars)) return $m[0];
        $v = (string) $vars[$m[1]];
        if (!$html) return $v;
        if ($m[1] === 'enlace') return '<a href="' . htmlspecialchars($v) . '" style="color:#007832">' . htmlspecialchars($v) . '</a>';
        if ($m[1] === 'clave') return '<strong style="font-family:Consolas,monospace;font-size:16px;background:#F3FAEE;padding:2px 6px;border-radius:4px">' . htmlspecialchars($v) . '</strong>';
        return '<strong>' . htmlspecialchars($v) . '</strong>';
    }, $html ? htmlspecialchars($t, ENT_NOQUOTES) : $t);

    $asunto = $reemplazar($plantilla['asunto'], false);
    $texto = $reemplazar($plantilla['cuerpo'], false) . "\n\nIngresa aquí: {$vars['enlace']}\n";
    $parrafos = array_map(fn($p) => '<p style="margin:0 0 14px">' . nl2br(trim($p), false) . '</p>',
        preg_split("/\n{2,}/", $reemplazar($plantilla['cuerpo'], true)));
    $enlace = htmlspecialchars((string) $vars['enlace']);
    $html = '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>' . htmlspecialchars($asunto) . '</title></head>'
        . '<body style="margin:0;padding:24px 12px;background:#F4F6F5;font-family:Segoe UI,Roboto,Arial,sans-serif;color:#1F2933">'
        . '<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">'
        . '<table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #E1E7E3" cellspacing="0" cellpadding="0">'
        . '<tr><td style="background:#39A900;padding:18px 24px;color:#ffffff;font-size:18px;font-weight:700">SENA · Ambientes y asistencia</td></tr>'
        . '<tr><td style="padding:24px 24px 8px;font-size:15px;line-height:1.55">' . implode('', $parrafos) . '</td></tr>'
        . '<tr><td align="center" style="padding:8px 24px 24px">'
        . '<a href="' . $enlace . '" style="display:inline-block;background:#007832;color:#ffffff;text-decoration:none;font-weight:700;font-size:16px;padding:14px 28px;border-radius:999px">Ingresar a Ambientes SENA</a>'
        . '<p style="margin:16px 0 0;font-size:12px;color:#5B6770">Si el botón no funciona, copia este enlace en el navegador:<br><a href="' . $enlace . '" style="color:#007832;word-break:break-all">' . $enlace . '</a></p>'
        . '</td></tr>'
        . '<tr><td style="background:#F3FAEE;padding:12px 24px;font-size:12px;color:#5B6770">Servicio Nacional de Aprendizaje · Este es un mensaje automático, no lo respondas.</td></tr>'
        . '</table></td></tr></table></body></html>';
    return ['asunto' => $asunto, 'texto' => $texto, 'html' => $html];
}

/** Valores de los campos para un usuario (y su ficha, si es aprendiz). */
function camposCorreo(array $u, string $clave, ?array $ficha = null): array
{
    return [
        'nombre' => explode(' ', $u['nombre'])[0], 'nombre_completo' => $u['nombre'],
        'tipo_documento' => $u['tipo_documento'], 'documento' => $u['documento'], 'rol' => ETIQUETA_ROL_CORREO[$u['rol']] ?? $u['rol'],
        'ficha' => $ficha['codigo'] ?? ($u['ficha'] ?? ''), 'programa' => $ficha['programa'] ?? '',
        'clave' => $clave, 'enlace' => enlaceIngreso($u),
    ];
}

/**
 * Correo con el usuario, la contraseña temporal y el botón de ingreso; marca
 * credenciales_enviadas_en. $plantilla = la de este envío (null = la guardada para su rol).
 */
function enviarCredenciales(array $u, string $clave, ?array $ficha = null, ?array $plantilla = null): array
{
    $plantilla ??= plantillaCorreo($u['rol'] === 'instructor' ? 'credenciales_instructor' : 'credenciales_aprendiz');
    $c = componerCorreo($plantilla, camposCorreo($u, $clave, $ficha));
    $r = enviarCorreo((int) $u['id'], $u['email'], $c['asunto'], $c['texto'], $c['html']);
    consulta('UPDATE users SET credenciales_enviadas_en = NOW() WHERE id = ?', [(int) $u['id']]);
    return $r;
}

/* ---------------- rutas ---------------- */

/** GET /mail-outbox?userId (administrativo): últimos correos registrados o enviados. */
function rutaCorreos(): never
{
    exigirRol('administrativo');
    $userId = entero($_GET, 'userId', false);
    $lista = filas('SELECT c.*, u.nombre, u.documento FROM correos c LEFT JOIN users u ON u.id = c.user_id'
        . ($userId ? ' WHERE c.user_id = ?' : '') . ' ORDER BY c.id DESC LIMIT 200', $userId ? [$userId] : []);
    responder(array_map(fn($c) => [
        'id' => (int) $c['id'], 'para' => $c['para'], 'asunto' => $c['asunto'], 'cuerpo' => $c['cuerpo'], 'html' => $c['html'],
        'estado' => $c['estado'], 'error' => $c['error'], 'fecha' => iso($c['created_at']),
        'usuario' => $c['user_id'] ? ['id' => (int) $c['user_id'], 'nombre' => $c['nombre'], 'documento' => $c['documento']] : null,
    ], $lista));
}

/** GET /mail-templates (administrativo): plantillas de credenciales con los campos que se pueden usar. */
function rutaPlantillasCorreo(): never
{
    exigirRol('administrativo');
    $lista = [];
    foreach (PLANTILLAS_CORREO as $clave => $def) {
        $g = fila('SELECT p.*, u.nombre AS por FROM plantillas_correo p LEFT JOIN users u ON u.id = p.actualizado_por WHERE p.clave = ?', [$clave]);
        $lista[] = ['clave' => $clave, 'nombre' => $def['nombre'], 'asunto' => $g['asunto'] ?? $def['asunto'], 'cuerpo' => $g['cuerpo'] ?? $def['cuerpo'],
            'porDefecto' => ['asunto' => $def['asunto'], 'cuerpo' => $def['cuerpo']], 'personalizada' => (bool) $g,
            'actualizadaPor' => $g['por'] ?? null, 'actualizadaEn' => iso($g['actualizado_en'] ?? null)];
    }
    responder(['plantillas' => $lista, 'campos' => CAMPOS_CORREO]);
}

/** PUT /mail-templates/{clave} {asunto, cuerpo} (administrativo). Sin cuerpo: vuelve a la de fábrica. */
function rutaGuardarPlantillaCorreo(string $clave): never
{
    $u = exigirRol('administrativo');
    plantillaCorreo($clave);
    $d = cuerpo();
    if (!empty($d['restablecer'])) consulta('DELETE FROM plantillas_correo WHERE clave = ?', [$clave]);
    else guardarPlantilla($clave, validarPlantilla($d), (int) $u['id']);
    responder(['clave' => $clave] + plantillaCorreo($clave));
}

/**
 * POST /mail-templates/{clave}/preview {asunto?, cuerpo?, clave?, nombre?, documento?, tipoDocumento?, email?, fichaId?}
 * (administrativo): cómo se verá el correo, con datos de ejemplo o los de la persona.
 */
function rutaVistaPreviaCorreo(string $plantilla): never
{
    exigirRol('administrativo');
    $d = cuerpo();
    $p = isset($d['asunto']) || isset($d['cuerpo']) ? ['asunto' => (string) ($d['asunto'] ?? ''), 'cuerpo' => (string) ($d['cuerpo'] ?? '')] : plantillaCorreo($plantilla);
    $rol = $plantilla === 'credenciales_instructor' ? 'instructor' : 'aprendiz';
    $ficha = !empty($d['fichaId']) ? fila('SELECT codigo, programa FROM fichas WHERE id = ?', [(int) $d['fichaId']]) : null;
    $u = ['nombre' => trim((string) ($d['nombre'] ?? '')) ?: ($rol === 'instructor' ? 'María Fernanda López' : 'Juan Camilo Pérez'),
          'tipo_documento' => $d['tipoDocumento'] ?? 'CC', 'documento' => preg_replace('/\D/', '', (string) ($d['documento'] ?? '')) ?: '1099887766',
          'rol' => $rol, 'ficha' => $ficha['codigo'] ?? '2758432'];
    $ficha ??= ['codigo' => '2758432', 'programa' => 'Análisis y desarrollo de software'];
    $clave = trim((string) ($d['clave'] ?? '')) ?: 'Sena-4821-kq';
    $c = componerCorreo($p, camposCorreo($u, $clave, $ficha));
    responder(['asunto' => $c['asunto'], 'texto' => $c['texto'], 'html' => $c['html'], 'enlace' => enlaceIngreso($u)]);
}
