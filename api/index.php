<?php
/**
 * API JSON de entrega y revisión de ambientes (prueba de concepto).
 *
 * Todas las rutas entran por este archivo: /sena-ambientes/api/index.php/<ruta>
 * (Apache pasa <ruta> en PATH_INFO; no hace falta mod_rewrite).
 * Contratos en ../API.md, sección "Entrega y revisión de ambientes".
 */

require __DIR__ . '/lib/base.php';
require __DIR__ . '/modulos/auth.php';
require __DIR__ . '/modulos/ambientes.php';
require __DIR__ . '/modulos/inventario.php';
require __DIR__ . '/modulos/inspecciones.php';
require __DIR__ . '/modulos/notificaciones.php';
require __DIR__ . '/modulos/reportes.php';

header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

/** [método, patrón, función]. Los grupos del patrón llegan como argumentos. */
$RUTAS = [
    ['POST',   '#^/auth/login$#',                        'rutaLogin'],
    ['POST',   '#^/auth/logout$#',                       'rutaLogout'],
    ['GET',    '#^/me$#',                                'rutaYo'],
    ['PATCH',  '#^/me$#',                                'rutaActualizarPerfil'],
    ['POST',   '#^/me/password$#',                       'rutaCambiarPassword'],
    ['GET',    '#^/users$#',                             'rutaUsuarios'],

    ['GET',    '#^/environments$#',                      'rutaAmbientes'],
    ['POST',   '#^/environments$#',                      'rutaCrearAmbiente'],
    ['GET',    '#^/environments/(\d+)$#',                'rutaAmbiente'],
    ['PATCH',  '#^/environments/(\d+)$#',                'rutaEditarAmbiente'],
    ['DELETE', '#^/environments/(\d+)$#',                'rutaBorrarAmbiente'],
    ['GET',    '#^/environments/(\d+)/items$#',          'rutaItemsAmbiente'],

    ['GET',    '#^/items/by-code/([A-Za-z0-9\-]+)$#',    'rutaItemPorCodigo'],
    ['POST',   '#^/items$#',                             'rutaCrearItem'],
    ['PATCH',  '#^/items/(\d+)$#',                       'rutaEditarItem'],
    ['DELETE', '#^/items/(\d+)$#',                       'rutaBorrarItem'],

    ['GET',    '#^/inspections$#',                       'rutaInspecciones'],
    ['POST',   '#^/inspections$#',                       'rutaIniciarInspeccion'],
    ['GET',    '#^/inspections/by-qr/([A-Z0-9]{16})$#',  'rutaInspeccionPorQr'],
    ['GET',    '#^/inspections/(\d+)$#',                 'rutaInspeccion'],
    ['PATCH',  '#^/inspections/(\d+)/checklist$#',       'rutaGuardarChecklist'],
    ['POST',   '#^/inspections/(\d+)/items$#',           'rutaReportarDano'],
    ['DELETE', '#^/inspections/(\d+)/items/(\d+)$#',     'rutaQuitarDano'],
    ['POST',   '#^/inspections/(\d+)/confirm$#',         'rutaConfirmarInspeccion'],
    ['POST',   '#^/inspections/(\d+)/qr$#',              'rutaGenerarQr'],
    ['POST',   '#^/inspections/by-qr/([A-Z0-9]{16})/receive$#', 'rutaRecibirPorQr'],
    ['POST',   '#^/inspections/(\d+)/cancel$#',          'rutaCancelarInspeccion'],

    ['GET',    '#^/inbox$#',                             'rutaBandeja'],
    ['POST',   '#^/inbox/read-all$#',                    'rutaLeerTodas'],
    ['POST',   '#^/inbox/(\d+)/read$#',                  'rutaLeerNotificacion'],

    ['GET',    '#^/reports$#',                           'rutaReporte'],
];

try {
    $metodo = $_SERVER['REQUEST_METHOD'];
    $ruta = rtrim($_SERVER['PATH_INFO'] ?? '/', '/') ?: '/';
    $metodoValido = false;
    foreach ($RUTAS as [$m, $patron, $fn]) {
        if (!preg_match($patron, $ruta, $grupos)) continue;
        $metodoValido = true;
        if ($m !== $metodo) continue;
        array_shift($grupos);
        $fn(...array_map('intval_si_numero', $grupos));
    }
    if ($metodoValido) fallar(405, 'Método no permitido para esta ruta.', 'METODO');
    fallar(404, 'Ruta no encontrada.', 'NO_ENCONTRADO');
} catch (ErrorApi $e) {
    responder(['mensaje' => $e->getMessage(), 'codigo' => $e->codigo], $e->status);
} catch (mysqli_sql_exception $e) {
    error_log('[api ambientes] ' . $e->getMessage());
    responder(['mensaje' => 'Ocurrió un error en la base de datos.', 'codigo' => 'BASE_DATOS'], 500);
} catch (Throwable $e) {
    error_log('[api ambientes] ' . $e);
    responder(['mensaje' => 'Ocurrió un error inesperado en el servidor.', 'codigo' => 'INTERNO'], 500);
}

function intval_si_numero(string $v)
{
    // Solo ids: un token de QR de 16 caracteres puede ser todo dígitos y empezar por cero.
    return ctype_digit($v) && strlen($v) < 16 ? (int) $v : $v;
}
