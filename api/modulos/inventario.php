<?php
/**
 * Inventario por ambiente: consulta para el personal, CRUD para administrativos.
 *
 * Cada ítem tiene un código único que va en su etiqueta como QR
 * ("SENA-INV:<codigo>") y como código de barras Code 128 (el código solo).
 * Se registra a mano, escaneando la etiqueta (registro rápido) o con carga
 * masiva (modulos/carga.php). Todo cambio queda en item_history.
 */

const ESTADOS_ITEM = ['operativo', 'danado', 'en_reparacion', 'baja'];
const ETIQUETA_ESTADO = ['operativo' => 'Operativo', 'danado' => 'Dañado', 'en_reparacion' => 'En reparación', 'baja' => 'De baja'];
const SQL_ITEMS = 'SELECT i.*, e.codigo AS ambiente_codigo, e.nombre AS ambiente_nombre
                   FROM inventory_items i JOIN environments e ON e.id = i.environment_id';

function itemPublico(array $i): array
{
    return [
        'id' => (int) $i['id'],
        'ambienteId' => (int) $i['environment_id'],
        'ambiente' => $i['ambiente_codigo'] ?? null,
        'codigo' => $i['codigo'],
        // Contenido del QR de la etiqueta física (el código de barras lleva solo el código).
        'qr' => 'SENA-INV:' . $i['codigo'],
        'nombre' => $i['nombre'],
        'categoria' => $i['categoria'],
        'serial' => $i['serial'],
        'estado' => $i['estado'],
        'actualizadoEn' => iso($i['updated_at']),
    ];
}

/**
 * Código leído de un QR o código de barras: quita el prefijo "SENA-INV:" y
 * los espacios y lo pasa a mayúsculas. Null si no es un código válido.
 */
function normalizarCodigo(?string $texto): ?string
{
    $c = strtoupper(trim((string) $texto));
    $c = preg_replace('/^SENA-INV:/', '', $c);
    return preg_match('/^[A-Z0-9][A-Z0-9-]{2,39}$/', $c) ? $c : null;
}

/** Siguiente código consecutivo del ambiente: AMB107-011. */
function siguienteCodigo(array $amb): string
{
    $prefijo = 'AMB' . $amb['codigo'] . '-';
    $ultimo = fila("SELECT MAX(CAST(SUBSTRING(codigo, ?) AS UNSIGNED)) n FROM inventory_items WHERE codigo REGEXP ?",
        [strlen($prefijo) + 1, '^' . preg_quote($prefijo) . '[0-9]+$']);
    return $prefijo . str_pad((string) (((int) ($ultimo['n'] ?? 0)) + 1), 3, '0', STR_PAD_LEFT);
}

/** Deja una fila de trazabilidad del ítem. $usuarioId null = proceso automático. */
function historial(int $itemId, string $accion, string $detalle, ?int $usuarioId, ?int $inspeccionId = null): void
{
    insertar(
        'INSERT INTO item_history (inventory_item_id, user_id, accion, detalle, inspection_id, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
        [$itemId, $usuarioId, $accion, mb_substr($detalle, 0, 300), $inspeccionId]
    );
}

function rutaItemsAmbiente(int $id): never
{
    exigirRol('administrativo', 'instructor', 'portero');
    buscarAmbiente($id);
    responder(array_map('itemPublico', filas(SQL_ITEMS . ' WHERE i.environment_id = ? ORDER BY i.codigo', [$id])));
}

/** GET /items/by-code/{codigo}: acepta el código solo o el contenido del QR. */
function rutaItemPorCodigo(string $texto): never
{
    exigirRol('administrativo', 'instructor', 'portero');
    $codigo = normalizarCodigo(rawurldecode($texto));
    $i = $codigo ? fila(SQL_ITEMS . ' WHERE i.codigo = ?', [$codigo]) : null;
    if (!$i) fallar(404, "No hay ningún ítem con el código $texto.", 'NO_ENCONTRADO');
    responder(itemPublico($i));
}

function buscarItem(int $id): array
{
    $i = fila(SQL_ITEMS . ' WHERE i.id = ?', [$id]);
    if (!$i) fallar(404, 'El ítem no existe.', 'NO_ENCONTRADO');
    return $i;
}

/** Datos comunes de crear/editar. */
function datosItem(array $d, bool $estadoObligatorio): array
{
    return [
        texto($d, 'nombre', 120, true, 'el nombre'),
        texto($d, 'categoria', 40, true, 'la categoría'),
        texto($d, 'serial', 60, false, 'el serial'),
        opcion($d, 'estado', ESTADOS_ITEM, $estadoObligatorio, 'el estado') ?? 'operativo',
    ];
}

/** POST /items {ambienteId, codigo?, nombre, categoria, serial?, estado?}. Sin código se genera el consecutivo. */
function rutaCrearItem(): never
{
    $u = exigirRol('administrativo');
    $d = cuerpo();
    $amb = buscarAmbiente(entero($d, 'ambienteId'));
    $codigo = siguienteCodigo($amb);
    if (!empty($d['codigo'])) {
        $codigo = normalizarCodigo($d['codigo']) ?? fallar(422, 'El código solo admite letras, números y guiones (3 a 40).', 'VALIDACION');
        if (fila('SELECT id FROM inventory_items WHERE codigo = ?', [$codigo])) fallar(409, "Ya existe un ítem con el código $codigo.", 'DUPLICADO');
    }
    [$nombre, $categoria, $serial, $estado] = datosItem($d, false);
    db()->begin_transaction();
    $id = insertar(
        'INSERT INTO inventory_items (environment_id, codigo, nombre, categoria, serial, estado) VALUES (?, ?, ?, ?, ?, ?)',
        [(int) $amb['id'], $codigo, $nombre, $categoria, $serial, $estado]
    );
    historial($id, 'registro', "Registrado a mano en el ambiente {$amb['codigo']}", (int) $u['id']);
    db()->commit();
    responder(itemPublico(buscarItem($id)), 201);
}

/**
 * POST /items/scan {codigo, ambienteId, nombre, categoria}
 * Registro rápido con lector: si el código ya existe devuelve el ítem; si no,
 * lo crea al instante con los datos por defecto del formulario.
 * → {item, creado, otroAmbiente}
 */
function rutaRegistrarPorEscaneo(): never
{
    $u = exigirRol('administrativo');
    $d = cuerpo();
    $codigo = normalizarCodigo($d['codigo'] ?? '') ?? fallar(422, 'El código leído no es válido: solo letras, números y guiones (3 a 40).', 'VALIDACION');
    $amb = buscarAmbiente(entero($d, 'ambienteId'));
    if ($i = fila(SQL_ITEMS . ' WHERE i.codigo = ?', [$codigo])) {
        responder(['item' => itemPublico($i), 'creado' => false, 'otroAmbiente' => (int) $i['environment_id'] !== (int) $amb['id']]);
    }
    [$nombre, $categoria, $serial, $estado] = datosItem($d, false);
    db()->begin_transaction();
    $id = insertar(
        'INSERT INTO inventory_items (environment_id, codigo, nombre, categoria, serial, estado) VALUES (?, ?, ?, ?, ?, ?)',
        [(int) $amb['id'], $codigo, $nombre, $categoria, $serial, $estado]
    );
    historial($id, 'escaneo', "Registrado escaneando su etiqueta en el ambiente {$amb['codigo']}", (int) $u['id']);
    db()->commit();
    responder(['item' => itemPublico(buscarItem($id)), 'creado' => true, 'otroAmbiente' => false], 201);
}

function rutaEditarItem(int $id): never
{
    $u = exigirRol('administrativo');
    $antes = buscarItem($id);
    [$nombre, $categoria, $serial, $estado] = datosItem(cuerpo(), true);
    $cambios = [];
    foreach (['nombre' => $nombre, 'categoria' => $categoria, 'serial' => $serial] as $campo => $nuevo) {
        if ((string) $antes[$campo] !== (string) $nuevo) $cambios[] = "$campo: " . ($antes[$campo] ?: '—') . ' → ' . ($nuevo ?: '—');
    }
    if ($antes['estado'] !== $estado) $cambios[] = 'estado: ' . ETIQUETA_ESTADO[$antes['estado']] . ' → ' . ETIQUETA_ESTADO[$estado];
    db()->begin_transaction();
    consulta('UPDATE inventory_items SET nombre = ?, categoria = ?, serial = ?, estado = ? WHERE id = ?', [$nombre, $categoria, $serial, $estado, $id]);
    if ($cambios) historial($id, 'edicion', implode(' · ', $cambios), (int) $u['id']);
    db()->commit();
    responder(itemPublico(buscarItem($id)));
}

function rutaBorrarItem(int $id): never
{
    exigirRol('administrativo');
    buscarItem($id);
    if (fila('SELECT id FROM inspection_items WHERE inventory_item_id = ? LIMIT 1', [$id])) {
        fallar(409, 'El ítem tiene daños reportados en inspecciones. Márcalo "De baja" en lugar de borrarlo.', 'EN_USO');
    }
    consulta('DELETE FROM inventory_items WHERE id = ?', [$id]);
    responder(null, 204);
}

/** POST /items/labels {ids, motivo?}: registra la impresión (o reimpresión) de etiquetas. */
function rutaEtiquetasImpresas(): never
{
    $u = exigirRol('administrativo', 'instructor', 'portero');
    $d = cuerpo();
    $ids = array_values(array_unique(array_filter(array_map('intval', (array) ($d['ids'] ?? [])))));
    if (!$ids || count($ids) > 500) fallar(422, 'Indica entre 1 y 500 ítems.', 'VALIDACION');
    $motivo = texto($d, 'motivo', 120, false, 'el motivo');
    $marcas = implode(',', array_fill(0, count($ids), '?'));
    $items = filas(SQL_ITEMS . " WHERE i.id IN ($marcas)", $ids);
    db()->begin_transaction();
    foreach ($items as $i) {
        $previas = fila("SELECT COUNT(*) n FROM item_history WHERE inventory_item_id = ? AND accion = 'etiqueta'", [(int) $i['id']])['n'];
        historial((int) $i['id'], 'etiqueta', ($previas ? 'Etiqueta reimpresa' : 'Etiqueta impresa') . ($motivo ? ": $motivo" : ''), (int) $u['id']);
    }
    db()->commit();
    responder(['registradas' => count($items)]);
}

/** GET /items/{id}/history: trazabilidad del ítem, lo más reciente primero. */
function rutaHistorialItem(int $id): never
{
    exigirRol('administrativo', 'instructor', 'portero');
    buscarItem($id);
    $filas = filas(
        'SELECT h.*, u.nombre AS usuario, e.codigo AS ambiente FROM item_history h
         LEFT JOIN users u ON u.id = h.user_id
         LEFT JOIN inspections s ON s.id = h.inspection_id LEFT JOIN environments e ON e.id = s.environment_id
         WHERE h.inventory_item_id = ? ORDER BY h.created_at DESC, h.id DESC LIMIT 100',
        [$id]
    );
    responder(array_map(fn($h) => [
        'id' => (int) $h['id'],
        'accion' => $h['accion'],
        'detalle' => $h['detalle'],
        'usuario' => $h['usuario'],
        'inspeccionId' => $h['inspection_id'] !== null ? (int) $h['inspection_id'] : null,
        'fecha' => iso($h['created_at']),
    ], $filas));
}
