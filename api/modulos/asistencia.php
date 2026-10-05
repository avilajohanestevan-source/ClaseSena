<?php
/**
 * Asistencia a clases (antes simulada en js/api/mock): mismos contratos de
 * API.md, ahora con la base real.
 *
 *   clases          sesiones por ficha (competencia, ambiente, instructor, horario)
 *   QR de clase     el instructor lo muestra; el aprendiz lo escanea dentro de la ventana
 *   asistencias     presente | tarde (después de TOLERANCIA_TARDE_MIN)
 *   faltas          se calculan: clase no cancelada, ventana cerrada y sin
 *                   registro = falla; si una excusa aprobada cubre ese día,
 *                   justificada (no cuenta en el semáforo)
 *   excusas         el aprendiz la sube con foto y periodo; la revisa el
 *                   instructor líder de la ficha (o quien le dicta) o coordinación
 *   semáforo        conteos por aprendiz; el color lo calcula el front
 *                   (mismos umbrales que UMBRALES_SEMAFORO en js/config.js)
 *   P004            estado académico; solo EN FORMACION y CONDICIONADO registran
 */

const ESTADOS_P004 = ['EN FORMACION', 'CONDICIONADO', 'APLAZADO', 'TRASLADADO', 'RETIRO VOLUNTARIO', 'CANCELADO', 'POR CERTIFICAR', 'CERTIFICADO'];
const ESTADOS_P004_ACTIVOS = ['EN FORMACION', 'CONDICIONADO'];
/** Mínimo de faltas consecutivas / totales para llegar a rojo (último umbral de UMBRALES_SEMAFORO). */
const ROJO_CONSECUTIVAS = 4;
const ROJO_TOTALES = 8;

const SQL_CLASES = "SELECT c.*, f.codigo AS ficha_codigo, f.programa, f.instructor_id AS ficha_lider_id, co.nombre AS competencia,
                           e.codigo AS amb_codigo, e.nombre AS amb_nombre, u.nombre AS instructor_nombre,
                           (SELECT COUNT(*) FROM users a WHERE a.rol = 'aprendiz' AND a.activo = 1 AND a.ficha = f.codigo) AS inscritos,
                           (SELECT COUNT(*) FROM asistencias s WHERE s.clase_id = c.id) AS registrados
                    FROM clases c
                    JOIN fichas f ON f.id = c.ficha_id
                    JOIN competencias co ON co.id = c.competencia_id
                    JOIN environments e ON e.id = c.environment_id
                    JOIN users u ON u.id = c.instructor_id";

function clasePublica(array $c): array
{
    return [
        'id' => (int) $c['id'],
        'ficha' => $c['ficha_codigo'],
        'fichaId' => (int) $c['ficha_id'],
        'programa' => $c['programa'],
        'competenciaId' => (int) $c['competencia_id'],
        'competencia' => $c['competencia'],
        'ambienteId' => (int) $c['environment_id'],
        'ambiente' => "{$c['amb_codigo']} · {$c['amb_nombre']}",
        'instructorId' => (int) $c['instructor_id'],
        'instructor' => $c['instructor_nombre'],
        'startTime' => iso($c['inicio']),
        'endTime' => iso($c['fin']),
        'ventanaMin' => (int) $c['ventana_min'],
        'cancelada' => (bool) $c['cancelada'],
        'motivoCancelacion' => $c['motivo_cancelacion'],
        'inscritos' => (int) $c['inscritos'],
        'registrados' => (int) $c['registrados'],
    ];
}

function buscarClase(int $id): array
{
    $c = fila(SQL_CLASES . ' WHERE c.id = ?', [$id]);
    if (!$c) fallar(404, 'La sesión no existe.', 'NO_EXISTE');
    return $c;
}

/** pendiente | abierta | cerrada | cancelada, con inicio y cierre (timestamps). */
function ventanaClase(array $c, ?int $ahora = null): array
{
    $ahora ??= time();
    $inicio = strtotime($c['inicio']);
    $cierre = $inicio + (int) $c['ventana_min'] * 60;
    $estado = $c['cancelada'] ? 'cancelada' : ($ahora < $inicio ? 'pendiente' : ($ahora > $cierre ? 'cerrada' : 'abierta'));
    return ['estado' => $estado, 'inicio' => $inicio, 'cierre' => $cierre];
}

/** El instructor de la clase, el líder de la ficha o un administrativo. */
function puedeGestionarClase(array $u, array $c): bool
{
    return $u['rol'] === 'administrativo' || (int) $c['instructor_id'] === (int) $u['id'] || (int) $c['ficha_lider_id'] === (int) $u['id'];
}

function fichaPorCodigoOId($id, $codigo): array
{
    $f = $id ? fila('SELECT * FROM fichas WHERE id = ?', [(int) $id]) : ($codigo ? fila('SELECT * FROM fichas WHERE codigo = ?', [(string) $codigo]) : null);
    if (!$f) fallar(422, 'Elige una ficha que exista.', 'VALIDACION');
    return $f;
}

/* ---------------- catálogos ---------------- */

/** GET /catalogs → {ambientes, competencias, fichas} (contrato de la asistencia). */
function rutaCatalogosAsistencia(): never
{
    $u = usuario();
    if ($u['rol'] === 'portero' || $u['rol'] === 'almacen') fallar(403, 'Tu rol no tiene permiso para esta acción.', 'PERMISO');
    responder([
        'ambientes' => array_map(fn($e) => ['id' => (int) $e['id'], 'nombre' => "{$e['codigo']} · {$e['nombre']}", 'sede' => 'Sede principal'],
            filas('SELECT id, codigo, nombre FROM environments WHERE activo = 1 ORDER BY codigo')),
        'competencias' => array_map(fn($c) => ['id' => (int) $c['id'], 'nombre' => $c['nombre']], filas('SELECT * FROM competencias ORDER BY nombre')),
        'fichas' => array_map(fn($f) => ['id' => (int) $f['id'], 'ficha' => $f['codigo'], 'programa' => $f['programa'], 'ambienteId' => $f['environment_id'] !== null ? (int) $f['environment_id'] : null,
            'jornada' => $f['jornada']], filas('SELECT * FROM fichas WHERE activo = 1 ORDER BY codigo')),
    ]);
}

/* ---------------- sesiones de clase ---------------- */

/** GET /sessions?instructorId&ficha&fecha (el aprendiz solo ve las de su ficha). */
function rutaSesiones(): never
{
    $u = exigirRol('administrativo', 'instructor', 'aprendiz');
    $where = [];
    $params = [];
    if ($u['rol'] === 'aprendiz') { $where[] = 'f.codigo = ?'; $params[] = (string) $u['ficha']; }
    elseif (!empty($_GET['ficha'])) { $where[] = 'f.codigo = ?'; $params[] = (string) $_GET['ficha']; }
    if ($v = entero($_GET, 'instructorId', false)) { $where[] = 'c.instructor_id = ?'; $params[] = $v; }
    if ($f = fechaValida($_GET['fecha'] ?? null, 'la fecha', false)) { $where[] = 'DATE(c.inicio) = ?'; $params[] = $f; }
    $sql = SQL_CLASES . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . ' ORDER BY c.inicio LIMIT 300';
    responder(array_map('clasePublica', filas($sql, $params)));
}

/**
 * POST /sessions (instructor o administrativo): programa una clase.
 * {fichaId | ficha, competenciaId | competencia (nombre; si no existe se crea),
 *  ambienteId? (por defecto el de la ficha), fecha, horaInicio "07:00", horaFin, ventanaMin?, instructorId? (solo administrativo)}
 */
function rutaCrearSesion(): never
{
    $u = exigirRol('administrativo', 'instructor');
    $d = cuerpo();
    $f = fichaPorCodigoOId($d['fichaId'] ?? null, $d['ficha'] ?? null);
    if (!$f['activo']) fallar(409, 'La ficha está inactiva.', 'ESTADO');
    if ($v = entero($d, 'competenciaId', false)) {
        $competencia = fila('SELECT * FROM competencias WHERE id = ?', [$v]) ?? fallar(422, 'La competencia no existe.', 'VALIDACION');
        $competenciaId = (int) $competencia['id'];
    } else {
        $nombre = texto($d, 'competencia', 160, true, 'la competencia');
        $competenciaId = (int) (fila('SELECT id FROM competencias WHERE nombre = ?', [$nombre])['id'] ?? insertar('INSERT INTO competencias (nombre) VALUES (?)', [$nombre]));
    }
    $ambienteId = entero($d, 'ambienteId', false) ?? ($f['environment_id'] !== null ? (int) $f['environment_id'] : null);
    if (!$ambienteId) fallar(422, 'Elige el ambiente de la clase.', 'VALIDACION');
    buscarAmbiente($ambienteId);
    $instructorId = (int) $u['id'];
    if ($u['rol'] === 'administrativo') {
        $instructorId = entero($d, 'instructorId', false) ?? (int) $f['instructor_id'];
        if (!$instructorId || !fila("SELECT id FROM users WHERE id = ? AND rol = 'instructor' AND activo = 1", [$instructorId])) fallar(422, 'Elige el instructor de la clase.', 'VALIDACION');
    }
    $fecha = fechaValida($d['fecha'] ?? null, 'la fecha');
    if ($fecha < hoy()) fallar(422, 'No se pueden programar clases en días que ya pasaron.', 'VALIDACION');
    foreach (['horaInicio', 'horaFin'] as $h) {
        if (!preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', (string) ($d[$h] ?? ''))) fallar(422, $h === 'horaInicio' ? 'Escribe la hora de inicio (hh:mm).' : 'Escribe la hora final (hh:mm).', 'VALIDACION');
    }
    $inicio = "$fecha {$d['horaInicio']}:00";
    $fin = "$fecha {$d['horaFin']}:00";
    if ($fin <= $inicio) fallar(422, 'La hora final debe ser posterior a la de inicio.', 'VALIDACION');
    $ventana = max(5, min(60, entero($d, 'ventanaMin', false) ?? 15));
    $cruce = fila('SELECT c.inicio, c.fin FROM clases c WHERE c.ficha_id = ? AND c.cancelada = 0 AND c.inicio < ? AND c.fin > ?', [(int) $f['id'], $fin, $inicio]);
    if ($cruce) fallar(409, "La ficha {$f['codigo']} ya tiene una clase de " . substr($cruce['inicio'], 11, 5) . ' a ' . substr($cruce['fin'], 11, 5) . ' ese día.', 'DUPLICADO');
    $id = insertar('INSERT INTO clases (ficha_id, competencia_id, environment_id, instructor_id, inicio, fin, ventana_min, creada_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [(int) $f['id'], $competenciaId, $ambienteId, $instructorId, $inicio, $fin, $ventana, (int) $u['id']]);
    responder(clasePublica(buscarClase($id)), 201);
}

/** POST /sessions/{id}/qr {validezSeg}: QR de la clase (solo con la ventana abierta). */
function rutaQrClase(int $id): never
{
    $u = exigirRol('administrativo', 'instructor');
    $c = buscarClase($id);
    if (!puedeGestionarClase($u, $c)) fallar(403, 'Esa clase es de otro instructor.', 'PERMISO');
    $v = ventanaClase($c);
    if ($v['estado'] === 'cancelada') fallar(409, 'La clase está cancelada: no se puede generar QR.', 'CANCELADA');
    if ($v['estado'] === 'cerrada') fallar(409, 'La ventana de registro ya cerró.', 'FUERA_DE_VENTANA');
    if ($v['estado'] === 'pendiente') fallar(409, 'La ventana de registro aún no abre.', 'PENDIENTE');
    $validez = max(10, min(900, (int) (cuerpo()['validezSeg'] ?? 60) ?: 60));
    // El QR nunca vence después de que cierra la ventana.
    $expira = min(time() + $validez, $v['cierre']);
    $nonce = substr(bin2hex(random_bytes(8)), 0, 12);
    insertar('INSERT INTO clase_qr (clase_id, nonce, expira) VALUES (?, ?, ?)', [$id, $nonce, date('Y-m-d H:i:s', $expira)]);
    $payload = ['sessionId' => $id, 'startTime' => iso($c['inicio']), 'expiryTime' => date(DATE_ATOM, $expira), 'nonce' => $nonce];
    responder(['payload' => $payload, 'texto' => 'SENA-ASIS:' . json_encode($payload, JSON_UNESCAPED_SLASHES)]);
}

/** POST /sessions/{id}/cancel {motivo}: deshabilita QR y registro y avisa a coordinación. */
function rutaCancelarClase(int $id): never
{
    $u = exigirRol('administrativo', 'instructor');
    $c = buscarClase($id);
    if (!puedeGestionarClase($u, $c)) fallar(403, 'Esa clase es de otro instructor.', 'PERMISO');
    if ($c['cancelada']) fallar(409, 'La clase ya estaba cancelada.', 'YA_CANCELADA');
    $motivo = trim((string) (cuerpo()['motivo'] ?? ''));
    if (mb_strlen($motivo) < 5) fallar(422, 'Indica el motivo de la cancelación.', 'VALIDACION');
    db()->begin_transaction();
    consulta('UPDATE clases SET cancelada = 1, motivo_cancelacion = ? WHERE id = ?', [mb_substr($motivo, 0, 300), $id]);
    notificarAdministrativos('clase_cancelada', 'Clase cancelada', "Ficha {$c['ficha_codigo']} · {$c['competencia']} · {$c['amb_codigo']} · $motivo ({$u['nombre']})", null, null, (int) $u['id']);
    db()->commit();
    responder(clasePublica(buscarClase($id)));
}

/** GET /sessions/{id}/attendance: registros de la clase (con las faltas y justificadas si la ventana ya cerró). */
function rutaAsistenciaClase(int $id): never
{
    $u = exigirRol('administrativo', 'instructor');
    $c = buscarClase($id);
    if ($u['rol'] === 'instructor' && !puedeGestionarClase($u, $c)) fallar(403, 'Esa clase es de otro instructor.', 'PERMISO');
    $lista = registrosAsistencia(['claseId' => $id]);
    usort($lista, fn($a, $b) => strcmp($b['hora'] ?? '', $a['hora'] ?? ''));
    responder($lista);
}

/* ---------------- asistencia ---------------- */

/**
 * Registros de asistencia (incluidas las faltas calculadas) según filtros:
 * claseId, desde, hasta, ficha, ambienteId, competenciaId, aprendizId, instructorDe (instructor: sus clases o fichas que dirige).
 * Solo clases que ya empezaron; las faltas, cuando la ventana ya cerró.
 */
function registrosAsistencia(array $f): array
{
    $where = ['c.inicio <= NOW()'];
    $params = [];
    if (!empty($f['claseId'])) { $where[] = 'c.id = ?'; $params[] = (int) $f['claseId']; }
    if (!empty($f['desde'])) { $where[] = 'DATE(c.inicio) >= ?'; $params[] = $f['desde']; }
    if (!empty($f['hasta'])) { $where[] = 'DATE(c.inicio) <= ?'; $params[] = $f['hasta']; }
    if (!empty($f['ficha'])) { $where[] = 'f.codigo = ?'; $params[] = (string) $f['ficha']; }
    if (!empty($f['ambienteId'])) { $where[] = 'c.environment_id = ?'; $params[] = (int) $f['ambienteId']; }
    if (!empty($f['competenciaId'])) { $where[] = 'c.competencia_id = ?'; $params[] = (int) $f['competenciaId']; }
    if (!empty($f['instructorDe'])) { $where[] = '(c.instructor_id = ? OR f.instructor_id = ?)'; array_push($params, (int) $f['instructorDe'], (int) $f['instructorDe']); }
    $clases = filas(SQL_CLASES . ' WHERE ' . implode(' AND ', $where) . ' ORDER BY c.inicio', $params);
    if (!$clases) return [];

    $codigos = array_values(array_unique(array_column($clases, 'ficha_codigo')));
    $aprendices = filas("SELECT id, documento, nombre, ficha, created_at FROM users WHERE rol = 'aprendiz' AND activo = 1 AND ficha IN (" . marcas(count($codigos)) . ')'
        . (!empty($f['aprendizId']) ? ' AND id = ?' : '') . ' ORDER BY nombre', [...$codigos, ...(!empty($f['aprendizId']) ? [(int) $f['aprendizId']] : [])]);
    if (!$aprendices) return [];
    $porFicha = [];
    foreach ($aprendices as $a) $porFicha[$a['ficha']][] = $a;
    $idsClases = array_map('intval', array_column($clases, 'id'));
    $registros = [];
    foreach (filas('SELECT * FROM asistencias WHERE clase_id IN (' . marcas(count($idsClases)) . ')', $idsClases) as $r) $registros[$r['clase_id'] . '-' . $r['aprendiz_id']] = $r;
    $idsAprendices = array_map('intval', array_column($aprendices, 'id'));
    $excusas = [];
    foreach (filas("SELECT aprendiz_id, desde, hasta FROM excusas WHERE estado = 'aprobada' AND aprendiz_id IN (" . marcas(count($idsAprendices)) . ')', $idsAprendices) as $e) $excusas[$e['aprendiz_id']][] = $e;

    $ahora = time();
    $lista = [];
    foreach ($clases as $c) {
        $v = ventanaClase($c, $ahora);
        $dia = substr($c['inicio'], 0, 10);
        foreach ($porFicha[$c['ficha_codigo']] ?? [] as $a) {
            // Un aprendiz importado después no tiene faltas de clases anteriores.
            if (substr($a['created_at'], 0, 10) > $dia) continue;
            $r = $registros[$c['id'] . '-' . $a['id']] ?? null;
            if ($c['cancelada']) $estado = 'cancelada';
            elseif ($r) $estado = $r['estado'];
            elseif ($v['estado'] !== 'cerrada') continue; // todavía puede registrarse
            else {
                $cubierta = array_filter($excusas[$a['id']] ?? [], fn($e) => $e['desde'] <= $dia && $e['hasta'] >= $dia);
                $estado = $cubierta ? 'justificada' : 'falla';
            }
            $lista[] = [
                'id' => $r ? (int) $r['id'] : "c{$c['id']}-a{$a['id']}",
                'sessionId' => (int) $c['id'], 'aprendizId' => (int) $a['id'], 'documento' => $a['documento'], 'aprendiz' => $a['nombre'],
                'ficha' => $c['ficha_codigo'], 'competenciaId' => (int) $c['competencia_id'], 'competencia' => $c['competencia'],
                'ambienteId' => (int) $c['environment_id'], 'ambiente' => "{$c['amb_codigo']} · {$c['amb_nombre']}",
                'instructor' => $c['instructor_nombre'],
                'fecha' => iso($c['inicio']), 'hora' => $r ? iso($r['hora']) : null, 'estado' => $estado,
            ];
        }
    }
    return $lista;
}

/** GET /attendance?desde&hasta&ficha&ambienteId&competenciaId&aprendizId (aprendiz: las suyas; instructor: sus clases y fichas). */
function rutaAsistencias(): never
{
    $u = exigirRol('administrativo', 'instructor', 'aprendiz');
    foreach (['desde', 'hasta'] as $campo) fechaValida($_GET[$campo] ?? null, "la fecha '$campo'", false);
    $filtros = array_intersect_key($_GET, array_flip(['desde', 'hasta', 'ficha', 'ambienteId', 'competenciaId', 'aprendizId']));
    if ($u['rol'] === 'aprendiz') $filtros['aprendizId'] = (int) $u['id'];
    if ($u['rol'] === 'instructor') $filtros['instructorDe'] = (int) $u['id'];
    $lista = registrosAsistencia($filtros);
    usort($lista, fn($a, $b) => strcmp($b['fecha'], $a['fecha']) ?: strcmp($a['aprendiz'], $b['aprendiz']));
    responder(array_slice($lista, 0, 3000));
}

/**
 * POST /attendance/scan {payload: {sessionId, startTime, expiryTime, nonce}, scannedAt}
 * (aprendiz). Siempre 200 si la petición es válida; el resultado va en el cuerpo.
 */
function rutaEscanearAsistencia(): never
{
    $u = exigirRol('aprendiz');
    $p = cuerpo()['payload'] ?? null;
    $falla = fn(string $codigo, string $motivo) => responder(['resultado' => 'falla', 'codigo' => $codigo, 'motivo' => $motivo]);
    if (!is_array($p) || empty($p['sessionId']) || empty($p['nonce'])) $falla('QR_INVALIDO', 'El QR no es válido.');
    $c = fila(SQL_CLASES . ' WHERE c.id = ?', [(int) $p['sessionId']]);
    if (!$c) $falla('QR_INVALIDO', 'El QR no corresponde a ninguna clase.');
    $qr = fila('SELECT * FROM clase_qr WHERE clase_id = ? AND nonce = ?', [(int) $c['id'], (string) $p['nonce']]);
    if (!$qr) $falla('QR_INVALIDO', 'El QR no fue emitido por el sistema.');
    if (strtotime($qr['expira']) < time()) $falla('QR_VENCIDO', 'El QR ya venció. Pide al instructor que lo muestre de nuevo.');
    $v = ventanaClase($c);
    if ($v['estado'] === 'cancelada') $falla('CANCELADA', 'La clase fue cancelada.');
    if ($v['estado'] !== 'abierta') $falla('FUERA_DE_VENTANA', 'Fuera de ventana: el tiempo de registro terminó.');
    if ($u['ficha'] !== $c['ficha_codigo']) $falla('NO_INSCRITO', "No estás inscrito en la ficha {$c['ficha_codigo']}.");
    $p004 = fila('SELECT estado FROM p004 WHERE documento = ?', [$u['documento']]);
    if ($p004 && !in_array($p004['estado'], ESTADOS_P004_ACTIVOS, true)) $falla('P004', "Tu estado en P004 es \"{$p004['estado']}\".");
    if (fila('SELECT id FROM asistencias WHERE clase_id = ? AND aprendiz_id = ?', [(int) $c['id'], (int) $u['id']])) $falla('DUPLICADO', 'Ya habías registrado tu asistencia en esta clase.');
    $estado = time() - $v['inicio'] > TOLERANCIA_TARDE_MIN * 60 ? 'tarde' : 'presente';
    $id = insertar('INSERT INTO asistencias (clase_id, aprendiz_id, estado, hora) VALUES (?, ?, ?, NOW())', [(int) $c['id'], (int) $u['id'], $estado]);
    $r = fila('SELECT * FROM asistencias WHERE id = ?', [$id]);
    responder([
        'resultado' => 'aceptado', 'estado' => $estado,
        'registro' => ['id' => $id, 'sessionId' => (int) $c['id'], 'aprendizId' => (int) $u['id'], 'documento' => $u['documento'], 'aprendiz' => $u['nombre'],
            'ficha' => $c['ficha_codigo'], 'competenciaId' => (int) $c['competencia_id'], 'competencia' => $c['competencia'],
            'ambienteId' => (int) $c['environment_id'], 'ambiente' => "{$c['amb_codigo']} · {$c['amb_nombre']}", 'fecha' => iso($c['inicio']), 'hora' => iso($r['hora']), 'estado' => $estado],
    ] + ($estado === 'tarde' ? ['motivo' => 'Llegada tarde (más de ' . TOLERANCIA_TARDE_MIN . ' min)'] : []));
}

/* ---------------- semáforo y riesgo ---------------- */

/**
 * GET /students/absences?ambienteId&competenciaId&fecha&ficha: conteos por aprendiz.
 * Las justificadas no cuentan como falla; las consecutivas se cuentan desde la última clase.
 * Si un aprendiz llega a rojo, se avisa (una vez por semana) a coordinación y al instructor líder.
 */
function rutaFaltas(): never
{
    $u = exigirRol('administrativo', 'instructor');
    $hasta = fechaValida($_GET['fecha'] ?? null, 'la fecha', false) ?? hoy();
    $filtros = ['hasta' => $hasta, 'ficha' => $_GET['ficha'] ?? null, 'competenciaId' => $_GET['competenciaId'] ?? null];
    if ($u['rol'] === 'instructor') $filtros['instructorDe'] = (int) $u['id'];
    $registros = registrosAsistencia(array_filter($filtros));

    // Todos los aprendices de las fichas visibles (también los que aún no tienen clases).
    $where = ["u.rol = 'aprendiz'", 'u.activo = 1'];
    $params = [];
    if (!empty($_GET['ficha'])) { $where[] = 'f.codigo = ?'; $params[] = (string) $_GET['ficha']; }
    if (!empty($_GET['ambienteId'])) { $where[] = 'f.environment_id = ?'; $params[] = (int) $_GET['ambienteId']; }
    if ($u['rol'] === 'instructor') {
        $where[] = '(f.instructor_id = ? OR EXISTS (SELECT 1 FROM clases c WHERE c.ficha_id = f.id AND c.instructor_id = ?))';
        array_push($params, (int) $u['id'], (int) $u['id']);
    }
    $aprendices = filas('SELECT u.id, u.documento, u.nombre, u.ficha, f.programa, f.environment_id, f.instructor_id AS lider_id,
                                (SELECT COUNT(*) FROM excusas x WHERE x.aprendiz_id = u.id AND x.estado = \'pendiente\') AS excusas_pendientes
                         FROM users u JOIN fichas f ON f.codigo = u.ficha WHERE ' . implode(' AND ', $where) . ' ORDER BY u.nombre', $params);
    $porAprendiz = [];
    foreach ($registros as $r) if ($r['estado'] !== 'cancelada') $porAprendiz[$r['aprendizId']][] = $r;
    $competenciasFicha = [];
    foreach (filas('SELECT DISTINCT f.codigo, c.competencia_id FROM clases c JOIN fichas f ON f.id = c.ficha_id') as $x) $competenciasFicha[$x['codigo']][] = (int) $x['competencia_id'];

    $lista = [];
    foreach ($aprendices as $a) {
        if (!empty($_GET['competenciaId']) && !in_array((int) $_GET['competenciaId'], $competenciasFicha[$a['ficha']] ?? [], true)) continue;
        $regs = $porAprendiz[(int) $a['id']] ?? [];
        usort($regs, fn($x, $y) => strcmp($x['fecha'], $y['fecha']));
        $consecutivas = 0;
        for ($i = count($regs) - 1; $i >= 0; $i--) {
            if ($regs[$i]['estado'] === 'justificada') continue; // no rompe la racha ni suma
            if ($regs[$i]['estado'] !== 'falla') break;
            $consecutivas++;
        }
        $fallas = array_values(array_filter($regs, fn($r) => $r['estado'] === 'falla'));
        $lista[] = [
            'aprendizId' => (int) $a['id'], 'documento' => $a['documento'], 'nombre' => $a['nombre'], 'ficha' => $a['ficha'], 'programa' => $a['programa'],
            'ambienteId' => $a['environment_id'] !== null ? (int) $a['environment_id'] : null, 'competenciaIds' => $competenciasFicha[$a['ficha']] ?? [],
            'faltasConsecutivas' => $consecutivas, 'faltasTotales' => count($fallas), 'sesiones' => count($regs),
            'justificadas' => count(array_filter($regs, fn($r) => $r['estado'] === 'justificada')),
            'excusasPendientes' => (int) $a['excusas_pendientes'],
            'ultimaFalta' => $fallas ? end($fallas)['fecha'] : null,
            '_lider' => $a['lider_id'] !== null ? (int) $a['lider_id'] : null,
        ];
    }
    avisarRiesgo($lista);
    responder(array_map(fn($x) => array_diff_key($x, ['_lider' => 1]), $lista));
}

/** Aviso de riesgo de deserción (rojo): a coordinación y al instructor líder, una vez por semana por aprendiz. */
function avisarRiesgo(array $lista): void
{
    foreach ($lista as $x) {
        if ($x['faltasConsecutivas'] < ROJO_CONSECUTIVAS && $x['faltasTotales'] < ROJO_TOTALES) continue;
        $titulo = "Riesgo de deserción: {$x['nombre']}";
        if (fila("SELECT id FROM notifications WHERE tipo = 'riesgo' AND titulo = ? AND created_at > NOW() - INTERVAL 7 DAY LIMIT 1", [$titulo])) continue;
        $detalle = "Ficha {$x['ficha']} · {$x['faltasConsecutivas']} falla(s) seguidas y {$x['faltasTotales']} en total · documento {$x['documento']}";
        notificarAdministrativos('riesgo', $titulo, $detalle, null);
        if ($x['_lider']) notificar($x['_lider'], 'riesgo', $titulo, $detalle, null);
    }
}

/* ---------------- horario del aprendiz ---------------- */

/** GET /my/schedule?dias=14 (aprendiz): su ficha, su instructor líder y las clases de hoy en adelante con su profesor y ambiente. */
function rutaMiHorario(): never
{
    $u = exigirRol('aprendiz');
    $f = fila(SQL_FICHAS . ' WHERE f.codigo = ?', [(string) $u['ficha']]);
    if (!$f) responder(['ficha' => null, 'clases' => []]);
    $dias = max(1, min(60, (int) ($_GET['dias'] ?? 14)));
    $clases = filas(SQL_CLASES . ' WHERE c.ficha_id = ? AND DATE(c.inicio) BETWEEN CURDATE() AND CURDATE() + INTERVAL ? DAY ORDER BY c.inicio', [(int) $f['id'], $dias]);
    $mias = [];
    foreach (filas('SELECT clase_id, estado FROM asistencias WHERE aprendiz_id = ?', [(int) $u['id']]) as $r) $mias[(int) $r['clase_id']] = $r['estado'];
    responder([
        'ficha' => fichaPublica($f),
        'clases' => array_map(fn($c) => clasePublica($c) + ['miRegistro' => $mias[(int) $c['id']] ?? null], $clases),
    ]);
}

/* ---------------- excusas ---------------- */

const SQL_EXCUSAS = 'SELECT x.*, a.nombre AS aprendiz_nombre, a.documento, a.ficha AS ficha_codigo, r.nombre AS revisor_nombre
                     FROM excusas x JOIN users a ON a.id = x.aprendiz_id LEFT JOIN users r ON r.id = x.revisada_por';

function excusaPublica(array $x): array
{
    return [
        'id' => (int) $x['id'],
        'aprendiz' => ['id' => (int) $x['aprendiz_id'], 'nombre' => $x['aprendiz_nombre'], 'documento' => $x['documento']],
        'ficha' => $x['ficha_codigo'],
        'desde' => $x['desde'], 'hasta' => $x['hasta'],
        'motivo' => $x['motivo'], 'foto' => $x['foto'],
        'estado' => $x['estado'],
        'revisadaPor' => $x['revisor_nombre'], 'revisadaEn' => iso($x['revisada_en']), 'observacion' => $x['observacion'],
        'creadaEn' => iso($x['created_at']),
        // Clases de la ficha que cubre (y cuántas eran faltas).
        'clasesCubiertas' => (int) (fila('SELECT COUNT(*) n FROM clases c JOIN fichas f ON f.id = c.ficha_id WHERE f.codigo = ? AND c.cancelada = 0 AND DATE(c.inicio) BETWEEN ? AND ?',
            [(string) $x['ficha_codigo'], $x['desde'], $x['hasta']])['n'] ?? 0),
    ];
}

/** ¿Puede revisar excusas de esta ficha? Administrativo, o instructor que la dirige o le dicta. */
function revisaExcusasDe(array $u, ?string $fichaCodigo): bool
{
    if ($u['rol'] === 'administrativo') return true;
    if ($u['rol'] !== 'instructor' || !$fichaCodigo) return false;
    $f = fila('SELECT * FROM fichas WHERE codigo = ?', [$fichaCodigo]);
    return $f && instructorDeFicha((int) $u['id'], $f);
}

/** GET /excuses?estado&ficha (aprendiz: las suyas; instructor: las de sus fichas; administrativo: todas). */
function rutaExcusas(): never
{
    $u = exigirRol('administrativo', 'instructor', 'aprendiz');
    $where = [];
    $params = [];
    if ($u['rol'] === 'aprendiz') { $where[] = 'x.aprendiz_id = ?'; $params[] = (int) $u['id']; }
    if ($u['rol'] === 'instructor') {
        $where[] = 'a.ficha IN (SELECT f.codigo FROM fichas f WHERE f.instructor_id = ? OR EXISTS (SELECT 1 FROM clases c WHERE c.ficha_id = f.id AND c.instructor_id = ?))';
        array_push($params, (int) $u['id'], (int) $u['id']);
    }
    if ($v = opcion($_GET, 'estado', ['pendiente', 'aprobada', 'rechazada'], false)) { $where[] = 'x.estado = ?'; $params[] = $v; }
    if (!empty($_GET['ficha'])) { $where[] = 'a.ficha = ?'; $params[] = (string) $_GET['ficha']; }
    $sql = SQL_EXCUSAS . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . " ORDER BY x.estado = 'pendiente' DESC, x.created_at DESC LIMIT 300";
    responder(array_map('excusaPublica', filas($sql, $params)));
}

/** POST /excuses {desde, hasta, motivo, foto} (aprendiz): queda pendiente y avisa al instructor líder y a coordinación. */
function rutaCrearExcusa(): never
{
    $u = exigirRol('aprendiz');
    $d = cuerpo();
    $desde = fechaValida($d['desde'] ?? null, 'la fecha de inicio');
    $hasta = fechaValida($d['hasta'] ?? null, 'la fecha final') ;
    if ($hasta < $desde) fallar(422, 'La fecha final no puede ser anterior a la de inicio.', 'VALIDACION');
    if ((new DateTime($desde))->diff(new DateTime($hasta))->days > 30) fallar(422, 'Una excusa cubre máximo 31 días.', 'VALIDACION');
    if ($desde < date('Y-m-d', strtotime('-30 days'))) fallar(422, 'Solo se pueden presentar excusas de los últimos 30 días.', 'VALIDACION');
    $motivo = texto($d, 'motivo', 500, true, 'el motivo');
    if (mb_strlen($motivo) < 10) fallar(422, 'Describe el motivo (mínimo 10 caracteres).', 'VALIDACION');
    if (empty($d['foto'])) fallar(422, 'Adjunta una foto de la evidencia (incapacidad, citación…).', 'VALIDACION');
    $foto = guardarFoto((string) $d['foto']);
    $f = fila('SELECT * FROM fichas WHERE codigo = ?', [(string) $u['ficha']]);
    if (fila("SELECT id FROM excusas WHERE aprendiz_id = ? AND estado <> 'rechazada' AND desde <= ? AND hasta >= ?", [(int) $u['id'], $hasta, $desde])) {
        fallar(409, 'Ya tienes una excusa para esas fechas.', 'DUPLICADO');
    }
    db()->begin_transaction();
    $id = insertar('INSERT INTO excusas (aprendiz_id, ficha_id, desde, hasta, motivo, foto) VALUES (?, ?, ?, ?, ?, ?)',
        [(int) $u['id'], $f ? (int) $f['id'] : null, $desde, $hasta, $motivo, $foto]);
    $titulo = "Excusa de {$u['nombre']} (ficha {$u['ficha']})";
    $detalle = ($desde === $hasta ? "El $desde" : "Del $desde al $hasta") . " · $motivo";
    if ($f && $f['instructor_id']) notificar((int) $f['instructor_id'], 'excusa', $titulo, $detalle, null);
    notificarAdministrativos('excusa', $titulo, $detalle, null);
    db()->commit();
    responder(excusaPublica(fila(SQL_EXCUSAS . ' WHERE x.id = ?', [$id])), 201);
}

/** POST /excuses/{id}/review {estado: aprobada|rechazada, observacion} (instructor de la ficha o administrativo). */
function rutaRevisarExcusa(int $id): never
{
    $u = exigirRol('administrativo', 'instructor');
    $x = fila(SQL_EXCUSAS . ' WHERE x.id = ?', [$id]) ?? fallar(404, 'La excusa no existe.', 'NO_ENCONTRADO');
    if (!revisaExcusasDe($u, $x['ficha_codigo'])) fallar(403, 'Solo el instructor de la ficha o coordinación revisan esta excusa.', 'PERMISO');
    if ($x['estado'] !== 'pendiente') fallar(409, 'La excusa ya fue revisada.', 'ESTADO');
    $d = cuerpo();
    $estado = opcion($d, 'estado', ['aprobada', 'rechazada'], true, 'si se aprueba o se rechaza');
    $observacion = texto($d, 'observacion', 300, $estado === 'rechazada', 'el motivo del rechazo');
    consulta('UPDATE excusas SET estado = ?, observacion = ?, revisada_por = ?, revisada_en = NOW() WHERE id = ?', [$estado, $observacion, (int) $u['id'], $id]);
    notificar((int) $x['aprendiz_id'], 'excusa_revisada', $estado === 'aprobada' ? 'Tu excusa fue aprobada' : 'Tu excusa fue rechazada',
        ($x['desde'] === $x['hasta'] ? "El {$x['desde']}" : "Del {$x['desde']} al {$x['hasta']}") . " · revisó {$u['nombre']}" . ($observacion ? " · $observacion" : ''), null);
    responder(excusaPublica(fila(SQL_EXCUSAS . ' WHERE x.id = ?', [$id])));
}

/* ---------------- notificaciones (contrato de la asistencia) ---------------- */

/** GET /notifications: las del usuario, con los tipos del contrato (clase-cancelada, dano-grave, riesgo, p004…). */
function rutaNotificacionesAsistencia(): never
{
    $u = usuario();
    $lista = filas('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 50', [(int) $u['id']]);
    responder(array_map(fn($n) => ['id' => (int) $n['id'], 'tipo' => str_replace('_', '-', $n['tipo']), 'titulo' => $n['titulo'], 'detalle' => $n['detalle'],
        'fecha' => iso($n['created_at']), 'leida' => (bool) $n['leida']], $lista));
}

function rutaLeerNotificacionAsistencia(int $id): never
{
    $u = usuario();
    consulta('UPDATE notifications SET leida = 1 WHERE id = ? AND user_id = ?', [$id, (int) $u['id']]);
    responder(null, 204);
}

/* ---------------- P004 ---------------- */

function p004Publico(array $r): array
{
    return ['documento' => $r['documento'], 'nombre' => $r['nombre'], 'ficha' => $r['ficha'], 'programa' => $r['programa'], 'estado' => $r['estado'],
        'actualizadoPor' => $r['actualizado_por_nombre'] ?? null, 'actualizadoEn' => iso($r['actualizado_en'])];
}

const SQL_P004 = 'SELECT p.*, u.nombre AS actualizado_por_nombre FROM p004 p LEFT JOIN users u ON u.id = p.actualizado_por';

function rutaP004(): never
{
    exigirRol('administrativo');
    responder(array_map('p004Publico', filas(SQL_P004 . ' ORDER BY p.ficha, p.nombre')));
}

/** POST /p004/import {registros: [{documento, nombre, ficha, programa, estado}]} */
function rutaImportarP004(): never
{
    $u = exigirRol('administrativo');
    $registros = cuerpo()['registros'] ?? null;
    if (!is_array($registros) || !$registros) fallar(422, 'No hay registros para importar.', 'VALIDACION');
    if (count($registros) > 3000) fallar(422, 'Máximo 3000 registros por importación.', 'VALIDACION');
    db()->begin_transaction();
    foreach ($registros as $n => $r) {
        $doc = (string) ($r['documento'] ?? '');
        $estado = mb_strtoupper(trim((string) ($r['estado'] ?? '')));
        if (!preg_match('/^\d{6,12}$/', $doc) || !in_array($estado, ESTADOS_P004, true) || !preg_match('/^\d{5,8}$/', (string) ($r['ficha'] ?? ''))) {
            db()->rollback();
            fallar(422, 'El registro ' . ($n + 1) . ' no es válido (documento, ficha o estado).', 'VALIDACION');
        }
        consulta('INSERT INTO p004 (documento, nombre, ficha, programa, estado, actualizado_por, actualizado_en) VALUES (?, ?, ?, ?, ?, ?, NOW())
                  ON DUPLICATE KEY UPDATE nombre = VALUES(nombre), ficha = VALUES(ficha), programa = VALUES(programa), estado = VALUES(estado),
                                          actualizado_por = VALUES(actualizado_por), actualizado_en = NOW()',
            [$doc, mb_substr((string) ($r['nombre'] ?? ''), 0, 120), (string) $r['ficha'], mb_substr((string) ($r['programa'] ?? ''), 0, 160), $estado, (int) $u['id']]);
    }
    notificarAdministrativos('p004', 'P004 actualizado', count($registros) . " registros importados por {$u['nombre']}", null, null, (int) $u['id']);
    db()->commit();
    responder(['importados' => count($registros), 'total' => (int) fila('SELECT COUNT(*) n FROM p004')['n']]);
}

/** PATCH /p004/{documento} {estado} */
function rutaEstadoP004(string $documento): never
{
    $u = exigirRol('administrativo');
    $estado = opcion(cuerpo(), 'estado', ESTADOS_P004, true, 'el estado');
    if (!fila('SELECT documento FROM p004 WHERE documento = ?', [$documento])) fallar(404, 'El aprendiz no está en el P004.', 'NO_EXISTE');
    consulta('UPDATE p004 SET estado = ?, actualizado_por = ?, actualizado_en = NOW() WHERE documento = ?', [$estado, (int) $u['id'], $documento]);
    responder(p004Publico(fila(SQL_P004 . ' WHERE p.documento = ?', [$documento])));
}
