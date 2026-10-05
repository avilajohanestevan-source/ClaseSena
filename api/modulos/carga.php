<?php
/**
 * Carga masiva del inventario desde Excel/ODS/CSV (PhpSpreadsheet) y
 * exportación a Excel. También la usa db/instalar.php para poblar la base
 * de prueba con db/inventario-prueba.xlsx.
 *
 * Columnas (la primera fila son los títulos, en cualquier orden):
 *   ambiente*       código del ambiente (107)
 *   codigo          código de la etiqueta (va en el código de barras); vacío = se busca el ítem por
 *                   serial (o ambiente + nombre) y, si no existe, se genera AMB107-011
 *   nombre*         "Teclado #3", "Silla (lote 28)"…
 *   categoria*      una de inventory_categories: Mobiliario, Equipos Informáticos, Periféricos…
 *   serial          opcional
 *   estado          Operativo | Dañado | En reparación | Fuera de servicio | De baja (vacío = Operativo)
 *   familia         código de la familia (FAM107-PC01); si no existe se crea en el ambiente de la fila
 *   familia_nombre  nombre de la familia nueva ("PC puesto 1"); vacío = "Familia <código>"
 *   familia_tipo    tipo de la familia nueva (PC, Estación de cocina…); vacío = "General"
 *   qr              contenido del QR (qr_value); vacío = SENA-INV:<codigo> en los nuevos y sin cambio en los existentes
 * Si el código ya existe, la fila actualiza ese ítem (y lo puede mover de ambiente).
 */

const COLUMNAS_CARGA = ['ambiente', 'codigo', 'nombre', 'categoria', 'serial', 'estado', 'familia', 'familia_nombre', 'familia_tipo', 'qr'];
const MAX_FILAS_CARGA = 2000;

$autoload = __DIR__ . '/../vendor/autoload.php';
if (is_file($autoload)) require_once $autoload;

function hayPhpSpreadsheet(): bool
{
    return class_exists(\PhpOffice\PhpSpreadsheet\IOFactory::class);
}

/** "Código", "CÓDIGO ", "Familia_Nombre" → codigo, familia_nombre. */
function normalizarTitulo(string $t): string
{
    $t = preg_replace('/[^a-z]/', '', claveTexto($t));
    return ['item' => 'nombre', 'elemento' => 'nombre', 'descripcion' => 'nombre', 'codigoambiente' => 'ambiente', 'salon' => 'ambiente',
            'placa' => 'codigo', 'codigodebarras' => 'codigo', 'numerodeserie' => 'serial',
            'familianombre' => 'familia_nombre', 'nombrefamilia' => 'familia_nombre', 'familiatipo' => 'familia_tipo', 'tipofamilia' => 'familia_tipo',
            'codigofamilia' => 'familia', 'qrvalue' => 'qr', 'valorqr' => 'qr', 'codigoqr' => 'qr', 'contenidoqr' => 'qr'][$t] ?? $t;
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

/** Acepta la clave (fuera_servicio) o la etiqueta (Fuera de servicio). Vacío = operativo. */
function estadoDeCarga(string $v): ?string
{
    if ($v === '') return 'operativo';
    return ['operativo' => 'operativo', 'danado' => 'danado', 'enreparacion' => 'en_reparacion', 'reparacion' => 'en_reparacion',
            'fueradeservicio' => 'fuera_servicio', 'fueraservicio' => 'fuera_servicio', 'outofservice' => 'fuera_servicio',
            'debaja' => 'baja', 'baja' => 'baja', 'debajainactivo' => 'baja', 'inactivo' => 'baja', 'inactive' => 'baja'][claveTexto($v)] ?? null;
}

/**
 * Crea o actualiza los ítems de las filas (y las familias nuevas que
 * nombren). Las filas con error se omiten y se informan. Con $simular no
 * guarda nada (vista previa).
 * @return array{total:int, nuevos:int, actualizados:int, sinCambios:int, familiasNuevas:int, errores:array, filas:array}
 */
function importarInventario(array $filas, ?int $usuarioId, bool $simular, string $origen): array
{
    $r = ['total' => count($filas), 'nuevos' => 0, 'actualizados' => 0, 'sinCambios' => 0, 'familiasNuevas' => 0, 'errores' => [], 'filas' => []];
    $ambientes = [];
    foreach (filas('SELECT * FROM environments') as $a) $ambientes[strtoupper($a['codigo'])] = $a;
    $vistos = [];
    $qrVistos = [];

    db()->begin_transaction();
    foreach ($filas as $f) {
        $error = function (string $m) use (&$r, $f) { $r['errores'][] = ['fila' => $f['fila'], 'mensaje' => $m]; };
        $amb = $ambientes[strtoupper(preg_replace('/^AMB/i', '', $f['ambiente'] ?? ''))] ?? null;
        if (!$amb) { $error('El ambiente "' . ($f['ambiente'] ?? '') . '" no existe.'); continue; }
        $nombre = $f['nombre'] ?? '';
        if (mb_strlen($nombre) < 2 || mb_strlen($nombre) > 120) { $error('Escribe el nombre (2 a 120 caracteres).'); continue; }
        $categoria = ($f['categoria'] ?? '') !== '' ? catalogoPorNombre('categoria', $f['categoria']) : null;
        if (!$categoria || !$categoria['activo']) {
            $error(($f['categoria'] ?? '') === '' ? 'Escribe la categoría.' : "La categoría \"{$f['categoria']}\" no existe o está desactivada. Regístrala en Inventario → Categorías o usa: " . implode(', ', nombresCatalogo('categoria')) . '.');
            continue;
        }
        $serial = ($f['serial'] ?? '') !== '' ? mb_substr($f['serial'], 0, 60) : null;
        $estado = estadoDeCarga($f['estado'] ?? '');
        if (!$estado) { $error('Estado "' . $f['estado'] . '" no válido: Operativo, Dañado, En reparación, Fuera de servicio o De baja.'); continue; }

        $codigo = null;
        if (($f['codigo'] ?? '') !== '') {
            $codigo = normalizarCodigo($f['codigo']);
            if (!$codigo) { $error('El código "' . $f['codigo'] . '" solo admite letras, números y guiones (3 a 40).'); continue; }
            if (isset($vistos[$codigo])) { $error("El código $codigo ya viene en la fila {$vistos[$codigo]}."); continue; }
            if (fila('SELECT id FROM item_families WHERE codigo = ?', [$codigo])) { $error("El código $codigo es de una familia, no de un ítem."); continue; }
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

        // QR: si viene, no puede ser de otro ítem ni repetirse en el archivo.
        $qr = ($f['qr'] ?? '') !== '' ? $f['qr'] : null;
        if ($qr !== null) {
            if ($m = errorQr($qr, $existente ? (int) $existente['id'] : 0)) { $error($m); continue; }
            if (isset($qrVistos[$qr])) { $error("El QR \"$qr\" ya viene en la fila {$qrVistos[$qr]}."); continue; }
            $qrVistos[$qr] = $f['fila'];
        }

        // Familia: la existente debe ser del mismo ambiente; si no existe, se crea en el ambiente de la fila.
        $familia = null;
        if (($f['familia'] ?? '') !== '') {
            $codFam = normalizarCodigo($f['familia'], PREFIJO_QR_FAMILIA);
            if (!$codFam) { $error('El código de familia "' . $f['familia'] . '" solo admite letras, números y guiones (3 a 40).'); continue; }
            $familia = fila('SELECT f.*, e.codigo AS ambiente_codigo FROM item_families f JOIN environments e ON e.id = f.environment_id WHERE f.codigo = ?', [$codFam]);
            if ($familia && (int) $familia['environment_id'] !== (int) $amb['id']) {
                $error("La familia $codFam es del ambiente {$familia['ambiente_codigo']}, no del {$amb['codigo']}."); continue;
            }
            if (!$familia) {
                if ($codFam === $codigo || fila('SELECT id FROM inventory_items WHERE codigo = ?', [$codFam])) { $error("El código de familia $codFam ya es de un ítem."); continue; }
                $idFam = insertar('INSERT INTO item_families (environment_id, codigo, tipo, nombre) VALUES (?, ?, ?, ?)', [
                    (int) $amb['id'], $codFam,
                    mb_substr(($f['familia_tipo'] ?? '') ?: 'General', 0, 40),
                    mb_substr(($f['familia_nombre'] ?? '') ?: "Familia $codFam", 0, 120),
                ]);
                $familia = fila('SELECT * FROM item_families WHERE id = ?', [$idFam]);
                $r['familiasNuevas']++;
            }
        }

        if (!$existente) {
            $codigo ??= siguienteCodigo($amb);
            if (fila('SELECT id FROM inventory_items WHERE qr_value = ?', [$qr ?? qrPorDefecto($codigo)])) { $error("El QR de $codigo ya es de otro ítem."); continue; }
            $id = insertar(
                'INSERT INTO inventory_items (environment_id, codigo, qr_value, nombre, category_id, family_id, serial, estado) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [(int) $amb['id'], $codigo, $qr ?? qrPorDefecto($codigo), $nombre, (int) $categoria['id'], $familia ? (int) $familia['id'] : null, $serial, $estado]
            );
            historial($id, 'carga_masiva', "Registrado por carga masiva ($origen, fila {$f['fila']}) en el ambiente {$amb['codigo']}"
                . ($familia ? " · familia {$familia['codigo']}" : ''), $usuarioId);
            $r['nuevos']++;
            $accion = 'nuevo';
        } else {
            $cambios = [];
            $movido = (int) $existente['environment_id'] !== (int) $amb['id'];
            if ($movido) $cambios[] = "ambiente → {$amb['codigo']}";
            foreach (['nombre' => $nombre, 'serial' => $serial] as $campo => $nuevo) {
                if ((string) $existente[$campo] !== (string) $nuevo) $cambios[] = "$campo → " . ($nuevo ?: '—');
            }
            if ((int) $existente['category_id'] !== (int) $categoria['id']) $cambios[] = "categoría → {$categoria['nombre']}";
            if ($existente['estado'] !== $estado) $cambios[] = 'estado → ' . ETIQUETA_ESTADO[$estado];
            $nuevoQr = $qr ?? $existente['qr_value'];
            if ($nuevoQr !== $existente['qr_value']) $cambios[] = "QR → $nuevoQr";
            // Sin familia en la fila se conserva la que tenía, salvo que el ítem cambie de ambiente.
            $familiaId = $familia ? (int) $familia['id'] : ($movido ? null : ($existente['family_id'] !== null ? (int) $existente['family_id'] : null));
            if ($familiaId !== ($existente['family_id'] !== null ? (int) $existente['family_id'] : null)) $cambios[] = 'familia → ' . ($familia['codigo'] ?? '—');
            if ($cambios) {
                consulta('UPDATE inventory_items SET environment_id = ?, nombre = ?, category_id = ?, serial = ?, estado = ?, qr_value = ?, family_id = ? WHERE id = ?',
                    [(int) $amb['id'], $nombre, (int) $categoria['id'], $serial, $estado, $nuevoQr, $familiaId, (int) $existente['id']]);
                historial((int) $existente['id'], 'carga_masiva', "Actualizado por carga masiva ($origen, fila {$f['fila']}): " . implode(' · ', $cambios), $usuarioId);
                $r['actualizados']++;
                $accion = 'actualizado';
            } else {
                $r['sinCambios']++;
                $accion = 'sin_cambios';
            }
        }
        if (count($r['filas']) < 300) {
            $r['filas'][] = ['fila' => $f['fila'], 'codigo' => $codigo, 'nombre' => $nombre, 'ambiente' => $amb['codigo'],
                             'categoria' => $categoria['nombre'], 'familia' => $familia['codigo'] ?? null, 'accion' => $accion];
        }
    }
    $simular ? db()->rollback() : db()->commit();
    return $r;
}

/**
 * POST /inventory/import (alias: /items/import)
 *   JSON: {archivo: data URL, nombre: "x.xlsx", simular}
 *   multipart/form-data: archivo (el archivo), simular=1
 * Con simular es una vista previa: no guarda nada.
 */
function rutaCargaMasiva(): never
{
    $u = exigirRol(...ROLES_INVENTARIO);
    $multipart = !empty($_FILES['archivo']);
    if ($multipart) {
        $subido = $_FILES['archivo'];
        if ($subido['error'] !== UPLOAD_ERR_OK) fallar(422, $subido['error'] === UPLOAD_ERR_INI_SIZE || $subido['error'] === UPLOAD_ERR_FORM_SIZE ? 'El archivo supera el tamaño permitido.' : 'No se recibió el archivo.', 'ARCHIVO');
        $nombre = basename((string) $subido['name']);
        $simular = !empty($_POST['simular']) && $_POST['simular'] !== '0' && $_POST['simular'] !== 'false';
        if ($subido['size'] > 5 * 1024 * 1024) fallar(422, 'El archivo supera 5 MB.', 'ARCHIVO');
    } else {
        $d = cuerpo();
        $nombre = basename(texto($d, 'nombre', 120, true, 'el nombre del archivo'));
        $simular = !empty($d['simular']);
        if (!preg_match('#^data:[^;,]*(;base64)?,(.*)$#s', (string) ($d['archivo'] ?? ''), $m)) fallar(422, 'Falta el archivo.', 'ARCHIVO');
        $binario = $m[1] ? base64_decode($m[2], true) : rawurldecode($m[2]);
        if ($binario === false || $binario === '') fallar(422, 'El archivo está vacío o dañado.', 'ARCHIVO');
        if (strlen($binario) > 5 * 1024 * 1024) fallar(422, 'El archivo supera 5 MB.', 'ARCHIVO');
    }
    if (!preg_match('/\.(xlsx|xls|ods|csv|txt)$/i', $nombre)) fallar(422, 'Sube un archivo .xlsx, .xls, .ods o .csv.', 'ARCHIVO');

    // El lector elige el formato por la extensión: se copia a un temporal con la extensión original.
    $tmp = tempnam(sys_get_temp_dir(), 'inv');
    $ruta = $tmp . '.' . strtolower(pathinfo($nombre, PATHINFO_EXTENSION));
    rename($tmp, $ruta);
    $multipart ? copy($subido['tmp_name'], $ruta) : file_put_contents($ruta, $binario);
    try {
        $filas = leerHojaInventario($ruta, $nombre);
    } finally {
        @unlink($ruta);
    }
    if (!$filas) fallar(422, 'El archivo no tiene filas con datos debajo de los títulos.', 'ARCHIVO');
    responder(importarInventario($filas, (int) $u['id'], $simular, $nombre));
}

/** GET /items/export?ambienteId: inventario en Excel con las mismas columnas de la carga (sirve de plantilla). */
function rutaExportarInventario(): never
{
    exigirRol(...ROLES_INVENTARIO);
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
        $hoja->fromArray([$i['ambiente_codigo'], $i['codigo'], $i['nombre'], $i['categoria'], $i['serial'], ETIQUETA_ESTADO[$i['estado']],
                          $i['familia_codigo'], $i['familia_nombre'], $i['familia_tipo'], $i['qr_value']], null, "A$fila");
        // Texto explícito para que Excel no convierta códigos numéricos (p. ej. 0770…) en números.
        $hoja->setCellValueExplicit("B$fila", $i['codigo'], \PhpOffice\PhpSpreadsheet\Cell\DataType::TYPE_STRING);
        $hoja->setCellValueExplicit("J$fila", $i['qr_value'], \PhpOffice\PhpSpreadsheet\Cell\DataType::TYPE_STRING);
        $fila++;
    }
    $hoja->getStyle('A1:J1')->getFont()->setBold(true)->getColor()->setRGB('FFFFFF');
    $hoja->getStyle('A1:J1')->getFill()->setFillType('solid')->getStartColor()->setRGB('39A900');
    foreach (range('A', 'J') as $col) $hoja->getColumnDimension($col)->setAutoSize(true);
    $hoja->freezePane('A2');

    $nombre = 'inventario' . ($ambienteId && $items ? '-' . $items[0]['ambiente_codigo'] : '') . '-' . date('Y-m-d') . '.xlsx';
    header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    header('Content-Disposition: attachment; filename="' . $nombre . '"');
    (new \PhpOffice\PhpSpreadsheet\Writer\Xlsx($libro))->save('php://output');
    exit;
}
