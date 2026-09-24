<?php
/** Reportes para administrativos: resumen, por ambiente y detalle de daños. */

/** GET /reports?desde&hasta&ambienteId&instructorId */
function rutaReporte(): never
{
    exigirRol('administrativo');
    $where = ["s.estado <> 'cancelada'"];
    $params = [];
    if ($v = entero($_GET, 'ambienteId', false)) { $where[] = 's.environment_id = ?'; $params[] = $v; }
    if ($v = entero($_GET, 'instructorId', false)) { $where[] = 's.instructor_id = ?'; $params[] = $v; }
    foreach (['desde' => '>=', 'hasta' => '<='] as $campo => $op) {
        if (!empty($_GET[$campo])) {
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $_GET[$campo])) fallar(422, "La fecha '$campo' no es válida.", 'VALIDACION');
            $where[] = "DATE(s.iniciada_en) $op ?";
            $params[] = $_GET[$campo];
        }
    }
    $w = implode(' AND ', $where);

    $resumen = fila(
        "SELECT COUNT(*) total,
                SUM(s.resultado = 'ok') ok,
                SUM(s.resultado = 'con_danos') con_danos,
                SUM(s.estado = 'en_curso') en_curso,
                SUM(s.estado = 'pendiente_recepcion') pendientes,
                SUM(s.estado = 'recibida') recibidas,
                (SELECT COUNT(*) FROM inspection_items d JOIN inspections s ON s.id = d.inspection_id WHERE $w) danos,
                ROUND(AVG(CASE WHEN s.recibida_en IS NOT NULL THEN TIMESTAMPDIFF(MINUTE, s.iniciada_en, s.recibida_en) END)) minutos_promedio
         FROM inspections s WHERE $w",
        [...$params, ...$params]
    );

    $porAmbiente = filas(
        "SELECT e.id, e.codigo, e.nombre, COUNT(s.id) inspecciones,
                SUM(s.resultado = 'con_danos') con_danos,
                (SELECT COUNT(*) FROM inspection_items d JOIN inspections s ON s.id = d.inspection_id WHERE s.environment_id = e.id AND $w) danos
         FROM environments e LEFT JOIN inspections s ON s.environment_id = e.id AND $w
         GROUP BY e.id ORDER BY e.codigo",
        [...$params, ...$params]
    );

    $danos = filas(
        "SELECT d.*, it.codigo, it.nombre AS item, it.estado AS estado_actual, e.codigo AS ambiente, u.nombre AS instructor, p.nombre AS portero, s.id AS inspeccion
         FROM inspection_items d
         JOIN inspections s ON s.id = d.inspection_id
         LEFT JOIN inventory_items it ON it.id = d.inventory_item_id
         JOIN environments e ON e.id = s.environment_id
         JOIN users u ON u.id = s.instructor_id
         LEFT JOIN users p ON p.id = s.portero_id
         WHERE $w ORDER BY d.reportado_en DESC LIMIT 300",
        $params
    );

    responder([
        'resumen' => [
            'total' => (int) $resumen['total'],
            'ok' => (int) $resumen['ok'],
            'conDanos' => (int) $resumen['con_danos'],
            'enCurso' => (int) $resumen['en_curso'],
            'pendientes' => (int) $resumen['pendientes'],
            'recibidas' => (int) $resumen['recibidas'],
            'danos' => (int) $resumen['danos'],
            'minutosPromedio' => $resumen['minutos_promedio'] !== null ? (int) $resumen['minutos_promedio'] : null,
        ],
        'porAmbiente' => array_map(fn($a) => [
            'id' => (int) $a['id'], 'codigo' => $a['codigo'], 'nombre' => $a['nombre'],
            'inspecciones' => (int) $a['inspecciones'], 'conDanos' => (int) $a['con_danos'], 'danos' => (int) $a['danos'],
        ], $porAmbiente),
        'danos' => array_map(fn($d) => [
            'id' => (int) $d['id'],
            'inspeccionId' => (int) $d['inspeccion'],
            'ambiente' => $d['ambiente'],
            'codigo' => $d['codigo'],
            // Daño del salón (sin ítem): se muestra la ubicación.
            'item' => $d['item'] ?? ('Salón · ' . UBICACIONES[$d['ubicacion']]),
            'ubicacion' => $d['ubicacion'],
            'estadoActual' => $d['estado_actual'],
            'tipoDano' => $d['tipo_dano'],
            'severidad' => $d['severidad'],
            'comentario' => $d['comentario'],
            'foto' => $d['foto'],
            'instructor' => $d['instructor'],
            'portero' => $d['portero'],
            'reportadoEn' => iso($d['reportado_en']),
        ], $danos),
    ]);
}
