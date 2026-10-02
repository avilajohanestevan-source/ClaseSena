<?php
/**
 * Historial para auditoría (audit_events): cada evento de una novedad
 * permanente (creada, reportada de nuevo, modificada, resuelta, anulada) y de
 * una asignación de instructor (creada, reasignada, recortada, anulada), con
 * fecha, usuario, detalle, evidencia (foto) y los datos que cambiaron.
 */

const ENTIDADES_AUDITORIA = ['novedad', 'asignacion'];

/** Deja un evento en el historial. $usuarioId null = proceso automático. */
function auditar(string $entidad, int $entidadId, ?int $ambienteId, string $accion, string $detalle, ?int $usuarioId,
                 ?string $foto = null, ?array $datos = null): void
{
    insertar(
        'INSERT INTO audit_events (entidad, entidad_id, environment_id, accion, detalle, foto, datos, user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())',
        [$entidad, $entidadId, $ambienteId, $accion, mb_substr($detalle, 0, 500), $foto,
         $datos ? json_encode($datos, JSON_UNESCAPED_UNICODE) : null, $usuarioId]
    );
}

const SQL_AUDITORIA = 'SELECT a.*, u.nombre AS usuario, u.rol AS usuario_rol, e.codigo AS ambiente
                       FROM audit_events a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN environments e ON e.id = a.environment_id';

function eventoPublico(array $a): array
{
    return [
        'id' => (int) $a['id'],
        'entidad' => $a['entidad'],
        'entidadId' => (int) $a['entidad_id'],
        'ambiente' => $a['ambiente'],
        'accion' => $a['accion'],
        'detalle' => $a['detalle'],
        'foto' => $a['foto'],
        'datos' => $a['datos'] ? json_decode($a['datos'], true) : null,
        'usuario' => $a['usuario'],
        'usuarioRol' => $a['usuario_rol'],
        'fecha' => iso($a['created_at']),
    ];
}

/** Eventos de una novedad o de una asignación, del más antiguo al más reciente. */
function eventosDe(string $entidad, int $id): array
{
    return array_map('eventoPublico', filas(SQL_AUDITORIA . ' WHERE a.entidad = ? AND a.entidad_id = ? ORDER BY a.created_at, a.id', [$entidad, $id]));
}

/** GET /audit?entidad&entidadId&ambienteId&usuarioId&accion&desde&hasta (administrativo) */
function rutaAuditoria(): never
{
    exigirRol('administrativo');
    $where = [];
    $params = [];
    if ($v = opcion($_GET, 'entidad', ENTIDADES_AUDITORIA, false)) { $where[] = 'a.entidad = ?'; $params[] = $v; }
    if ($v = entero($_GET, 'entidadId', false)) { $where[] = 'a.entidad_id = ?'; $params[] = $v; }
    if ($v = entero($_GET, 'ambienteId', false)) { $where[] = 'a.environment_id = ?'; $params[] = $v; }
    if ($v = entero($_GET, 'usuarioId', false)) { $where[] = 'a.user_id = ?'; $params[] = $v; }
    if (!empty($_GET['accion'])) { $where[] = 'a.accion = ?'; $params[] = (string) $_GET['accion']; }
    foreach (['desde' => '>=', 'hasta' => '<='] as $campo => $op) {
        if (!empty($_GET[$campo])) {
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $_GET[$campo])) fallar(422, "La fecha '$campo' no es válida.", 'VALIDACION');
            $where[] = "DATE(a.created_at) $op ?";
            $params[] = $_GET[$campo];
        }
    }
    $sql = SQL_AUDITORIA . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . ' ORDER BY a.created_at DESC, a.id DESC LIMIT 500';
    responder(array_map('eventoPublico', filas($sql, $params)));
}
