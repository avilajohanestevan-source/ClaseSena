<?php
/**
 * Genera db/inventario-prueba.xlsx (con PhpSpreadsheet): el inventario de
 * prueba elemento por elemento. db/instalar.php lo carga con la carga
 * masiva, igual que si lo subiera un administrativo. Sirve para validar:
 *   · categorías del catálogo (Periféricos, Electrodomésticos, Utensilios de cocina…)
 *   · familias: monitor, teclado y mouse de las familias PC que ya existen en
 *     seed.sql (107, 108, 109) y familias nuevas que la carga crea (110, 111)
 *   · la columna qr: pegatinas viejas con otro contenido (PLACA-SENA-…)
 *   · códigos EAN del fabricante y una fila que actualiza un ítem base
 *
 *   C:\xampp\php\php.exe scripts\generar-inventario-prueba.php
 *
 * Solo hace falta volver a ejecutarlo si se cambia la lista de abajo.
 */

require __DIR__ . '/../api/vendor/autoload.php';

use PhpOffice\PhpSpreadsheet\Cell\DataType;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;

const COLUMNAS = ['ambiente', 'codigo', 'nombre', 'categoria', 'serial', 'estado', 'familia', 'familia_nombre', 'familia_tipo', 'qr'];

$filas = [];
$agregar = function (string $amb, ?string $codigo, string $nombre, string $categoria, ?string $serial = null, string $estado = 'Operativo',
                     ?array $familia = null, ?string $qr = null) use (&$filas) {
    $filas[] = [$amb, $codigo, $nombre, $categoria, $serial, $estado, $familia[0] ?? null, $familia[1] ?? null, $familia[2] ?? null, $qr];
};

// 107, 108 y 109: los computadores y sus familias PC ya vienen en seed.sql;
// aquí llegan el monitor, el teclado y el mouse de cada puesto, y las sillas
// y mesas con su propia pegatina.
$porAmbiente = [
    '107' => ['equipos' => 4, 'sillas' => 30, 'mesas' => 15],
    '108' => ['equipos' => 3, 'sillas' => 28, 'mesas' => 14],
    '109' => ['equipos' => 1, 'sillas' => 24, 'mesas' => 6],
];
foreach ($porAmbiente as $amb => $n) {
    for ($i = 1; $i <= $n['equipos']; $i++) {
        $familia = [sprintf('FAM%s-PC%02d', $amb, $i)];
        $agregar($amb, null, "Monitor 24\" #$i", 'Periféricos', sprintf('SAM-S24-%s%02d', $amb, $i), 'Operativo', $familia);
        $agregar($amb, null, "Teclado #$i", 'Periféricos', sprintf('LOG-K120-%s%02d', $amb, $i), 'Operativo', $familia);
        $agregar($amb, null, "Mouse #$i", 'Periféricos', sprintf('LOG-M90-%s%02d', $amb, $i), 'Operativo', $familia);
    }
    for ($i = 1; $i <= $n['sillas']; $i++) $agregar($amb, sprintf('SILLA-%s-%02d', $amb, $i), "Silla #$i", 'Mobiliario');
    for ($i = 1; $i <= $n['mesas']; $i++) $agregar($amb, sprintf('MESA-%s-%02d', $amb, $i), "Mesa #$i", 'Mobiliario');
}
// Equipos que ya traen código de barras del fabricante (EAN-13): se usa ese código.
$agregar('107', '7701234500017', 'Parlantes USB', 'Audiovisual', 'GEN-SP-107');
$agregar('108', '7701234500024', 'Cámara web', 'Periféricos', 'LOG-C920-108');
$agregar('109', '7701234500031', 'Soldador de repuesto', 'Herramientas', null, 'En reparación');
// Un ítem base con un dato actualizado (y su placa vieja en el QR), para que la carga muestre "actualizado".
$agregar('107', 'AMB107-005', 'Video beam Epson PowerLite', 'Audiovisual', 'EPS-X41-0107', 'Operativo', null, 'PLACA-SENA-000457');

// 110 · Cocina: dos estaciones de cocina (familias nuevas que crea la carga).
for ($i = 1; $i <= 2; $i++) {
    $familia = [sprintf('FAM110-EST%02d', $i), "Estación de cocina $i", 'Estación de cocina'];
    $agregar('110', sprintf('COC-110-ESTUFA%02d', $i), "Estufa industrial #$i", 'Electrodomésticos', sprintf('IND-EST4-110%02d', $i), 'Operativo', $familia);
    $agregar('110', sprintf('COC-110-CAMPANA%02d', $i), "Campana extractora #$i", 'Electrodomésticos', null, 'Operativo', $familia);
    $agregar('110', sprintf('COC-110-MESON%02d', $i), "Mesón en acero #$i", 'Mobiliario', null, 'Operativo', $familia);
}
$agregar('110', null, 'Nevera industrial', 'Electrodomésticos', 'IND-NEV-1101');
$agregar('110', null, 'Horno microondas', 'Electrodomésticos', 'SAM-MW-1101');
$agregar('110', null, 'Licuadora industrial', 'Electrodomésticos', 'OST-LIC-1101');
$agregar('110', null, 'Juego de ollas (lote 6)', 'Utensilios de cocina');
$agregar('110', null, 'Cuchillos de chef (lote 12)', 'Utensilios de cocina');
$agregar('110', null, 'Extintor tipo K', 'Seguridad', 'EXT-K-110');
$agregar('110', null, 'Puerta del cuarto frío', 'Inmuebles');
for ($i = 1; $i <= 10; $i++) $agregar('110', sprintf('BANCO-110-%02d', $i), "Banco alto #$i", 'Mobiliario');

// 111 · Audiovisual: un kit de grabación y una estación de edición (familias nuevas).
$kit = ['FAM111-KIT01', 'Kit de grabación 1', 'Kit de grabación'];
$agregar('111', null, 'Cámara de video 4K', 'Audiovisual', 'SON-FX30-1111', 'Operativo', $kit, 'PLACA-SENA-000981');
$agregar('111', null, 'Trípode de video', 'Audiovisual', 'MAN-TRI-1111', 'Operativo', $kit);
$agregar('111', null, 'Micrófono de solapa', 'Audiovisual', 'ROD-LAV-1111', 'Operativo', $kit);
$edicion = ['FAM111-PC01', 'Estación de edición 1', 'PC'];
$agregar('111', null, 'Computador de edición', 'Equipos Informáticos', 'APL-MS-1111', 'Operativo', $edicion);
$agregar('111', null, 'Monitor 27" de edición', 'Periféricos', 'DEL-U27-1111', 'Operativo', $edicion);
$agregar('111', null, 'Teclado de edición', 'Periféricos', 'LOG-K380-1111', 'Operativo', $edicion);
$agregar('111', null, 'Mouse de edición', 'Periféricos', 'LOG-M720-1111', 'Operativo', $edicion);
$agregar('111', null, 'Panel LED (lote 4)', 'Audiovisual');
$agregar('111', null, 'Fondo verde', 'Mobiliario');
$agregar('111', null, 'Aire acondicionado', 'Electrodomésticos', 'LG-AC-18K-111');
for ($i = 1; $i <= 18; $i++) $agregar('111', sprintf('SILLA-111-%02d', $i), "Silla #$i", 'Mobiliario');

$libro = new Spreadsheet();
$hoja = $libro->getActiveSheet();
$hoja->setTitle('Inventario');
$hoja->fromArray(COLUMNAS, null, 'A1');
foreach ($filas as $i => $f) {
    $r = $i + 2;
    $hoja->fromArray($f, null, "A$r");
    // Los códigos EAN son solo dígitos: como texto para que Excel no los cambie.
    if ($f[1] !== null) $hoja->setCellValueExplicit("B$r", $f[1], DataType::TYPE_STRING);
}
$ultima = chr(ord('A') + count(COLUMNAS) - 1);
$hoja->getStyle("A1:{$ultima}1")->getFont()->setBold(true)->getColor()->setRGB('FFFFFF');
$hoja->getStyle("A1:{$ultima}1")->getFill()->setFillType('solid')->getStartColor()->setRGB('39A900');
foreach (range('A', $ultima) as $col) $hoja->getColumnDimension($col)->setAutoSize(true);
$hoja->freezePane('A2');

$destino = __DIR__ . '/../db/inventario-prueba.xlsx';
(new Xlsx($libro))->save($destino);
printf("✓ %s: %d filas\n", realpath($destino), count($filas));
