<?php
/** Ambientes: consulta para todos los roles, CRUD para administrativos. */

const SQL_AMBIENTES = "
    SELECT e.*, p.nombre AS portero_nombre,
           (SELECT COUNT(*) FROM inventory_items i WHERE i.environment_id = e.id AND i.estado <> 'baja') AS items_total,
           (SELECT COUNT(*) FROM inventory_items i WHERE i.environment_id = e.id AND i.estado IN ('danado','en_reparacion')) AS items_novedad,
           u.id AS ult_id, u.estado AS ult_estado, u.resultado AS ult_resultado, u.iniciada_en AS ult_iniciada,
           u.instructor_id AS ult_instructor_id, ui.nombre AS ult_instructor, u.portero_id AS ult_portero_id, up.nombre AS ult_portero
    FROM environments e
    LEFT JOIN users p ON p.id = e.portero_id
    LEFT JOIN inspections u ON u.id = (
        SELECT x.id FROM inspections x WHERE x.environment_id = e.id AND x.estado <> 'cancelada'
        ORDER BY x.iniciada_en DESC LIMIT 1)
    LEFT JOIN users ui ON ui.id = u.instructor_id
    LEFT JOIN users up ON up.id = u.portero_id";

function ambientePublico(array $e): array
{
    return [
        'id' => (int) $e['id'],
        'codigo' => $e['codigo'],
        'nombre' => $e['nombre'],
        'bloque' => $e['bloque'],
        'capacidad' => $e['capacidad'] !== null ? (int) $e['capacidad'] : null,
        'porteroId' => $e['portero_id'] !== null ? (int) $e['portero_id'] : null,
        'portero' => $e['portero_nombre'] ?? null,
        'activo' => (bool) $e['activo'],
        'itemsTotal' => (int) ($e['items_total'] ?? 0),
        'itemsNovedad' => (int) ($e['items_novedad'] ?? 0),
        'ultimaInspeccion' => !empty($e['ult_id']) ? [
            'id' => (int) $e['ult_id'],
            'estado' => $e['ult_estado'],
            'resultado' => $e['ult_resultado'],
            'iniciadaEn' => iso($e['ult_iniciada']),
            'porteroId' => (int) $e['ult_portero_id'],
            'portero' => $e['ult_portero'],
            'instructorId' => $e['ult_instructor_id'] !== null ? (int) $e['ult_instructor_id'] : null,
            'instructor' => $e['ult_instructor'],
        ] : null,
    ];
}

/** GET /environments?asignados=1  (portero: solo los que tiene asignados) */
function rutaAmbientes(): never
{
    $u = usuario();
    $where = [];
    $params = [];
    if ($u['rol'] !== 'administrativo') $where[] = 'e.activo = 1';
    if (!empty($_GET['asignados']) && $u['rol'] === 'portero') { $where[] = 'e.portero_id = ?'; $params[] = (int) $u['id']; }
    $sql = SQL_AMBIENTES . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . ' ORDER BY e.codigo';
    responder(array_map('ambientePublico', filas($sql, $params)));
}

function buscarAmbiente(int $id): array
{
    $e = fila(SQL_AMBIENTES . ' WHERE e.id = ?', [$id]);
    if (!$e) fallar(404, 'El ambiente no existe.', 'NO_ENCONTRADO');
    return $e;
}

function rutaAmbiente(int $id): never
{
    usuario();
    responder(ambientePublico(buscarAmbiente($id)));
}

function datosAmbiente(array $d): array
{
    $codigo = texto($d, 'codigo', 10, true, 'el número del ambiente');
    if (!preg_match('/^[A-Za-z0-9-]+$/', $codigo)) fallar(422, 'El número del ambiente solo admite letras, números y guiones.', 'VALIDACION');
    $porteroId = entero($d, 'porteroId', false);
    if ($porteroId !== null && !fila("SELECT id FROM users WHERE id = ? AND rol = 'portero' AND activo = 1", [$porteroId])) {
        fallar(422, 'El portero elegido no existe.', 'VALIDACION');
    }
    $capacidad = entero($d, 'capacidad', false);
    if ($capacidad !== null && ($capacidad < 1 || $capacidad > 500)) fallar(422, 'La capacidad debe estar entre 1 y 500.', 'VALIDACION');
    return [
        strtoupper($codigo),
        texto($d, 'nombre', 120, true, 'el nombre'),
        texto($d, 'bloque', 60, false, 'el bloque'),
        $capacidad,
        $porteroId,
        array_key_exists('activo', $d) ? (int) (bool) $d['activo'] : 1,
    ];
}

function verificarCodigoLibre(string $codigo, int $excepto = 0): void
{
    if (fila('SELECT id FROM environments WHERE codigo = ? AND id <> ?', [$codigo, $excepto])) {
        fallar(409, "Ya existe un ambiente con el número $codigo.", 'DUPLICADO');
    }
}

function rutaCrearAmbiente(): never
{
    exigirRol('administrativo');
    $v = datosAmbiente(cuerpo());
    verificarCodigoLibre($v[0]);
    $id = insertar('INSERT INTO environments (codigo, nombre, bloque, capacidad, portero_id, activo) VALUES (?, ?, ?, ?, ?, ?)', $v);
    responder(ambientePublico(buscarAmbiente($id)), 201);
}

function rutaEditarAmbiente(int $id): never
{
    exigirRol('administrativo');
    buscarAmbiente($id);
    $v = datosAmbiente(cuerpo());
    verificarCodigoLibre($v[0], $id);
    consulta('UPDATE environments SET codigo = ?, nombre = ?, bloque = ?, capacidad = ?, portero_id = ?, activo = ? WHERE id = ?', [...$v, $id]);
    responder(ambientePublico(buscarAmbiente($id)));
}

function rutaBorrarAmbiente(int $id): never
{
    exigirRol('administrativo');
    buscarAmbiente($id);
    $uso = fila('SELECT (SELECT COUNT(*) FROM inventory_items WHERE environment_id = ?) items,
                        (SELECT COUNT(*) FROM inspections WHERE environment_id = ?) inspecciones', [$id, $id]);
    if ($uso['items'] || $uso['inspecciones']) {
        fallar(409, 'El ambiente tiene inventario o inspecciones registradas. Desactívalo en lugar de borrarlo.', 'EN_USO');
    }
    consulta('DELETE FROM environments WHERE id = ?', [$id]);
    responder(null, 204);
}
