<?php
/**
 * Crea (o recrea) la base de datos de prueba y carga los datos de ejemplo.
 *
 *   C:\xampp\php\php.exe db\instalar.php
 *
 * Borra y vuelve a crear las tablas de `sena_ambientes`, así que solo se
 * permite desde la línea de comandos (no desde el navegador). Alternativa
 * sin consola: importar schema.sql y luego seed.sql en phpMyAdmin (sin el
 * inventario completo de inventario-prueba.xlsx, que se sube después desde
 * Inventario → Carga masiva).
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit("Este script solo se ejecuta desde la consola: php db/instalar.php\n");
}

require __DIR__ . '/../api/config.php';

mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
try {
    $conn = new mysqli(DB_HOST, DB_USER, DB_PASS);
    $conn->set_charset('utf8mb4');
    $conn->query("SET time_zone = '" . date('P') . "'");

    foreach (['schema.sql', 'seed.sql'] as $archivo) {
        $sql = file_get_contents(__DIR__ . '/' . $archivo);
        $conn->multi_query($sql);
        // Hay que recorrer todos los resultados para que se ejecuten todas las sentencias.
        do {
            if ($r = $conn->store_result()) $r->free();
        } while ($conn->more_results() && $conn->next_result());
        echo "✓ $archivo\n";
    }

    // Carga masiva del inventario de prueba (Excel) con PhpSpreadsheet, como la haría un administrativo.
    $excel = __DIR__ . '/inventario-prueba.xlsx';
    if (is_file(__DIR__ . '/../api/vendor/autoload.php')) {
        require __DIR__ . '/../api/lib/base.php';
        require __DIR__ . '/../api/modulos/ambientes.php';
        require __DIR__ . '/../api/modulos/inventario.php';
        require __DIR__ . '/../api/modulos/carga.php';
        $r = importarInventario(leerHojaInventario($excel, basename($excel)), null, false, basename($excel));
        printf("✓ inventario-prueba.xlsx: %d nuevos, %d actualizados, %d sin cambios, %d con error
",
            $r['nuevos'], $r['actualizados'], $r['sinCambios'], count($r['errores']));
        foreach ($r['errores'] as $e) echo "  fila {$e['fila']}: {$e['mensaje']}
";
    } else {
        echo "· Sin PhpSpreadsheet (composer install): se omite inventario-prueba.xlsx; quedan los ítems base de seed.sql.
";
    }

    $carpeta = __DIR__ . '/../' . CARPETA_FOTOS;
    if (!is_dir($carpeta)) mkdir($carpeta, 0775, true);

    $conn->select_db(DB_NAME);
    $conteos = $conn->query(
        "SELECT (SELECT COUNT(*) FROM users) usuarios, (SELECT COUNT(*) FROM environments) ambientes,
                (SELECT COUNT(*) FROM inventory_items) items, (SELECT COUNT(*) FROM inspections) inspecciones"
    )->fetch_assoc();
    printf("Base %s lista: %d usuarios, %d ambientes, %d ítems, %d inspecciones.\n",
        DB_NAME, $conteos['usuarios'], $conteos['ambientes'], $conteos['items'], $conteos['inspecciones']);
    echo "Contraseña de todos los usuarios de prueba: Sena2026*\n";
} catch (mysqli_sql_exception $e) {
    fwrite(STDERR, "Error: " . $e->getMessage() . "\n¿Está encendido MySQL en el panel de XAMPP?\n");
    exit(1);
}
