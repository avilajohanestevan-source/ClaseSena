<?php
/**
 * Cuentadante del ambiente y revisión del inventario (acta de entrega).
 *
 * El cuentadante responde por el inventario del ambiente. Antes de recibirlo
 * hay que revisarlo ítem por ítem (OK, faltante o dañado) y aceptarlo:
 *   · tipo cuentadante: al crear el ambiente con un cuentadante, al cambiarlo
 *     en "Editar ambiente" o al asignar un instructor marcado como
 *     cuentadante. environments.cuentadante_id cambia solo cuando el nuevo
 *     acepta (hasta entonces responde el anterior);
 *   · tipo instructor: un instructor asignado por primera vez al ambiente.
 * Mientras tenga una revisión pendiente en el ambiente, esa persona no puede
 * iniciar la entrega diaria ("Ingresé" → 409 REVISION_INVENTARIO).
 *
 * El inventario del cuentadante se exporta e importa en Excel
 * (/environments/{id}/inventory/…) y el acta de la revisión también: se
 * descarga, se llena la columna "revision" (OK, FALTANTE, DAÑADO) y se sube.
 */

const ESTADOS_REVISION_ITEM = ['pendiente', 'ok', 'faltante', 'danado'];
const ETIQUETA_REVISION = ['pendiente' => 'PENDIENTE', 'ok' => 'OK', 'faltante' => 'FALTANTE', 'danado' => 'DAÑADO'];
const COLUMNAS_ACTA = ['codigo', 'nombre', 'serial', 'categoria', 'familia', 'valor', 'estado', 'revision', 'observacion'];

const SQL_REVISIONES = "SELECT r.*, e.codigo AS amb_codigo, e.nombre AS amb_nombre, e.cuentadante_id AS amb_cuentadante_id,
                               u.nombre AS responsable_nombre, u.rol AS responsable_rol, ca.nombre AS anterior_nombre,
                               cr.nombre AS creada_por_nombre, cz.nombre AS cerrada_por_nombre,
                               (SELECT COUNT(*) FROM revision_inventario_items x WHERE x.revision_id = r.id) AS total,
                               (SELECT COUNT(*) FROM revision_inventario_items x WHERE x.revision_id = r.id AND x.estado = 'pendiente') AS pendientes,
                               (SELECT COUNT(*) FROM revision_inventario_items x WHERE x.revision_id = r.id AND x.estado = 'ok') AS ok,
                               (SELECT COUNT(*) FROM revision_inventario_items x WHERE x.revision_id = r.id AND x.estado = 'faltante') AS faltantes,
                               (SELECT COUNT(*) FROM revision_inventario_items x WHERE x.revision_id = r.id AND x.estado = 'danado') AS danados
                        FROM revisiones_inventario r
                        JOIN environments e ON e.id = r.environment_id
                        JOIN users u ON u.id = r.responsable_id
                        LEFT JOIN users ca ON ca.id = r.cuentadante_anterior_id
                        LEFT JOIN users cr ON cr.id = r.creada_por
                        LEFT JOIN users cz ON cz.id = r.cerrada_por";

function revisionPublica(array $r): array
{
    return [
        'id' => (int) $r['id'],
        'tipo' => $r['tipo'],
        'estado' => $r['estado'],
        'ambiente' => ['id' => (int) $r['environment_id'], 'codigo' => $r['amb_codigo'], 'nombre' => $r['amb_nombre']],
        'responsable' => ['id' => (int) $r['responsable_id'], 'nombre' => $r['responsable_nombre'], 'rol' => $r['responsable_rol']],
        'cuentadanteAnterior' => $r['cuentadante_anterior_id'] ? ['id' => (int) $r['cuentadante_anterior_id'], 'nombre' => $r['anterior_nombre']] : null,
        'motivo' => $r['motivo'],
        'observaciones' => $r['observaciones'],
        'conteo' => ['total' => (int) $r['total'], 'pendientes' => (int) $r['pendientes'], 'ok' => (int) $r['ok'],
                     'faltantes' => (int) $r['faltantes'], 'danados' => (int) $r['danados']],
        'creadaPor' => $r['creada_por_nombre'], 'creadaEn' => iso($r['creada_en']),
        'cerradaPor' => $r['cerrada_por_nombre'], 'cerradaEn' => iso($r['cerrada_en']),
    ];
}

function buscarRevision(int $id): array
{
    $r = fila(SQL_REVISIONES . ' WHERE r.id = ?', [$id]);
    if (!$r) fallar(404, 'La revisión de inventario no existe.', 'NO_ENCONTRADO');
    $u = usuario();
    if ((int) $r['responsable_id'] !== (int) $u['id'] && !in_array($u['rol'], ROLES_INVENTARIO, true)) fallar(403, 'Esa revisión es de otra persona.', 'PERMISO');
    return $r;
}

/** Revisión pendiente de la persona en el ambiente (la bloquea para "Ingresé"). */
function revisionPendiente(int $ambienteId, int $userId): ?array
{
    return fila("SELECT * FROM revisiones_inventario WHERE environment_id = ? AND responsable_id = ? AND estado = 'pendiente' ORDER BY id LIMIT 1", [$ambienteId, $userId]);
}

/**
 * Mientras esté pendiente, la revisión tiene todos los ítems del ambiente
 * (sin los de baja): se agregan los nuevos y se quitan los que salieron.
 */
function sincronizarRevision(array $r): void
{
    if ($r['estado'] !== 'pendiente') return;
    $id = (int) $r['id'];
    $amb = (int) $r['environment_id'];
    consulta("INSERT IGNORE INTO revision_inventario_items (revision_id, inventory_item_id)
              SELECT ?, i.id FROM inventory_items i WHERE i.environment_id = ? AND i.estado <> 'baja'", [$id, $amb]);
    consulta("DELETE x FROM revision_inventario_items x JOIN inventory_items i ON i.id = x.inventory_item_id
              WHERE x.revision_id = ? AND (i.environment_id <> ? OR i.estado = 'baja')", [$id, $amb]);
}

/**
 * Crea la revisión que corresponda. Devuelve su id, o null si no hace falta:
 *   instructor  si ya revisó (o tiene pendiente) el inventario de este ambiente;
 *   cuentadante si ya es el cuentadante. Una revisión de cuentadante nueva
 *               anula la otra pendiente del mismo ambiente.
 */
function crearRevision(int $ambienteId, string $tipo, int $responsableId, ?int $creadaPor, string $motivo, ?int $asignacionId = null): ?int
{
    $amb = fila('SELECT * FROM environments WHERE id = ?', [$ambienteId]);
    if ($tipo === 'instructor') {
        if ((int) $amb['cuentadante_id'] === $responsableId) return null;
        if (fila("SELECT id FROM revisiones_inventario WHERE environment_id = ? AND responsable_id = ? AND estado IN ('pendiente', 'aceptada') LIMIT 1", [$ambienteId, $responsableId])) return null;
    } else {
        if ((int) $amb['cuentadante_id'] === $responsableId) return null;
        if ($ya = fila("SELECT id FROM revisiones_inventario WHERE environment_id = ? AND tipo = 'cuentadante' AND responsable_id = ? AND estado = 'pendiente'", [$ambienteId, $responsableId])) return (int) $ya['id'];
        consulta("UPDATE revisiones_inventario SET estado = 'anulada', cerrada_por = ?, cerrada_en = NOW(), observaciones = 'Reemplazada por otro cambio de cuentadante'
                  WHERE environment_id = ? AND tipo = 'cuentadante' AND estado = 'pendiente'", [$creadaPor, $ambienteId]);
        // Un instructor que pasa a cuentadante no necesita además la revisión de instructor.
        consulta("UPDATE revisiones_inventario SET estado = 'anulada', cerrada_por = ?, cerrada_en = NOW(), observaciones = 'Incluida en la revisión como cuentadante'
                  WHERE environment_id = ? AND tipo = 'instructor' AND responsable_id = ? AND estado = 'pendiente'", [$creadaPor, $ambienteId, $responsableId]);
    }
    $id = insertar('INSERT INTO revisiones_inventario (environment_id, tipo, responsable_id, cuentadante_anterior_id, asignacion_id, motivo, creada_por, creada_en)
                    VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
        [$ambienteId, $tipo, $responsableId, $tipo === 'cuentadante' ? ($amb['cuentadante_id'] !== null ? (int) $amb['cuentadante_id'] : null) : null, $asignacionId, mb_substr($motivo, 0, 300), $creadaPor]);
    sincronizarRevision(fila('SELECT * FROM revisiones_inventario WHERE id = ?', [$id]));
    notificar($responsableId, 'revision_inventario',
        $tipo === 'cuentadante' ? "Recibe el inventario del ambiente {$amb['codigo']} como cuentadante" : "Revisa el inventario del ambiente {$amb['codigo']}",
        ($tipo === 'cuentadante' ? 'Quedarás como cuentadante cuando revises y aceptes el inventario.' : 'Antes de tu primera entrega del ambiente revisa su inventario.') . " · $motivo", null);
    return $id;
}

/** Detalle con los ítems (código, nombre, serial, categoría, familia, valor, estado del ítem y revisión). */
function detalleRevision(array $r): array
{
    sincronizarRevision($r);
    $r = fila(SQL_REVISIONES . ' WHERE r.id = ?', [(int) $r['id']]);
    $items = filas("SELECT x.estado AS revision, x.observacion, x.revisado_en, i.id, i.codigo, i.qr_value, i.nombre, i.serial, i.valor, i.estado,
                           c.nombre AS categoria, f.codigo AS familia_codigo, f.nombre AS familia_nombre
                    FROM revision_inventario_items x JOIN inventory_items i ON i.id = x.inventory_item_id
                    JOIN inventory_categories c ON c.id = i.category_id LEFT JOIN item_families f ON f.id = i.family_id
                    WHERE x.revision_id = ? ORDER BY c.nombre, i.codigo", [(int) $r['id']]);
    return revisionPublica($r) + [
        'valorTotal' => array_sum(array_map(fn($i) => (float) $i['valor'], $items)),
        'items' => array_map(fn($i) => [
            'itemId' => (int) $i['id'], 'codigo' => $i['codigo'], 'qr' => $i['qr_value'], 'nombre' => $i['nombre'], 'serial' => $i['serial'],
            'valor' => $i['valor'] !== null ? (float) $i['valor'] : null, 'estadoItem' => $i['estado'], 'categoria' => $i['categoria'],
            'familia' => $i['familia_codigo'] ? ['codigo' => $i['familia_codigo'], 'nombre' => $i['familia_nombre']] : null,
            'revision' => $i['revision'], 'observacion' => $i['observacion'], 'revisadoEn' => iso($i['revisado_en']),
        ], $items),
    ];
}

/* ---------------- rutas de la revisión ---------------- */

/** GET /inventory-reviews?estado&ambienteId (administrativo y almacén: todas; los demás: las suyas). */
function rutaRevisiones(): never
{
    $u = usuario();
    // Las pendientes siempre muestran el inventario actual del ambiente.
    foreach (filas("SELECT * FROM revisiones_inventario WHERE estado = 'pendiente'") as $pend) sincronizarRevision($pend);
    $where = [];
    $params = [];
    if (!in_array($u['rol'], ROLES_INVENTARIO, true) || !empty($_GET['mias'])) { $where[] = 'r.responsable_id = ?'; $params[] = (int) $u['id']; }
    if ($v = opcion($_GET, 'estado', ['pendiente', 'aceptada', 'anulada'], false)) { $where[] = 'r.estado = ?'; $params[] = $v; }
    if ($v = entero($_GET, 'ambienteId', false)) { $where[] = 'r.environment_id = ?'; $params[] = $v; }
    $sql = SQL_REVISIONES . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . " ORDER BY r.estado = 'pendiente' DESC, r.creada_en DESC LIMIT 200";
    responder(array_map('revisionPublica', filas($sql, $params)));
}

function rutaRevision(int $id): never
{
    responder(detalleRevision(buscarRevision($id)));
}

/** Solo quien recibe el inventario la marca, y mientras siga pendiente. */
function revisionEditable(int $id): array
{
    $u = usuario();
    $r = buscarRevision($id);
    if ((int) $r['responsable_id'] !== (int) $u['id']) fallar(403, "Solo {$r['responsable_nombre']} puede revisar este inventario.", 'PERMISO');
    if ($r['estado'] !== 'pendiente') fallar(409, 'La revisión ya se cerró.', 'ESTADO');
    sincronizarRevision($r);
    return $r;
}

/**
 * PATCH /inventory-reviews/{id}/items {items: [{itemId | codigo (lo escaneado), estado: ok|faltante|danado|pendiente, observacion?}]}
 * Una pegatina de familia marca todos sus componentes. "Todo está bien": todos los pendientes en ok.
 */
function rutaMarcarRevision(int $id): never
{
    $r = revisionEditable($id);
    $lista = cuerpo()['items'] ?? null;
    if (!empty(cuerpo()['todoBien'])) {
        consulta("UPDATE revision_inventario_items SET estado = 'ok', revisado_en = NOW() WHERE revision_id = ? AND estado = 'pendiente'", [$id]);
        responder(detalleRevision($r));
    }
    if (!is_array($lista) || !$lista || count($lista) > 3000) fallar(422, 'Indica los ítems que revisaste.', 'VALIDACION');
    foreach ($lista as $x) {
        $estado = opcion($x, 'estado', ESTADOS_REVISION_ITEM, true, 'el resultado de la revisión');
        $obs = texto($x, 'observacion', 300, false, 'la observación');
        if (in_array($estado, ['faltante', 'danado'], true) && !$obs) fallar(422, 'Describe lo que falta o el daño en la observación.', 'VALIDACION');
        $ids = [];
        if (!empty($x['itemId'])) $ids = [(int) $x['itemId']];
        elseif (!empty($x['codigo'])) {
            $leido = leerCodigoEscaneado((string) $x['codigo']);
            if (!$leido) fallar(404, "El código \"{$x['codigo']}\" no está en el inventario.", 'NO_ENCONTRADO');
            if ((int) $leido['fila']['environment_id'] !== (int) $r['environment_id']) fallar(422, "{$leido['fila']['codigo']} es del ambiente {$leido['fila']['ambiente_codigo']}, no de este.", 'OTRO_AMBIENTE');
            $ids = $leido['tipo'] === 'familia'
                ? array_map('intval', array_column(filas("SELECT id FROM inventory_items WHERE family_id = ? AND estado <> 'baja'", [(int) $leido['fila']['id']]), 'id'))
                : [(int) $leido['fila']['id']];
        }
        if (!$ids) fallar(422, 'Indica el ítem.', 'VALIDACION');
        consulta('UPDATE revision_inventario_items SET estado = ?, observacion = ?, revisado_en = IF(? = \'pendiente\', NULL, NOW())
                  WHERE revision_id = ? AND inventory_item_id IN (' . marcas(count($ids)) . ')', [$estado, $obs, $estado, $id, ...$ids]);
    }
    responder(detalleRevision($r));
}

/**
 * POST /inventory-reviews/{id}/accept {observaciones?}: con todo revisado, la
 * persona recibe el inventario. Si es de cuentadante, queda como cuentadante.
 * Los dañados pasan a "Dañado"; todo queda en la trazabilidad de cada ítem y
 * se avisa a coordinación, administrativo y almacén (y al cuentadante anterior).
 */
function rutaAceptarRevision(int $id): never
{
    $u = usuario();
    $r = revisionEditable($id);
    $r = fila(SQL_REVISIONES . ' WHERE r.id = ?', [$id]);
    if ((int) $r['total'] === 0) fallar(422, 'El ambiente no tiene inventario para revisar. Pide a almacén que lo cargue.', 'SIN_INVENTARIO');
    if ((int) $r['pendientes']) fallar(422, "Faltan {$r['pendientes']} ítem(s) por revisar.", 'REVISION_INCOMPLETA');
    $observaciones = texto(cuerpo(), 'observaciones', 500, false, 'las observaciones');
    $novedades = (int) $r['faltantes'] + (int) $r['danados'];
    if ($novedades && !$observaciones) fallar(422, 'Hay ítems faltantes o dañados: escribe una observación general del acta.', 'VALIDACION');

    db()->begin_transaction();
    $quien = $r['tipo'] === 'cuentadante' ? 'como cuentadante' : 'como instructor';
    foreach (filas("SELECT * FROM revision_inventario_items WHERE revision_id = ? AND estado IN ('faltante', 'danado')", [$id]) as $x) {
        if ($x['estado'] === 'danado') consulta("UPDATE inventory_items SET estado = 'danado' WHERE id = ? AND estado = 'operativo'", [(int) $x['inventory_item_id']]);
        historial((int) $x['inventory_item_id'], 'estado', "Revisión de inventario #$id ($quien, {$u['nombre']}): " . ETIQUETA_REVISION[$x['estado']] . ($x['observacion'] ? " · {$x['observacion']}" : ''), (int) $u['id']);
    }
    $resumen = ['total' => (int) $r['total'], 'ok' => (int) $r['ok'], 'faltantes' => (int) $r['faltantes'], 'danados' => (int) $r['danados']];
    consulta("UPDATE revisiones_inventario SET estado = 'aceptada', observaciones = ?, resumen = ?, cerrada_por = ?, cerrada_en = NOW() WHERE id = ?",
        [$observaciones, json_encode($resumen), (int) $u['id'], $id]);
    if ($r['tipo'] === 'cuentadante') consulta('UPDATE environments SET cuentadante_id = ? WHERE id = ?', [(int) $u['id'], (int) $r['environment_id']]);
    $detalle = "{$r['total']} ítems: {$r['ok']} OK" . ($r['faltantes'] ? ", {$r['faltantes']} faltante(s)" : '') . ($r['danados'] ? ", {$r['danados']} dañado(s)" : '') . ($observaciones ? " · $observaciones" : '');
    $titulo = $r['tipo'] === 'cuentadante' ? "{$u['nombre']} es ahora cuentadante del ambiente {$r['amb_codigo']}" : "{$u['nombre']} revisó el inventario del ambiente {$r['amb_codigo']}";
    if ($r['tipo'] === 'cuentadante' || $novedades) notificarAdministrativos('revision_inventario', $titulo, $detalle, null, null, (int) $u['id']);
    if ($r['cuentadante_anterior_id']) notificar((int) $r['cuentadante_anterior_id'], 'revision_inventario', $titulo, "Entregaste el inventario · $detalle", null);
    db()->commit();
    responder(detalleRevision(buscarRevision($id)));
}

/** POST /inventory-reviews/{id}/cancel {motivo} (administrativo o almacén): la anula sin cambiar al cuentadante. */
function rutaAnularRevision(int $id): never
{
    $u = exigirRol(...ROLES_INVENTARIO);
    $r = buscarRevision($id);
    if ($r['estado'] !== 'pendiente') fallar(409, 'La revisión ya se cerró.', 'ESTADO');
    $motivo = texto(cuerpo(), 'motivo', 300, true, 'el motivo');
    consulta("UPDATE revisiones_inventario SET estado = 'anulada', observaciones = ?, cerrada_por = ?, cerrada_en = NOW() WHERE id = ?", [$motivo, (int) $u['id'], $id]);
    notificar((int) $r['responsable_id'], 'revision_inventario', "Se anuló la revisión de inventario del ambiente {$r['amb_codigo']}", "$motivo ({$u['nombre']})", null);
    responder(revisionPublica(fila(SQL_REVISIONES . ' WHERE r.id = ?', [$id])));
}

/* ---------------- Excel ---------------- */

/** Hoja con un encabezado (título y datos) y la tabla debajo; devuelve la fila de los títulos. */
function hojaConEncabezado($hoja, string $titulo, array $datos, array $columnas, array $filas): int
{
    $hoja->setCellValue('A1', $titulo);
    $hoja->getStyle('A1')->getFont()->setBold(true)->setSize(14)->getColor()->setRGB('00304D');
    $n = 2;
    foreach ($datos as $etiqueta => $valor) {
        $hoja->setCellValue("A$n", $etiqueta);
        $hoja->setCellValueExplicit("B$n", (string) $valor, \PhpOffice\PhpSpreadsheet\Cell\DataType::TYPE_STRING);
        $hoja->getStyle("A$n")->getFont()->setBold(true);
        $n++;
    }
    $cab = $n + 1;
    $ultima = chr(ord('A') + count($columnas) - 1);
    $hoja->fromArray($columnas, null, "A$cab");
    $hoja->getStyle("A$cab:$ultima$cab")->getFont()->setBold(true)->getColor()->setRGB('FFFFFF');
    $hoja->getStyle("A$cab:$ultima$cab")->getFill()->setFillType('solid')->getStartColor()->setRGB('39A900');
    $f = $cab + 1;
    foreach ($filas as $valores) {
        $hoja->fromArray($valores, null, "A$f");
        // Texto explícito: que Excel no convierta códigos o placas numéricas en números.
        $hoja->setCellValueExplicit("A$f", (string) $valores[0], \PhpOffice\PhpSpreadsheet\Cell\DataType::TYPE_STRING);
        $f++;
    }
    foreach (range('A', $ultima) as $col) $hoja->getColumnDimension($col)->setAutoSize(true);
    $hoja->freezePane('A' . ($cab + 1));
    return $cab;
}

function enviarExcel($libro, string $nombre): never
{
    header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    header('Content-Disposition: attachment; filename="' . $nombre . '"');
    (new \PhpOffice\PhpSpreadsheet\Writer\Xlsx($libro))->save('php://output');
    exit;
}

/**
 * GET /environments/{id}/inventory/export (personal): inventario del
 * cuentadante en Excel. Arriba el ambiente, el cuentadante y la fecha; debajo
 * las columnas de la carga masiva (se puede editar y volver a subir).
 */
function rutaExportarInventarioCuentadante(int $ambienteId): never
{
    exigirRol(...ROLES_PERSONAL);
    if (!hayPhpSpreadsheet()) fallar(500, 'Falta instalar PhpSpreadsheet (ejecuta "composer install").', 'SIN_PHPSPREADSHEET');
    $amb = fila('SELECT e.*, c.nombre AS cuentadante, c.documento AS cuentadante_doc FROM environments e LEFT JOIN users c ON c.id = e.cuentadante_id WHERE e.id = ?', [$ambienteId])
        ?? fallar(404, 'El ambiente no existe.', 'NO_ENCONTRADO');
    $items = filas(SQL_ITEMS . " WHERE i.environment_id = ? AND i.estado <> 'baja' ORDER BY c.nombre, i.codigo", [$ambienteId]);
    $libro = new \PhpOffice\PhpSpreadsheet\Spreadsheet();
    $hoja = $libro->getActiveSheet();
    $hoja->setTitle('Inventario del cuentadante');
    $cab = hojaConEncabezado($hoja, 'Inventario del cuentadante · SENA', [
        'Ambiente' => "{$amb['codigo']} · {$amb['nombre']}",
        'Cuentadante' => $amb['cuentadante'] ? "{$amb['cuentadante']} (CC {$amb['cuentadante_doc']})" : 'Sin cuentadante',
        'Fecha' => date('Y-m-d H:i'),
        'Ítems' => count($items),
        'Valor total' => number_format(array_sum(array_map(fn($i) => (float) $i['valor'], $items)), 0, ',', '.'),
    ], ['codigo', 'nombre', 'serial', 'categoria', 'estado', 'familia', 'familia_nombre', 'familia_tipo', 'qr', 'valor'],
        array_map(fn($i) => [$i['codigo'], $i['nombre'], $i['serial'], $i['categoria'], ETIQUETA_ESTADO[$i['estado']], $i['familia_codigo'], $i['familia_nombre'],
            $i['familia_tipo'], $i['qr_value'], $i['valor'] !== null ? (float) $i['valor'] : null], $items));
    $hoja->getStyle('J' . ($cab + 1) . ':J' . ($cab + count($items) + 1))->getNumberFormat()->setFormatCode('#,##0');
    enviarExcel($libro, "inventario-cuentadante-{$amb['codigo']}-" . date('Y-m-d') . '.xlsx');
}

/**
 * POST /environments/{id}/inventory/import (administrativo y almacén):
 * inventario del cuentadante desde Excel/CSV, todo para este ambiente
 * (columna ambiente opcional). Columnas como la carga masiva; acepta "placa"
 * y "descripción", y "valor". Sin categoría queda en "Sin clasificar".
 * Si hay una revisión de inventario pendiente, los ítems nuevos se suman a ella.
 */
function rutaImportarInventarioCuentadante(int $ambienteId): never
{
    $u = exigirRol(...ROLES_INVENTARIO);
    $amb = fila('SELECT * FROM environments WHERE id = ?', [$ambienteId]) ?? fallar(404, 'El ambiente no existe.', 'NO_ENCONTRADO');
    ['tabla' => $tabla, 'nombre' => $nombre, 'simular' => $simular] = recibirTabla();
    $filas = filasDeTabla($tabla, COLUMNAS_CARGA, ['nombre'], 'normalizarTitulo');
    if (!$filas) fallar(422, 'El archivo no tiene filas con datos debajo de los títulos.', 'ARCHIVO');
    foreach ($filas as &$f) $f['ambiente'] = $amb['codigo'];
    unset($f);
    // Sin categoría, los ítems quedan en "Sin clasificar" (se crea la primera vez; antes de consultar el catálogo).
    if (!fila('SELECT id FROM inventory_categories WHERE nombre = ?', [CATEGORIA_SIN_CLASIFICAR])) {
        insertar('INSERT INTO inventory_categories (nombre, descripcion) VALUES (?, ?)', [CATEGORIA_SIN_CLASIFICAR, 'Ítems del inventario del cuentadante sin categoría']);
    }
    $r = importarInventario($filas, (int) $u['id'], $simular, "inventario del cuentadante: $nombre", CATEGORIA_SIN_CLASIFICAR);
    if (!$simular) foreach (filas("SELECT * FROM revisiones_inventario WHERE environment_id = ? AND estado = 'pendiente'", [$ambienteId]) as $rev) sincronizarRevision($rev);
    responder($r);
}

/** GET /inventory-reviews/{id}/export: acta de la revisión en Excel, con las columnas "revision" y "observacion" para llenar. */
function rutaExportarRevision(int $id): never
{
    if (!hayPhpSpreadsheet()) fallar(500, 'Falta instalar PhpSpreadsheet (ejecuta "composer install").', 'SIN_PHPSPREADSHEET');
    $d = detalleRevision(buscarRevision($id));
    $libro = new \PhpOffice\PhpSpreadsheet\Spreadsheet();
    $hoja = $libro->getActiveSheet();
    $hoja->setTitle('Revisión de inventario');
    $cab = hojaConEncabezado($hoja, 'Acta de revisión de inventario · SENA', [
        'Revisión' => "#{$d['id']} · " . ($d['tipo'] === 'cuentadante' ? 'entrega al cuentadante' : 'instructor nuevo') . " · {$d['estado']}",
        'Ambiente' => "{$d['ambiente']['codigo']} · {$d['ambiente']['nombre']}",
        'Recibe' => $d['responsable']['nombre'],
        'Entrega' => $d['cuentadanteAnterior']['nombre'] ?? '—',
        'Fecha' => date('Y-m-d H:i'),
        'Instrucciones' => 'En "revision" escribe OK, FALTANTE o DAÑADO (con observación) y sube el archivo en la revisión.',
    ], COLUMNAS_ACTA, array_map(fn($i) => [$i['codigo'], $i['nombre'], $i['serial'], $i['categoria'], $i['familia']['codigo'] ?? null, $i['valor'],
        ETIQUETA_ESTADO[$i['estadoItem']], ETIQUETA_REVISION[$i['revision']], $i['observacion']], $d['items']));
    // Lista desplegable en la columna "revision".
    $ultima = $cab + max(1, count($d['items']));
    for ($f = $cab + 1; $f <= $ultima; $f++) {
        $v = $hoja->getCell("H$f")->getDataValidation();
        $v->setType('list')->setAllowBlank(true)->setShowDropDown(true)->setFormula1('"OK,FALTANTE,DAÑADO,PENDIENTE"');
    }
    $hoja->getStyle('F' . ($cab + 1) . ":F$ultima")->getNumberFormat()->setFormatCode('#,##0');
    enviarExcel($libro, "revision-inventario-{$d['ambiente']['codigo']}-{$d['id']}.xlsx");
}

/** "ok", "Bien", "faltante", "No está", "dañado", "malo" → estado; vacío → null (no cambia). */
function revisionDeCarga(string $v): ?string
{
    $k = claveTexto($v);
    if ($k === '') return null;
    return ['ok' => 'ok', 'bien' => 'ok', 'si' => 'ok', 'x' => 'ok', 'faltante' => 'faltante', 'falta' => 'faltante', 'noesta' => 'faltante',
            'danado' => 'danado', 'dano' => 'danado', 'malo' => 'danado', 'pendiente' => 'pendiente'][$k] ?? 'invalido';
}

/** POST /inventory-reviews/{id}/import: sube el acta llenada (columnas codigo/placa, revision, observacion). */
function rutaImportarRevision(int $id): never
{
    $r = revisionEditable($id);
    ['tabla' => $tabla, 'simular' => $simular] = recibirTabla();
    $filas = filasDeTabla($tabla, ['codigo', 'revision', 'observacion'], ['codigo', 'revision'],
        fn($t) => ['resultado' => 'revision', 'verificacion' => 'revision', 'observaciones' => 'observacion'][normalizarTitulo($t)] ?? normalizarTitulo($t), 5000);
    $res = ['total' => count($filas), 'actualizados' => 0, 'sinCambios' => 0, 'errores' => []];
    $items = [];
    foreach (filas('SELECT x.*, i.codigo FROM revision_inventario_items x JOIN inventory_items i ON i.id = x.inventory_item_id WHERE x.revision_id = ?', [$id]) as $x) $items[strtoupper($x['codigo'])] = $x;
    db()->begin_transaction();
    foreach ($filas as $f) {
        $x = $items[strtoupper(trim($f['codigo'] ?? ''))] ?? null;
        if (!$x) { $res['errores'][] = ['fila' => $f['fila'], 'mensaje' => "El código \"{$f['codigo']}\" no está en esta revisión."]; continue; }
        $estado = revisionDeCarga($f['revision'] ?? '');
        if ($estado === null) { $res['sinCambios']++; continue; }
        if ($estado === 'invalido') { $res['errores'][] = ['fila' => $f['fila'], 'mensaje' => "Revisión \"{$f['revision']}\" no válida: OK, FALTANTE o DAÑADO."]; continue; }
        $obs = mb_substr(trim($f['observacion'] ?? ''), 0, 300) ?: null;
        if (in_array($estado, ['faltante', 'danado'], true) && !$obs) { $res['errores'][] = ['fila' => $f['fila'], 'mensaje' => "{$x['codigo']}: escribe la observación de lo que falta o del daño."]; continue; }
        if ($x['estado'] === $estado && (string) $x['observacion'] === (string) $obs) { $res['sinCambios']++; continue; }
        consulta('UPDATE revision_inventario_items SET estado = ?, observacion = ?, revisado_en = IF(? = \'pendiente\', NULL, NOW()) WHERE id = ?', [$estado, $obs, $estado, (int) $x['id']]);
        $res['actualizados']++;
    }
    $simular ? db()->rollback() : db()->commit();
    responder($res + ['revision' => $simular ? null : detalleRevision(buscarRevision($id))]);
}
