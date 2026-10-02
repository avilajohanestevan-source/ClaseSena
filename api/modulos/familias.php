<?php
/**
 * Familias de ítems: conjuntos que se revisan y se reportan juntos, p. ej.
 * Familia PC = monitor + CPU + teclado + mouse, o Estación de cocina =
 * estufa + campana + mesón. La familia tiene su propia pegatina
 * (QR "SENA-FAM:<codigo>" y código de barras del código): al escanearla en
 * la revisión se reporta la familia completa o uno de sus componentes.
 * Consulta para el personal; crear, editar y borrar solo administrativos.
 */

const SQL_FAMILIAS = "SELECT f.*, e.codigo AS ambiente_codigo, e.nombre AS ambiente_nombre,
                             (SELECT COUNT(*) FROM inventory_items i WHERE i.family_id = f.id) AS componentes,
                             (SELECT COUNT(*) FROM inventory_items i WHERE i.family_id = f.id AND i.estado <> 'operativo') AS componentes_novedad,
                             (SELECT n.id FROM persistent_issues n WHERE n.family_id = f.id AND n.estado = 'en_curso' ORDER BY n.id LIMIT 1) AS novedad_activa_id
                      FROM item_families f JOIN environments e ON e.id = f.environment_id";

/** Con $conComponentes trae los ítems de la familia (una consulta más). */
function familiaPublica(array $f, bool $conComponentes = false): array
{
    $r = [
        'id' => (int) $f['id'],
        'ambienteId' => (int) $f['environment_id'],
        'ambiente' => $f['ambiente_codigo'],
        'codigo' => $f['codigo'],
        'qr' => PREFIJO_QR_FAMILIA . $f['codigo'],
        'tipo' => $f['tipo'],
        'nombre' => $f['nombre'],
        'componentesTotal' => (int) $f['componentes'],
        'componentesConNovedad' => (int) $f['componentes_novedad'],
        'novedadActivaId' => $f['novedad_activa_id'] !== null ? (int) $f['novedad_activa_id'] : null,
    ];
    if ($conComponentes) {
        $r['componentes'] = array_map('itemPublico', filas(SQL_ITEMS . ' WHERE i.family_id = ? ORDER BY i.nombre', [(int) $f['id']]));
    }
    return $r;
}

function buscarFamilia(int $id): array
{
    $f = fila(SQL_FAMILIAS . ' WHERE f.id = ?', [$id]);
    if (!$f) fallar(404, 'La familia no existe.', 'NO_ENCONTRADO');
    return $f;
}

/** FAM107-PC05, FAM110-EST01…: prefijo del ambiente, tres letras del tipo y consecutivo. */
function siguienteCodigoFamilia(array $amb, string $tipo): string
{
    $sigla = strtoupper(substr(preg_replace('/[^a-z]/', '', claveTexto($tipo)), 0, 3)) ?: 'FAM';
    $prefijo = "FAM{$amb['codigo']}-$sigla";
    $ultimo = fila('SELECT MAX(CAST(SUBSTRING(codigo, ?) AS UNSIGNED)) n FROM item_families WHERE codigo REGEXP ?',
        [strlen($prefijo) + 1, '^' . preg_quote($prefijo) . '[0-9]+$']);
    return $prefijo . str_pad((string) (((int) ($ultimo['n'] ?? 0)) + 1), 2, '0', STR_PAD_LEFT);
}

/** GET /inventory/families?ambienteId: con sus componentes. */
function rutaFamilias(): never
{
    exigirRol('administrativo', 'instructor', 'portero');
    $ambienteId = entero($_GET, 'ambienteId', false);
    $lista = filas(SQL_FAMILIAS . ($ambienteId ? ' WHERE f.environment_id = ?' : '') . ' ORDER BY e.codigo, f.codigo', $ambienteId ? [$ambienteId] : []);
    responder(array_map(fn($f) => familiaPublica($f, true), $lista));
}

function rutaFamilia(int $id): never
{
    exigirRol('administrativo', 'instructor', 'portero');
    responder(familiaPublica(buscarFamilia($id), true));
}

/**
 * Deja la familia con exactamente estos componentes: los que entran salen de
 * su familia anterior; los que no vienen quedan sueltos. Todo en la trazabilidad.
 */
function asignarComponentes(array $familia, array $ids, int $usuarioId): void
{
    if ($ids) {
        $items = filas('SELECT i.id, i.codigo, i.environment_id, i.family_id, f.codigo AS familia_anterior FROM inventory_items i
                        LEFT JOIN item_families f ON f.id = i.family_id WHERE i.id IN (' . marcas(count($ids)) . ')', $ids);
        if (count($items) !== count($ids)) fallar(422, 'Alguno de los ítems elegidos no existe.', 'VALIDACION');
        foreach ($items as $i) {
            if ((int) $i['environment_id'] !== (int) $familia['environment_id']) {
                fallar(422, "El ítem {$i['codigo']} es de otro ambiente: los componentes deben estar en el ambiente {$familia['ambiente_codigo']}.", 'OTRO_AMBIENTE');
            }
        }
    } else {
        $items = [];
    }
    foreach (filas('SELECT id FROM inventory_items WHERE family_id = ?', [(int) $familia['id']]) as $actual) {
        if (in_array((int) $actual['id'], $ids, true)) continue;
        consulta('UPDATE inventory_items SET family_id = NULL WHERE id = ?', [(int) $actual['id']]);
        historial((int) $actual['id'], 'familia', "Sale de la familia {$familia['codigo']} ({$familia['nombre']})", $usuarioId);
    }
    foreach ($items as $i) {
        if ((int) $i['family_id'] === (int) $familia['id']) continue;
        consulta('UPDATE inventory_items SET family_id = ? WHERE id = ?', [(int) $familia['id'], (int) $i['id']]);
        historial((int) $i['id'], 'familia', "Asignado a la familia {$familia['codigo']} ({$familia['nombre']})"
            . ($i['familia_anterior'] ? "; antes en {$i['familia_anterior']}" : ''), $usuarioId);
    }
}

/** POST /inventory/families {ambienteId, tipo, nombre, codigo?, itemIds?} */
function rutaCrearFamilia(): never
{
    $u = exigirRol('administrativo');
    $d = cuerpo();
    $amb = buscarAmbiente(entero($d, 'ambienteId'));
    $tipo = texto($d, 'tipo', 40, true, 'el tipo de familia');
    $nombre = texto($d, 'nombre', 120, true, 'el nombre');
    $codigo = !empty($d['codigo'])
        ? (normalizarCodigo($d['codigo'], PREFIJO_QR_FAMILIA) ?? fallar(422, 'El código solo admite letras, números y guiones (3 a 40).', 'VALIDACION'))
        : siguienteCodigoFamilia($amb, $tipo);
    verificarCodigoFamiliaLibre($codigo);
    db()->begin_transaction();
    $id = insertar('INSERT INTO item_families (environment_id, codigo, tipo, nombre) VALUES (?, ?, ?, ?)', [(int) $amb['id'], $codigo, $tipo, $nombre]);
    asignarComponentes(buscarFamilia($id), listaIds($d['itemIds'] ?? [], 50), (int) $u['id']);
    db()->commit();
    responder(familiaPublica(buscarFamilia($id), true), 201);
}

function verificarCodigoFamiliaLibre(string $codigo, int $excepto = 0): void
{
    if (fila('SELECT id FROM item_families WHERE codigo = ? AND id <> ?', [$codigo, $excepto])) fallar(409, "Ya existe una familia con el código $codigo.", 'DUPLICADO');
    if (fila('SELECT id FROM inventory_items WHERE codigo = ?', [$codigo])) fallar(409, "El código $codigo ya es de un ítem.", 'DUPLICADO');
}

/** PATCH /inventory/families/{id} {tipo, nombre, itemIds?}: sin itemIds no cambia los componentes. */
function rutaEditarFamilia(int $id): never
{
    $u = exigirRol('administrativo');
    $f = buscarFamilia($id);
    $d = cuerpo();
    db()->begin_transaction();
    consulta('UPDATE item_families SET tipo = ?, nombre = ? WHERE id = ?',
        [texto($d, 'tipo', 40, true, 'el tipo de familia'), texto($d, 'nombre', 120, true, 'el nombre'), $id]);
    if (array_key_exists('itemIds', $d)) asignarComponentes(buscarFamilia($id), listaIds($d['itemIds'], 50), (int) $u['id']);
    db()->commit();
    responder(familiaPublica(buscarFamilia($id), true));
}

/** DELETE /inventory/families/{id}: los componentes quedan como ítems sueltos. */
function rutaBorrarFamilia(int $id): never
{
    $u = exigirRol('administrativo');
    $f = buscarFamilia($id);
    if (fila('SELECT id FROM inspection_items WHERE family_id = ? LIMIT 1', [$id]) || fila('SELECT id FROM persistent_issues WHERE family_id = ? LIMIT 1', [$id])) {
        fallar(409, 'La familia tiene novedades reportadas; no se puede borrar.', 'EN_USO');
    }
    db()->begin_transaction();
    asignarComponentes($f, [], (int) $u['id']);
    consulta('DELETE FROM item_families WHERE id = ?', [$id]);
    db()->commit();
    responder(null, 204);
}
