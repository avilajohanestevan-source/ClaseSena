<?php
/**
 * Ambientes: consulta para todos los roles, CRUD para administrativos.
 * Cada ambiente tiene su capacidad en aprendices (capacidad_aprendices), una
 * especialidad (especialidades_ambiente: Cocina, Laboratorio, Audiovisual…) y
 * un cuentadante, que responde por el inventario. Elegir un cuentadante nuevo
 * (al crear o al editar) abre una revisión del inventario: queda como
 * cuentadante cuando la acepta (modulos/cuentadante.php).
 */

const SQL_AMBIENTES = "
    SELECT e.*, p.nombre AS portero_nombre, es.nombre AS especialidad_nombre, cu.nombre AS cuentadante_nombre,
           (SELECT r.id FROM revisiones_inventario r WHERE r.environment_id = e.id AND r.tipo = 'cuentadante' AND r.estado = 'pendiente' ORDER BY r.id DESC LIMIT 1) AS rev_cuentadante_id,
           (SELECT ru.nombre FROM revisiones_inventario r JOIN users ru ON ru.id = r.responsable_id
             WHERE r.environment_id = e.id AND r.tipo = 'cuentadante' AND r.estado = 'pendiente' ORDER BY r.id DESC LIMIT 1) AS rev_cuentadante_nombre,
           (SELECT r.responsable_id FROM revisiones_inventario r
             WHERE r.environment_id = e.id AND r.tipo = 'cuentadante' AND r.estado = 'pendiente' ORDER BY r.id DESC LIMIT 1) AS rev_cuentadante_resp,
           (SELECT COUNT(*) FROM inventory_items i WHERE i.environment_id = e.id AND i.estado <> 'baja') AS items_total,
           (SELECT COUNT(*) FROM inventory_items i WHERE i.environment_id = e.id AND i.estado IN ('danado','en_reparacion','fuera_servicio')) AS items_novedad,
           (SELECT COUNT(*) FROM item_families f WHERE f.environment_id = e.id) AS familias_total,
           (SELECT COUNT(*) FROM persistent_issues n WHERE n.environment_id = e.id AND n.estado = 'en_curso') AS novedades_activas,
           u.id AS ult_id, u.estado AS ult_estado, u.resultado AS ult_resultado, u.iniciada_en AS ult_iniciada,
           u.instructor_id AS ult_instructor_id, ui.nombre AS ult_instructor, u.portero_id AS ult_portero_id, up.nombre AS ult_portero
    FROM environments e
    LEFT JOIN users p ON p.id = e.portero_id
    LEFT JOIN users cu ON cu.id = e.cuentadante_id
    LEFT JOIN especialidades_ambiente es ON es.id = e.especialidad_id
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
        'capacidadAprendices' => $e['capacidad_aprendices'] !== null ? (int) $e['capacidad_aprendices'] : null,
        'especialidadId' => $e['especialidad_id'] !== null ? (int) $e['especialidad_id'] : null,
        'especialidad' => $e['especialidad_nombre'] ?? null,
        'porteroId' => $e['portero_id'] !== null ? (int) $e['portero_id'] : null,
        'portero' => $e['portero_nombre'] ?? null,
        'cuentadante' => $e['cuentadante_id'] ? ['id' => (int) $e['cuentadante_id'], 'nombre' => $e['cuentadante_nombre']] : null,
        // Cambio de cuentadante en curso: el nuevo aún no acepta la revisión del inventario.
        'cuentadantePendiente' => !empty($e['rev_cuentadante_id'])
            ? ['revisionId' => (int) $e['rev_cuentadante_id'], 'id' => (int) $e['rev_cuentadante_resp'], 'nombre' => $e['rev_cuentadante_nombre']] : null,
        'activo' => (bool) $e['activo'],
        'itemsTotal' => (int) ($e['items_total'] ?? 0),
        'itemsNovedad' => (int) ($e['items_novedad'] ?? 0),
        'familiasTotal' => (int) ($e['familias_total'] ?? 0),
        'novedadesActivas' => (int) ($e['novedades_activas'] ?? 0),
        'ultimaInspeccion' => !empty($e['ult_id']) ? [
            'id' => (int) $e['ult_id'],
            'estado' => $e['ult_estado'],
            'resultado' => $e['ult_resultado'],
            'iniciadaEn' => iso($e['ult_iniciada']),
            'porteroId' => $e['ult_portero_id'] !== null ? (int) $e['ult_portero_id'] : null,
            'portero' => $e['ult_portero'],
            'instructorId' => (int) $e['ult_instructor_id'],
            'instructor' => $e['ult_instructor'],
        ] : null,
    ];
}

/** GET /environments?asignados=1&especialidadId  (portero: solo los que tiene asignados) */
function rutaAmbientes(): never
{
    $u = usuario();
    $where = [];
    $params = [];
    if ($u['rol'] !== 'administrativo') $where[] = 'e.activo = 1';
    if (!empty($_GET['asignados']) && $u['rol'] === 'portero') { $where[] = 'e.portero_id = ?'; $params[] = (int) $u['id']; }
    if ($v = entero($_GET, 'especialidadId', false)) { $where[] = 'e.especialidad_id = ?'; $params[] = $v; }
    $sql = SQL_AMBIENTES . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . ' ORDER BY e.codigo';
    // Quién está asignado hoy en cada jornada (modulos/asignaciones.php).
    $efectivas = asignacionesEfectivas(hoy(), hoy());
    // El instructor solo ve sus propias jornadas (modulos/asignaciones.php).
    responder(array_map(fn($e) => ambientePublico($e) + ['asignadosHoy' => asignadosHoyPara($u, (int) $e['id'], $efectivas)], filas($sql, $params)));
}

function buscarAmbiente(int $id): array
{
    $e = fila(SQL_AMBIENTES . ' WHERE e.id = ?', [$id]);
    if (!$e) fallar(404, 'El ambiente no existe.', 'NO_ENCONTRADO');
    return $e;
}

function rutaAmbiente(int $id): never
{
    $u = usuario();
    responder(ambientePublico(buscarAmbiente($id)) + ['asignadosHoy' => asignadosHoyPara($u, $id, asignacionesEfectivas(hoy(), hoy(), $id))]);
}

/**
 * Datos de crear/editar. Acepta camelCase (capacidadAprendices, especialidadId)
 * o snake_case (capacidad_aprendices, especialidad_id); la especialidad también
 * por nombre (especialidad: "Cocina").
 */
function datosAmbiente(array $d): array
{
    $d = conAlias(conAlias(conAlias($d, 'capacidadAprendices', 'capacidad_aprendices'), 'especialidadId', 'especialidad_id'), 'porteroId', 'portero_id');
    $codigo = texto($d, 'codigo', 10, true, 'el número del ambiente');
    if (!preg_match('/^[A-Za-z0-9-]+$/', $codigo)) fallar(422, 'El número del ambiente solo admite letras, números y guiones.', 'VALIDACION');
    $porteroId = entero($d, 'porteroId', false);
    if ($porteroId !== null && !fila("SELECT id FROM users WHERE id = ? AND rol = 'portero' AND activo = 1", [$porteroId])) {
        fallar(422, 'El portero elegido no existe.', 'VALIDACION');
    }
    $capacidad = entero($d, 'capacidadAprendices', false);
    if ($capacidad !== null && ($capacidad < 1 || $capacidad > 500)) fallar(422, 'La capacidad de aprendices debe estar entre 1 y 500.', 'VALIDACION');
    $especialidadId = idCatalogo('especialidad', $d['especialidadId'] ?? null, $d['especialidad'] ?? null, false);
    $d = conAlias($d, 'cuentadanteId', 'cuentadante_id');
    return [
        strtoupper($codigo),
        texto($d, 'nombre', 120, true, 'el nombre'),
        $capacidad,
        $especialidadId,
        $porteroId,
        array_key_exists('activo', $d) ? (int) (bool) $d['activo'] : 1,
    ];
}

/** Cuentadante elegido (instructor, administrativo o almacén activo), o null si no viene. */
function cuentadanteElegido(array $d): ?int
{
    $d = conAlias($d, 'cuentadanteId', 'cuentadante_id');
    $id = entero($d, 'cuentadanteId', false);
    if ($id === null) return null;
    if (!fila("SELECT id FROM users WHERE id = ? AND activo = 1 AND rol IN ('instructor', 'administrativo', 'almacen')", [$id])) {
        fallar(422, 'El cuentadante debe ser un instructor, un administrativo o almacén activo.', 'VALIDACION');
    }
    return $id;
}

function verificarCodigoLibre(string $codigo, int $excepto = 0): void
{
    if (fila('SELECT id FROM environments WHERE codigo = ? AND id <> ?', [$codigo, $excepto])) {
        fallar(409, "Ya existe un ambiente con el número $codigo.", 'DUPLICADO');
    }
}

function rutaCrearAmbiente(): never
{
    $u = exigirRol('administrativo');
    $v = datosAmbiente(cuerpo());
    $cuentadante = cuentadanteElegido(cuerpo());
    verificarCodigoLibre($v[0]);
    db()->begin_transaction();
    $id = insertar('INSERT INTO environments (codigo, nombre, capacidad_aprendices, especialidad_id, portero_id, activo) VALUES (?, ?, ?, ?, ?, ?)', $v);
    // El cuentadante recibe el inventario revisándolo (se carga después con su Excel).
    if ($cuentadante) crearRevision($id, 'cuentadante', $cuentadante, (int) $u['id'], "Ambiente nuevo {$v[0]}");
    db()->commit();
    responder(ambientePublico(buscarAmbiente($id)), 201);
}

function rutaEditarAmbiente(int $id): never
{
    $u = exigirRol('administrativo');
    $antes = buscarAmbiente($id);
    $v = datosAmbiente(cuerpo());
    $cuentadante = cuentadanteElegido(cuerpo());
    verificarCodigoLibre($v[0], $id);
    db()->begin_transaction();
    consulta('UPDATE environments SET codigo = ?, nombre = ?, capacidad_aprendices = ?, especialidad_id = ?, portero_id = ?, activo = ? WHERE id = ?', [...$v, $id]);
    // Cambio de cuentadante: el nuevo lo es cuando revise y acepte el inventario.
    if ($cuentadante && $cuentadante !== (int) $antes['cuentadante_id']) {
        crearRevision($id, 'cuentadante', $cuentadante, (int) $u['id'], 'Cambio de cuentadante' . ($antes['cuentadante_nombre'] ? " (antes {$antes['cuentadante_nombre']})" : ''));
    }
    db()->commit();
    responder(ambientePublico(buscarAmbiente($id)));
}

function rutaBorrarAmbiente(int $id): never
{
    exigirRol('administrativo');
    buscarAmbiente($id);
    $uso = fila('SELECT (SELECT COUNT(*) FROM inventory_items WHERE environment_id = ?) items,
                        (SELECT COUNT(*) FROM item_families WHERE environment_id = ?) familias,
                        (SELECT COUNT(*) FROM inspections WHERE environment_id = ?) inspecciones', [$id, $id, $id]);
    if ($uso['items'] || $uso['familias'] || $uso['inspecciones']) {
        fallar(409, 'El ambiente tiene inventario o inspecciones registradas. Desactívalo en lugar de borrarlo.', 'EN_USO');
    }
    consulta('DELETE FROM environments WHERE id = ?', [$id]);
    responder(null, 204);
}
