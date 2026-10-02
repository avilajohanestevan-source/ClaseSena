<?php
/**
 * Entrega de ambientes.
 *
 *   1. El instructor revisa el salón al entrar: checklist e ítems. "Todo está
 *      bien" es un atajo de la pantalla que marca todo OK sin enviar nada.
 *      Si hay novedades escanea el ítem o la familia y deja foto  → en_curso
 *   2. Termina la revisión (checklist + ítems OK); se avisa al portero → pendiente_recepcion
 *   3. El portero genera el QR de entrega                    → pendiente_recepcion + qr_generado_en
 *   4. El instructor escanea el QR y confirma la recepción   → recibida + estado_salon
 *   en_curso | pendiente_recepcion ──cancel (instructor)──▶ cancelada
 *
 * instructor_id = quien revisa y recibe; portero_id = quien genera el QR
 * (entrega). Cada novedad es una fila de inspection_items vinculada a un ítem,
 * a una familia completa o, si es del salón, a su ubicación. Su naturaleza:
 *   · permanente (aire dañado, video beam sin lámpara): el ítem (o todos los
 *     componentes de la familia) pasa a "danado" y, en el momento de
 *     reportarla, queda "en_curso" en persistent_issues hasta que un
 *     instructor o un administrativo la resuelva (modulos/novedades.php), con
 *     aviso a coordinación, administrativo e inventario. Si el reporte se
 *     retira antes de entregar el ambiente, la novedad queda anulada;
 *   · temporal o limpieza: queda en el historial y no cambia el inventario.
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
const NATURALEZAS = ['permanente' => 'permanente', 'temporal' => 'temporal', 'limpieza' => 'de limpieza'];
/** Daños del salón que no son ítems del inventario. */
const UBICACIONES = [
    'pared' => 'Pared', 'techo' => 'Techo', 'piso' => 'Piso', 'puerta' => 'Puerta', 'ventana' => 'Ventana',
    'electrica' => 'Instalación eléctrica', 'estructura' => 'Estructura', 'otro' => 'Otro (salón)',
];

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
        'SELECT d.*, it.codigo, it.nombre, c.nombre AS categoria, f.codigo AS familia_codigo, f.nombre AS familia_nombre, f.tipo AS familia_tipo
         FROM inspection_items d
         LEFT JOIN inventory_items it ON it.id = d.inventory_item_id
         LEFT JOIN inventory_categories c ON c.id = it.category_id
         LEFT JOIN item_families f ON f.id = d.family_id
         WHERE d.inspection_id = ? ORDER BY d.reportado_en',
        [$id]
    );
    $reportados = array_map('intval', array_filter(array_column($danos, 'inventory_item_id')));
    $familiasReportadas = array_map('intval', array_filter(array_column($danos, 'family_id')));
    $inventario = filas(SQL_ITEMS . ' WHERE i.environment_id = ? ORDER BY i.codigo', [(int) $s['environment_id']]);
    $familias = filas(SQL_FAMILIAS . ' WHERE f.environment_id = ? ORDER BY f.codigo', [(int) $s['environment_id']]);
    return resumenInspeccion($s) + [
        'checklist' => $s['checklist'] ? json_decode($s['checklist'], true) : checklistVacio(),
        'observaciones' => $s['observaciones'],
        // Ítems que el instructor marcó OK al terminar (el atajo "Todo está bien" los marca todos en la pantalla).
        'itemsOk' => array_map('intval', json_decode($s['items_ok'] ?? '[]', true) ?: []),
        // Foto del estado del salón al recibirlo (null hasta que se recibe).
        'estadoSalon' => $s['estado_salon'] ? json_decode($s['estado_salon'], true) : null,
        // Constancias: el portero al generar el QR (entrega) y el instructor al escanearlo (recibe).
        'entrega' => $s['qr_generado_en'] ? ['nombre' => $s['firma_portero_nombre'], 'fecha' => iso($s['qr_generado_en'])] : null,
        'recibe' => $s['recibida_en'] ? ['nombre' => $s['firma_instructor_nombre'], 'fecha' => iso($s['recibida_en'])] : null,
        'reportes' => array_map(fn($d) => [
            'id' => (int) $d['id'],
            'itemId' => $d['inventory_item_id'] !== null ? (int) $d['inventory_item_id'] : null,
            'familiaId' => $d['family_id'] !== null ? (int) $d['family_id'] : null,
            'ubicacion' => $d['ubicacion'],
            'codigo' => $d['codigo'] ?? $d['familia_codigo'],
            // Familia: su nombre; sin ítem ni familia: la ubicación en el salón.
            'nombre' => $d['nombre'] ?? ($d['family_id'] ? "Familia {$d['familia_tipo']} · {$d['familia_nombre']}" : (UBICACIONES[$d['ubicacion']] ?? 'Salón')),
            'categoria' => $d['categoria'] ?? ($d['family_id'] ? 'Familia completa' : 'Salón'),
            'naturaleza' => $d['naturaleza'],
            'tipoDano' => $d['tipo_dano'],
            'severidad' => $d['severidad'],
            'comentario' => $d['comentario'],
            'foto' => $d['foto'],
            'novedadId' => $d['persistent_issue_id'] !== null ? (int) $d['persistent_issue_id'] : null,
            'reportadoEn' => iso($d['reportado_en']),
        ], $danos),
        'inventario' => array_map(fn($i) => itemPublico($i) + [
            'reportado' => in_array((int) $i['id'], $reportados, true) || ($i['family_id'] !== null && in_array((int) $i['family_id'], $familiasReportadas, true)),
            'reportadoPorFamilia' => $i['family_id'] !== null && in_array((int) $i['family_id'], $familiasReportadas, true),
        ], $inventario),
        'familias' => array_map(fn($f) => familiaPublica($f) + [
            'itemIds' => array_map('intval', array_column(array_filter($inventario, fn($i) => (int) $i['family_id'] === (int) $f['id']), 'id')),
            'reportado' => in_array((int) $f['id'], $familiasReportadas, true),
        ], $familias),
        // Jornadas de hoy en este ambiente: el instructor solo ve las suyas; portero y administrativo, todas.
        'asignadosHoy' => asignadosHoyPara(usuario(), (int) $s['environment_id'], asignacionesEfectivas(hoy(), hoy(), (int) $s['environment_id'])),
        // Novedades permanentes que el ambiente ya tiene abiertas: no hace falta volver a reportarlas.
        'novedadesActivas' => array_map('novedadPublica', filas(SQL_NOVEDADES . " WHERE n.environment_id = ? AND n.estado = 'en_curso' ORDER BY n.creada_en", [(int) $s['environment_id']])),
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

/** Sin naturaleza explícita: la suciedad es de limpieza; lo demás (rotura, no funciona, faltante…), permanente. */
function naturalezaPorDefecto(string $tipoDano): string
{
    return $tipoDano === 'suciedad' ? 'limpieza' : 'permanente';
}

/** Una novedad permanente deja el ítem "danado", salvo que ya esté de baja, fuera de servicio o en reparación. */
const SQL_MARCAR_DANADO = "UPDATE inventory_items SET estado = 'danado' WHERE id = ? AND estado NOT IN ('baja', 'fuera_servicio', 'en_reparacion')";

/**
 * POST /inspections/{id}/items: novedad de un ítem, de una familia completa o del salón.
 *   {itemId | familiaId | codigo (lo que se escaneó: ítem o familia) | ubicacion,
 *    naturaleza?, tipoDano, severidad, comentario, foto}
 * Un componente y su familia no se reportan a la vez en la misma revisión.
 */
function rutaReportarDano(int $id): never
{
    $s = inspeccionEditable($id);
    $u = usuario();
    $d = conAlias(cuerpo(), 'familiaId', 'familia_id');
    $item = $familia = $ubicacion = null;
    if (!empty($d['itemId'])) {
        $item = fila(SQL_ITEMS . ' WHERE i.id = ?', [(int) $d['itemId']]) ?? fallar(404, 'El ítem no existe en el inventario.', 'NO_ENCONTRADO');
    } elseif (!empty($d['familiaId'])) {
        $familia = fila(SQL_FAMILIAS . ' WHERE f.id = ?', [(int) $d['familiaId']]) ?? fallar(404, 'La familia no existe.', 'NO_ENCONTRADO');
    } elseif (!empty($d['codigo'])) {
        $l = leerCodigoEscaneado((string) $d['codigo']) ?? fallar(404, 'El código no corresponde a ningún ítem ni familia del inventario.', 'NO_ENCONTRADO');
        if ($l['tipo'] === 'item') $item = $l['fila']; else $familia = $l['fila'];
    } else {
        // Daño del salón que no es un ítem del inventario (pared, techo, piso…): va asociado al ambiente.
        $ubicacion = opcion($d, 'ubicacion', array_keys(UBICACIONES), true, 'dónde está el daño');
    }
    $objetivo = $item ?? $familia;
    if ($objetivo && (int) $objetivo['environment_id'] !== (int) $s['environment_id']) {
        fallar(422, ($item ? "El ítem" : "La familia") . " {$objetivo['codigo']} pertenece al ambiente {$objetivo['ambiente_codigo']}, no al {$s['amb_codigo']}.", 'OTRO_AMBIENTE');
    }
    if ($item) {
        if (fila('SELECT id FROM inspection_items WHERE inspection_id = ? AND inventory_item_id = ?', [$id, (int) $item['id']])) {
            fallar(409, "Ya reportaste una novedad para {$item['codigo']} en esta revisión.", 'DUPLICADO');
        }
        if ($item['family_id'] && fila('SELECT id FROM inspection_items WHERE inspection_id = ? AND family_id = ?', [$id, (int) $item['family_id']])) {
            fallar(409, "Ya reportaste la familia completa {$item['familia_codigo']}, que incluye {$item['codigo']}.", 'DUPLICADO');
        }
    }
    if ($familia) {
        if (fila('SELECT id FROM inspection_items WHERE inspection_id = ? AND family_id = ?', [$id, (int) $familia['id']])) {
            fallar(409, "Ya reportaste la familia {$familia['codigo']} en esta revisión.", 'DUPLICADO');
        }
        $sueltos = array_column(filas('SELECT it.codigo FROM inspection_items d JOIN inventory_items it ON it.id = d.inventory_item_id
                                       WHERE d.inspection_id = ? AND it.family_id = ?', [$id, (int) $familia['id']]), 'codigo');
        if ($sueltos) fallar(409, 'Ya reportaste componentes de esta familia (' . implode(', ', $sueltos) . '). Quita esos reportes para reportar la familia completa.', 'DUPLICADO');
        if (!(int) $familia['componentes']) fallar(422, "La familia {$familia['codigo']} no tiene componentes.", 'VALIDACION');
    }
    $tipo = opcion($d, 'tipoDano', TIPOS_DANO, true, 'el tipo de daño');
    $severidad = opcion($d, 'severidad', SEVERIDADES, true, 'la severidad');
    $naturaleza = opcion($d, 'naturaleza', array_keys(NATURALEZAS), false, 'si la novedad es permanente, temporal o de limpieza') ?? naturalezaPorDefecto($tipo);
    $comentario = texto($d, 'comentario', 500, true, 'el comentario');
    if (mb_strlen($comentario) < 10) fallar(422, 'Describe el daño con al menos 10 caracteres.', 'VALIDACION');
    // La foto es la evidencia del daño: siempre obligatoria.
    if (empty($d['foto'])) fallar(422, 'Toma una foto del daño como evidencia.', 'VALIDACION');
    $foto = guardarFoto((string) $d['foto']);

    $componentes = $familia ? filas('SELECT id, estado FROM inventory_items WHERE family_id = ?', [(int) $familia['id']]) : [];
    $permanente = $naturaleza === 'permanente';
    $resumen = 'Novedad ' . NATURALEZAS[$naturaleza] . " en la revisión del ambiente {$s['amb_codigo']}: " . str_replace('_', ' ', $tipo) . " ($severidad)";
    db()->begin_transaction();
    $reporteId = insertar(
        'INSERT INTO inspection_items (inspection_id, inventory_item_id, family_id, ubicacion, naturaleza, tipo_dano, severidad, comentario, foto,
                                       estado_item_anterior, estados_anteriores, reportado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
        [$id, $item ? (int) $item['id'] : null, $familia ? (int) $familia['id'] : null, $ubicacion, $naturaleza, $tipo, $severidad, $comentario, $foto,
         $item['estado'] ?? 'operativo', $familia ? json_encode(array_column($componentes, 'estado', 'id')) : null]
    );
    $marcados = [];
    if ($item) $marcados[] = ['id' => (int) $item['id'], 'detalle' => $resumen];
    foreach ($componentes as $c) $marcados[] = ['id' => (int) $c['id'], 'detalle' => "$resumen · reportada a la familia completa {$familia['codigo']}"];
    foreach ($marcados as $m) {
        if ($permanente) consulta(SQL_MARCAR_DANADO, [$m['id']]);
        historial($m['id'], 'dano', $m['detalle'] . ($permanente ? '. Pasa a Dañado.' : '. El inventario no cambia.'), (int) $u['id'], $id);
    }
    // La permanente queda en curso desde ya (visible en Novedades) y avisa a coordinación, administrativo e inventario.
    if ($permanente) abrirNovedadDeReporte($reporteId, $s, $u);
    db()->commit();
    responder(detalleInspeccion(buscarInspeccion($id)), 201);
}

function deshacerReporte(array $r, ?int $usuarioId): void
{
    // Solo las permanentes cambiaron el estado del inventario: esas se restauran.
    $restaurar = $r['naturaleza'] === 'permanente';
    $previos = $r['inventory_item_id'] ? [(int) $r['inventory_item_id'] => $r['estado_item_anterior']] : [];
    if ($r['family_id']) $previos += json_decode($r['estados_anteriores'] ?? '{}', true) ?: [];
    foreach ($previos as $itemId => $estado) {
        if ($restaurar) consulta('UPDATE inventory_items SET estado = ? WHERE id = ?', [$estado, (int) $itemId]);
        historial((int) $itemId, 'dano_retirado', 'Se retiró el reporte de novedad' . ($r['family_id'] ? ' de la familia' : '')
            . ($restaurar ? '; vuelve a ' . ETIQUETA_ESTADO[$estado] : ''), $usuarioId, (int) $r['inspection_id']);
    }
    retirarReporteDeNovedad($r, $usuarioId);
    // La foto de una novedad permanente es evidencia del historial: se conserva.
    if ($r['foto'] && !$r['persistent_issue_id'] && is_file(__DIR__ . '/../../' . $r['foto'])) @unlink(__DIR__ . '/../../' . $r['foto']);
    consulta('DELETE FROM inspection_items WHERE id = ?', [(int) $r['id']]);
}

function rutaQuitarDano(int $id, int $reporteId): never
{
    inspeccionEditable($id);
    $r = fila('SELECT * FROM inspection_items WHERE id = ? AND inspection_id = ?', [$reporteId, $id]);
    if (!$r) fallar(404, 'El reporte no existe.', 'NO_ENCONTRADO');
    db()->begin_transaction();
    deshacerReporte($r, (int) usuario()['id']);
    db()->commit();
    responder(detalleInspeccion(buscarInspeccion($id)));
}


/**
 * POST /inspections/{id}/confirm {checklist, observaciones?, itemsOk?}
 * El instructor termina la revisión: queda esperando el QR del portero, a
 * quien se avisa (el asignado al ambiente o, si no hay, todos los porteros).
 * itemsOk son los ítems que marcó OK; el botón "Todo está bien" de la app
 * solo los marca en la pantalla: el envío es siempre este paso, explícito.
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

    // Ítems OK: deben ser del ambiente; los que tienen una novedad en esta revisión no cuentan como OK.
    $itemsOk = listaIds($d['itemsOk'] ?? [], 5000);
    if ($itemsOk) {
        $delAmbiente = array_map('intval', array_column(filas('SELECT id FROM inventory_items WHERE environment_id = ? AND id IN (' . marcas(count($itemsOk)) . ')',
            [(int) $s['environment_id'], ...$itemsOk]), 'id'));
        if (count($delAmbiente) !== count($itemsOk)) fallar(422, 'Algunos ítems marcados OK no son de este ambiente.', 'VALIDACION');
        $conNovedadIds = array_map('intval', array_column(filas(
            'SELECT it.id FROM inspection_items d JOIN inventory_items it ON it.id = d.inventory_item_id OR it.family_id = d.family_id WHERE d.inspection_id = ?', [$id]), 'id'));
        $itemsOk = array_values(array_diff($itemsOk, $conNovedadIds));
    }

    db()->begin_transaction();
    consulta(
        "UPDATE inspections SET estado = 'pendiente_recepcion', resultado = ?, checklist = ?, observaciones = ?, items_ok = ?, confirmada_en = NOW() WHERE id = ?",
        [$resultado, json_encode($checklist, JSON_UNESCAPED_UNICODE), $observaciones, json_encode($itemsOk), $id]
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
 * (portero_id), quién recibió (instructor_id), las horas, el estado del salón
 * (estado_salon) y sus reportes (las novedades permanentes ya están en curso
 * desde que se reportaron). Si hubo novedades se avisa el resumen a
 * coordinación, administrativo e inventario.
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
        'Escaneó el QR de entrega' . ((int) $s['danos'] ? " · {$s['danos']} novedad(es) registrada(s)" : ' · sin novedades'), $id);
    // Novedades permanentes: abren una persistent_issue (o se suman a la que ya estaba activa) y avisan.
    // Las novedades permanentes ya quedaron en curso al reportarlas: aquí solo se cuentan para el resumen.
    $nuevas = (int) fila("SELECT COUNT(*) n FROM persistent_issues WHERE inspection_id = ? AND estado <> 'anulada'", [$id])['n'];
    if ($s['resultado'] === 'con_danos') {
        // Resumen para coordinación, administrativo e inventario: qué pasó a "Dañado", qué es del salón y qué fue temporal.
        $reportes = filas('SELECT d.ubicacion, d.naturaleza, COALESCE(it.codigo, f.codigo) codigo FROM inspection_items d
                           LEFT JOIN inventory_items it ON it.id = d.inventory_item_id LEFT JOIN item_families f ON f.id = d.family_id
                           WHERE d.inspection_id = ?', [$id]);
        $codigos = array_column(array_filter($reportes, fn($r) => $r['codigo'] && $r['naturaleza'] === 'permanente'), 'codigo');
        $salon = array_map(fn($r) => mb_strtolower(UBICACIONES[$r['ubicacion']]), array_filter($reportes, fn($r) => $r['ubicacion']));
        $temporales = count(array_filter($reportes, fn($r) => $r['naturaleza'] !== 'permanente'));
        $partes = array_filter([
            $codigos ? 'Inventario: ' . implode(', ', $codigos) . (count($codigos) === 1 ? ' pasa' : ' pasan') . ' a Dañado' : null,
            $salon ? count($salon) . ' daño(s) del salón (' . implode(', ', array_unique($salon)) . ')' : null,
            $nuevas ? "$nuevas novedad(es) permanente(s) nueva(s) en curso" : null,
            $temporales ? "$temporales incidencia(s) temporal(es) o de limpieza" : null,
            !$reportes ? 'Novedades en el checklist' : null,
            (int) $s['danos_graves'] ? "{$s['danos_graves']} grave(s)" : null,
        ]);
        notificarAdministrativos((int) $s['danos_graves'] ? 'dano_grave' : 'dano_reportado', "Novedades en el ambiente {$s['amb_codigo']}",
            "Recibió {$u['nombre']} · entregó {$s['portero_nombre']} · " . implode(' · ', $partes), $id);
    }
    consulta('UPDATE inspections SET estado_salon = ? WHERE id = ?', [json_encode(estadoSalon($s), JSON_UNESCAPED_UNICODE), $id]);
    db()->commit();
    responder(detalleInspeccion(buscarInspeccion($id)));
}

/**
 * Lo que queda guardado del salón al recibirlo: cómo estaba el inventario,
 * qué marcó OK el instructor, qué novedades reportó y cuántas permanentes
 * siguen activas en el ambiente.
 */
function estadoSalon(array $s): array
{
    $amb = (int) $s['environment_id'];
    $inv = fila("SELECT COUNT(*) total, SUM(estado = 'operativo') operativos, SUM(estado = 'danado') danados,
                        SUM(estado = 'en_reparacion') en_reparacion, SUM(estado = 'fuera_servicio') fuera_servicio
                 FROM inventory_items WHERE environment_id = ? AND estado <> 'baja'", [$amb]);
    $reportes = filas('SELECT id, naturaleza, persistent_issue_id FROM inspection_items WHERE inspection_id = ?', [(int) $s['id']]);
    $porNaturaleza = array_count_values(array_column($reportes, 'naturaleza'));
    $checklist = json_decode($s['checklist'] ?? '[]', true) ?: [];
    return [
        'resultado' => $s['resultado'],
        'checklistConNovedad' => count(array_filter($checklist, fn($c) => ($c['ok'] ?? null) === false)),
        'items' => [
            'total' => (int) $inv['total'],
            'operativos' => (int) $inv['operativos'],
            'danados' => (int) $inv['danados'],
            'enReparacion' => (int) $inv['en_reparacion'],
            'fueraServicio' => (int) $inv['fuera_servicio'],
            'marcadosOk' => count(json_decode($s['items_ok'] ?? '[]', true) ?: []),
        ],
        'reportes' => [
            'total' => count($reportes),
            'permanentes' => $porNaturaleza['permanente'] ?? 0,
            'temporales' => $porNaturaleza['temporal'] ?? 0,
            'limpieza' => $porNaturaleza['limpieza'] ?? 0,
            'ids' => array_map('intval', array_column($reportes, 'id')),
        ],
        'novedadesActivas' => (int) fila("SELECT COUNT(*) n FROM persistent_issues WHERE environment_id = ? AND estado = 'en_curso'", [$amb])['n'],
        'registradoEn' => date(DATE_ATOM),
    ];
}

/** POST /inspections/{id}/cancel: el instructor cancela su revisión mientras no haya recibido el ambiente. */
function rutaCancelarInspeccion(int $id): never
{
    $u = exigirRol('instructor');
    $s = buscarInspeccion($id);
    if ((int) $s['instructor_id'] !== (int) $u['id']) fallar(403, 'Solo el instructor que inició la revisión puede cancelarla.', 'PERMISO');
    if (!in_array($s['estado'], ['en_curso', 'pendiente_recepcion'], true)) fallar(409, 'El ambiente ya fue recibido; no se puede cancelar.', 'ESTADO');
    db()->begin_transaction();
    foreach (filas('SELECT * FROM inspection_items WHERE inspection_id = ?', [$id]) as $r) deshacerReporte($r, (int) $u['id']);
    consulta("UPDATE inspections SET estado = 'cancelada' WHERE id = ?", [$id]);
    db()->commit();
    responder(null, 204);
}
