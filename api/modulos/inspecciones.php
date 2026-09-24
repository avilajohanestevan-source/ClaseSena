<?php
/**
 * Entrega de ambientes.
 *
 *   1. El instructor revisa el salón al entrar: checklist y, si hay daños,
 *      escanea el ítem y deja foto como evidencia          → en_curso
 *   2. Termina la revisión; se avisa al portero              → pendiente_recepcion
 *   3. El portero genera el QR de entrega                    → pendiente_recepcion + qr_generado_en
 *   4. El instructor escanea el QR y confirma la recepción   → recibida
 *   en_curso | pendiente_recepcion ──cancel (instructor)──▶ cancelada
 *
 * instructor_id = quien revisa y recibe; portero_id = quien genera el QR
 * (entrega). Cada daño es una fila de inspection_items vinculada a
 * inventory_items; el ítem pasa a "danado" mientras el reporte exista. Al
 * recibir un ambiente con daños se avisa a coordinación (administrativos).
 */

const CHECKLIST = [
    ['aseo', 'Aseo y orden'],
    ['luces', 'Iluminación'],
    ['ventilacion', 'Aire / ventilación'],
    ['puertas', 'Puertas, ventanas y chapas'],
    ['mobiliario', 'Sillas y mesas'],
    ['equipos', 'Equipos encienden'],
    ['electrico', 'Tomas y cableado seguros'],
    ['senalizacion', 'Señalización y extintor'],
];
const TIPOS_DANO = ['rotura', 'no_funciona', 'faltante', 'suciedad', 'otro'];
const SEVERIDADES = ['leve', 'moderada', 'grave'];

const SQL_INSPECCIONES = "
    SELECT s.*, e.codigo AS amb_codigo, e.nombre AS amb_nombre, e.bloque AS amb_bloque, e.portero_id AS amb_portero_id,
           pa.nombre AS amb_portero, i.nombre AS instructor_nombre, p.nombre AS portero_nombre,
           (SELECT COUNT(*) FROM inspection_items d WHERE d.inspection_id = s.id) AS danos,
           (SELECT COUNT(*) FROM inspection_items d WHERE d.inspection_id = s.id AND d.severidad = 'grave') AS danos_graves
    FROM inspections s
    JOIN environments e ON e.id = s.environment_id
    JOIN users i ON i.id = s.instructor_id
    LEFT JOIN users p ON p.id = s.portero_id
    LEFT JOIN users pa ON pa.id = e.portero_id";

function checklistVacio(): array
{
    return array_map(fn($c) => ['clave' => $c[0], 'etiqueta' => $c[1], 'ok' => null], CHECKLIST);
}

function resumenInspeccion(array $s): array
{
    // El instructor nunca recibe el texto del QR: tiene que escanearlo en el celular del portero.
    $verQr = $s['qr_generado_en'] && $s['estado'] === 'pendiente_recepcion' && usuario()['rol'] !== 'instructor';
    return [
        'id' => (int) $s['id'],
        'estado' => $s['estado'],
        'resultado' => $s['resultado'],
        'qr' => $verQr ? 'SENA-INSP:' . $s['qr_token'] : null,
        'qrGeneradoEn' => iso($s['qr_generado_en']),
        'ambiente' => [
            'id' => (int) $s['environment_id'], 'codigo' => $s['amb_codigo'], 'nombre' => $s['amb_nombre'],
            'bloque' => $s['amb_bloque'], 'porteroId' => $s['amb_portero_id'] !== null ? (int) $s['amb_portero_id'] : null,
            'portero' => $s['amb_portero'],
        ],
        'instructor' => ['id' => (int) $s['instructor_id'], 'nombre' => $s['instructor_nombre']],
        'portero' => $s['portero_id'] ? ['id' => (int) $s['portero_id'], 'nombre' => $s['portero_nombre']] : null,
        'iniciadaEn' => iso($s['iniciada_en']),
        'confirmadaEn' => iso($s['confirmada_en']),
        'recibidaEn' => iso($s['recibida_en']),
        'danos' => (int) $s['danos'],
        'danosGraves' => (int) $s['danos_graves'],
    ];
}

function buscarInspeccion(int $id): array
{
    $s = fila(SQL_INSPECCIONES . ' WHERE s.id = ?', [$id]);
    if (!$s) fallar(404, 'La revisión no existe.', 'NO_ENCONTRADO');
    $u = usuario();
    $puede = match ($u['rol']) {
        'administrativo', 'portero' => true,
        'instructor' => (int) $s['instructor_id'] === (int) $u['id'],
        default => false,
    };
    if (!$puede) fallar(403, 'No tienes acceso a esta revisión.', 'PERMISO');
    return $s;
}

/** Solo el instructor que la inició y mientras siga en curso. */
function inspeccionEditable(int $id): array
{
    $u = exigirRol('instructor');
    $s = buscarInspeccion($id);
    if ((int) $s['instructor_id'] !== (int) $u['id']) fallar(403, 'Solo el instructor que inició la revisión puede modificarla.', 'PERMISO');
    if ($s['estado'] !== 'en_curso') fallar(409, 'La revisión ya se terminó; no se puede modificar.', 'ESTADO');
    return $s;
}

function detalleInspeccion(array $s): array
{
    $id = (int) $s['id'];
    $danos = filas(
        'SELECT d.*, it.codigo, it.nombre, it.categoria FROM inspection_items d
         JOIN inventory_items it ON it.id = d.inventory_item_id WHERE d.inspection_id = ? ORDER BY d.reportado_en',
        [$id]
    );
    $reportados = array_column($danos, 'inventory_item_id');
    $inventario = filas(SQL_ITEMS . ' WHERE i.environment_id = ? ORDER BY i.codigo', [(int) $s['environment_id']]);
    return resumenInspeccion($s) + [
        'checklist' => $s['checklist'] ? json_decode($s['checklist'], true) : checklistVacio(),
        'observaciones' => $s['observaciones'],
        // Constancias: el portero al generar el QR (entrega) y el instructor al escanearlo (recibe).
        'entrega' => $s['qr_generado_en'] ? ['nombre' => $s['firma_portero_nombre'], 'fecha' => iso($s['qr_generado_en'])] : null,
        'recibe' => $s['recibida_en'] ? ['nombre' => $s['firma_instructor_nombre'], 'fecha' => iso($s['recibida_en'])] : null,
        'reportes' => array_map(fn($d) => [
            'id' => (int) $d['id'],
            'itemId' => (int) $d['inventory_item_id'],
            'codigo' => $d['codigo'],
            'nombre' => $d['nombre'],
            'categoria' => $d['categoria'],
            'tipoDano' => $d['tipo_dano'],
            'severidad' => $d['severidad'],
            'comentario' => $d['comentario'],
            'foto' => $d['foto'],
            'reportadoEn' => iso($d['reportado_en']),
        ], $danos),
        'inventario' => array_map(fn($i) => itemPublico($i) + ['reportado' => in_array($i['id'], $reportados)], $inventario),
    ];
}

/** GET /inspections?estado&resultado&ambienteId&instructorId&desde&hasta&asignados */
function rutaInspecciones(): never
{
    $u = exigirRol('administrativo', 'instructor', 'portero');
    $where = [];
    $params = [];
    if ($u['rol'] === 'instructor') { $where[] = 's.instructor_id = ?'; $params[] = (int) $u['id']; }
    // Portero: las que entregó él o las de sus ambientes asignados.
    if ($u['rol'] === 'portero' && !empty($_GET['asignados'])) { $where[] = '(s.portero_id = ? OR e.portero_id = ?)'; array_push($params, (int) $u['id'], (int) $u['id']); }
    if ($v = opcion($_GET, 'estado', ['en_curso', 'pendiente_recepcion', 'recibida', 'cancelada'], false)) { $where[] = 's.estado = ?'; $params[] = $v; }
    else $where[] = "s.estado <> 'cancelada'";
    if ($v = opcion($_GET, 'resultado', ['ok', 'con_danos'], false)) { $where[] = 's.resultado = ?'; $params[] = $v; }
    if ($v = entero($_GET, 'ambienteId', false)) { $where[] = 's.environment_id = ?'; $params[] = $v; }
    if ($v = entero($_GET, 'instructorId', false)) { $where[] = 's.instructor_id = ?'; $params[] = $v; }
    foreach (['desde' => '>=', 'hasta' => '<='] as $campo => $op) {
        if (!empty($_GET[$campo])) {
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $_GET[$campo])) fallar(422, "La fecha '$campo' no es válida.", 'VALIDACION');
            $where[] = "DATE(s.iniciada_en) $op ?";
            $params[] = $_GET[$campo];
        }
    }
    $sql = SQL_INSPECCIONES . ' WHERE ' . implode(' AND ', $where) . ' ORDER BY s.iniciada_en DESC LIMIT 300';
    responder(array_map('resumenInspeccion', filas($sql, $params)));
}

function rutaInspeccion(int $id): never
{
    responder(detalleInspeccion(buscarInspeccion($id)));
}

/** GET /inspections/by-qr/{token}: consulta (portero y administrativo). El instructor recibe con POST …/receive. */
function rutaInspeccionPorQr(string $token): never
{
    exigirRol('administrativo', 'portero');
    $s = fila('SELECT id FROM inspections WHERE qr_token = ?', [$token]);
    if (!$s) fallar(404, 'El QR no corresponde a ninguna entrega.', 'NO_ENCONTRADO');
    responder(detalleInspeccion(buscarInspeccion((int) $s['id'])));
}

/** POST /inspections {ambienteId}: el instructor inicia la revisión. Si ya tenía una en curso en ese ambiente, la retoma. */
function rutaIniciarInspeccion(): never
{
    $u = exigirRol('instructor');
    $ambienteId = entero(cuerpo(), 'ambienteId');
    $amb = buscarAmbiente($ambienteId);
    if (!$amb['activo']) fallar(409, 'El ambiente está desactivado.', 'ESTADO');

    $abierta = fila("SELECT s.id, s.estado, s.instructor_id, u.nombre FROM inspections s JOIN users u ON u.id = s.instructor_id
                     WHERE s.environment_id = ? AND s.estado IN ('en_curso', 'pendiente_recepcion')", [$ambienteId]);
    if ($abierta) {
        $propia = (int) $abierta['instructor_id'] === (int) $u['id'];
        if ($propia) responder(detalleInspeccion(buscarInspeccion((int) $abierta['id'])));
        fallar(409, $abierta['estado'] === 'en_curso'
            ? "El ambiente {$amb['codigo']} ya lo está revisando {$abierta['nombre']}."
            : "El ambiente {$amb['codigo']} está esperando la entrega a {$abierta['nombre']}.", 'EN_CURSO');
    }
    $otra = fila("SELECT e.codigo FROM inspections s JOIN environments e ON e.id = s.environment_id
                  WHERE s.instructor_id = ? AND s.estado = 'en_curso'", [(int) $u['id']]);
    if ($otra) fallar(409, "Ya tienes una revisión en curso en el ambiente {$otra['codigo']}. Termínala o cancélala primero.", 'EN_CURSO');

    $id = insertar(
        'INSERT INTO inspections (environment_id, instructor_id, qr_token, checklist, iniciada_en) VALUES (?, ?, ?, ?, NOW())',
        [$ambienteId, (int) $u['id'], nuevoToken(), json_encode(checklistVacio(), JSON_UNESCAPED_UNICODE)]
    );
    responder(detalleInspeccion(buscarInspeccion($id)), 201);
}

function nuevoToken(): string
{
    return strtoupper(bin2hex(random_bytes(8)));
}

/** Valida el checklist recibido contra la plantilla. $completo exige que todo esté marcado. */
function checklistRecibido($lista, bool $completo): array
{
    if (!is_array($lista)) fallar(422, 'El checklist no es válido.', 'VALIDACION');
    $marcas = [];
    foreach ($lista as $c) {
        if (is_array($c) && isset($c['clave'])) $marcas[$c['clave']] = $c['ok'] ?? null;
    }
    $resultado = [];
    foreach (CHECKLIST as [$clave, $etiqueta]) {
        $ok = $marcas[$clave] ?? null;
        if ($ok !== null && !is_bool($ok)) fallar(422, 'El checklist no es válido.', 'VALIDACION');
        if ($completo && $ok === null) fallar(422, "Falta revisar \"$etiqueta\" en el checklist.", 'CHECKLIST_INCOMPLETO');
        $resultado[] = ['clave' => $clave, 'etiqueta' => $etiqueta, 'ok' => $ok];
    }
    return $resultado;
}

function rutaGuardarChecklist(int $id): never
{
    inspeccionEditable($id);
    $d = cuerpo();
    $checklist = checklistRecibido($d['checklist'] ?? null, false);
    consulta('UPDATE inspections SET checklist = ?, observaciones = ? WHERE id = ?',
        [json_encode($checklist, JSON_UNESCAPED_UNICODE), texto($d, 'observaciones', 500, false, 'las observaciones'), $id]);
    responder(detalleInspeccion(buscarInspeccion($id)));
}

/** POST /inspections/{id}/items: reporte de daño de un ítem del inventario del ambiente. */
function rutaReportarDano(int $id): never
{
    $s = inspeccionEditable($id);
    $d = cuerpo();
    $item = null;
    if (!empty($d['itemId'])) $item = fila(SQL_ITEMS . ' WHERE i.id = ?', [(int) $d['itemId']]);
    elseif (!empty($d['codigo'])) $item = fila(SQL_ITEMS . ' WHERE i.codigo = ?', [strtoupper(preg_replace('/^SENA-INV:/i', '', (string) $d['codigo']))]);
    if (!$item) fallar(404, 'El ítem no existe en el inventario.', 'NO_ENCONTRADO');
    if ((int) $item['environment_id'] !== (int) $s['environment_id']) {
        fallar(422, "El ítem {$item['codigo']} pertenece al ambiente {$item['ambiente_codigo']}, no al {$s['amb_codigo']}.", 'OTRO_AMBIENTE');
    }
    if (fila('SELECT id FROM inspection_items WHERE inspection_id = ? AND inventory_item_id = ?', [$id, (int) $item['id']])) {
        fallar(409, "Ya reportaste un daño para {$item['codigo']} en esta inspección.", 'DUPLICADO');
    }
    $tipo = opcion($d, 'tipoDano', TIPOS_DANO, true, 'el tipo de daño');
    $severidad = opcion($d, 'severidad', SEVERIDADES, true, 'la severidad');
    $comentario = texto($d, 'comentario', 500, true, 'el comentario');
    if (mb_strlen($comentario) < 10) fallar(422, 'Describe el daño con al menos 10 caracteres.', 'VALIDACION');
    // La foto es la evidencia del daño: siempre obligatoria.
    if (empty($d['foto'])) fallar(422, 'Toma una foto del daño como evidencia.', 'VALIDACION');
    $foto = guardarFoto((string) $d['foto']);

    db()->begin_transaction();
    insertar(
        'INSERT INTO inspection_items (inspection_id, inventory_item_id, tipo_dano, severidad, comentario, foto, estado_item_anterior, reportado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
        [$id, (int) $item['id'], $tipo, $severidad, $comentario, $foto, $item['estado']]
    );
    consulta("UPDATE inventory_items SET estado = 'danado' WHERE id = ? AND estado <> 'baja'", [(int) $item['id']]);
    db()->commit();
    responder(detalleInspeccion(buscarInspeccion($id)), 201);
}

function deshacerReporte(array $r): void
{
    consulta('UPDATE inventory_items SET estado = ? WHERE id = ?', [$r['estado_item_anterior'], (int) $r['inventory_item_id']]);
    if ($r['foto'] && is_file(__DIR__ . '/../../' . $r['foto'])) @unlink(__DIR__ . '/../../' . $r['foto']);
    consulta('DELETE FROM inspection_items WHERE id = ?', [(int) $r['id']]);
}

function rutaQuitarDano(int $id, int $reporteId): never
{
    inspeccionEditable($id);
    $r = fila('SELECT * FROM inspection_items WHERE id = ? AND inspection_id = ?', [$reporteId, $id]);
    if (!$r) fallar(404, 'El reporte no existe.', 'NO_ENCONTRADO');
    db()->begin_transaction();
    deshacerReporte($r);
    db()->commit();
    responder(detalleInspeccion(buscarInspeccion($id)));
}


/**
 * POST /inspections/{id}/confirm {checklist, observaciones}
 * El instructor termina la revisión: queda esperando el QR del portero, a
 * quien se avisa (el asignado al ambiente o, si no hay, todos los porteros).
 */
function rutaConfirmarInspeccion(int $id): never
{
    $s = inspeccionEditable($id);
    $d = cuerpo();
    $checklist = checklistRecibido($d['checklist'] ?? null, true);
    $observaciones = texto($d, 'observaciones', 500, false, 'las observaciones');
    $conNovedad = in_array(false, array_column($checklist, 'ok'), true);
    if ($conNovedad && !$observaciones) fallar(422, 'Describe en observaciones la novedad marcada en el checklist.', 'VALIDACION');
    $resultado = ((int) $s['danos'] > 0 || $conNovedad) ? 'con_danos' : 'ok';

    db()->begin_transaction();
    consulta(
        "UPDATE inspections SET estado = 'pendiente_recepcion', resultado = ?, checklist = ?, observaciones = ?, confirmada_en = NOW() WHERE id = ?",
        [$resultado, json_encode($checklist, JSON_UNESCAPED_UNICODE), $observaciones, $id]
    );
    $porteros = $s['amb_portero_id']
        ? [(int) $s['amb_portero_id']]
        : array_map('intval', array_column(filas("SELECT id FROM users WHERE rol = 'portero' AND activo = 1"), 'id'));
    $detalle = "{$s['instructor_nombre']} terminó la revisión · "
        . ($resultado === 'ok' ? 'sin novedades' : ((int) $s['danos'] ? "{$s['danos']} daño(s) reportado(s)" : 'con novedades'));
    foreach ($porteros as $p) notificar($p, 'revision_lista', "Genera el QR de entrega: ambiente {$s['amb_codigo']}", $detalle, $id);
    db()->commit();
    responder(detalleInspeccion(buscarInspeccion($id)));
}

/** POST /inspections/{id}/qr: el portero genera (o renueva) el QR de entrega. Cada QR sirve una sola vez. */
function rutaGenerarQr(int $id): never
{
    $u = exigirRol('portero');
    $s = buscarInspeccion($id);
    if ($s['estado'] !== 'pendiente_recepcion') {
        fallar(409, $s['estado'] === 'en_curso' ? 'El instructor todavía no ha terminado la revisión.' : 'Este ambiente ya fue entregado o la revisión se canceló.', 'ESTADO');
    }
    consulta(
        "UPDATE inspections SET portero_id = ?, firma_portero_nombre = ?, qr_token = ?, qr_generado_en = NOW()
         WHERE id = ? AND estado = 'pendiente_recepcion'",
        [(int) $u['id'], $u['nombre'], nuevoToken(), $id]
    );
    responder(detalleInspeccion(buscarInspeccion($id)));
}

/**
 * POST /inspections/by-qr/{token}/receive: el instructor escanea el QR del
 * portero y confirma que recibió el ambiente. Queda guardado quién entregó
 * (portero_id), quién recibió (instructor_id), las horas y el estado de los
 * ítems; si hay daños o novedades se avisa a coordinación.
 */
function rutaRecibirPorQr(string $token): never
{
    $u = exigirRol('instructor');
    $s = fila(SQL_INSPECCIONES . ' WHERE s.qr_token = ? AND s.qr_generado_en IS NOT NULL', [$token]);
    if (!$s) fallar(404, 'El QR no corresponde a ninguna entrega. Pide al portero que lo genere de nuevo.', 'NO_ENCONTRADO');
    if ((int) $s['instructor_id'] !== (int) $u['id']) {
        fallar(403, "Este QR es para {$s['instructor_nombre']}, que hizo la revisión del ambiente {$s['amb_codigo']}.", 'PERMISO');
    }
    if ($s['estado'] === 'recibida') responder(detalleInspeccion($s));
    if ($s['estado'] !== 'pendiente_recepcion') fallar(409, 'Esta revisión fue cancelada.', 'ESTADO');
    $id = (int) $s['id'];

    db()->begin_transaction();
    consulta(
        "UPDATE inspections SET estado = 'recibida', firma_instructor_nombre = ?, recibida_en = NOW()
         WHERE id = ? AND estado = 'pendiente_recepcion'",
        [$u['nombre'], $id]
    );
    consulta("UPDATE notifications SET leida = 1 WHERE inspection_id = ? AND tipo = 'revision_lista'", [$id]);
    notificar((int) $s['portero_id'], 'entrega_recibida', "{$u['nombre']} recibió el ambiente {$s['amb_codigo']}",
        'Escaneó el QR de entrega' . ((int) $s['danos'] ? " · {$s['danos']} daño(s) registrado(s)" : ' · sin novedades'), $id);
    if ($s['resultado'] === 'con_danos') {
        $detalle = "Revisó y recibió {$u['nombre']} · entregó {$s['portero_nombre']} · "
            . ((int) $s['danos'] ? "{$s['danos']} ítem(s) marcados como dañados en el inventario" : 'novedades en el checklist')
            . ((int) $s['danos_graves'] ? " ({$s['danos_graves']} grave)" : '');
        foreach (filas("SELECT id FROM users WHERE rol = 'administrativo' AND activo = 1") as $a) {
            notificar((int) $a['id'], (int) $s['danos_graves'] ? 'dano_grave' : 'dano_reportado',
                "Novedades en el ambiente {$s['amb_codigo']}", $detalle, $id);
        }
    }
    db()->commit();
    responder(detalleInspeccion(buscarInspeccion($id)));
}

/** POST /inspections/{id}/cancel: el instructor cancela su revisión mientras no haya recibido el ambiente. */
function rutaCancelarInspeccion(int $id): never
{
    $u = exigirRol('instructor');
    $s = buscarInspeccion($id);
    if ((int) $s['instructor_id'] !== (int) $u['id']) fallar(403, 'Solo el instructor que inició la revisión puede cancelarla.', 'PERMISO');
    if (!in_array($s['estado'], ['en_curso', 'pendiente_recepcion'], true)) fallar(409, 'El ambiente ya fue recibido; no se puede cancelar.', 'ESTADO');
    db()->begin_transaction();
    foreach (filas('SELECT * FROM inspection_items WHERE inspection_id = ?', [$id]) as $r) deshacerReporte($r);
    consulta("UPDATE inspections SET estado = 'cancelada' WHERE id = ?", [$id]);
    db()->commit();
    responder(null, 204);
}
