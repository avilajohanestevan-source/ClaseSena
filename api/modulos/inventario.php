<?php
/** Inventario por ambiente: consulta para el personal, CRUD para administrativos. */

const ESTADOS_ITEM = ['operativo', 'danado', 'en_reparacion', 'baja'];
const SQL_ITEMS = 'SELECT i.*, e.codigo AS ambiente_codigo, e.nombre AS ambiente_nombre
                   FROM inventory_items i JOIN environments e ON e.id = i.environment_id';

function itemPublico(array $i): array
{
    return [
        'id' => (int) $i['id'],
        'ambienteId' => (int) $i['environment_id'],
        'ambiente' => $i['ambiente_codigo'] ?? null,
        'codigo' => $i['codigo'],
        // Contenido del QR de la etiqueta física.
        'qr' => 'SENA-INV:' . $i['codigo'],
        'nombre' => $i['nombre'],
        'categoria' => $i['categoria'],
        'serial' => $i['serial'],
        'estado' => $i['estado'],
        'actualizadoEn' => iso($i['updated_at']),
    ];
}

function rutaItemsAmbiente(int $id): never
{
    exigirRol('administrativo', 'instructor', 'portero');
    buscarAmbiente($id);
    responder(array_map('itemPublico', filas(SQL_ITEMS . ' WHERE i.environment_id = ? ORDER BY i.codigo', [$id])));
}

/** Busca por código (AMB107-003). El front quita el prefijo "SENA-INV:" del QR antes de llamar. */
function rutaItemPorCodigo(string $codigo): never
{
    exigirRol('administrativo', 'instructor', 'portero');
    $i = fila(SQL_ITEMS . ' WHERE i.codigo = ?', [strtoupper($codigo)]);
    if (!$i) fallar(404, "No hay ningún ítem con el código $codigo.", 'NO_ENCONTRADO');
    responder(itemPublico($i));
}

function buscarItem(int $id): array
{
    $i = fila(SQL_ITEMS . ' WHERE i.id = ?', [$id]);
    if (!$i) fallar(404, 'El ítem no existe.', 'NO_ENCONTRADO');
    return $i;
}

function rutaCrearItem(): never
{
    exigirRol('administrativo');
    $d = cuerpo();
    $ambienteId = entero($d, 'ambienteId');
    $amb = buscarAmbiente($ambienteId);
    // Código consecutivo por ambiente: AMB107-011.
    $prefijo = 'AMB' . $amb['codigo'] . '-';
    $ultimo = fila('SELECT MAX(CAST(SUBSTRING(codigo, ?) AS UNSIGNED)) n FROM inventory_items WHERE codigo LIKE ?', [strlen($prefijo) + 1, $prefijo . '%']);
    $codigo = $prefijo . str_pad((string) (((int) ($ultimo['n'] ?? 0)) + 1), 3, '0', STR_PAD_LEFT);
    $id = insertar(
        'INSERT INTO inventory_items (environment_id, codigo, nombre, categoria, serial, estado) VALUES (?, ?, ?, ?, ?, ?)',
        [$ambienteId, $codigo, texto($d, 'nombre', 120, true, 'el nombre'), texto($d, 'categoria', 40, true, 'la categoría'),
         texto($d, 'serial', 60, false, 'el serial'), opcion($d, 'estado', ESTADOS_ITEM, false) ?? 'operativo']
    );
    responder(itemPublico(buscarItem($id)), 201);
}

function rutaEditarItem(int $id): never
{
    exigirRol('administrativo');
    buscarItem($id);
    $d = cuerpo();
    consulta(
        'UPDATE inventory_items SET nombre = ?, categoria = ?, serial = ?, estado = ? WHERE id = ?',
        [texto($d, 'nombre', 120, true, 'el nombre'), texto($d, 'categoria', 40, true, 'la categoría'),
         texto($d, 'serial', 60, false, 'el serial'), opcion($d, 'estado', ESTADOS_ITEM, true, 'el estado'), $id]
    );
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
