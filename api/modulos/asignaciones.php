<?php
/**
 * Asignación de instructores a ambientes por jornada (mañana, tarde, noche).
 *
 *   dia         un solo día (fecha_inicio = fecha_fin)
 *   periodo     un rango de fechas
 *   permanente  sin fecha final: vale hasta que se reasigne o se anule
 *
 * Para cada ambiente, jornada y día vale la asignación vigente más
 * específica: día > periodo > permanente (así un reemplazo de un día no
 * obliga a tocar la asignación permanente). No puede haber dos del mismo
 * tipo para el mismo ambiente y jornada en fechas que se crucen.
 *
 * Reasignar o anular desde una fecha recorta la asignación (fecha_fin = día
 * anterior); si es desde su primer día, queda "reasignada" o "anulada". Cada
 * evento queda en audit_events y se avisa al instructor.
 */

const JORNADAS = ['manana' => 'mañana', 'tarde' => 'tarde', 'noche' => 'noche'];
const HORARIO_JORNADA = ['manana' => '6:00 a 12:00', 'tarde' => '12:00 a 18:00', 'noche' => '18:00 a 22:00'];
const TIPOS_ASIGNACION = ['dia', 'periodo', 'permanente'];
const PRIORIDAD_TIPO = ['dia' => 3, 'periodo' => 2, 'permanente' => 1];

const SQL_ASIGNACIONES = 'SELECT a.*, e.codigo AS ambiente_codigo, e.nombre AS ambiente_nombre, i.nombre AS instructor_nombre,
                                 uc.nombre AS creada_por_nombre, uz.nombre AS cerrada_por_nombre
                          FROM instructor_assignments a
                          JOIN environments e ON e.id = a.environment_id
                          JOIN users i ON i.id = a.instructor_id
                          LEFT JOIN users uc ON uc.id = a.creada_por
                          LEFT JOIN users uz ON uz.id = a.cerrada_por';

function asignacionPublica(array $a): array
{
    return [
        'id' => (int) $a['id'],
        'ambiente' => ['id' => (int) $a['environment_id'], 'codigo' => $a['ambiente_codigo'], 'nombre' => $a['ambiente_nombre']],
        'instructor' => ['id' => (int) $a['instructor_id'], 'nombre' => $a['instructor_nombre']],
        'jornada' => $a['jornada'],
        'tipo' => $a['tipo'],
        'fechaInicio' => $a['fecha_inicio'],
        'fechaFin' => $a['fecha_fin'],
        'estado' => $a['estado'],
        'motivo' => $a['motivo'],
        'reemplazaId' => $a['reemplaza_id'] !== null ? (int) $a['reemplaza_id'] : null,
        'creadaPor' => $a['creada_por_nombre'],
        'creadaEn' => iso($a['creada_en']),
        'cerradaPor' => $a['cerrada_por_nombre'],
        'cerradaEn' => iso($a['cerrada_en']),
        'motivoCierre' => $a['motivo_cierre'],
    ];
}

function buscarAsignacion(int $id): array
{
    $a = fila(SQL_ASIGNACIONES . ' WHERE a.id = ?', [$id]);
    if (!$a) fallar(404, 'La asignación no existe.', 'NO_ENCONTRADO');
    return $a;
}

function fechaValida($v, string $nombre, bool $obligatoria = true): ?string
{
    if ($v === null || $v === '') {
        if ($obligatoria) fallar(422, "Falta $nombre.", 'VALIDACION');
        return null;
    }
    $f = DateTime::createFromFormat('!Y-m-d', (string) $v);
    if (!$f || $f->format('Y-m-d') !== $v) fallar(422, ucfirst($nombre) . ' no es una fecha válida (aaaa-mm-dd).', 'VALIDACION');
    return $v;
}

function hoy(): string { return date('Y-m-d'); }
function diaAnterior(string $f): string { return (new DateTime($f))->modify('-1 day')->format('Y-m-d'); }

/** "Laura · mañana · solo el 2026-10-03" para el historial y los avisos. */
function describirAsignacion(array $a): string
{
    $cuando = match ($a['tipo']) {
        'dia' => "solo el {$a['fecha_inicio']}",
        'periodo' => "del {$a['fecha_inicio']} al {$a['fecha_fin']}",
        default => "permanente desde el {$a['fecha_inicio']}" . ($a['fecha_fin'] ? " hasta el {$a['fecha_fin']}" : ''),
    };
    return "{$a['instructor_nombre']} · " . JORNADAS[$a['jornada']] . " · $cuando";
}

/**
 * Vigentes que se cruzan con [inicio, fin] (fin null = sin final). Con
 * $mismoTipo filtra por tipo; $excepto excluye una asignación.
 */
function asignacionesQueSeCruzan(string $donde, array $params, string $inicio, ?string $fin, int $excepto = 0): array
{
    return filas(SQL_ASIGNACIONES . " WHERE a.estado = 'vigente' AND a.id <> ? AND $donde
                 AND a.fecha_inicio <= COALESCE(?, '9999-12-31') AND COALESCE(a.fecha_fin, '9999-12-31') >= ?",
        [$excepto, ...$params, $fin, $inicio]);
}

/** Valida que no choque con otra del mismo tipo (409) y devuelve advertencias si el instructor ya tiene esa jornada en otro ambiente. */
function revisarCruces(int $ambienteId, int $instructorId, string $jornada, string $tipo, string $inicio, ?string $fin, int $excepto = 0): array
{
    $duplicada = asignacionesQueSeCruzan('a.environment_id = ? AND a.jornada = ? AND a.tipo = ?', [$ambienteId, $jornada, $tipo], $inicio, $fin, $excepto);
    if ($duplicada) {
        $d = $duplicada[0];
        fallar(409, "El ambiente {$d['ambiente_codigo']} ya tiene asignada la jornada de la " . JORNADAS[$jornada] . ' (' . describirAsignacion($d)
            . '). Reasígnala o anúlala en lugar de crear otra.', 'DUPLICADO');
    }
    return array_map(fn($o) => "{$o['instructor_nombre']} también tiene la jornada de la " . JORNADAS[$jornada] . " en el ambiente {$o['ambiente_codigo']} ("
        . ($o['tipo'] === 'dia' ? "el {$o['fecha_inicio']}" : ($o['fecha_fin'] ? "del {$o['fecha_inicio']} al {$o['fecha_fin']}" : "desde el {$o['fecha_inicio']}")) . ')',
        asignacionesQueSeCruzan('a.instructor_id = ? AND a.jornada = ? AND a.environment_id <> ?', [$instructorId, $jornada, $ambienteId], $inicio, $fin, $excepto));
}

function instructorActivo($id): array
{
    $i = fila("SELECT * FROM users WHERE id = ? AND rol = 'instructor' AND activo = 1", [(int) $id]);
    if (!$i) fallar(422, 'El instructor elegido no existe o está inactivo.', 'VALIDACION');
    return $i;
}

/** [inicio, fin] según el tipo: día (fin = inicio), periodo (fin obligatorio) o permanente (sin fin). */
function fechasSegunTipo(string $tipo, array $d): array
{
    $inicio = fechaValida($d['fechaInicio'] ?? null, 'la fecha de inicio');
    if ($tipo === 'dia') return [$inicio, $inicio];
    if ($tipo === 'permanente') return [$inicio, null];
    $fin = fechaValida($d['fechaFin'] ?? null, 'la fecha final');
    if ($fin < $inicio) fallar(422, 'La fecha final no puede ser anterior a la de inicio.', 'VALIDACION');
    if ((new DateTime($inicio))->diff(new DateTime($fin))->days > 366) fallar(422, 'Un periodo puede durar máximo un año; para más, usa una asignación permanente.', 'VALIDACION');
    return [$inicio, $fin];
}

function avisarInstructor(int $instructorId, string $titulo, string $detalle): void
{
    notificar($instructorId, 'asignacion', $titulo, $detalle, null);
}

/* ---------------- consultas ---------------- */

/**
 * Asignación efectiva de cada ambiente y jornada para cada día del rango:
 * [ambienteId][fecha][jornada] = fila (la de mayor prioridad).
 */
function asignacionesEfectivas(string $desde, string $hasta, ?int $ambienteId = null): array
{
    $filas = filas(SQL_ASIGNACIONES . " WHERE a.estado = 'vigente' AND a.fecha_inicio <= ? AND COALESCE(a.fecha_fin, '9999-12-31') >= ?"
        . ($ambienteId ? ' AND a.environment_id = ?' : '') . ' ORDER BY a.id', $ambienteId ? [$hasta, $desde, $ambienteId] : [$hasta, $desde]);
    $r = [];
    for ($f = new DateTime($desde); $f->format('Y-m-d') <= $hasta; $f->modify('+1 day')) {
        $dia = $f->format('Y-m-d');
        foreach ($filas as $a) {
            if ($a['fecha_inicio'] > $dia || ($a['fecha_fin'] !== null && $a['fecha_fin'] < $dia)) continue;
            $actual = $r[(int) $a['environment_id']][$dia][$a['jornada']] ?? null;
            if (!$actual || PRIORIDAD_TIPO[$a['tipo']] > PRIORIDAD_TIPO[$actual['tipo']] || (PRIORIDAD_TIPO[$a['tipo']] === PRIORIDAD_TIPO[$actual['tipo']] && $a['id'] > $actual['id'])) {
                $r[(int) $a['environment_id']][$dia][$a['jornada']] = $a;
            }
        }
    }
    return $r;
}

/** Para las tarjetas de ambientes: quién está hoy en cada jornada. */
function asignadosHoy(int $ambienteId, array $efectivas): array
{
    $hoy = $efectivas[$ambienteId][hoy()] ?? [];
    return array_map(fn($j) => isset($hoy[$j]) ? ['jornada' => $j, 'instructorId' => (int) $hoy[$j]['instructor_id'], 'instructor' => $hoy[$j]['instructor_nombre'], 'tipo' => $hoy[$j]['tipo']]
        : ['jornada' => $j, 'instructorId' => null, 'instructor' => null, 'tipo' => null], array_keys(JORNADAS));
}

/**
 * GET /assignments/board?desde=aaaa-mm-dd&dias=7&ambienteId (personal)
 * Tablero: quién está asignado a cada ambiente, en cada jornada, cada día.
 */
function rutaTableroAsignaciones(): never
{
    exigirRol('administrativo', 'instructor', 'portero');
    $desde = fechaValida($_GET['desde'] ?? null, 'la fecha', false) ?? hoy();
    $dias = max(1, min(31, (int) ($_GET['dias'] ?? 7)));
    $hasta = (new DateTime($desde))->modify('+' . ($dias - 1) . ' day')->format('Y-m-d');
    $ambienteId = entero($_GET, 'ambienteId', false);
    $efectivas = asignacionesEfectivas($desde, $hasta, $ambienteId);
    $fechas = [];
    for ($f = new DateTime($desde); $f->format('Y-m-d') <= $hasta; $f->modify('+1 day')) $fechas[] = $f->format('Y-m-d');
    $ambientes = filas('SELECT id, codigo, nombre FROM environments WHERE activo = 1' . ($ambienteId ? ' AND id = ?' : '') . ' ORDER BY codigo', $ambienteId ? [$ambienteId] : []);
    responder([
        'desde' => $desde, 'hasta' => $hasta, 'fechas' => $fechas,
        'jornadas' => array_map(fn($k) => ['clave' => $k, 'etiqueta' => JORNADAS[$k], 'horario' => HORARIO_JORNADA[$k]], array_keys(JORNADAS)),
        'ambientes' => array_map(fn($e) => [
            'id' => (int) $e['id'], 'codigo' => $e['codigo'], 'nombre' => $e['nombre'],
            'celdas' => array_combine($fechas, array_map(fn($dia) => array_combine(array_keys(JORNADAS), array_map(function ($j) use ($efectivas, $e, $dia) {
                $a = $efectivas[(int) $e['id']][$dia][$j] ?? null;
                return $a ? ['id' => (int) $a['id'], 'instructorId' => (int) $a['instructor_id'], 'instructor' => $a['instructor_nombre'], 'tipo' => $a['tipo'],
                             'fechaInicio' => $a['fecha_inicio'], 'fechaFin' => $a['fecha_fin']] : null;
            }, array_keys(JORNADAS))), $fechas)),
        ], $ambientes),
    ]);
}

/** GET /assignments?ambienteId&instructorId&estado=vigente|todas&fecha (el instructor solo ve las suyas) */
function rutaAsignaciones(): never
{
    $u = exigirRol('administrativo', 'instructor');
    $where = [];
    $params = [];
    if ($u['rol'] === 'instructor') { $where[] = 'a.instructor_id = ?'; $params[] = (int) $u['id']; }
    elseif ($v = entero($_GET, 'instructorId', false)) { $where[] = 'a.instructor_id = ?'; $params[] = $v; }
    if ($v = entero($_GET, 'ambienteId', false)) { $where[] = 'a.environment_id = ?'; $params[] = $v; }
    if (($_GET['estado'] ?? 'vigente') !== 'todas') { $where[] = "a.estado = 'vigente'"; }
    if ($f = fechaValida($_GET['fecha'] ?? null, 'la fecha', false)) { $where[] = "a.fecha_inicio <= ? AND COALESCE(a.fecha_fin, '9999-12-31') >= ?"; array_push($params, $f, $f); }
    elseif (($_GET['estado'] ?? 'vigente') !== 'todas') { $where[] = "COALESCE(a.fecha_fin, '9999-12-31') >= ?"; $params[] = hoy(); }
    $sql = SQL_ASIGNACIONES . ($where ? ' WHERE ' . implode(' AND ', $where) : '')
        . " ORDER BY e.codigo, FIELD(a.jornada, 'manana', 'tarde', 'noche'), a.fecha_inicio DESC LIMIT 500";
    responder(array_map('asignacionPublica', filas($sql, $params)));
}

function rutaAsignacion(int $id): never
{
    $u = exigirRol('administrativo', 'instructor');
    $a = buscarAsignacion($id);
    if ($u['rol'] === 'instructor' && (int) $a['instructor_id'] !== (int) $u['id']) fallar(403, 'Solo puedes ver tus asignaciones.', 'PERMISO');
    responder(asignacionPublica($a) + ['eventos' => eventosDe('asignacion', $id)]);
}

/* ---------------- cambios (administrativo) ---------------- */

/** POST /assignments {ambienteId, instructorId, jornada, tipo, fechaInicio, fechaFin?, motivo?} → {asignacion, advertencias} */
function rutaCrearAsignacion(): never
{
    $u = exigirRol('administrativo');
    $d = cuerpo();
    $amb = buscarAmbiente(entero($d, 'ambienteId'));
    if (!$amb['activo']) fallar(409, 'El ambiente está desactivado.', 'ESTADO');
    $instructor = instructorActivo(entero($d, 'instructorId'));
    $jornada = opcion($d, 'jornada', array_keys(JORNADAS), true, 'la jornada');
    $tipo = opcion($d, 'tipo', TIPOS_ASIGNACION, true, 'si es por un día, por un periodo o permanente');
    [$inicio, $fin] = fechasSegunTipo($tipo, $d);
    if (($fin ?? '9999-12-31') < hoy()) fallar(422, 'No se puede asignar en fechas que ya pasaron.', 'VALIDACION');
    $motivo = texto($d, 'motivo', 300, false, 'el motivo');
    $advertencias = revisarCruces((int) $amb['id'], (int) $instructor['id'], $jornada, $tipo, $inicio, $fin);

    db()->begin_transaction();
    $id = insertar(
        'INSERT INTO instructor_assignments (environment_id, instructor_id, jornada, tipo, fecha_inicio, fecha_fin, motivo, creada_por, creada_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())',
        [(int) $amb['id'], (int) $instructor['id'], $jornada, $tipo, $inicio, $fin, $motivo, (int) $u['id']]
    );
    $a = buscarAsignacion($id);
    auditar('asignacion', $id, (int) $amb['id'], 'creada', describirAsignacion($a) . ($motivo ? " · $motivo" : ''), (int) $u['id'], null,
        ['instructorId' => (int) $instructor['id'], 'jornada' => $jornada, 'tipo' => $tipo, 'fechaInicio' => $inicio, 'fechaFin' => $fin]);
    avisarInstructor((int) $instructor['id'], "Te asignaron al ambiente {$amb['codigo']}", describirAsignacion($a) . ' (' . HORARIO_JORNADA[$jornada] . ')');
    db()->commit();
    responder(['asignacion' => asignacionPublica($a), 'advertencias' => $advertencias], 201);
}

/**
 * Fecha desde la que aplica un cambio: por defecto hoy (o el inicio, si
 * empieza después). Debe estar dentro de la asignación.
 */
function desdeDelCambio(array $a, $valor): string
{
    $desde = fechaValida($valor, 'la fecha desde la que aplica', false) ?? max(hoy(), $a['fecha_inicio']);
    if ($desde < $a['fecha_inicio'] || ($a['fecha_fin'] !== null && $desde > $a['fecha_fin'])) {
        fallar(422, 'La fecha del cambio debe estar dentro de la asignación (' . $a['fecha_inicio'] . ($a['fecha_fin'] ? " a {$a['fecha_fin']}" : ' en adelante') . ').', 'VALIDACION');
    }
    if ($desde < hoy()) fallar(422, 'No se pueden cambiar días que ya pasaron.', 'VALIDACION');
    return $desde;
}

/**
 * Cierra la asignación desde $desde: si es su primer día queda $estadoFinal
 * (reasignada o anulada); si no, se recorta hasta el día anterior y sigue
 * vigente para los días que ya pasaron.
 */
function cerrarAsignacionDesde(array $a, string $desde, string $estadoFinal, string $motivo, int $usuarioId): string
{
    if ($desde === $a['fecha_inicio']) {
        consulta('UPDATE instructor_assignments SET estado = ?, cerrada_por = ?, cerrada_en = NOW(), motivo_cierre = ? WHERE id = ?',
            [$estadoFinal, $usuarioId, $motivo, (int) $a['id']]);
        return $estadoFinal;
    }
    consulta('UPDATE instructor_assignments SET fecha_fin = ?, cerrada_por = ?, cerrada_en = NOW(), motivo_cierre = ? WHERE id = ?',
        [diaAnterior($desde), $usuarioId, $motivo, (int) $a['id']]);
    return 'recortada';
}

/**
 * POST /assignments/{id}/reassign {instructorId, motivo, desde?}
 * Otro instructor toma la jornada desde la fecha indicada (hasta donde iba
 * la original). → {asignacion (la nueva), anterior, advertencias}
 */
function rutaReasignar(int $id): never
{
    $u = exigirRol('administrativo');
    $a = buscarAsignacion($id);
    if ($a['estado'] !== 'vigente') fallar(409, 'La asignación ya no está vigente.', 'ESTADO');
    $d = cuerpo();
    $nuevo = instructorActivo(entero($d, 'instructorId'));
    if ((int) $nuevo['id'] === (int) $a['instructor_id']) fallar(422, 'Elige un instructor distinto al actual.', 'VALIDACION');
    $motivo = texto($d, 'motivo', 300, true, 'el motivo de la reasignación');
    $desde = desdeDelCambio($a, $d['desde'] ?? null);
    $advertencias = revisarCruces((int) $a['environment_id'], (int) $nuevo['id'], $a['jornada'], $a['tipo'], $desde, $a['fecha_fin'], (int) $a['id']);

    db()->begin_transaction();
    $resultado = cerrarAsignacionDesde($a, $desde, 'reasignada', "Reasignada a {$nuevo['nombre']}: $motivo", (int) $u['id']);
    $nuevaId = insertar(
        'INSERT INTO instructor_assignments (environment_id, instructor_id, jornada, tipo, fecha_inicio, fecha_fin, motivo, reemplaza_id, creada_por, creada_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
        [(int) $a['environment_id'], (int) $nuevo['id'], $a['jornada'], $a['tipo'], $desde, $a['fecha_fin'], $motivo, (int) $a['id'], (int) $u['id']]
    );
    $nueva = buscarAsignacion($nuevaId);
    $texto = "{$a['instructor_nombre']} → {$nuevo['nombre']} · " . JORNADAS[$a['jornada']] . " desde el $desde · $motivo";
    auditar('asignacion', (int) $a['id'], (int) $a['environment_id'], 'reasignada', $texto, (int) $u['id'], null,
        ['desde' => $desde, 'antes' => (int) $a['instructor_id'], 'despues' => (int) $nuevo['id'], 'nuevaAsignacionId' => $nuevaId, 'resultado' => $resultado]);
    auditar('asignacion', $nuevaId, (int) $a['environment_id'], 'creada', describirAsignacion($nueva) . " · reemplaza a {$a['instructor_nombre']} · $motivo", (int) $u['id']);
    avisarInstructor((int) $a['instructor_id'], "Cambio de asignación en el ambiente {$a['ambiente_codigo']}",
        "Desde el $desde la jornada de la " . JORNADAS[$a['jornada']] . " queda a cargo de {$nuevo['nombre']} · $motivo");
    avisarInstructor((int) $nuevo['id'], "Te asignaron al ambiente {$a['ambiente_codigo']}", describirAsignacion($nueva) . ' (' . HORARIO_JORNADA[$a['jornada']] . ')');
    db()->commit();
    responder(['asignacion' => asignacionPublica($nueva), 'anterior' => asignacionPublica(buscarAsignacion($id)), 'advertencias' => $advertencias]);
}

/**
 * POST /assignments/{id}/cancel {motivo, desde?}
 * Anula el turno desde la fecha indicada (por defecto hoy, o su inicio si es futuro).
 */
function rutaAnularAsignacion(int $id): never
{
    $u = exigirRol('administrativo');
    $a = buscarAsignacion($id);
    if ($a['estado'] !== 'vigente') fallar(409, 'La asignación ya no está vigente.', 'ESTADO');
    $d = cuerpo();
    $motivo = texto($d, 'motivo', 300, true, 'el motivo');
    $desde = desdeDelCambio($a, $d['desde'] ?? null);
    db()->begin_transaction();
    $resultado = cerrarAsignacionDesde($a, $desde, 'anulada', $motivo, (int) $u['id']);
    auditar('asignacion', $id, (int) $a['environment_id'], $resultado === 'anulada' ? 'anulada' : 'recortada',
        ($resultado === 'anulada' ? 'Turno anulado' : 'Turno anulado desde el ' . $desde . ' (vale hasta el ' . diaAnterior($desde) . ')') . ": $motivo",
        (int) $u['id'], null, ['desde' => $desde, 'resultado' => $resultado]);
    avisarInstructor((int) $a['instructor_id'], "Se anuló tu turno en el ambiente {$a['ambiente_codigo']}",
        JORNADAS[$a['jornada']] . " desde el $desde · $motivo");
    db()->commit();
    responder(asignacionPublica(buscarAsignacion($id)));
}
