<?php
/**
 * Catálogos que mantiene el administrativo:
 *   · especialidades_ambiente: Cocina, Laboratorio, Audiovisual, Axo… (una por ambiente)
 *   · inventory_categories: Inmuebles, Mobiliario, Electrodomésticos,
 *     Equipos Informáticos, Periféricos… (una por ítem del inventario)
 * Consulta para todo el personal; crear, editar y borrar solo administrativos.
 * No se borra lo que está en uso: se desactiva.
 */

/** Configuración de cada catálogo: tabla, tabla que lo usa y textos. */
const CATALOGOS = [
    'especialidad' => ['tabla' => 'especialidades_ambiente', 'uso' => 'environments', 'columna' => 'especialidad_id',
                       'nombre' => 'la especialidad', 'usado' => 'ambiente(s)'],
    'categoria'    => ['tabla' => 'inventory_categories', 'uso' => 'inventory_items', 'columna' => 'category_id',
                       'nombre' => 'la categoría', 'usado' => 'ítem(s)'],
];

function catalogoPublico(array $c): array
{
    return [
        'id' => (int) $c['id'],
        'nombre' => $c['nombre'],
        'descripcion' => $c['descripcion'],
        'activo' => (bool) $c['activo'],
        'enUso' => (int) ($c['en_uso'] ?? 0),
    ];
}

function listarCatalogo(string $tipo): array
{
    ['tabla' => $t, 'uso' => $uso, 'columna' => $col] = CATALOGOS[$tipo];
    $soloActivos = !in_array(usuario()['rol'], ROLES_INVENTARIO, true) || empty($_GET['todos']);
    return array_map('catalogoPublico', filas(
        "SELECT c.*, (SELECT COUNT(*) FROM $uso x WHERE x.$col = c.id) en_uso FROM $t c"
        . ($soloActivos ? ' WHERE c.activo = 1' : '') . ' ORDER BY c.nombre'
    ));
}

function buscarCatalogo(string $tipo, int $id): array
{
    ['tabla' => $t, 'uso' => $uso, 'columna' => $col] = CATALOGOS[$tipo];
    $c = fila("SELECT c.*, (SELECT COUNT(*) FROM $uso x WHERE x.$col = c.id) en_uso FROM $t c WHERE c.id = ?", [$id]);
    if (!$c) fallar(404, ucfirst(CATALOGOS[$tipo]['nombre']) . ' no existe.', 'NO_ENCONTRADO');
    return $c;
}

/** Especialidades: administrativo. Categorías del inventario: administrativo y almacén. */
function exigirGestorCatalogo(string $tipo): void
{
    $tipo === 'categoria' ? exigirRol(...ROLES_INVENTARIO) : exigirRol('administrativo');
}

function guardarCatalogo(string $tipo, ?int $id): array
{
    exigirGestorCatalogo($tipo);
    $cfg = CATALOGOS[$tipo];
    $d = cuerpo();
    $nombre = texto($d, 'nombre', 60, true, 'el nombre');
    if (mb_strlen($nombre) < 2) fallar(422, 'El nombre debe tener al menos 2 caracteres.', 'VALIDACION');
    $descripcion = texto($d, 'descripcion', 200, false, 'la descripción');
    $activo = array_key_exists('activo', $d) ? (int) (bool) $d['activo'] : 1;
    if (fila("SELECT id FROM {$cfg['tabla']} WHERE nombre = ? AND id <> ?", [$nombre, $id ?? 0])) {
        fallar(409, ucfirst($cfg['nombre']) . " \"$nombre\" ya existe.", 'DUPLICADO');
    }
    if ($id) {
        buscarCatalogo($tipo, $id);
        consulta("UPDATE {$cfg['tabla']} SET nombre = ?, descripcion = ?, activo = ? WHERE id = ?", [$nombre, $descripcion, $activo, $id]);
    } else {
        $id = insertar("INSERT INTO {$cfg['tabla']} (nombre, descripcion, activo) VALUES (?, ?, ?)", [$nombre, $descripcion, $activo]);
    }
    return catalogoPublico(buscarCatalogo($tipo, $id));
}

function borrarCatalogo(string $tipo, int $id): never
{
    exigirGestorCatalogo($tipo);
    $cfg = CATALOGOS[$tipo];
    $c = buscarCatalogo($tipo, $id);
    if ((int) $c['en_uso']) {
        fallar(409, ucfirst($cfg['nombre']) . " \"{$c['nombre']}\" está asignada a {$c['en_uso']} {$cfg['usado']}. Desactívala en lugar de borrarla.", 'EN_USO');
    }
    consulta("DELETE FROM {$cfg['tabla']} WHERE id = ?", [$id]);
    responder(null, 204);
}

/**
 * Resuelve el id de un catálogo a partir del id o del nombre (sin importar
 * mayúsculas ni tildes). Null si no viene; 422 si no existe o está inactivo.
 */
function idCatalogo(string $tipo, $id, $nombre, bool $obligatorio): ?int
{
    $cfg = CATALOGOS[$tipo];
    $c = null;
    if ($id !== null && $id !== '') {
        if (!is_numeric($id)) fallar(422, ucfirst($cfg['nombre']) . ' no es válida.', 'VALIDACION');
        $c = fila("SELECT * FROM {$cfg['tabla']} WHERE id = ?", [(int) $id]);
        if (!$c) fallar(422, ucfirst($cfg['nombre']) . ' elegida no existe.', 'VALIDACION');
    } elseif ($nombre !== null && trim((string) $nombre) !== '') {
        $c = catalogoPorNombre($tipo, (string) $nombre);
        if (!$c) fallar(422, ucfirst($cfg['nombre']) . ' "' . trim((string) $nombre) . '" no existe. Opciones: ' . implode(', ', nombresCatalogo($tipo)) . '.', 'VALIDACION');
    } elseif ($obligatorio) {
        fallar(422, 'Elige ' . $cfg['nombre'] . '.', 'VALIDACION');
    }
    if ($c && !$c['activo']) fallar(422, ucfirst($cfg['nombre']) . " \"{$c['nombre']}\" está desactivada.", 'VALIDACION');
    return $c ? (int) $c['id'] : null;
}

/** "equipos informaticos", "EQUIPOS INFORMÁTICOS" → la fila de "Equipos Informáticos". */
function catalogoPorNombre(string $tipo, string $nombre): ?array
{
    static $cache = [];
    $cache[$tipo] ??= filas('SELECT * FROM ' . CATALOGOS[$tipo]['tabla']);
    $buscado = claveTexto($nombre);
    foreach ($cache[$tipo] as $c) if (claveTexto($c['nombre']) === $buscado) return $c;
    return null;
}

function nombresCatalogo(string $tipo): array
{
    return array_column(filas('SELECT nombre FROM ' . CATALOGOS[$tipo]['tabla'] . ' WHERE activo = 1 ORDER BY nombre'), 'nombre');
}

/** Minúsculas, sin tildes ni signos: para comparar nombres escritos a mano. */
function claveTexto(string $t): string
{
    $t = mb_strtolower(trim($t));
    $t = strtr($t, ['á' => 'a', 'é' => 'e', 'í' => 'i', 'ó' => 'o', 'ú' => 'u', 'ü' => 'u', 'ñ' => 'n']);
    return preg_replace('/[^a-z0-9]/', '', $t);
}

/* ---------------- rutas ---------------- */

function rutaEspecialidades(): never { usuario(); responder(listarCatalogo('especialidad')); }
function rutaCrearEspecialidad(): never { responder(guardarCatalogo('especialidad', null), 201); }
function rutaEditarEspecialidad(int $id): never { responder(guardarCatalogo('especialidad', $id)); }
function rutaBorrarEspecialidad(int $id): never { borrarCatalogo('especialidad', $id); }

function rutaCategorias(): never { exigirRol(...ROLES_PERSONAL); responder(listarCatalogo('categoria')); }
function rutaCrearCategoria(): never { responder(guardarCatalogo('categoria', null), 201); }
function rutaEditarCategoria(int $id): never { responder(guardarCatalogo('categoria', $id)); }
function rutaBorrarCategoria(int $id): never { borrarCatalogo('categoria', $id); }
