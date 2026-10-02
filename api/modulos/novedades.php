<?php
/**
 * Novedades permanentes (persistent_issues) e historial de novedades.
 *
 * Una novedad permanente (aire acondicionado dañado, video beam sin lámpara,
 * grieta en la pared) nace cuando se recibe un ambiente con un reporte de
 * naturaleza "permanente", o la registra un administrativo. Sigue activa
 * —revisión tras revisión— hasta que un administrativo la marca resuelta.
 * Mientras tanto el ítem (o los componentes de la familia) puede quedar
 * "fuera_servicio" o "baja". Al abrirse y al resolverse se avisa a
 * coordinación, administrativo e inventario (todos los administrativos).
 *
 * El historial (GET /issues) reúne cada novedad reportada: equipo o
 * ambiente, fecha, usuario, evidencia, naturaleza, estado y fecha de resolución.
 */

const SQL_NOVEDADES = "SELECT n.*, e.codigo AS ambiente_codigo, e.nombre AS ambiente_nombre,
                              it.codigo AS item_codigo, it.nombre AS item_nombre, it.estado AS item_estado,
                              f.codigo AS familia_codigo, f.nombre AS familia_nombre, f.tipo AS familia_tipo,
                              ur.nombre AS reportada_por_nombre, us.nombre AS resuelta_por_nombre,
                              (SELECT COUNT(*) FROM inspection_items d WHERE d.persistent_issue_id = n.id) AS reportes
                       FROM persistent_issues n
                       JOIN environments e ON e.id = n.environment_id
                       LEFT JOIN inventory_items it ON it.id = n.inventory_item_id
                       LEFT JOIN item_families f ON f.id = n.family_id
                       LEFT JOIN users ur ON ur.id = n.reportada_por
                       LEFT JOIN users us ON us.id = n.resuelta_por";

/** Estados en los que el administrativo puede dejar los ítems de una novedad activa. */
const ESTADOS_NOVEDAD_ITEM = ['danado', 'en_reparacion', 'fuera_servicio', 'baja'];

/** Ítem, familia o salón al que se refiere una novedad (o un reporte). */
function objetivoNovedad(array $n): array
{
    if ($n['inventory_item_id'] ?? null) return ['tipo' => 'item', 'id' => (int) $n['inventory_item_id'], 'codigo' => $n['item_codigo'], 'nombre' => $n['item_nombre']];
    if ($n['family_id'] ?? null) return ['tipo' => 'familia', 'id' => (int) $n['family_id'], 'codigo' => $n['familia_codigo'], 'nombre' => "Familia {$n['familia_tipo']} · {$n['familia_nombre']}"];
    return ['tipo' => 'salon', 'id' => null, 'codigo' => null, 'nombre' => 'Salón · ' . (UBICACIONES[$n['ubicacion']] ?? 'Otro')];
}

function novedadPublica(array $n): array
{
    $obj = objetivoNovedad($n);
    return [
        'id' => (int) $n['id'],
        'estado' => $n['estado'],
        'ambiente' => ['id' => (int) $n['environment_id'], 'codigo' => $n['ambiente_codigo'], 'nombre' => $n['ambiente_nombre']],
        'objetivo' => $obj,
        'titulo' => $obj['nombre'] . ($obj['codigo'] ? " · {$obj['codigo']}" : ''),
        'itemEstado' => $n['item_estado'],
        'ubicacion' => $n['ubicacion'],
        'tipoDano' => $n['tipo_dano'],
        'severidad' => $n['severidad'],
        'descripcion' => $n['descripcion'],
        'foto' => $n['foto'],
        'reportadaPor' => $n['reportada_por_nombre'],
        'inspeccionId' => $n['inspection_id'] !== null ? (int) $n['inspection_id'] : null,
        'creadaEn' => iso($n['creada_en']),
        'resueltaPor' => $n['resuelta_por_nombre'],
        'resueltaEn' => iso($n['resuelta_en']),
        'resolucion' => $n['resolucion'],
        // Cuántas revisiones la han reportado (la primera y las que se le sumaron).
        'reportes' => (int) ($n['reportes'] ?? 0),
    ];
}

function buscarNovedad(int $id): array
{
    $n = fila(SQL_NOVEDADES . ' WHERE n.id = ?', [$id]);
    if (!$n) fallar(404, 'La novedad no existe.', 'NO_ENCONTRADO');
    return $n;
}

/** Ítems afectados: el ítem, o los componentes actuales de la familia; ninguno si es del salón. */
function itemsDeNovedad(array $n): array
{
    if ($n['inventory_item_id']) return filas('SELECT id, codigo, estado FROM inventory_items WHERE id = ?', [(int) $n['inventory_item_id']]);
    if ($n['family_id']) return filas('SELECT id, codigo, estado FROM inventory_items WHERE family_id = ?', [(int) $n['family_id']]);
    return [];
}

/**
 * Al recibir un ambiente: cada reporte permanente abre una novedad, o se suma
 * a la que el ítem (o la familia) ya tenía activa para no duplicarla. Avisa
 * a coordinación, administrativo e inventario por cada novedad nueva.
 * @return array{nuevas:int[], vinculadas:int[]}
 */
function registrarNovedadesPermanentes(array $s, array $instructor): array
{
    $r = ['nuevas' => [], 'vinculadas' => []];
    $reportes = filas("SELECT * FROM inspection_items WHERE inspection_id = ? AND naturaleza = 'permanente'", [(int) $s['id']]);
    foreach ($reportes as $d) {
        $activa = $d['inventory_item_id']
            ? fila("SELECT id FROM persistent_issues WHERE inventory_item_id = ? AND estado = 'activa' ORDER BY id LIMIT 1", [(int) $d['inventory_item_id']])
            : ($d['family_id'] ? fila("SELECT id FROM persistent_issues WHERE family_id = ? AND estado = 'activa' ORDER BY id LIMIT 1", [(int) $d['family_id']]) : null);
        if ($activa) {
            $novedadId = (int) $activa['id'];
            $r['vinculadas'][] = $novedadId;
            $texto = "Reportada otra vez en la revisión del ambiente {$s['amb_codigo']}: se suma a la novedad permanente #$novedadId, que sigue activa";
        } else {
            $novedadId = insertar(
                'INSERT INTO persistent_issues (environment_id, inventory_item_id, family_id, ubicacion, tipo_dano, severidad, descripcion, foto,
                                                reportada_por, inspection_id, creada_en)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
                [(int) $s['environment_id'], $d['inventory_item_id'] !== null ? (int) $d['inventory_item_id'] : null,
                 $d['family_id'] !== null ? (int) $d['family_id'] : null, $d['ubicacion'], $d['tipo_dano'], $d['severidad'],
                 $d['comentario'], $d['foto'], (int) $instructor['id'], (int) $s['id']]
            );
            $r['nuevas'][] = $novedadId;
            $texto = "Novedad permanente #$novedadId abierta al recibir el ambiente {$s['amb_codigo']}: {$d['comentario']}";
        }
        consulta('UPDATE inspection_items SET persistent_issue_id = ? WHERE id = ?', [$novedadId, (int) $d['id']]);
        foreach (itemsDeNovedad($d) as $i) historial((int) $i['id'], 'novedad', $texto, (int) $instructor['id'], (int) $s['id'], $novedadId);
    }
    foreach ($r['nuevas'] as $novedadId) avisarNovedad(buscarNovedad($novedadId), 'novedad_permanente', 0);
    return $r;
}

/** Aviso a todos los administrativos (coordinación, administrativo e inventario). */
function avisarNovedad(array $n, string $tipo, int $excepto): void
{
    $obj = objetivoNovedad($n);
    $titulo = $tipo === 'novedad_resuelta'
        ? "Novedad resuelta en el ambiente {$n['ambiente_codigo']}"
        : "Novedad permanente en el ambiente {$n['ambiente_codigo']}";
    $detalle = $tipo === 'novedad_resuelta'
        ? "{$obj['nombre']}: {$n['resolucion']} · resolvió {$n['resuelta_por_nombre']}"
        : "{$obj['nombre']}" . ($obj['codigo'] ? " ({$obj['codigo']})" : '') . ': ' . str_replace('_', ' ', $n['tipo_dano']) . " ({$n['severidad']}) · "
          . ($n['reportada_por_nombre'] ? "reportó {$n['reportada_por_nombre']} · " : '') . 'sigue activa hasta que se marque resuelta';
    notificarAdministrativos($tipo, $titulo, $detalle, $n['inspection_id'] !== null ? (int) $n['inspection_id'] : null, (int) $n['id'], $excepto);
}

/* ---------------- rutas ---------------- */

/** GET /persistent-issues?estado=activa|resuelta&ambienteId */
function rutaNovedades(): never
{
    exigirRol('administrativo', 'instructor', 'portero');
    $where = [];
    $params = [];
    if ($v = opcion($_GET, 'estado', ['activa', 'resuelta'], false)) { $where[] = 'n.estado = ?'; $params[] = $v; }
    if ($v = entero($_GET, 'ambienteId', false)) { $where[] = 'n.environment_id = ?'; $params[] = $v; }
    $sql = SQL_NOVEDADES . ($where ? ' WHERE ' . implode(' AND ', $where) : '')
        . " ORDER BY n.estado = 'activa' DESC, FIELD(n.severidad, 'grave', 'moderada', 'leve'), n.creada_en DESC LIMIT 300";
    responder(array_map('novedadPublica', filas($sql, $params)));
}

/** GET /persistent-issues/{id}: con los ítems afectados y cada revisión que la reportó. */
function rutaNovedad(int $id): never
{
    exigirRol('administrativo', 'instructor', 'portero');
    $n = buscarNovedad($id);
    $reportes = filas(
        'SELECT d.id, d.inspection_id, d.comentario, d.foto, d.severidad, d.reportado_en, u.nombre AS instructor
         FROM inspection_items d JOIN inspections s ON s.id = d.inspection_id JOIN users u ON u.id = s.instructor_id
         WHERE d.persistent_issue_id = ? ORDER BY d.reportado_en DESC', [$id]);
    responder(novedadPublica($n) + [
        'items' => array_map(fn($i) => ['id' => (int) $i['id'], 'codigo' => $i['codigo'], 'estado' => $i['estado']], itemsDeNovedad($n)),
        'historial' => array_map(fn($d) => [
            'reporteId' => (int) $d['id'], 'inspeccionId' => (int) $d['inspection_id'], 'instructor' => $d['instructor'],
            'comentario' => $d['comentario'], 'foto' => $d['foto'], 'severidad' => $d['severidad'], 'fecha' => iso($d['reportado_en']),
        ], $reportes),
    ]);
}

/**
 * POST /persistent-issues (administrativo): registra una novedad permanente
 * sin revisión de por medio.
 * {ambienteId?, itemId | familiaId | codigo | ubicacion, tipoDano, severidad, descripcion, foto?, estadoItem?}
 * Los ítems pasan a estadoItem (por defecto "danado").
 */
function rutaCrearNovedad(): never
{
    $u = exigirRol('administrativo');
    $d = conAlias(cuerpo(), 'familiaId', 'familia_id');
    $item = $familia = $ubicacion = null;
    if (!empty($d['itemId'])) $item = fila(SQL_ITEMS . ' WHERE i.id = ?', [(int) $d['itemId']]) ?? fallar(404, 'El ítem no existe.', 'NO_ENCONTRADO');
    elseif (!empty($d['familiaId'])) $familia = fila(SQL_FAMILIAS . ' WHERE f.id = ?', [(int) $d['familiaId']]) ?? fallar(404, 'La familia no existe.', 'NO_ENCONTRADO');
    elseif (!empty($d['codigo'])) {
        $l = leerCodigoEscaneado((string) $d['codigo']) ?? fallar(404, 'El código no corresponde a ningún ítem ni familia.', 'NO_ENCONTRADO');
        if ($l['tipo'] === 'item') $item = $l['fila']; else $familia = $l['fila'];
    } else {
        $ubicacion = opcion($d, 'ubicacion', array_keys(UBICACIONES), true, 'dónde está la novedad');
    }
    $ambienteId = (int) (($item ?? $familia)['environment_id'] ?? buscarAmbiente(entero($d, 'ambienteId'))['id']);
    $activa = $item ? fila("SELECT id FROM persistent_issues WHERE inventory_item_id = ? AND estado = 'activa'", [(int) $item['id']])
        : ($familia ? fila("SELECT id FROM persistent_issues WHERE family_id = ? AND estado = 'activa'", [(int) $familia['id']]) : null);
    if ($activa) fallar(409, "Ya hay una novedad permanente activa (#{$activa['id']}) para " . ($item['codigo'] ?? $familia['codigo']) . '.', 'DUPLICADO');
    $tipo = opcion($d, 'tipoDano', TIPOS_DANO, true, 'el tipo de daño');
    $severidad = opcion($d, 'severidad', SEVERIDADES, true, 'la severidad');
    $descripcion = texto($d, 'descripcion', 500, true, 'la descripción');
    if (mb_strlen($descripcion) < 10) fallar(422, 'Describe la novedad con al menos 10 caracteres.', 'VALIDACION');
    $estadoItem = opcion($d, 'estadoItem', ESTADOS_NOVEDAD_ITEM, false, 'el estado del ítem') ?? 'danado';
    $foto = !empty($d['foto']) ? guardarFoto((string) $d['foto']) : null;

    db()->begin_transaction();
    $id = insertar(
        'INSERT INTO persistent_issues (environment_id, inventory_item_id, family_id, ubicacion, tipo_dano, severidad, descripcion, foto, reportada_por, creada_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
        [$ambienteId, $item ? (int) $item['id'] : null, $familia ? (int) $familia['id'] : null, $ubicacion, $tipo, $severidad, $descripcion, $foto, (int) $u['id']]
    );
    $n = buscarNovedad($id);
    foreach (itemsDeNovedad($n) as $i) {
        if ($i['estado'] !== 'baja') consulta('UPDATE inventory_items SET estado = ? WHERE id = ?', [$estadoItem, (int) $i['id']]);
        historial((int) $i['id'], 'novedad', "Novedad permanente #$id registrada por {$u['nombre']}: $descripcion · " . ETIQUETA_ESTADO[$i['estado']] . ' → ' . ETIQUETA_ESTADO[$estadoItem], (int) $u['id'], null, $id);
    }
    avisarNovedad($n, 'novedad_permanente', (int) $u['id']);
    db()->commit();
    responder(novedadPublica(buscarNovedad($id)), 201);
}

/**
 * PATCH /persistent-issues/{id} {estadoItem, severidad?, descripcion?} (administrativo)
 * Mientras siga activa: deja el ítem (o los componentes de la familia)
 * dañado, en reparación, fuera de servicio o de baja (inactivo).
 */
function rutaEditarNovedad(int $id): never
{
    $u = exigirRol('administrativo');
    $n = buscarNovedad($id);
    if ($n['estado'] !== 'activa') fallar(409, 'La novedad ya está resuelta.', 'ESTADO');
    $d = cuerpo();
    $estadoItem = opcion($d, 'estadoItem', ESTADOS_NOVEDAD_ITEM, false, 'el estado del ítem');
    $severidad = opcion($d, 'severidad', SEVERIDADES, false, 'la severidad') ?? $n['severidad'];
    $descripcion = texto($d, 'descripcion', 500, false, 'la descripción') ?? $n['descripcion'];
    if (!$estadoItem && $severidad === $n['severidad'] && $descripcion === $n['descripcion']) fallar(422, 'No hay cambios.', 'VALIDACION');
    if ($estadoItem && !$n['inventory_item_id'] && !$n['family_id']) fallar(422, 'Esta novedad es del salón: no tiene ítems que cambiar de estado.', 'VALIDACION');

    db()->begin_transaction();
    consulta('UPDATE persistent_issues SET severidad = ?, descripcion = ? WHERE id = ?', [$severidad, $descripcion, $id]);
    if ($estadoItem) {
        foreach (itemsDeNovedad($n) as $i) {
            if ($i['estado'] === $estadoItem) continue;
            consulta('UPDATE inventory_items SET estado = ? WHERE id = ?', [$estadoItem, (int) $i['id']]);
            historial((int) $i['id'], 'estado', 'Estado: ' . ETIQUETA_ESTADO[$i['estado']] . ' → ' . ETIQUETA_ESTADO[$estadoItem] . " (novedad permanente #$id)", (int) $u['id'], null, $id);
        }
    }
    db()->commit();
    responder(novedadPublica(buscarNovedad($id)));
}

/**
 * POST /persistent-issues/{id}/resolve {resolucion, estadoItem?} (administrativo)
 * La marca resuelta; los ítems vuelven a estadoItem (por defecto "operativo";
 * los que están de baja no cambian). Avisa a los demás administrativos y a
 * quien la reportó.
 */
function rutaResolverNovedad(int $id): never
{
    $u = exigirRol('administrativo');
    $n = buscarNovedad($id);
    if ($n['estado'] !== 'activa') fallar(409, 'La novedad ya estaba resuelta.', 'ESTADO');
    $d = cuerpo();
    $resolucion = texto($d, 'resolucion', 500, true, 'qué se hizo para resolverla');
    if (mb_strlen($resolucion) < 5) fallar(422, 'Describe la solución con al menos 5 caracteres.', 'VALIDACION');
    $estadoItem = opcion($d, 'estadoItem', ESTADOS_ITEM, false, 'el estado del ítem') ?? 'operativo';

    db()->begin_transaction();
    consulta("UPDATE persistent_issues SET estado = 'resuelta', resuelta_por = ?, resuelta_en = NOW(), resolucion = ? WHERE id = ? AND estado = 'activa'",
        [(int) $u['id'], $resolucion, $id]);
    foreach (itemsDeNovedad($n) as $i) {
        // Si el ítem tiene otra novedad activa (p. ej. la de su familia), sigue como está.
        $otra = fila("SELECT id FROM persistent_issues WHERE estado = 'activa' AND id <> ? AND (inventory_item_id = ? OR family_id = (SELECT family_id FROM inventory_items WHERE id = ?))",
            [$id, (int) $i['id'], (int) $i['id']]);
        $nuevo = $i['estado'] === 'baja' || $otra ? $i['estado'] : $estadoItem;
        if ($nuevo !== $i['estado']) consulta('UPDATE inventory_items SET estado = ? WHERE id = ?', [$nuevo, (int) $i['id']]);
        historial((int) $i['id'], 'novedad_resuelta', "Novedad permanente #$id resuelta: $resolucion"
            . ($nuevo !== $i['estado'] ? ' · ' . ETIQUETA_ESTADO[$i['estado']] . ' → ' . ETIQUETA_ESTADO[$nuevo] : ($otra ? " · sigue con la novedad #{$otra['id']}" : '')),
            (int) $u['id'], null, $id);
    }
    $n = buscarNovedad($id);
    avisarNovedad($n, 'novedad_resuelta', (int) $u['id']);
    $reporto = fila("SELECT id, rol FROM users WHERE id = ? AND activo = 1", [(int) $n['reportada_por']]);
    if ($reporto && $reporto['rol'] !== 'administrativo') {
        notificar((int) $reporto['id'], 'novedad_resuelta', "Se resolvió la novedad que reportaste en el ambiente {$n['ambiente_codigo']}",
            objetivoNovedad($n)['nombre'] . ": $resolucion", $n['inspection_id'] !== null ? (int) $n['inspection_id'] : null, $id);
    }
    db()->commit();
    responder(novedadPublica($n));
}

/**
 * GET /issues?ambienteId&itemId&naturaleza&estado&desde&hasta (administrativo)
 * Historial completo de novedades: todo lo reportado en las revisiones más
 * las novedades permanentes registradas por un administrativo.
 * estado: en_revision (la entrega no se ha recibido) | activa | resuelta
 * (permanentes) | cerrada (temporales y de limpieza, al recibir el ambiente).
 */
function rutaHistorialNovedades(): never
{
    exigirRol('administrativo');
    $ambienteId = entero($_GET, 'ambienteId', false);
    $itemId = entero($_GET, 'itemId', false);
    $naturaleza = opcion($_GET, 'naturaleza', array_keys(NATURALEZAS), false);
    $estado = opcion($_GET, 'estado', ['en_revision', 'activa', 'resuelta', 'cerrada'], false);
    foreach (['desde', 'hasta'] as $campo) {
        if (!empty($_GET[$campo]) && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $_GET[$campo])) fallar(422, "La fecha '$campo' no es válida.", 'VALIDACION');
    }

    $reportes = filas(
        "SELECT d.id, d.inspection_id, d.inventory_item_id, d.family_id, d.ubicacion, d.naturaleza, d.tipo_dano, d.severidad, d.comentario, d.foto,
                d.reportado_en, d.persistent_issue_id, s.environment_id, s.estado AS insp_estado, s.recibida_en,
                e.codigo AS ambiente_codigo, e.nombre AS ambiente_nombre, it.codigo AS item_codigo, it.nombre AS item_nombre, it.estado AS item_estado,
                f.codigo AS familia_codigo, f.nombre AS familia_nombre, f.tipo AS familia_tipo, u.nombre AS usuario,
                n.estado AS nov_estado, n.resuelta_en, ur.nombre AS resuelta_por_nombre, n.resolucion
         FROM inspection_items d
         JOIN inspections s ON s.id = d.inspection_id
         JOIN environments e ON e.id = s.environment_id
         JOIN users u ON u.id = s.instructor_id
         LEFT JOIN inventory_items it ON it.id = d.inventory_item_id
         LEFT JOIN item_families f ON f.id = d.family_id
         LEFT JOIN persistent_issues n ON n.id = d.persistent_issue_id
         LEFT JOIN users ur ON ur.id = n.resuelta_por
         WHERE s.estado <> 'cancelada'"
    );
    $manuales = filas(SQL_NOVEDADES . ' WHERE n.inspection_id IS NULL');

    $lista = [];
    foreach ($reportes as $r) {
        $est = $r['insp_estado'] !== 'recibida' ? 'en_revision' : ($r['naturaleza'] === 'permanente' ? ($r['nov_estado'] ?? 'activa') : 'cerrada');
        $lista[] = [
            'origen' => 'revision', 'id' => (int) $r['id'], 'inspeccionId' => (int) $r['inspection_id'],
            'novedadId' => $r['persistent_issue_id'] !== null ? (int) $r['persistent_issue_id'] : null,
            'ambiente' => ['id' => (int) $r['environment_id'], 'codigo' => $r['ambiente_codigo'], 'nombre' => $r['ambiente_nombre']],
            'objetivo' => objetivoNovedad($r), 'itemEstado' => $r['item_estado'],
            'naturaleza' => $r['naturaleza'], 'tipoDano' => $r['tipo_dano'], 'severidad' => $r['severidad'],
            'comentario' => $r['comentario'], 'foto' => $r['foto'], 'usuario' => $r['usuario'],
            'fecha' => iso($r['reportado_en']), 'estado' => $est,
            'resueltaEn' => iso($est === 'cerrada' ? $r['recibida_en'] : $r['resuelta_en']),
            'resueltaPor' => $r['resuelta_por_nombre'], 'resolucion' => $r['resolucion'],
            '_items' => array_filter([(int) $r['inventory_item_id']]), '_familia' => (int) $r['family_id'],
        ];
    }
    foreach ($manuales as $n) {
        $lista[] = [
            'origen' => 'administrativo', 'id' => (int) $n['id'], 'inspeccionId' => null, 'novedadId' => (int) $n['id'],
            'ambiente' => ['id' => (int) $n['environment_id'], 'codigo' => $n['ambiente_codigo'], 'nombre' => $n['ambiente_nombre']],
            'objetivo' => objetivoNovedad($n), 'itemEstado' => $n['item_estado'],
            'naturaleza' => 'permanente', 'tipoDano' => $n['tipo_dano'], 'severidad' => $n['severidad'],
            'comentario' => $n['descripcion'], 'foto' => $n['foto'], 'usuario' => $n['reportada_por_nombre'],
            'fecha' => iso($n['creada_en']), 'estado' => $n['estado'],
            'resueltaEn' => iso($n['resuelta_en']), 'resueltaPor' => $n['resuelta_por_nombre'], 'resolucion' => $n['resolucion'],
            '_items' => array_filter([(int) $n['inventory_item_id']]), '_familia' => (int) $n['family_id'],
        ];
    }
    $familiaDelItem = $itemId ? (int) (fila('SELECT family_id FROM inventory_items WHERE id = ?', [$itemId])['family_id'] ?? 0) : 0;
    $lista = array_values(array_filter($lista, function ($x) use ($ambienteId, $itemId, $familiaDelItem, $naturaleza, $estado) {
        $dia = substr($x['fecha'], 0, 10);
        return (!$ambienteId || $x['ambiente']['id'] === $ambienteId)
            && (!$itemId || in_array($itemId, $x['_items'], true) || ($familiaDelItem && $x['_familia'] === $familiaDelItem))
            && (!$naturaleza || $x['naturaleza'] === $naturaleza)
            && (!$estado || $x['estado'] === $estado)
            && (empty($_GET['desde']) || $dia >= $_GET['desde'])
            && (empty($_GET['hasta']) || $dia <= $_GET['hasta']);
    }));
    usort($lista, fn($a, $b) => strcmp($b['fecha'], $a['fecha']));
    responder(array_map(fn($x) => array_diff_key($x, ['_items' => 1, '_familia' => 1]), array_slice($lista, 0, 500)));
}
