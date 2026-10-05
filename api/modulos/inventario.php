<?php
/**
 * Inventario por ambiente: consulta para el personal, CRUD para administrativos.
 *
 * Cada ítem tiene un código único (va en el código de barras Code 128 de su
 * pegatina) y un qr_value: lo que lleva su QR. Por defecto es
 * "SENA-INV:<codigo>", pero puede ser la placa que ya traía pegada
 * (PLACA-SENA-000457) o cualquier texto que se lea al escanearla. Cada ítem
 * pertenece a una categoría (inventory_categories) y, opcionalmente, a una
 * familia (modulos/familias.php). Se registra a mano, escaneando la etiqueta
 * (crea o actualiza al instante) o con carga masiva (modulos/carga.php).
 * Todo cambio queda en item_history.
 */

const ESTADOS_ITEM = ['operativo', 'danado', 'en_reparacion', 'fuera_servicio', 'baja'];
const ETIQUETA_ESTADO = [
    'operativo' => 'Operativo', 'danado' => 'Dañado', 'en_reparacion' => 'En reparación',
    'fuera_servicio' => 'Fuera de servicio', 'baja' => 'De baja (inactivo)',
];
const PREFIJO_QR_ITEM = 'SENA-INV:';
const PREFIJO_QR_FAMILIA = 'SENA-FAM:';
const SQL_ITEMS = "SELECT i.*, e.codigo AS ambiente_codigo, e.nombre AS ambiente_nombre, c.nombre AS categoria,
                          f.codigo AS familia_codigo, f.nombre AS familia_nombre, f.tipo AS familia_tipo,
                          (SELECT n.id FROM persistent_issues n WHERE n.estado = 'en_curso'
                             AND (n.inventory_item_id = i.id OR n.family_id = i.family_id) ORDER BY n.id LIMIT 1) AS novedad_activa_id
                   FROM inventory_items i
                   JOIN environments e ON e.id = i.environment_id
                   JOIN inventory_categories c ON c.id = i.category_id
                   LEFT JOIN item_families f ON f.id = i.family_id";

function itemPublico(array $i): array
{
    return [
        'id' => (int) $i['id'],
        'ambienteId' => (int) $i['environment_id'],
        'ambiente' => $i['ambiente_codigo'] ?? null,
        'codigo' => $i['codigo'],
        // Contenido del QR de la pegatina (el código de barras lleva solo el código).
        'qr' => $i['qr_value'],
        'nombre' => $i['nombre'],
        'categoriaId' => (int) $i['category_id'],
        'categoria' => $i['categoria'],
        'familiaId' => $i['family_id'] !== null ? (int) $i['family_id'] : null,
        'familia' => $i['family_id'] !== null ? [
            'id' => (int) $i['family_id'], 'codigo' => $i['familia_codigo'], 'nombre' => $i['familia_nombre'], 'tipo' => $i['familia_tipo'],
        ] : null,
        'serial' => $i['serial'],
        'valor' => isset($i['valor']) ? (float) $i['valor'] : null,
        'estado' => $i['estado'],
        // Novedad permanente activa del ítem o de su familia (null si no tiene).
        'novedadActivaId' => isset($i['novedad_activa_id']) ? (int) $i['novedad_activa_id'] : null,
        'ultimoEscaneoEn' => iso($i['ultimo_escaneo_en']),
        'actualizadoEn' => iso($i['updated_at']),
    ];
}

/**
 * Código leído de un QR o código de barras: quita el prefijo ("SENA-INV:" o
 * el que se indique) y los espacios y lo pasa a mayúsculas. Null si no es un
 * código válido.
 */
function normalizarCodigo(?string $texto, string $prefijo = PREFIJO_QR_ITEM): ?string
{
    $c = strtoupper(trim((string) $texto));
    if (str_starts_with($c, $prefijo)) $c = substr($c, strlen($prefijo));
    return preg_match('/^[A-Z0-9][A-Z0-9-]{2,39}$/', $c) ? $c : null;
}

function qrPorDefecto(string $codigo): string
{
    return PREFIJO_QR_ITEM . $codigo;
}

/**
 * Resuelve lo que se leyó con la cámara o el lector:
 *   SENA-FAM:<codigo>          → familia
 *   qr_value exacto de un ítem → ítem (placas viejas, QR de otros sistemas)
 *   SENA-INV:<codigo> o código → ítem; si no hay ítem con ese código, familia con ese código
 * @return ?array{tipo:'item'|'familia', fila:array}
 */
function leerCodigoEscaneado(string $texto): ?array
{
    $texto = trim($texto);
    if ($texto === '') return null;
    if (stripos($texto, PREFIJO_QR_FAMILIA) === 0) {
        $codigo = normalizarCodigo($texto, PREFIJO_QR_FAMILIA);
        $f = $codigo ? fila(SQL_FAMILIAS . ' WHERE f.codigo = ?', [$codigo]) : null;
        return $f ? ['tipo' => 'familia', 'fila' => $f] : null;
    }
    if ($i = fila(SQL_ITEMS . ' WHERE i.qr_value = ?', [$texto])) return ['tipo' => 'item', 'fila' => $i];
    $codigo = normalizarCodigo($texto);
    if (!$codigo) return null;
    if ($i = fila(SQL_ITEMS . ' WHERE i.codigo = ?', [$codigo])) return ['tipo' => 'item', 'fila' => $i];
    if ($f = fila(SQL_FAMILIAS . ' WHERE f.codigo = ?', [$codigo])) return ['tipo' => 'familia', 'fila' => $f];
    return null;
}

/** Un código no puede repetirse entre ítems ni entre ítems y familias (el lector no sabría cuál es). */
function verificarCodigoItemLibre(string $codigo): void
{
    if (fila('SELECT id FROM inventory_items WHERE codigo = ?', [$codigo])) fallar(409, "Ya existe un ítem con el código $codigo.", 'DUPLICADO');
    if (fila('SELECT id FROM item_families WHERE codigo = ?', [$codigo])) fallar(409, "El código $codigo ya es de una familia.", 'DUPLICADO');
}

/** Error del contenido del QR de un ítem, o null si sirve. */
function errorQr(string $qr, int $exceptoItem = 0): ?string
{
    if (mb_strlen($qr) < 3 || mb_strlen($qr) > 120) return 'El contenido del QR debe tener entre 3 y 120 caracteres.';
    if (preg_match('/[\x00-\x1F\x7F]/', $qr)) return 'El contenido del QR tiene caracteres no válidos.';
    if (stripos($qr, PREFIJO_QR_FAMILIA) === 0 || stripos($qr, 'SENA-INSP:') === 0) return 'Ese QR es de una familia o de una entrega, no de un ítem.';
    if ($otro = fila('SELECT codigo FROM inventory_items WHERE qr_value = ? AND id <> ?', [$qr, $exceptoItem])) return "El QR \"$qr\" ya es del ítem {$otro['codigo']}.";
    return null;
}

/** Contenido del QR recortado y validado (422 si no sirve). Null si no viene. */
function validarQr($valor, int $exceptoItem = 0): ?string
{
    $qr = trim((string) ($valor ?? ''));
    if ($qr === '') return null;
    if ($error = errorQr($qr, $exceptoItem)) fallar(422, $error, 'VALIDACION');
    return $qr;
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
function historial(int $itemId, string $accion, string $detalle, ?int $usuarioId, ?int $inspeccionId = null, ?int $novedadId = null): void
{
    insertar(
        'INSERT INTO item_history (inventory_item_id, user_id, accion, detalle, inspection_id, persistent_issue_id, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
        [$itemId, $usuarioId, $accion, mb_substr($detalle, 0, 300), $inspeccionId, $novedadId]
    );
}

/** GET /environments/{id}/items?familiaId */
function rutaItemsAmbiente(int $id): never
{
    exigirRol(...ROLES_PERSONAL);
    buscarAmbiente($id);
    $familia = entero($_GET, 'familiaId', false);
    responder(array_map('itemPublico', filas(SQL_ITEMS . ' WHERE i.environment_id = ?' . ($familia ? ' AND i.family_id = ?' : '') . ' ORDER BY i.codigo',
        $familia ? [$id, $familia] : [$id])));
}

/** GET /items/by-code/{codigo}: acepta el código solo, SENA-INV:<codigo> o el qr_value del ítem. */
function rutaItemPorCodigo(string $texto): never
{
    exigirRol(...ROLES_PERSONAL);
    $l = leerCodigoEscaneado(rawurldecode($texto));
    if (!$l || $l['tipo'] !== 'item') fallar(404, "No hay ningún ítem con el código $texto.", 'NO_ENCONTRADO');
    responder(itemPublico($l['fila']));
}

/**
 * GET /inventory/lookup?codigo=<lo que se leyó>: el escáner no sabe si la
 * pegatina es de un ítem o de una familia; esta ruta lo resuelve.
 * → {tipo:'item', item} | {tipo:'familia', familia (con componentes)}
 */
function rutaBuscarEscaneado(): never
{
    exigirRol(...ROLES_PERSONAL);
    $l = leerCodigoEscaneado((string) ($_GET['codigo'] ?? ''));
    if (!$l) fallar(404, 'Ese código no corresponde a ningún ítem ni familia del inventario.', 'NO_ENCONTRADO');
    responder($l['tipo'] === 'item'
        ? ['tipo' => 'item', 'item' => itemPublico($l['fila'])]
        : ['tipo' => 'familia', 'familia' => familiaPublica($l['fila'], true)]);
}

function buscarItem(int $id): array
{
    $i = fila(SQL_ITEMS . ' WHERE i.id = ?', [$id]);
    if (!$i) fallar(404, 'El ítem no existe.', 'NO_ENCONTRADO');
    return $i;
}

/** La familia debe existir y ser del mismo ambiente que el ítem. Null = sin familia. */
function familiaDelAmbiente($familiaId, int $ambienteId): ?array
{
    if ($familiaId === null || $familiaId === '' || (int) $familiaId === 0) return null;
    $f = fila('SELECT * FROM item_families WHERE id = ?', [(int) $familiaId]);
    if (!$f) fallar(422, 'La familia elegida no existe.', 'VALIDACION');
    if ((int) $f['environment_id'] !== $ambienteId) fallar(422, "La familia {$f['codigo']} es de otro ambiente.", 'VALIDACION');
    return $f;
}

/** Datos comunes de crear/editar: [nombre, categoryId, serial, estado]. Categoría por id (categoriaId) o por nombre (categoria). */
function datosItem(array $d, bool $estadoObligatorio): array
{
    $d = conAlias($d, 'categoriaId', 'categoria_id', 'category_id');
    return [
        texto($d, 'nombre', 120, true, 'el nombre'),
        idCatalogo('categoria', $d['categoriaId'] ?? null, $d['categoria'] ?? null, true),
        texto($d, 'serial', 60, false, 'el serial'),
        opcion($d, 'estado', ESTADOS_ITEM, $estadoObligatorio, 'el estado') ?? 'operativo',
    ];
}

/** POST /items {ambienteId, codigo?, qr?, nombre, categoriaId|categoria, familiaId?, serial?, estado?}. Sin código se genera el consecutivo. */
function rutaCrearItem(): never
{
    $u = exigirRol(...ROLES_INVENTARIO);
    $d = conAlias(cuerpo(), 'familiaId', 'familia_id');
    $amb = buscarAmbiente(entero($d, 'ambienteId'));
    $codigo = siguienteCodigo($amb);
    if (!empty($d['codigo'])) {
        $codigo = normalizarCodigo($d['codigo']) ?? fallar(422, 'El código solo admite letras, números y guiones (3 a 40).', 'VALIDACION');
        verificarCodigoItemLibre($codigo);
    }
    [$nombre, $categoria, $serial, $estado] = datosItem($d, false);
    $familia = familiaDelAmbiente($d['familiaId'] ?? null, (int) $amb['id']);
    $qr = validarQr($d['qr'] ?? null) ?? qrPorDefecto($codigo);
    db()->begin_transaction();
    $id = insertar(
        'INSERT INTO inventory_items (environment_id, codigo, qr_value, nombre, category_id, family_id, serial, estado) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [(int) $amb['id'], $codigo, $qr, $nombre, $categoria, $familia ? (int) $familia['id'] : null, $serial, $estado]
    );
    historial($id, 'registro', "Registrado a mano en el ambiente {$amb['codigo']}" . ($familia ? " · familia {$familia['codigo']}" : ''), (int) $u['id']);
    db()->commit();
    responder(itemPublico(buscarItem($id)), 201);
}

/**
 * POST /items/scan {codigo, ambienteId, nombre, categoriaId|categoria, familiaId?, estado?}
 * Registro con lector: lo que se lea crea o actualiza el ítem al instante.
 *   · No existe → se crea con los datos del formulario. Si lo leído no es un
 *     código (p. ej. un QR de otro sistema), se genera el consecutivo y lo
 *     leído queda como su qr_value.
 *   · Existe → se actualiza: si estaba en otro ambiente se traslada al
 *     elegido (y sale de su familia, que era de allá), se asigna a la familia
 *     elegida y se anota la hora del escaneo. No cambia nombre ni categoría.
 * → {item, creado, actualizado, cambios[], otroAmbiente, movidoDesde}
 */
function rutaRegistrarPorEscaneo(): never
{
    $u = exigirRol(...ROLES_INVENTARIO);
    $d = conAlias(cuerpo(), 'familiaId', 'familia_id');
    $leido = trim((string) ($d['codigo'] ?? ''));
    if ($leido === '' || mb_strlen($leido) > 120) fallar(422, 'El código leído no es válido.', 'VALIDACION');
    $amb = buscarAmbiente(entero($d, 'ambienteId'));
    $familia = familiaDelAmbiente($d['familiaId'] ?? null, (int) $amb['id']);
    $l = leerCodigoEscaneado($leido);
    if ($l && $l['tipo'] === 'familia') fallar(422, "Esa es la pegatina de la familia {$l['fila']['codigo']}, no de un ítem.", 'ES_FAMILIA');

    db()->begin_transaction();
    if ($l) {
        $i = $l['fila'];
        $id = (int) $i['id'];
        $cambios = [];
        $movidoDesde = null;
        $nuevaFamilia = $i['family_id'] !== null ? (int) $i['family_id'] : null;
        if ((int) $i['environment_id'] !== (int) $amb['id']) {
            $movidoDesde = $i['ambiente_codigo'];
            $cambios[] = "ambiente {$i['ambiente_codigo']} → {$amb['codigo']}";
            if ($nuevaFamilia) { $cambios[] = "sale de la familia {$i['familia_codigo']}"; $nuevaFamilia = null; }
        }
        if ($familia && $nuevaFamilia !== (int) $familia['id']) { $cambios[] = "familia → {$familia['codigo']}"; $nuevaFamilia = (int) $familia['id']; }
        consulta('UPDATE inventory_items SET environment_id = ?, family_id = ?, ultimo_escaneo_en = NOW() WHERE id = ?', [(int) $amb['id'], $nuevaFamilia, $id]);
        historial($id, $movidoDesde ? 'traslado' : 'escaneo', $cambios
            ? 'Actualizado al escanear su pegatina: ' . implode(' · ', $cambios)
            : "Pegatina escaneada en el ambiente {$amb['codigo']} (sin cambios)", (int) $u['id']);
        db()->commit();
        responder(['item' => itemPublico(buscarItem($id)), 'creado' => false, 'actualizado' => (bool) $cambios, 'cambios' => $cambios,
                   'otroAmbiente' => $movidoDesde !== null, 'movidoDesde' => $movidoDesde]);
    }

    $codigo = normalizarCodigo($leido);
    if ($codigo) {
        verificarCodigoItemLibre($codigo);
        // Pegatina propia (SENA-INV:…) o código de barras: el QR que se imprima será el estándar.
        $qr = stripos($leido, PREFIJO_QR_ITEM) === 0 || strtoupper($leido) === $codigo ? qrPorDefecto($codigo) : validarQr($leido);
    } else {
        $codigo = siguienteCodigo($amb);
        $qr = validarQr($leido);
    }
    [$nombre, $categoria, $serial, $estado] = datosItem($d, false);
    $id = insertar(
        'INSERT INTO inventory_items (environment_id, codigo, qr_value, nombre, category_id, family_id, serial, estado, ultimo_escaneo_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())',
        [(int) $amb['id'], $codigo, $qr, $nombre, $categoria, $familia ? (int) $familia['id'] : null, $serial, $estado]
    );
    historial($id, 'escaneo', "Registrado escaneando su etiqueta en el ambiente {$amb['codigo']}" . ($familia ? " · familia {$familia['codigo']}" : ''), (int) $u['id']);
    db()->commit();
    responder(['item' => itemPublico(buscarItem($id)), 'creado' => true, 'actualizado' => false, 'cambios' => [], 'otroAmbiente' => false, 'movidoDesde' => null], 201);
}

/** PATCH /items/{id} {nombre, categoriaId|categoria, serial?, estado, familiaId?, qr?} */
function rutaEditarItem(int $id): never
{
    $u = exigirRol(...ROLES_INVENTARIO);
    $antes = buscarItem($id);
    $d = conAlias(cuerpo(), 'familiaId', 'familia_id');
    [$nombre, $categoria, $serial, $estado] = datosItem($d, true);
    $familiaId = array_key_exists('familiaId', $d)
        ? (($f = familiaDelAmbiente($d['familiaId'], (int) $antes['environment_id'])) ? (int) $f['id'] : null)
        : ($antes['family_id'] !== null ? (int) $antes['family_id'] : null);
    $qr = array_key_exists('qr', $d) ? (validarQr($d['qr'], $id) ?? qrPorDefecto($antes['codigo'])) : $antes['qr_value'];

    $cambios = [];
    foreach (['nombre' => $nombre, 'serial' => $serial, 'QR' => $qr] as $campo => $nuevo) {
        $previo = $antes[$campo === 'QR' ? 'qr_value' : $campo];
        if ((string) $previo !== (string) $nuevo) $cambios[] = "$campo: " . ($previo ?: '—') . ' → ' . ($nuevo ?: '—');
    }
    if ((int) $antes['category_id'] !== $categoria) $cambios[] = "categoría: {$antes['categoria']} → " . fila('SELECT nombre FROM inventory_categories WHERE id = ?', [$categoria])['nombre'];
    if (($antes['family_id'] !== null ? (int) $antes['family_id'] : null) !== $familiaId) {
        $cambios[] = 'familia: ' . ($antes['familia_codigo'] ?: '—') . ' → ' . ($familiaId ? fila('SELECT codigo FROM item_families WHERE id = ?', [$familiaId])['codigo'] : '—');
    }
    if ($antes['estado'] !== $estado) $cambios[] = 'estado: ' . ETIQUETA_ESTADO[$antes['estado']] . ' → ' . ETIQUETA_ESTADO[$estado];
    db()->begin_transaction();
    consulta('UPDATE inventory_items SET nombre = ?, category_id = ?, serial = ?, estado = ?, family_id = ?, qr_value = ? WHERE id = ?',
        [$nombre, $categoria, $serial, $estado, $familiaId, $qr, $id]);
    if ($cambios) historial($id, 'edicion', implode(' · ', $cambios), (int) $u['id']);
    db()->commit();
    responder(itemPublico(buscarItem($id)));
}

function rutaBorrarItem(int $id): never
{
    exigirRol(...ROLES_INVENTARIO);
    buscarItem($id);
    if (fila('SELECT id FROM inspection_items WHERE inventory_item_id = ? LIMIT 1', [$id])
        || fila('SELECT id FROM persistent_issues WHERE inventory_item_id = ? LIMIT 1', [$id])) {
        fallar(409, 'El ítem tiene novedades reportadas. Márcalo "De baja" en lugar de borrarlo.', 'EN_USO');
    }
    consulta('DELETE FROM inventory_items WHERE id = ?', [$id]);
    responder(null, 204);
}

/**
 * POST /inventory/labels (alias: /items/labels) {ids?, familiaIds?, ambienteId?, motivo?}
 * Reimpresión de pegatinas: devuelve lo que va en cada una (QR, código de
 * barras, nombre) y lo deja en la trazabilidad (impresa o reimpresa). Con
 * solo ambienteId: todas las pegatinas del ambiente (ítems activos y familias).
 * → {registradas, etiquetas:[{tipo, id, codigo, qr, nombre, ambiente, detalle, reimpresion}]}
 */
function rutaEtiquetasImpresas(): never
{
    $u = exigirRol(...ROLES_PERSONAL);
    $d = cuerpo();
    $ids = listaIds($d['ids'] ?? []);
    $familiaIds = listaIds($d['familiaIds'] ?? []);
    if (!$ids && !$familiaIds && ($ambienteId = entero($d, 'ambienteId', false))) {
        buscarAmbiente($ambienteId);
        $ids = array_map('intval', array_column(filas("SELECT id FROM inventory_items WHERE environment_id = ? AND estado <> 'baja'", [$ambienteId]), 'id'));
        $familiaIds = array_map('intval', array_column(filas('SELECT id FROM item_families WHERE environment_id = ?', [$ambienteId]), 'id'));
    }
    if (!$ids && !$familiaIds) fallar(422, 'Indica los ítems o las familias de las pegatinas.', 'VALIDACION');
    if (count($ids) + count($familiaIds) > 500) fallar(422, 'Se pueden imprimir máximo 500 pegatinas a la vez.', 'VALIDACION');
    $motivo = texto($d, 'motivo', 120, false, 'el motivo');
    $items = $ids ? filas(SQL_ITEMS . ' WHERE i.id IN (' . marcas(count($ids)) . ') ORDER BY i.codigo', $ids) : [];
    $familias = $familiaIds ? filas(SQL_FAMILIAS . ' WHERE f.id IN (' . marcas(count($familiaIds)) . ') ORDER BY f.codigo', $familiaIds) : [];

    $etiquetas = [];
    db()->begin_transaction();
    foreach ($items as $i) {
        $previas = (int) fila("SELECT COUNT(*) n FROM item_history WHERE inventory_item_id = ? AND accion = 'etiqueta' AND detalle LIKE 'Etiqueta %'", [(int) $i['id']])['n'];
        historial((int) $i['id'], 'etiqueta', ($previas ? 'Etiqueta reimpresa' : 'Etiqueta impresa') . ($motivo ? ": $motivo" : ''), (int) $u['id']);
        $etiquetas[] = ['tipo' => 'item', 'id' => (int) $i['id'], 'codigo' => $i['codigo'], 'qr' => $i['qr_value'], 'nombre' => $i['nombre'],
                        'ambiente' => $i['ambiente_codigo'], 'detalle' => $i['categoria'] . ($i['familia_codigo'] ? " · {$i['familia_codigo']}" : ''), 'reimpresion' => $previas > 0];
    }
    foreach ($familias as $f) {
        // La pegatina de la familia queda en la trazabilidad de cada componente.
        $componentes = filas('SELECT id FROM inventory_items WHERE family_id = ?', [(int) $f['id']]);
        $previas = $componentes ? (int) fila("SELECT COUNT(*) n FROM item_history WHERE inventory_item_id = ? AND accion = 'etiqueta' AND detalle LIKE 'Pegatina de la familia %'", [(int) $componentes[0]['id']])['n'] : 0;
        foreach ($componentes as $c) {
            historial((int) $c['id'], 'etiqueta', "Pegatina de la familia {$f['codigo']} " . ($previas ? 'reimpresa' : 'impresa') . ($motivo ? ": $motivo" : ''), (int) $u['id']);
        }
        $etiquetas[] = ['tipo' => 'familia', 'id' => (int) $f['id'], 'codigo' => $f['codigo'], 'qr' => PREFIJO_QR_FAMILIA . $f['codigo'], 'nombre' => $f['nombre'],
                        'ambiente' => $f['ambiente_codigo'], 'detalle' => "Familia {$f['tipo']} · {$f['componentes']} componente(s)", 'reimpresion' => $previas > 0];
    }
    db()->commit();
    responder(['registradas' => count($etiquetas), 'etiquetas' => $etiquetas]);
}

/** GET /items/{id}/history: trazabilidad del ítem, lo más reciente primero. */
function rutaHistorialItem(int $id): never
{
    exigirRol(...ROLES_PERSONAL);
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
        'novedadId' => $h['persistent_issue_id'] !== null ? (int) $h['persistent_issue_id'] : null,
        'fecha' => iso($h['created_at']),
    ], $filas));
}
