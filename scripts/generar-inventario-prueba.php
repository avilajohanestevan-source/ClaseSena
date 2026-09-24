<?php
/**
 * Genera db/inventario-prueba.xlsx (con PhpSpreadsheet): el inventario de
 * prueba de los ambientes 107, 108 y 109 elemento por elemento
 * (computadores, teclados, mouse, sillas, mesas…). db/instalar.php lo carga
 * con la carga masiva, igual que si lo subiera un administrativo.
 *
 *   C:\xampp\php\php.exe scripts\generar-inventario-prueba.php
 *
 * Solo hace falta volver a ejecutarlo si se cambia la lista de abajo.
 */

require __DIR__ . '/../api/vendor/autoload.php';

use PhpOffice\PhpSpreadsheet\Cell\DataType;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;

$filas = [];
$agregar = function (string $amb, ?string $codigo, string $nombre, string $categoria, ?string $serial = null, string $estado = 'Operativo') use (&$filas) {
    $filas[] = [$amb, $codigo, $nombre, $categoria, $serial, $estado];
};

// Los 30 ítems base ya vienen en seed.sql; aquí van los elementos que se
// registran uno por uno con su propia etiqueta.
$porAmbiente = [
    '107' => ['equipos' => 4, 'sillas' => 30, 'mesas' => 15],
    '108' => ['equipos' => 3, 'sillas' => 28, 'mesas' => 14],
    '109' => ['equipos' => 1, 'sillas' => 24, 'mesas' => 6],
];
foreach ($porAmbiente as $amb => $n) {
    for ($i = 1; $i <= $n['equipos']; $i++) {
        $agregar($amb, null, "Monitor 24\" #$i", 'Cómputo', sprintf('SAM-S24-%s%02d', $amb, $i));
        $agregar($amb, null, "Teclado #$i", 'Cómputo', sprintf('LOG-K120-%s%02d', $amb, $i));
        $agregar($amb, null, "Mouse #$i", 'Cómputo', sprintf('LOG-M90-%s%02d', $amb, $i));
    }
    for ($i = 1; $i <= $n['sillas']; $i++) $agregar($amb, sprintf('SILLA-%s-%02d', $amb, $i), "Silla #$i", 'Mobiliario');
    for ($i = 1; $i <= $n['mesas']; $i++) $agregar($amb, sprintf('MESA-%s-%02d', $amb, $i), "Mesa #$i", 'Mobiliario');
}
// Equipos que ya traen código de barras del fabricante (EAN-13): se usa ese código.
$agregar('107', '7701234500017', 'Parlantes USB', 'Audiovisual', 'GEN-SP-107');
$agregar('108', '7701234500024', 'Cámara web', 'Audiovisual', 'LOG-C920-108');
$agregar('109', '7701234500031', 'Soldador de repuesto', 'Herramientas', null, 'En reparación');
// Un ítem base con un dato actualizado, para que la carga muestre "actualizado".
$agregar('107', 'AMB107-005', 'Video beam Epson PowerLite', 'Audiovisual', 'EPS-X41-0107');

$libro = new Spreadsheet();
$hoja = $libro->getActiveSheet();
$hoja->setTitle('Inventario');
$hoja->fromArray(['ambiente', 'codigo', 'nombre', 'categoria', 'serial', 'estado'], null, 'A1');
foreach ($filas as $i => $f) {
    $r = $i + 2;
    $hoja->fromArray($f, null, "A$r");
    // Los códigos EAN son solo dígitos: como texto para que Excel no los cambie.
    if ($f[1] !== null) $hoja->setCellValueExplicit("B$r", $f[1], DataType::TYPE_STRING);
}
$hoja->getStyle('A1:F1')->getFont()->setBold(true)->getColor()->setRGB('FFFFFF');
$hoja->getStyle('A1:F1')->getFill()->setFillType('solid')->getStartColor()->setRGB('39A900');
foreach (range('A', 'F') as $col) $hoja->getColumnDimension($col)->setAutoSize(true);
$hoja->freezePane('A2');

$destino = __DIR__ . '/../db/inventario-prueba.xlsx';
(new Xlsx($libro))->save($destino);
printf("✓ %s: %d filas\n", realpath($destino), count($filas));
