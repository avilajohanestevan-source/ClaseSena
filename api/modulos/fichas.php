<?php
/**
 * Fichas (cursos) y sus aprendices.
 *
 * Coordinación crea la ficha (programa, jornada, ambiente habitual e
 * instructor líder) e importa sus aprendices desde Excel/CSV con
 * PhpSpreadsheet. Cada aprendiz nuevo queda como usuario con una contraseña
 * temporal que le llega por correo (lib/correo.php); en su primer ingreso
 * debe confirmar el correo con un código y cambiar la contraseña
 * (modulos/auth.php). Si el aprendiz ya existía, se actualizan sus datos y
 * se pasa a la ficha.
 *
 * Columnas de la importación (la primera fila son los títulos):
 *   tipo_documento  CC | TI | CE | PPT (vacío = CC)
 *   documento*      6 a 12 dígitos
 *   nombre*         nombre completo
 *   email*          correo al que llegan las credenciales
 *   telefono        opcional
 */

const COLUMNAS_APRENDICES = ['tipo_documento', 'documento', 'nombre', 'email', 'telefono'];
const TIPOS_DOCUMENTO = ['CC', 'TI', 'CE', 'PPT'];

const SQL_FICHAS = "SELECT f.*, e.codigo AS amb_codigo, e.nombre AS amb_nombre, i.nombre AS instructor_nombre,
                           (SELECT COUNT(*) FROM users a WHERE a.rol = 'aprendiz' AND a.activo = 1 AND a.ficha = f.codigo) AS aprendices,
                           (SELECT COUNT(*) FROM users a WHERE a.rol = 'aprendiz' AND a.activo = 1 AND a.ficha = f.codigo AND a.debe_cambiar_password = 1) AS pendientes
                    FROM fichas f
                    LEFT JOIN environments e ON e.id = f.environment_id
                    LEFT JOIN users i ON i.id = f.instructor_id";

function fichaPublica(array $f): array
{
    return [
        'id' => (int) $f['id'],
        'codigo' => $f['codigo'],
        'programa' => $f['programa'],
        'jornada' => $f['jornada'],
        'ambiente' => $f['environment_id'] ? ['id' => (int) $f['environment_id'], 'codigo' => $f['amb_codigo'], 'nombre' => $f['amb_nombre']] : null,
        'instructor' => $f['instructor_id'] ? ['id' => (int) $f['instructor_id'], 'nombre' => $f['instructor_nombre']] : null,
        'fechaInicio' => $f['fecha_inicio'],
        'fechaFin' => $f['fecha_fin'],
        'activo' => (bool) $f['activo'],
        'aprendices' => (int) $f['aprendices'],
        // Aprendices que aún no han confirmado el correo ni cambiado la contraseña temporal.
        'primerIngresoPendiente' => (int) $f['pendientes'],
    ];
}

function buscarFicha(int $id): array
{
    $f = fila(SQL_FICHAS . ' WHERE f.id = ?', [$id]);
    if (!$f) fallar(404, 'La ficha no existe.', 'NO_ENCONTRADO');
    return $f;
}

/** ¿El instructor dirige la ficha o le dicta alguna clase? */
function instructorDeFicha(int $instructorId, array $f): bool
{
    return (int) $f['instructor_id'] === $instructorId
        || (bool) fila('SELECT id FROM clases WHERE ficha_id = ? AND instructor_id = ? LIMIT 1', [(int) $f['id'], $instructorId]);
}

/** GET /fichas: administrativo, todas; instructor, las que dirige o en las que dicta clase. */
function rutaFichas(): never
{
    $u = exigirRol('administrativo', 'instructor');
    $sql = SQL_FICHAS . ($u['rol'] === 'instructor'
        ? ' WHERE f.instructor_id = ? OR EXISTS (SELECT 1 FROM clases c WHERE c.ficha_id = f.id AND c.instructor_id = ?)' : '') . ' ORDER BY f.activo DESC, f.codigo';
    responder(array_map('fichaPublica', filas($sql, $u['rol'] === 'instructor' ? [(int) $u['id'], (int) $u['id']] : [])));
}

function aprendizPublico(array $a): array
{
    return [
        'id' => (int) $a['id'],
        'tipoDocumento' => $a['tipo_documento'],
        'documento' => $a['documento'],
        'nombre' => $a['nombre'],
        'email' => $a['email'],
        'telefono' => $a['telefono'],
        'activo' => (bool) $a['activo'],
        'primerIngresoPendiente' => (bool) $a['debe_cambiar_password'],
        'emailVerificado' => !empty($a['email_verificado_en']),
        'credencialesEnviadasEn' => iso($a['credenciales_enviadas_en']),
        'p004' => $a['p004_estado'] ?? null,
    ];
}

/** GET /fichas/{id}: con sus aprendices (estado de su cuenta y del P004). */
function rutaFicha(int $id): never
{
    $u = exigirRol('administrativo', 'instructor');
    $f = buscarFicha($id);
    if ($u['rol'] === 'instructor' && !instructorDeFicha((int) $u['id'], $f)) fallar(403, 'Esa ficha no es tuya.', 'PERMISO');
    $aprendices = filas("SELECT u.*, p.estado AS p004_estado FROM users u LEFT JOIN p004 p ON p.documento = u.documento
                         WHERE u.rol = 'aprendiz' AND u.ficha = ? ORDER BY u.nombre", [$f['codigo']]);
    responder(fichaPublica($f) + ['listaAprendices' => array_map('aprendizPublico', $aprendices)]);
}

function datosFicha(array $d, ?int $excepto = null): array
{
    $d = conAlias(conAlias($d, 'ambienteId', 'environment_id'), 'instructorId', 'instructor_id');
    $codigo = texto($d, 'codigo', 12, true, 'el número de la ficha');
    if (!preg_match('/^\d{5,12}$/', $codigo)) fallar(422, 'El número de la ficha debe tener entre 5 y 12 dígitos.', 'VALIDACION');
    if (fila('SELECT id FROM fichas WHERE codigo = ? AND id <> ?', [$codigo, $excepto ?? 0])) fallar(409, "Ya existe la ficha $codigo.", 'DUPLICADO');
    $programa = texto($d, 'programa', 160, true, 'el programa');
    $jornada = opcion($d, 'jornada', ['manana', 'tarde', 'noche', 'fin_semana'], false, 'la jornada') ?? 'manana';
    $ambienteId = entero($d, 'ambienteId', false);
    if ($ambienteId) buscarAmbiente($ambienteId);
    $instructorId = entero($d, 'instructorId', false);
    if ($instructorId && !fila("SELECT id FROM users WHERE id = ? AND rol = 'instructor' AND activo = 1", [$instructorId])) fallar(422, 'El instructor líder no existe.', 'VALIDACION');
    $inicio = fechaValida($d['fechaInicio'] ?? null, 'la fecha de inicio', false);
    $fin = fechaValida($d['fechaFin'] ?? null, 'la fecha final', false);
    if ($inicio && $fin && $fin < $inicio) fallar(422, 'La fecha final no puede ser anterior a la de inicio.', 'VALIDACION');
    $activo = array_key_exists('activo', $d) ? (int) (bool) $d['activo'] : 1;
    return [$codigo, $programa, $jornada, $ambienteId, $instructorId, $inicio, $fin, $activo];
}

function rutaCrearFicha(): never
{
    exigirRol('administrativo');
    $id = insertar('INSERT INTO fichas (codigo, programa, jornada, environment_id, instructor_id, fecha_inicio, fecha_fin, activo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', datosFicha(cuerpo()));
    responder(fichaPublica(buscarFicha($id)), 201);
}

function rutaEditarFicha(int $id): never
{
    exigirRol('administrativo');
    $antes = buscarFicha($id);
    $v = datosFicha(cuerpo(), $id);
    db()->begin_transaction();
    consulta('UPDATE fichas SET codigo = ?, programa = ?, jornada = ?, environment_id = ?, instructor_id = ?, fecha_inicio = ?, fecha_fin = ?, activo = ? WHERE id = ?', [...$v, $id]);
    // Si cambia el número, los aprendices y el P004 siguen a la ficha.
    if ($v[0] !== $antes['codigo']) {
        consulta("UPDATE users SET ficha = ? WHERE rol = 'aprendiz' AND ficha = ?", [$v[0], $antes['codigo']]);
        consulta('UPDATE p004 SET ficha = ? WHERE ficha = ?', [$v[0], $antes['codigo']]);
    }
    db()->commit();
    responder(fichaPublica(buscarFicha($id)));
}

/** "Tipo de documento", "Correo electrónico", "Nombres y apellidos" → tipo_documento, email, nombre. */
function normalizarTituloAprendiz(string $t): string
{
    $t = preg_replace('/[^a-z]/', '', claveTexto($t));
    return ['tipodocumento' => 'tipo_documento', 'tipodedocumento' => 'tipo_documento', 'tipo' => 'tipo_documento', 'tipodoc' => 'tipo_documento',
            'numerodedocumento' => 'documento', 'numerodocumento' => 'documento', 'identificacion' => 'documento', 'cedula' => 'documento',
            'nombres' => 'nombre', 'nombrecompleto' => 'nombre', 'nombresyapellidos' => 'nombre', 'aprendiz' => 'nombre',
            'correo' => 'email', 'correoelectronico' => 'email', 'mail' => 'email', 'celular' => 'telefono', 'telefonocelular' => 'telefono'][$t] ?? $t;
}

/**
 * POST /fichas/{id}/students/import (administrativo): aprendices desde
 * Excel/CSV (archivo como en recibirTabla(); con simular es una vista previa).
 * Nuevos: usuario aprendiz con contraseña temporal + correo con credenciales;
 * existentes (mismo documento): se actualizan y pasan a esta ficha.
 * → {total, nuevos, actualizados, sinCambios, correos, errores:[{fila, mensaje}], filas:[{fila, documento, nombre, email, accion}]}
 */
function rutaImportarAprendices(int $fichaId): never
{
    exigirRol('administrativo');
    $f = buscarFicha($fichaId);
    ['tabla' => $tabla, 'simular' => $simular] = recibirTabla();
    $filas = filasDeTabla($tabla, COLUMNAS_APRENDICES, ['documento', 'nombre', 'email'], 'normalizarTituloAprendiz', 1000);
    if (!$filas) fallar(422, 'El archivo no tiene filas con datos debajo de los títulos.', 'ARCHIVO');

    $r = ['total' => count($filas), 'nuevos' => 0, 'actualizados' => 0, 'sinCambios' => 0, 'correos' => 0, 'errores' => [], 'filas' => []];
    $vistos = [];
    db()->begin_transaction();
    foreach ($filas as $x) {
        $error = function (string $m) use (&$r, $x) { $r['errores'][] = ['fila' => $x['fila'], 'mensaje' => $m]; };
        $doc = preg_replace('/[.\s]/', '', $x['documento'] ?? '');
        $tipo = strtoupper($x['tipo_documento'] ?? '') ?: 'CC';
        $nombre = preg_replace('/\s+/', ' ', $x['nombre'] ?? '');
        $email = mb_strtolower($x['email'] ?? '');
        $tel = ($x['telefono'] ?? '') ?: null;
        if (!preg_match('/^\d{6,12}$/', $doc)) { $error('El documento debe tener entre 6 y 12 dígitos.'); continue; }
        if (isset($vistos[$doc])) { $error("El documento $doc está repetido (fila {$vistos[$doc]})."); continue; }
        $vistos[$doc] = $x['fila'];
        if (!in_array($tipo, TIPOS_DOCUMENTO, true)) { $error('El tipo de documento debe ser CC, TI, CE o PPT.'); continue; }
        if (mb_strlen($nombre) < 5 || mb_strlen($nombre) > 120) { $error('Escribe el nombre completo (5 a 120 caracteres).'); continue; }
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) { $error('El correo no es válido.'); continue; }
        if ($tel !== null && !preg_match('/^[0-9 +()-]{7,20}$/', $tel)) { $error('El teléfono no es válido.'); continue; }

        $existente = fila('SELECT * FROM users WHERE documento = ?', [$doc]);
        if ($existente && $existente['rol'] !== 'aprendiz') { $error("El documento $doc ya es de un usuario con rol {$existente['rol']}."); continue; }
        $duenoCorreo = fila('SELECT id, documento FROM users WHERE email = ? AND documento <> ?', [$email, $doc]);
        if ($duenoCorreo) { $error("El correo $email ya lo usa el documento {$duenoCorreo['documento']}."); continue; }

        if (!$existente) {
            $r['nuevos']++;
            $r['filas'][] = ['fila' => $x['fila'], 'documento' => $doc, 'nombre' => $nombre, 'email' => $email, 'accion' => 'nuevo'];
            if ($simular) continue;
            $clave = passwordTemporal();
            $id = insertar("INSERT INTO users (tipo_documento, documento, nombre, email, telefono, rol, ficha, password_hash, debe_cambiar_password)
                            VALUES (?, ?, ?, ?, ?, 'aprendiz', ?, ?, 1)", [$tipo, $doc, $nombre, $email, $tel, $f['codigo'], password_hash($clave, PASSWORD_BCRYPT)]);
            enviarCredenciales(fila('SELECT * FROM users WHERE id = ?', [$id]), $clave, $f);
            $r['correos']++;
            continue;
        }
        $cambios = array_filter([
            $existente['nombre'] !== $nombre ? 'nombre' : null, $existente['email'] !== $email ? 'correo' : null,
            $existente['tipo_documento'] !== $tipo ? 'tipo de documento' : null, (string) $existente['telefono'] !== (string) $tel && $tel !== null ? 'teléfono' : null,
            $existente['ficha'] !== $f['codigo'] ? "ficha {$existente['ficha']} → {$f['codigo']}" : null, !$existente['activo'] ? 'reactivado' : null,
        ]);
        if (!$cambios) {
            $r['sinCambios']++;
            $r['filas'][] = ['fila' => $x['fila'], 'documento' => $doc, 'nombre' => $nombre, 'email' => $email, 'accion' => 'sin_cambios'];
            continue;
        }
        $r['actualizados']++;
        $r['filas'][] = ['fila' => $x['fila'], 'documento' => $doc, 'nombre' => $nombre, 'email' => $email, 'accion' => 'actualizado', 'cambios' => array_values($cambios)];
        if ($simular) continue;
        // Si cambió el correo y aún no confirma el primer ingreso, la confirmación queda pendiente con el correo nuevo.
        consulta('UPDATE users SET tipo_documento = ?, nombre = ?, email = ?, telefono = COALESCE(?, telefono), ficha = ?, activo = 1,
                         email_verificado_en = IF(email = ?, email_verificado_en, NULL) WHERE id = ?',
            [$tipo, $nombre, $email, $tel, $f['codigo'], $email, (int) $existente['id']]);
    }
    if ($simular) db()->rollback(); else db()->commit();
    $r['simulado'] = $simular;
    responder($r);
}

/** POST /fichas/{id}/students/{userId}/credentials (administrativo): nueva contraseña temporal y correo; vuelve a pedir el primer ingreso. */
function rutaReenviarCredenciales(int $fichaId, int $userId): never
{
    exigirRol('administrativo');
    $f = buscarFicha($fichaId);
    $a = fila("SELECT * FROM users WHERE id = ? AND rol = 'aprendiz' AND ficha = ?", [$userId, $f['codigo']]);
    if (!$a) fallar(404, 'El aprendiz no está en esta ficha.', 'NO_ENCONTRADO');
    if (!$a['email']) fallar(422, 'El aprendiz no tiene correo registrado.', 'VALIDACION');
    $clave = passwordTemporal();
    consulta('UPDATE users SET password_hash = ?, debe_cambiar_password = 1 WHERE id = ?', [password_hash($clave, PASSWORD_BCRYPT), $userId]);
    consulta('DELETE FROM api_tokens WHERE user_id = ?', [$userId]);
    $correo = enviarCredenciales(fila('SELECT * FROM users WHERE id = ?', [$userId]), $clave, $f);
    responder(['aprendiz' => aprendizPublico(fila('SELECT u.*, NULL AS p004_estado FROM users u WHERE u.id = ?', [$userId])), 'correo' => $correo]);
}
