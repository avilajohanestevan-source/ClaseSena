<?php
/** Bandeja de notificaciones del usuario (porteros, instructores y administrativos). */

function rutaBandeja(): never
{
    $u = usuario();
    $lista = filas(
        'SELECT n.*, e.codigo AS ambiente FROM notifications n
         LEFT JOIN inspections s ON s.id = n.inspection_id LEFT JOIN environments e ON e.id = s.environment_id
         WHERE n.user_id = ? ORDER BY n.created_at DESC, n.id DESC LIMIT 40',
        [(int) $u['id']]
    );
    $sinLeer = fila('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND leida = 0', [(int) $u['id']]);
    responder([
        'sinLeer' => (int) $sinLeer['n'],
        'notificaciones' => array_map(fn($n) => [
            'id' => (int) $n['id'],
            'tipo' => $n['tipo'],
            'titulo' => $n['titulo'],
            'detalle' => $n['detalle'],
            'inspeccionId' => $n['inspection_id'] !== null ? (int) $n['inspection_id'] : null,
            'ambiente' => $n['ambiente'],
            'leida' => (bool) $n['leida'],
            'fecha' => iso($n['created_at']),
        ], $lista),
    ]);
}

function rutaLeerNotificacion(int $id): never
{
    $u = usuario();
    consulta('UPDATE notifications SET leida = 1 WHERE id = ? AND user_id = ?', [$id, (int) $u['id']]);
    responder(null, 204);
}

function rutaLeerTodas(): never
{
    $u = usuario();
    consulta('UPDATE notifications SET leida = 1 WHERE user_id = ?', [(int) $u['id']]);
    responder(null, 204);
}
