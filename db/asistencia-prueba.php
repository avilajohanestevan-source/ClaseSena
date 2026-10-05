<?php
/**
 * Datos de prueba de la asistencia (lo llama db/instalar.php después de seed.sql):
 *
 *  · clases de las últimas cuatro semanas (lunes a viernes) de cada ficha, en
 *    el horario de su jornada, y las de las próximas dos semanas (horario del aprendiz);
 *  · hoy: una clase de la ficha 2758432 que empezó hace 2 minutos con la
 *    ventana de registro abierta 30 minutos (para probar el QR enseguida);
 *  · asistencias con un patrón por aprendiz para que el semáforo tenga todos
 *    los colores (verde, amarillo, naranja, rojo claro y rojo);
 *  · una excusa aprobada (Daniela: sus faltas quedan justificadas) y una
 *    pendiente (María José);
 *  · Valentina Ospina (1122334470, ficha 2901122) recién importada: tiene la
 *    contraseña temporal Temporal2026 y en su primer ingreso debe confirmar el
 *    correo y cambiarla. Su correo con las credenciales queda en Fichas → Correos enviados.
 */

if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }

require_once __DIR__ . '/../api/lib/base.php';
require_once __DIR__ . '/../api/lib/correo.php';

const SEMANAS_ATRAS = 4;
const HORARIO = ['manana' => ['07:00', '11:00'], 'tarde' => ['13:00', '17:00'], 'noche' => ['18:00', '22:00'], 'fin_semana' => ['08:00', '12:00']];
const COMPETENCIAS_FICHA = ['2758432' => [1, 2, 3], '2834519' => [4, 5], '2901122' => [6, 7]];

/** Patrón de cada aprendiz: posiciones de falla contando desde la última clase (1 = la última). */
const PATRONES = [
    '1122334455' => [],                          // Camila: verde
    '1122334456' => [1, 2, 3, 4, 5, 8, 11, 16],  // Mateo: rojo (5 seguidas, 8 en total)
    '1122334458' => [6, 12],                     // Juan David: amarillo
    '1122334459' => [1, 2, 10, 15],              // Valeria: naranja
    '1122334461' => [1, 2, 3, 9, 14],            // Santiago: rojo claro
    '1122334462' => [4, 5, 6],                   // Daniela: faltas justificadas con excusa aprobada
    '1122334463' => [],                          // Felipe: verde (llega tarde a veces)
    '1122334457' => [7, 13],                     // Sara: amarillo
    '1122334464' => [],                          // Laura Sofía: verde
    '1122334465' => [1, 2, 3, 4, 6, 9, 12, 18],  // Kevin: rojo (además aplazado en P004)
    '1122334466' => [1, 2, 11, 17],              // María José: naranja, con excusa pendiente
    '1122334467' => [],                          // Andrés Camilo: verde
    '1122334468' => [1, 2, 3, 7, 12],            // Natalia: rojo claro
    '1122334469' => [5, 14],                     // Esteban: amarillo
];

$fichas = filas('SELECT * FROM fichas');
$aprendices = filas("SELECT * FROM users WHERE rol = 'aprendiz'");
$hoy = new DateTime('today');
$clases = 0; $registros = 0;

foreach ($fichas as $f) {
    [$hIni, $hFin] = HORARIO[$f['jornada']];
    $comp = COMPETENCIAS_FICHA[$f['codigo']];
    // Días hábiles de las semanas anteriores (sin hoy) y de las próximas dos.
    $pasados = [];
    for ($d = (clone $hoy)->modify('-1 day'); count($pasados) < SEMANAS_ATRAS * 5; $d->modify('-1 day')) if ((int) $d->format('N') <= 5) $pasados[] = $d->format('Y-m-d');
    $pasados = array_reverse($pasados);
    $futuros = [];
    for ($d = (clone $hoy)->modify('+1 day'); count($futuros) < 10; $d->modify('+1 day')) if ((int) $d->format('N') <= 5) $futuros[] = $d->format('Y-m-d');

    $idsPasados = [];
    foreach ([...$pasados, ...$futuros] as $n => $dia) {
        $id = insertar('INSERT INTO clases (ficha_id, competencia_id, environment_id, instructor_id, inicio, fin, ventana_min, creada_por) VALUES (?, ?, ?, ?, ?, ?, 15, 10)',
            [(int) $f['id'], $comp[$n % count($comp)], (int) $f['environment_id'], (int) $f['instructor_id'], "$dia $hIni:00", "$dia $hFin:00"]);
        if ($dia < $hoy->format('Y-m-d')) $idsPasados[] = ['id' => $id, 'dia' => $dia];
        $clases++;
    }
    // Una clase pasada cancelada (no cuenta para nadie).
    consulta("UPDATE clases SET cancelada = 1, motivo_cancelacion = 'Corte de energía en la sede' WHERE id = ?", [$idsPasados[count($idsPasados) - 9]['id']]);

    // Hoy: la 2758432 tiene clase ahora mismo (ventana abierta 30 min); las demás, más tarde.
    $ahora = new DateTime();
    if ($f['codigo'] === '2758432') {
        $inicio = (clone $ahora)->modify('-2 minutes');
        insertar('INSERT INTO clases (ficha_id, competencia_id, environment_id, instructor_id, inicio, fin, ventana_min, creada_por) VALUES (?, 1, ?, ?, ?, ?, 30, 1)',
            [(int) $f['id'], (int) $f['environment_id'], (int) $f['instructor_id'], $inicio->format('Y-m-d H:i:s'), (clone $inicio)->modify('+2 hours')->format('Y-m-d H:i:s')]);
        $clases++;
    } elseif ((int) $ahora->format('H') < 20) {
        $inicio = (clone $ahora)->setTime((int) $ahora->format('H') + 2, 0);
        insertar('INSERT INTO clases (ficha_id, competencia_id, environment_id, instructor_id, inicio, fin, ventana_min, creada_por) VALUES (?, ?, ?, ?, ?, ?, 15, 10)',
            [(int) $f['id'], $comp[0], (int) $f['environment_id'], (int) $f['instructor_id'], $inicio->format('Y-m-d H:i:s'), (clone $inicio)->modify('+2 hours')->format('Y-m-d H:i:s')]);
        $clases++;
    }

    // Asistencias: todas menos las faltas del patrón (contadas desde la última clase no cancelada).
    $validas = array_values(array_filter($idsPasados, fn($c) => !fila('SELECT cancelada FROM clases WHERE id = ?', [$c['id']])['cancelada']));
    foreach (array_filter($aprendices, fn($a) => $a['ficha'] === $f['codigo']) as $a) {
        $faltas = PATRONES[$a['documento']] ?? [];
        foreach ($validas as $i => $c) {
            $desdeElFinal = count($validas) - $i;
            if (in_array($desdeElFinal, $faltas, true)) continue;
            $tarde = $a['documento'] === '1122334463' ? $i % 3 === 0 : $i % 7 === 3;
            $minuto = $tarde ? 9 + $i % 5 : 1 + $i % 4;
            insertar('INSERT INTO asistencias (clase_id, aprendiz_id, estado, hora) VALUES (?, ?, ?, ?)',
                [$c['id'], (int) $a['id'], $tarde ? 'tarde' : 'presente', $c['dia'] . ' ' . $hIni . ':' . str_pad((string) $minuto, 2, '0', STR_PAD_LEFT)]);
            $registros++;
        }
        // Excusas: aprobada para las faltas de Daniela y pendiente para las últimas de María José.
        if (in_array($a['documento'], ['1122334462', '1122334466'], true)) {
            $aprobada = $a['documento'] === '1122334462';
            $cubre = $aprobada ? [count($validas) - 6, count($validas) - 4] : [count($validas) - 2, count($validas) - 1];
            insertar('INSERT INTO excusas (aprendiz_id, ficha_id, desde, hasta, motivo, foto, estado, revisada_por, revisada_en, observacion, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
                (int) $a['id'], (int) $f['id'], $validas[$cubre[0]]['dia'], $validas[$cubre[1]]['dia'],
                $aprobada ? 'Incapacidad médica por gastroenteritis (3 días).' : 'Cita médica y exámenes en la EPS.',
                'uploads/danos/excusa-demo.svg', $aprobada ? 'aprobada' : 'pendiente', $aprobada ? (int) $f['instructor_id'] : null,
                $aprobada ? $validas[$cubre[1]]['dia'] . ' 17:00:00' : null, $aprobada ? 'Soporte de la EPS revisado.' : null,
                $validas[$cubre[1]]['dia'] . ' 12:00:00',
            ]);
        }
    }
}

// Evidencia de ejemplo para las excusas.
$carpeta = __DIR__ . '/../uploads/danos';
if (!is_dir($carpeta)) mkdir($carpeta, 0775, true);
file_put_contents("$carpeta/excusa-demo.svg", '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360"><rect width="480" height="360" fill="#F3FAEE"/><rect x="120" y="40" width="240" height="280" rx="12" fill="#fff" stroke="#39A900" stroke-width="4"/><text x="240" y="100" font-family="sans-serif" font-size="22" font-weight="700" text-anchor="middle" fill="#00304D">Incapacidad</text><text x="240" y="130" font-family="sans-serif" font-size="16" text-anchor="middle" fill="#00304D">médica (ejemplo)</text><g stroke="#C6E8AE" stroke-width="10"><line x1="160" y1="180" x2="320" y2="180"/><line x1="160" y1="210" x2="320" y2="210"/><line x1="160" y1="240" x2="280" y2="240"/></g></svg>');

// Aprendiz recién importada: primer ingreso pendiente con contraseña temporal conocida.
$f = fila("SELECT * FROM fichas WHERE codigo = '2901122'");
$id = insertar("INSERT INTO users (tipo_documento, documento, nombre, email, telefono, rol, ficha, password_hash, debe_cambiar_password)
                VALUES ('CC', '1122334470', 'Valentina Ospina Rueda', 'vospina@soy.sena.edu.co', '3014445580', 'aprendiz', '2901122', ?, 1)",
    [password_hash('Temporal2026', PASSWORD_BCRYPT)]);
consulta("INSERT INTO p004 (documento, nombre, ficha, programa, estado, actualizado_por, actualizado_en) VALUES ('1122334470', 'Valentina Ospina Rueda', '2901122', 'Cocina', 'EN FORMACION', 10, NOW())");
enviarCredenciales(fila('SELECT * FROM users WHERE id = ?', [$id]), 'Temporal2026', $f);

printf("✓ asistencia: %d clases, %d registros de asistencia, 2 excusas, 1 aprendiz con primer ingreso pendiente\n", $clases, $registros);
