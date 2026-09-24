<?php
/**
 * Carga masiva del inventario desde Excel/ODS/CSV (PhpSpreadsheet) y
 * exportación a Excel. También la usa db/instalar.php para poblar la base
 * de prueba con db/inventario-prueba.xlsx.
 *
 * Columnas (la primera fila son los títulos, en cualquier orden):
 *   ambiente*  código del ambiente (107)
 *   codigo     código de la etiqueta; vacío = se busca el ítem por serial (o ambiente + nombre)
 *              y, si no existe, se genera AMB107-011
 *   nombre*    "Teclado #3", "Silla (lote 28)"…
 *   categoria* Cómputo, Mobiliario, Audiovisual…
 *   serial     opcional
 *   estado     Operativo | Dañado | En reparación | De baja (vacío = Operativo)
 * Si el código ya existe, la fila actualiza ese ítem (y lo puede mover de ambiente).
 */

const COLUMNAS_CARGA = ['ambiente', 'codigo', 'nombre', 'categoria', 'serial', 'estado'];
const MAX_FILAS_CARGA = 2000;

$autoload = __DIR__ . '/../vendor/autoload.php';
if (is_file($autoload)) require_once $autoload;

function hayPhpSpreadsheet(): bool
{
    return class_exists(\PhpOffice\PhpSpreadsheet\IOFactory::class);
}

/** "Código", "CÓDIGO " → "codigo". */
function normalizarTitulo(string $t): string
{
    $t = mb_strtolower(trim($t));
    $t = strtr($t, ['á' => 'a', 'é' => 'e', 'í' => 'i', 'ó' => 'o', 'ú' => 'u', 'ñ' => 'n']);
    $t = preg_replace('/[^a-z]/', '', $t);
    return ['item' => 'nombre', 'elemento' => 'nombre', 'descripcion' => 'nombre', 'codigoambiente' => 'ambiente', 'salon' => 'ambiente',
            'placa' => 'codigo', 'codigodebarras' => 'codigo', 'qr' => 'codigo', 'numerodeserie' => 'serial'][$t] ?? $t;
}

/**
 * Lee la hoja y devuelve [['fila' => 2, 'ambiente' => '107', …], …].
 * Con PhpSpreadsheet lee xlsx, xls, ods y csv; sin él, solo csv.
 */
function leerHojaInventario(string $ruta, string $nombreArchivo): array
{
    $ext = strtolower(pathinfo($nombreArchivo, PATHINFO_EXTENSION));
    if (hayPhpSpreadsheet()) {
        try {
            $lector = \PhpOffice\PhpSpreadsheet\IOFactory::createReaderForFile($ruta);
            $lector->setReadDataOnly(true);
            $tabla = $lector->load($ruta)->getSheet(0)->toArray(null, true, true, false);
        } catch (Throwable $e) {
            throw new ErrorApi(422, 'No se pudo leer el archivo. Usa la plantilla en Excel (.xlsx) o CSV.', 'ARCHIVO');
        }
    } elseif ($ext === 'csv' || $ext === 'txt') {
        $tabla = leerCsv($ruta);
    } else {
        throw new ErrorApi(500, 'Falta instalar PhpSpreadsheet para leer Excel (ejecuta "composer install"). Mientras tanto puedes subir un CSV.', 'SIN_PHPSPREADSHEET');
    }

    $titulos = array_map(fn($t) => normalizarTitulo((string) $t), array_shift($tabla) ?? []);
    foreach (['ambiente', 'nombre', 'categoria'] as $obligatoria) {
        if (!in_array($obligatoria, $titulos, true)) {
            throw new ErrorApi(422, "Falta la columna \"$obligatoria\". La primera fila debe tener los títulos: " . implode(', ', COLUMNAS_CARGA) . '.', 'COLUMNAS');
        }
    }
    $filas = [];
    foreach ($tabla as $n => $valores) {
        $f = ['fila' => $n + 2];
        foreach ($titulos as $i => $t) {
            if (in_array($t, COLUMNAS_CARGA, true)) $f[$t] = trim((string) ($valores[$i] ?? ''));
        }
        if (implode('', array_diff_key($f, ['fila' => 1])) === '') continue; // fila vacía
        $filas[] = $f;
    }
    if (count($filas) > MAX_FILAS_CARGA) throw new ErrorApi(422, 'El archivo tiene más de ' . MAX_FILAS_CARGA . ' filas. Divídelo en varios.', 'ARCHIVO');
    return $filas;
}

/** CSV separado por ; o , (el que aparezca en la primera línea). */
function leerCsv(string $ruta): array
{
    $texto = preg_replace('/^\xEF\xBB\xBF/', '', file_get_contents($ruta));
    $primera = strtok($texto, "\n");
    $sep = substr_count($primera, ';') >= substr_count($primera, ',') ? ';' : ',';
    $tabla = [];
    foreach (preg_split('/\r\n|\n|\r/', $texto) as $linea) {
        if (trim($linea) !== '') $tabla[] = str_getcsv($linea, $sep);
    }
    return $tabla;
}

/** Acepta la clave (en_reparacion) o la etiqueta (En reparación). Vacío = operativo. */
function estadoDeCarga(string $v): ?string
{
    if ($v === '') return 'operativo';
    $n = normalizarTitulo($v);
    return ['operativo' => 'operativo', 'danado' => 'danado', 'enreparacion' => 'en_reparacion', 'reparacion' => 'en_reparacion',
            'debaja' => 'baja', 'baja' => 'baja'][$n] ?? null;
}

/**
 * Crea o actualiza los ítems de las filas. Las filas con error se omiten y se
 * informan. Con $simular no guarda nada (vista previa).
 * @return array{total:int, nuevos:int, actualizados:int, sinCambios:int, errores:array, filas:array}
 */
function importarInventario(array $filas, ?int $usuarioId, bool $simular, string $origen): array
{
    $r = ['total' => count($filas), 'nuevos' => 0, 'actualizados' => 0, 'sinCambios' => 0, 'errores' => [], 'filas' => []];
    $ambientes = [];
    foreach (filas('SELECT * FROM environments') as $a) $ambientes[strtoupper($a['codigo'])] = $a;
    $vistos = [];

    db()->begin_transaction();
    foreach ($filas as $f) {
        $error = function (string $m) use (&$r, $f) { $r['errores'][] = ['fila' => $f['fila'], 'mensaje' => $m]; };
        $amb = $ambientes[strtoupper(preg_replace('/^AMB/i', '', $f['ambiente'] ?? ''))] ?? null;
        if (!$amb) { $error('El ambiente "' . ($f['ambiente'] ?? '') . '" no existe.'); continue; }
        $nombre = $f['nombre'] ?? '';
        $categoria = $f['categoria'] ?? '';
        if (mb_strlen($nombre) < 2 || mb_strlen($nombre) > 120) { $error('Escribe el nombre (2 a 120 caracteres).'); continue; }
        if ($categoria === '' || mb_strlen($categoria) > 40) { $error('Escribe la categoría (máx. 40 caracteres).'); continue; }
        $serial = ($f['serial'] ?? '') !== '' ? mb_substr($f['serial'], 0, 60) : null;
        $estado = estadoDeCarga($f['estado'] ?? '');
        if (!$estado) { $error('Estado "' . $f['estado'] . '" no válido: Operativo, Dañado, En reparación o De baja.'); continue; }

        $codigo = null;
        if (($f['codigo'] ?? '') !== '') {
            $codigo = normalizarCodigo($f['codigo']);
            if (!$codigo) { $error('El código "' . $f['codigo'] . '" solo admite letras, números y guiones (3 a 40).'); continue; }
            if (isset($vistos[$codigo])) { $error("El código $codigo ya viene en la fila {$vistos[$codigo]}."); continue; }
            $vistos[$codigo] = $f['fila'];
        }
        if ($codigo) {
            $existente = fila('SELECT * FROM inventory_items WHERE codigo = ?', [$codigo]);
        } else {
            // Sin código: se reconoce el mismo ítem por su serial o por ambiente + nombre, para que
            // volver a subir el mismo archivo no duplique el inventario.
            $existente = $serial
                ? fila('SELECT * FROM inventory_items WHERE serial = ? LIMIT 1', [$serial])
                : fila('SELECT * FROM inventory_items WHERE environment_id = ? AND nombre = ? LIMIT 1', [(int) $amb['id'], $nombre]);
            if ($existente) {
                $codigo = $existente['codigo'];
                if (isset($vistos[$codigo])) { $error("Esta fila repite el ítem $codigo de la fila {$vistos[$codigo]}."); continue; }
                $vistos[$codigo] = $f['fila'];
            }
        }

        if (!$existente) {
            $codigo ??= siguienteCodigo($amb);
            $id = insertar(
                'INSERT INTO inventory_items (environment_id, codigo, nombre, categoria, serial, estado) VALUES (?, ?, ?, ?, ?, ?)',
                [(int) $amb['id'], $codigo, $nombre, $categoria, $serial, $estado]
            );
            historial($id, 'carga_masiva', "Registrado por carga masiva ($origen, fila {$f['fila']}) en el ambiente {$amb['codigo']}", $usuarioId);
            $r['nuevos']++;
            $accion = 'nuevo';
        } else {
            $cambios = [];
            if ((int) $existente['environment_id'] !== (int) $amb['id']) $cambios[] = "ambiente → {$amb['codigo']}";
            foreach (['nombre' => $nombre, 'categoria' => $categoria, 'serial' => $serial] as $campo => $nuevo) {
                if ((string) $existente[$campo] !== (string) $nuevo) $cambios[] = "$campo → " . ($nuevo ?: '—');
            }
            if ($existente['estado'] !== $estado) $cambios[] = 'estado → ' . ETIQUETA_ESTADO[$estado];
            if ($cambios) {
                consulta('UPDATE inventory_items SET environment_id = ?, nombre = ?, categoria = ?, serial = ?, estado = ? WHERE id = ?',
                    [(int) $amb['id'], $nombre, $categoria, $serial, $estado, (int) $existente['id']]);
                historial((int) $existente['id'], 'carga_masiva', "Actualizado por carga masiva ($origen, fila {$f['fila']}): " . implode(' · ', $cambios), $usuarioId);
                $r['actualizados']++;
                $accion = 'actualizado';
            } else {
                $r['sinCambios']++;
                $accion = 'sin_cambios';
            }
        }
        if (count($r['filas']) < 300) $r['filas'][] = ['fila' => $f['fila'], 'codigo' => $codigo, 'nombre' => $nombre, 'ambiente' => $amb['codigo'], 'accion' => $accion];
    }
    $simular ? db()->rollback() : db()->commit();
    return $r;
}

/** POST /items/import {archivo: data URL, nombre, simular}: vista previa (simular) o carga. */
function rutaCargaMasiva(): never
{
    $u = exigirRol('administrativo');
    $d = cuerpo();
    $nombre = basename(texto($d, 'nombre', 120, true, 'el nombre del archivo'));
    if (!preg_match('/\.(xlsx|xls|ods|csv|txt)$/i', $nombre)) fallar(422, 'Sube un archivo .xlsx, .xls, .ods o .csv.', 'ARCHIVO');
    if (!preg_match('#^data:[^;,]*(;base64)?,(.*)$#s', (string) ($d['archivo'] ?? ''), $m)) fallar(422, 'Falta el archivo.', 'ARCHIVO');
    $binario = $m[1] ? base64_decode($m[2], true) : rawurldecode($m[2]);
    if ($binario === false || $binario === '') fallar(422, 'El archivo está vacío o dañado.', 'ARCHIVO');
    if (strlen($binario) > 5 * 1024 * 1024) fallar(422, 'El archivo supera 5 MB.', 'ARCHIVO');

    $tmp = tempnam(sys_get_temp_dir(), 'inv');
    $ruta = $tmp . '.' . strtolower(pathinfo($nombre, PATHINFO_EXTENSION));
    rename($tmp, $ruta);
    file_put_contents($ruta, $binario);
    try {
        $filas = leerHojaInventario($ruta, $nombre);
    } finally {
        @unlink($ruta);
    }
    if (!$filas) fallar(422, 'El archivo no tiene filas con datos debajo de los títulos.', 'ARCHIVO');
    responder(importarInventario($filas, (int) $u['id'], !empty($d['simular']), $nombre));
}

/** GET /items/export?ambienteId: inventario en Excel con las mismas columnas de la carga (sirve de plantilla). */
function rutaExportarInventario(): never
{
    exigirRol('administrativo');
    if (!hayPhpSpreadsheet()) fallar(500, 'Falta instalar PhpSpreadsheet (ejecuta "composer install").', 'SIN_PHPSPREADSHEET');
    $ambienteId = entero($_GET, 'ambienteId', false);
    $where = $ambienteId ? ' WHERE i.environment_id = ?' : '';
    $items = filas(SQL_ITEMS . $where . ' ORDER BY e.codigo, i.codigo', $ambienteId ? [$ambienteId] : []);

    $libro = new \PhpOffice\PhpSpreadsheet\Spreadsheet();
    $hoja = $libro->getActiveSheet();
    $hoja->setTitle('Inventario');
    $hoja->fromArray(COLUMNAS_CARGA, null, 'A1');
    $fila = 2;
    foreach ($items as $i) {
        $hoja->fromArray([$i['ambiente_codigo'], $i['codigo'], $i['nombre'], $i['categoria'], $i['serial'], ETIQUETA_ESTADO[$i['estado']]], null, "A$fila");
        // Texto explícito para que Excel no convierta códigos numéricos (p. ej. 0770…) en números.
        $hoja->setCellValueExplicit("B$fila", $i['codigo'], \PhpOffice\PhpSpreadsheet\Cell\DataType::TYPE_STRING);
        $fila++;
    }
    $hoja->getStyle('A1:F1')->getFont()->setBold(true)->getColor()->setRGB('FFFFFF');
    $hoja->getStyle('A1:F1')->getFill()->setFillType('solid')->getStartColor()->setRGB('39A900');
    foreach (range('A', 'F') as $col) $hoja->getColumnDimension($col)->setAutoSize(true);
    $hoja->freezePane('A2');

    $nombre = 'inventario' . ($ambienteId && $items ? '-' . $items[0]['ambiente_codigo'] : '') . '-' . date('Y-m-d') . '.xlsx';
    header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    header('Content-Disposition: attachment; filename="' . $nombre . '"');
    (new \PhpOffice\PhpSpreadsheet\Writer\Xlsx($libro))->save('php://output');
    exit;
}
