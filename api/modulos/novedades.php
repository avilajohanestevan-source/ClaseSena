<?php
/**
 * Novedades permanentes (persistent_issues) e historial de novedades.
 *
 * Una novedad permanente (aire acondicionado dañado, video beam sin lámpara,
 * grieta en la pared) queda "en_curso" en cuanto un instructor la reporta
 * —en una revisión, con naturaleza "permanente", o desde el módulo de
 * novedades— o la registra un administrativo. Sigue en curso, revisión tras
 * revisión, hasta que un instructor o un administrativo la marca resuelta.
 * Mientras tanto el ítem (o los componentes de la familia) puede quedar
 * "fuera_servicio" o "baja". Si el reporte que la abrió se retira antes de
 * entregar el ambiente, queda "anulada".
 *
 * Cada cambio (creada, reportada de nuevo, modificada, resuelta, anulada)
 * queda en audit_events con fecha, usuario y evidencia. Al abrirse y al
 * resolverse se avisa a coordinación, administrativo y almacén.
 *
 * El historial (GET /issues) reúne cada novedad reportada: equipo o
 * ambiente, fecha, usuario, evidencia, naturaleza, estado y fecha de resolución.
 */

const SQL_NOVEDADES = "SELECT n.*, e.codigo AS ambiente_codigo, e.nombre AS ambiente_nombre,
                              it.codigo AS item_codigo, it.nombre AS item_nombre, it.estado AS item_estado,
                              f.codigo AS familia_codigo, f.nombre AS familia_nombre, f.tipo AS familia_tipo,
                              ur.nombre AS reportada_por_nombre, ur.rol AS reportada_por_rol, us.nombre AS resuelta_por_nombre,
                              ci.nombre AS item_categoria,
                              (SELECT c2.nombre FROM inventory_items i2 JOIN inventory_categories c2 ON c2.id = i2.category_id
                               WHERE i2.family_id = n.family_id ORDER BY i2.id LIMIT 1) AS familia_categoria,
                              (SELECT COUNT(*) FROM inspection_items d WHERE d.persistent_issue_id = n.id) AS reportes
                       FROM persistent_issues n
                       JOIN environments e ON e.id = n.environment_id
                       LEFT JOIN inventory_items it ON it.id = n.inventory_item_id
                       LEFT JOIN inventory_categories ci ON ci.id = it.category_id
                       LEFT JOIN item_families f ON f.id = n.family_id
                       LEFT JOIN users ur ON ur.id = n.reportada_por
                       LEFT JOIN users us ON us.id = n.resuelta_por";

const ESTADOS_NOVEDAD = ['en_curso', 'resuelta', 'anulada'];
/** Estados en los que se pueden dejar los ítems de una novedad en curso (baja = inactivo, solo administrativos). */
const ESTADOS_NOVEDAD_ITEM = ['danado', 'en_reparacion', 'fuera_servicio', 'baja'];

/**
 * Punto del checklist de la revisión al que pertenece una novedad, para
 * mostrarla resaltada en esa área (p. ej. el aire acondicionado en "Aire /
 * ventilación"). Se deduce del nombre, la categoría o la ubicación en el salón.
 * Null si no encaja en ninguna.
 */
function areaChecklist(?string $nombre, ?string $categoria, ?string $ubicacion): ?string
{
    $nombre = claveTexto((string) $nombre);
    $categoria = claveTexto((string) $categoria);
    foreach (['ventilacion' => '/aire|ventilad|extract|climatiz|campana/', 'luces' => '/lampara|luz|luminaria|bombillo|reflector|panelled/',
              'electrico' => '/toma|cable|interruptor|extension|multitoma|regulador/', 'senalizacion' => '/extintor|botiquin|senal|alarma/'] as $area => $patron) {
        if ($nombre !== '' && preg_match($patron, $nombre)) return $area;
    }
    if ($ubicacion) return ['puerta' => 'puertas', 'ventana' => 'puertas', 'electrica' => 'electrico'][$ubicacion] ?? null;
    return [
        'mobiliario' => 'mobiliario', 'inmuebles' => 'puertas', 'seguridad' => 'senalizacion',
        'equiposinformaticos' => 'equipos', 'perifericos' => 'equipos', 'audiovisual' => 'equipos', 'redes' => 'equipos',
        'laboratorio' => 'equipos', 'herramientas' => 'equipos', 'electrodomesticos' => 'equipos', 'utensiliosdecocina' => 'equipos',
    ][$categoria] ?? null;
}

/**
 * Categoría del inventario de una novedad: la del ítem, la del primer
 * componente de la familia o, si es del salón (pared, techo…), Inmuebles.
 * → {id, nombre} o null.
 */
function categoriaNovedad(?int $itemId, ?int $familiaId, ?string $ubicacion): ?array
{
    static $categorias = null, $porItem = [], $porFamilia = [];
    $categorias ??= array_column(filas('SELECT id, nombre FROM inventory_categories'), 'nombre', 'id');
    $id = null;
    if ($itemId) $id = $porItem[$itemId] ??= (int) (fila('SELECT category_id FROM inventory_items WHERE id = ?', [$itemId])['category_id'] ?? 0);
    elseif ($familiaId) $id = $porFamilia[$familiaId] ??= (int) (fila('SELECT category_id FROM inventory_items WHERE family_id = ? ORDER BY id LIMIT 1', [$familiaId])['category_id'] ?? 0);
    elseif ($ubicacion) $id = (int) (array_search('Inmuebles', $categorias, true) ?: 0);
    return $id && isset($categorias[$id]) ? ['id' => $id, 'nombre' => $categorias[$id]] : null;
}

/** Ítem, familia o salón al que se refiere una novedad (o un reporte). */
function objetivoNovedad(array $n): array
{
    if ($n['inventory_item_id'] ?? null) return ['tipo' => 'item', 'id' => (int) $n['inventory_item_id'], 'codigo' => $n['item_codigo'], 'nombre' => $n['item_nombre']];
    if ($n['family_id'] ?? null) return ['tipo' => 'familia', 'id' => (int) $n['family_id'], 'codigo' => $n['familia_codigo'], 'nombre' => "Familia {$n['familia_tipo']} · {$n['familia_nombre']}"];
    return ['tipo' => 'salon', 'id' => null, 'codigo' => null, 'nombre' => 'Salón · ' . (UBICACIONES[$n['ubicacion']] ?? 'Otro')];
}

function novedadPublica(array $n): array
{
    $obj = objetivoNovedad($n);
    return [
        'id' => (int) $n['id'],
        'estado' => $n['estado'],
        'ambiente' => ['id' => (int) $n['environment_id'], 'codigo' => $n['ambiente_codigo'], 'nombre' => $n['ambiente_nombre']],
        'objetivo' => $obj,
        'titulo' => $obj['nombre'] . ($obj['codigo'] ? " · {$obj['codigo']}" : ''),
        'itemEstado' => $n['item_estado'],
        'ubicacion' => $n['ubicacion'],
        'categoria' => categoriaNovedad($n['inventory_item_id'] !== null ? (int) $n['inventory_item_id'] : null,
            $n['family_id'] !== null ? (int) $n['family_id'] : null, $n['ubicacion']),
        'tipoDano' => $n['tipo_dano'],
        'severidad' => $n['severidad'],
        'descripcion' => $n['descripcion'],
        'foto' => $n['foto'],
        'reportadaPor' => $n['reportada_por_nombre'],
        'reportadaPorRol' => $n['reportada_por_rol'],
        'inspeccionId' => $n['inspection_id'] !== null ? (int) $n['inspection_id'] : null,
        'creadaEn' => iso($n['creada_en']),
        'resueltaPor' => $n['resuelta_por_nombre'],
        'resueltaEn' => iso($n['resuelta_en']),
        'resolucion' => $n['resolucion'],
        'fotoResolucion' => $n['foto_resolucion'],
        'anuladaEn' => iso($n['anulada_en']),
        // Cuántas revisiones la han reportado (la primera y las que se le sumaron).
        'reportes' => (int) ($n['reportes'] ?? 0),
        // Punto del checklist donde se resalta en la revisión (ventilacion, equipos, puertas…).
        'area' => areaChecklist($n['item_nombre'] ?? ($n['familia_tipo'] ?? null), $n['item_categoria'] ?? ($n['familia_categoria'] ?? null), $n['ubicacion']),
    ];
}

function buscarNovedad(int $id): array
{
    $n = fila(SQL_NOVEDADES . ' WHERE n.id = ?', [$id]);
    if (!$n) fallar(404, 'La novedad no existe.', 'NO_ENCONTRADO');
    return $n;
}

/** Ítems afectados: el ítem, o los componentes actuales de la familia; ninguno si es del salón. */
function itemsDeNovedad(array $n): array
{
    if ($n['inventory_item_id']) return filas('SELECT id, codigo, estado FROM inventory_items WHERE id = ?', [(int) $n['inventory_item_id']]);
    if ($n['family_id']) return filas('SELECT id, codigo, estado FROM inventory_items WHERE family_id = ?', [(int) $n['family_id']]);
    return [];
}

/** Novedad en curso del mismo ítem o de la misma familia (para no duplicarla). */
function novedadEnCursoDe(?int $itemId, ?int $familiaId): ?array
{
    if ($itemId) return fila("SELECT id FROM persistent_issues WHERE inventory_item_id = ? AND estado = 'en_curso' ORDER BY id LIMIT 1", [$itemId]);
    if ($familiaId) return fila("SELECT id FROM persistent_issues WHERE family_id = ? AND estado = 'en_curso' ORDER BY id LIMIT 1", [$familiaId]);
    return null;
}

/**
 * Un reporte permanente de una revisión abre una novedad en curso (o se suma
 * a la que el ítem o la familia ya tenía) en el momento de reportarlo. Avisa
 * a coordinación, administrativo y almacén si es nueva.
 * @return int id de la novedad
 */
function abrirNovedadDeReporte(int $reporteId, array $s, array $instructor): int
{
    $d = fila('SELECT * FROM inspection_items WHERE id = ?', [$reporteId]);
    $activa = novedadEnCursoDe($d['inventory_item_id'] !== null ? (int) $d['inventory_item_id'] : null, $d['family_id'] !== null ? (int) $d['family_id'] : null);
    if ($activa) {
        $novedadId = (int) $activa['id'];
        $texto = "Reportada otra vez en la revisión del ambiente {$s['amb_codigo']} por {$instructor['nombre']}: {$d['comentario']}";
        auditar('novedad', $novedadId, (int) $s['environment_id'], 'reportada_de_nuevo', $texto, (int) $instructor['id'], $d['foto'], ['inspeccionId' => (int) $s['id'], 'reporteId' => $reporteId]);
    } else {
        $novedadId = insertar(
            'INSERT INTO persistent_issues (environment_id, inventory_item_id, family_id, ubicacion, tipo_dano, severidad, descripcion, foto,
                                            reportada_por, inspection_id, creada_en)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
            [(int) $s['environment_id'], $d['inventory_item_id'] !== null ? (int) $d['inventory_item_id'] : null,
             $d['family_id'] !== null ? (int) $d['family_id'] : null, $d['ubicacion'], $d['tipo_dano'], $d['severidad'],
             $d['comentario'], $d['foto'], (int) $instructor['id'], (int) $s['id']]
        );
        $texto = "Novedad permanente #$novedadId abierta en la revisión del ambiente {$s['amb_codigo']}: {$d['comentario']}";
        auditar('novedad', $novedadId, (int) $s['environment_id'], 'creada', $texto, (int) $instructor['id'], $d['foto'],
            ['inspeccionId' => (int) $s['id'], 'reporteId' => $reporteId, 'severidad' => $d['severidad'], 'tipoDano' => $d['tipo_dano']]);
    }
    consulta('UPDATE inspection_items SET persistent_issue_id = ? WHERE id = ?', [$novedadId, $reporteId]);
    foreach (itemsDeNovedad($d) as $i) historial((int) $i['id'], 'novedad', $texto, (int) $instructor['id'], (int) $s['id'], $novedadId);
    if (!$activa) avisarNovedad(buscarNovedad($novedadId), 'novedad_permanente', 0);
    return $novedadId;
}

/**
 * Se retiró un reporte permanente antes de entregar el ambiente: si la novedad
 * nació con ese reporte y ninguna otra revisión la reportó, queda anulada; si
 * no, solo se deja constancia de que ese reporte se retiró.
 */
function retirarReporteDeNovedad(array $r, ?int $usuarioId): void
{
    if (!$r['persistent_issue_id']) return;
    $n = buscarNovedad((int) $r['persistent_issue_id']);
    $otros = (int) fila('SELECT COUNT(*) n FROM inspection_items WHERE persistent_issue_id = ? AND id <> ?', [(int) $n['id'], (int) $r['id']])['n'];
    if ($n['estado'] === 'en_curso' && !$otros && (int) $n['inspection_id'] === (int) $r['inspection_id']) {
        consulta("UPDATE persistent_issues SET estado = 'anulada', anulada_en = NOW() WHERE id = ?", [(int) $n['id']]);
        auditar('novedad', (int) $n['id'], (int) $n['environment_id'], 'anulada', 'Anulada: se retiró el reporte que la abrió, antes de entregar el ambiente', $usuarioId);
    } else {
        auditar('novedad', (int) $n['id'], (int) $n['environment_id'], 'reporte_retirado', "Se retiró el reporte de la revisión #{$r['inspection_id']}; la novedad sigue " . str_replace('_', ' ', $n['estado']), $usuarioId);
    }
}

/** Aviso a coordinación, administrativo y almacén. */
function avisarNovedad(array $n, string $tipo, int $excepto): void
{
    $obj = objetivoNovedad($n);
    $titulo = $tipo === 'novedad_resuelta'
        ? "Novedad resuelta en el ambiente {$n['ambiente_codigo']}"
        : "Novedad permanente en el ambiente {$n['ambiente_codigo']}";
    $detalle = $tipo === 'novedad_resuelta'
        ? "{$obj['nombre']}: {$n['resolucion']} · resolvió {$n['resuelta_por_nombre']}"
        : "{$obj['nombre']}" . ($obj['codigo'] ? " ({$obj['codigo']})" : '') . ': ' . str_replace('_', ' ', $n['tipo_dano']) . " ({$n['severidad']}) · "
          . ($n['reportada_por_nombre'] ? "reportó {$n['reportada_por_nombre']} · " : '') . 'en curso hasta que se marque resuelta';
    notificarAdministrativos($tipo, $titulo, $detalle, $n['inspection_id'] !== null ? (int) $n['inspection_id'] : null, (int) $n['id'], $excepto);
}

/**
 * Cambio hecho desde la pantalla de revisión (inspeccionId): la revisión debe
 * ser del mismo ambiente y, si es un instructor, la suya. Devuelve el texto y
 * los datos que se agregan al historial, o null si no viene.
 */
function desdeRevision(array $d, array $n, array $u): ?array
{
    $inspeccionId = entero($d, 'inspeccionId', false);
    if (!$inspeccionId) return null;
    $s = fila('SELECT s.id, s.environment_id, s.instructor_id, s.estado, e.codigo FROM inspections s JOIN environments e ON e.id = s.environment_id WHERE s.id = ?', [$inspeccionId]);
    if (!$s || (int) $s['environment_id'] !== (int) $n['environment_id']) fallar(422, 'La revisión indicada no es de este ambiente.', 'VALIDACION');
    if ($u['rol'] === 'instructor' && (int) $s['instructor_id'] !== (int) $u['id']) fallar(403, 'Esa revisión es de otro instructor.', 'PERMISO');
    return ['id' => (int) $s['id'], 'texto' => ' · desde la revisión INS-' . str_pad((string) $s['id'], 6, '0', STR_PAD_LEFT) . " del ambiente {$s['codigo']}"];
}

/** Foto opcional de evidencia (data URL) → ruta guardada, o null. */
function fotoOpcional(array $d, string $campo = 'foto'): ?string
{
    return !empty($d[$campo]) ? guardarFoto((string) $d[$campo]) : null;
}

/* ---------------- rutas ---------------- */

/** GET /persistent-issues?estado=en_curso|resuelta|anulada&ambienteId&categoriaId */
function rutaNovedades(): never
{
    exigirRol(...ROLES_PERSONAL);
    $where = [];
    $params = [];
    if ($v = opcion($_GET, 'estado', ESTADOS_NOVEDAD, false)) { $where[] = 'n.estado = ?'; $params[] = $v; }
    if ($v = entero($_GET, 'ambienteId', false)) { $where[] = 'n.environment_id = ?'; $params[] = $v; }
    $categoriaId = entero($_GET, 'categoriaId', false);
    $sql = SQL_NOVEDADES . ($where ? ' WHERE ' . implode(' AND ', $where) : '')
        . " ORDER BY n.estado = 'en_curso' DESC, FIELD(n.severidad, 'grave', 'moderada', 'leve'), n.creada_en DESC";
    $lista = array_map('novedadPublica', filas($sql, $params));
    if ($categoriaId) $lista = array_values(array_filter($lista, fn($n) => ($n['categoria']['id'] ?? 0) === $categoriaId));
    responder(array_slice($lista, 0, 300));
}

/** GET /persistent-issues/{id}: con los ítems afectados, cada revisión que la reportó y sus eventos (auditoría). */
function rutaNovedad(int $id): never
{
    exigirRol(...ROLES_PERSONAL);
    responder(detalleNovedad(buscarNovedad($id)));
}

function detalleNovedad(array $n): array
{
    $reportes = filas(
        'SELECT d.id, d.inspection_id, d.comentario, d.foto, d.severidad, d.reportado_en, u.nombre AS instructor
         FROM inspection_items d JOIN inspections s ON s.id = d.inspection_id JOIN users u ON u.id = s.instructor_id
         WHERE d.persistent_issue_id = ? ORDER BY d.reportado_en DESC', [(int) $n['id']]);
    return novedadPublica($n) + [
        'items' => array_map(fn($i) => ['id' => (int) $i['id'], 'codigo' => $i['codigo'], 'estado' => $i['estado']], itemsDeNovedad($n)),
        'historial' => array_map(fn($d) => [
            'reporteId' => (int) $d['id'], 'inspeccionId' => (int) $d['inspection_id'], 'instructor' => $d['instructor'],
            'comentario' => $d['comentario'], 'foto' => $d['foto'], 'severidad' => $d['severidad'], 'fecha' => iso($d['reportado_en']),
        ], $reportes),
        'eventos' => eventosDe('novedad', (int) $n['id']),
    ];
}

/**
 * POST /persistent-issues (instructor o administrativo): levanta una novedad
 * permanente sin revisión de por medio (p. ej. el aire se daña a mitad de la clase).
 * {ambienteId?, itemId | familiaId | codigo | ubicacion, tipoDano, severidad, descripcion, foto, estadoItem?}
 * La foto es obligatoria para los instructores. Los ítems pasan a estadoItem
 * (por defecto "danado"; "baja" solo administrativos).
 */
function rutaCrearNovedad(): never
{
    $u = exigirRol('administrativo', 'instructor', 'almacen');
    $d = conAlias(cuerpo(), 'familiaId', 'familia_id');
    $item = $familia = $ubicacion = null;
    if (!empty($d['itemId'])) $item = fila(SQL_ITEMS . ' WHERE i.id = ?', [(int) $d['itemId']]) ?? fallar(404, 'El ítem no existe.', 'NO_ENCONTRADO');
    elseif (!empty($d['familiaId'])) $familia = fila(SQL_FAMILIAS . ' WHERE f.id = ?', [(int) $d['familiaId']]) ?? fallar(404, 'La familia no existe.', 'NO_ENCONTRADO');
    elseif (!empty($d['codigo'])) {
        $l = leerCodigoEscaneado((string) $d['codigo']) ?? fallar(404, 'El código no corresponde a ningún ítem ni familia.', 'NO_ENCONTRADO');
        if ($l['tipo'] === 'item') $item = $l['fila']; else $familia = $l['fila'];
    } else {
        $ubicacion = opcion($d, 'ubicacion', array_keys(UBICACIONES), true, 'dónde está la novedad');
    }
    $ambienteId = (int) (($item ?? $familia)['environment_id'] ?? buscarAmbiente(entero($d, 'ambienteId'))['id']);
    if ($activa = novedadEnCursoDe($item ? (int) $item['id'] : null, $familia ? (int) $familia['id'] : null)) {
        fallar(409, "Ya hay una novedad permanente en curso (#{$activa['id']}) para " . ($item['codigo'] ?? $familia['codigo']) . '. Agrégale la información desde su detalle.', 'DUPLICADO');
    }
    $tipo = opcion($d, 'tipoDano', TIPOS_DANO, true, 'el tipo de daño');
    $severidad = opcion($d, 'severidad', SEVERIDADES, true, 'la severidad');
    $descripcion = texto($d, 'descripcion', 500, true, 'la descripción');
    if (mb_strlen($descripcion) < 10) fallar(422, 'Describe la novedad con al menos 10 caracteres.', 'VALIDACION');
    $estadoItem = opcion($d, 'estadoItem', ESTADOS_NOVEDAD_ITEM, false, 'el estado del ítem') ?? 'danado';
    if ($estadoItem === 'baja' && !in_array($u['rol'], ROLES_INVENTARIO, true)) fallar(403, 'Solo administrativo o almacén pueden dar de baja un ítem.', 'PERMISO');
    if ($u['rol'] === 'instructor' && empty($d['foto'])) fallar(422, 'Toma una foto de la novedad como evidencia.', 'VALIDACION');
    $foto = fotoOpcional($d);

    db()->begin_transaction();
    $id = insertar(
        'INSERT INTO persistent_issues (environment_id, inventory_item_id, family_id, ubicacion, tipo_dano, severidad, descripcion, foto, reportada_por, creada_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
        [$ambienteId, $item ? (int) $item['id'] : null, $familia ? (int) $familia['id'] : null, $ubicacion, $tipo, $severidad, $descripcion, $foto, (int) $u['id']]
    );
    $cambios = [];
    foreach (itemsDeNovedad(buscarNovedad($id)) as $i) {
        if ($i['estado'] !== 'baja' && $i['estado'] !== $estadoItem) {
            consulta('UPDATE inventory_items SET estado = ? WHERE id = ?', [$estadoItem, (int) $i['id']]);
            $cambios[] = "{$i['codigo']}: " . ETIQUETA_ESTADO[$i['estado']] . ' → ' . ETIQUETA_ESTADO[$estadoItem];
        }
        historial((int) $i['id'], 'novedad', "Novedad permanente #$id levantada por {$u['nombre']}: $descripcion", (int) $u['id'], null, $id);
    }
    auditar('novedad', $id, $ambienteId, 'creada', "Novedad permanente levantada por {$u['nombre']}: $descripcion" . ($cambios ? ' · ' . implode(' · ', $cambios) : ''),
        (int) $u['id'], $foto, ['severidad' => $severidad, 'tipoDano' => $tipo, 'estadoItem' => $estadoItem]);
    avisarNovedad(buscarNovedad($id), 'novedad_permanente', (int) $u['id']);
    db()->commit();
    responder(detalleNovedad(buscarNovedad($id)), 201);
}

/**
 * PATCH /persistent-issues/{id} (instructor o administrativo), mientras siga en curso:
 * {estadoItem?, severidad?, descripcion?, nota?, foto?}
 *   · estadoItem deja el ítem (o los componentes de la familia) dañado, en
 *     reparación, fuera de servicio o de baja (inactivo; solo administrativos)
 *     hasta su reparación;
 *   · nota y foto agregan seguimiento y evidencia.
 * Cada modificación queda en el historial con lo que cambió.
 */
function rutaEditarNovedad(int $id): never
{
    $u = exigirRol('administrativo', 'instructor', 'almacen');
    $n = buscarNovedad($id);
    if ($n['estado'] !== 'en_curso') fallar(409, 'La novedad ya no está en curso.', 'ESTADO');
    $d = cuerpo();
    $estadoItem = opcion($d, 'estadoItem', ESTADOS_NOVEDAD_ITEM, false, 'el estado del ítem');
    if ($estadoItem === 'baja' && !in_array($u['rol'], ROLES_INVENTARIO, true)) fallar(403, 'Solo administrativo o almacén pueden dar de baja un ítem.', 'PERMISO');
    if ($estadoItem && !$n['inventory_item_id'] && !$n['family_id']) fallar(422, 'Esta novedad es del salón: no tiene ítems que cambiar de estado.', 'VALIDACION');
    $severidad = opcion($d, 'severidad', SEVERIDADES, false, 'la severidad') ?? $n['severidad'];
    $descripcion = texto($d, 'descripcion', 500, false, 'la descripción') ?? $n['descripcion'];
    $nota = texto($d, 'nota', 500, false, 'la nota');
    $revision = desdeRevision($d, $n, $u);
    $foto = fotoOpcional($d);

    $cambios = [];
    $datos = $revision ? ['inspeccionId' => $revision['id']] : [];
    if ($severidad !== $n['severidad']) { $cambios[] = "severidad: {$n['severidad']} → $severidad"; $datos['severidad'] = [$n['severidad'], $severidad]; }
    if ($descripcion !== $n['descripcion']) { $cambios[] = 'descripción actualizada'; $datos['descripcion'] = [$n['descripcion'], $descripcion]; }
    db()->begin_transaction();
    consulta('UPDATE persistent_issues SET severidad = ?, descripcion = ? WHERE id = ?', [$severidad, $descripcion, $id]);
    if ($estadoItem) {
        foreach (itemsDeNovedad($n) as $i) {
            if ($i['estado'] === $estadoItem) continue;
            consulta('UPDATE inventory_items SET estado = ? WHERE id = ?', [$estadoItem, (int) $i['id']]);
            historial((int) $i['id'], 'estado', 'Estado: ' . ETIQUETA_ESTADO[$i['estado']] . ' → ' . ETIQUETA_ESTADO[$estadoItem] . " (novedad permanente #$id)", (int) $u['id'], $revision['id'] ?? null, $id);
            $cambios[] = "{$i['codigo']}: " . ETIQUETA_ESTADO[$i['estado']] . ' → ' . ETIQUETA_ESTADO[$estadoItem];
            $datos['items'][$i['codigo']] = [$i['estado'], $estadoItem];
        }
    }
    if (!$cambios && !$nota && !$foto) { db()->rollback(); fallar(422, 'No hay cambios: indica un estado, una nota o una foto.', 'VALIDACION'); }
    auditar('novedad', $id, (int) $n['environment_id'], 'modificada',
        implode(' · ', array_filter([$cambios ? implode(' · ', $cambios) : null, $nota ? "Nota: $nota" : null, $foto && !$nota ? 'Nueva evidencia' : null])) . ($revision['texto'] ?? ''),
        (int) $u['id'], $foto, $datos ?: null);
    db()->commit();
    responder(detalleNovedad(buscarNovedad($id)));
}

/**
 * POST /persistent-issues/{id}/resolve {resolucion, estadoItem?, foto?, inspeccionId?} (instructor o administrativo)
 * La marca resuelta; los ítems vuelven a estadoItem (por defecto "operativo";
 * los que están de baja no cambian). Avisa a coordinación, administrativo e
 * inventario y a quien la reportó. Con inspeccionId queda en el historial que
 * se resolvió desde la revisión del ambiente ("Ya está en funcionamiento").
 */
function rutaResolverNovedad(int $id): never
{
    $u = exigirRol('administrativo', 'instructor', 'almacen');
    $n = buscarNovedad($id);
    if ($n['estado'] !== 'en_curso') fallar(409, $n['estado'] === 'resuelta' ? 'La novedad ya estaba resuelta.' : 'La novedad fue anulada.', 'ESTADO');
    $d = cuerpo();
    $resolucion = texto($d, 'resolucion', 500, true, 'qué se hizo para resolverla');
    if (mb_strlen($resolucion) < 5) fallar(422, 'Describe la solución con al menos 5 caracteres.', 'VALIDACION');
    $estadoItem = opcion($d, 'estadoItem', ['operativo', 'en_reparacion', 'baja'], false, 'el estado del ítem') ?? 'operativo';
    if ($estadoItem === 'baja' && !in_array($u['rol'], ROLES_INVENTARIO, true)) fallar(403, 'Solo administrativo o almacén pueden dar de baja un ítem.', 'PERMISO');
    $revision = desdeRevision($d, $n, $u);
    $foto = fotoOpcional($d);

    db()->begin_transaction();
    consulta("UPDATE persistent_issues SET estado = 'resuelta', resuelta_por = ?, resuelta_en = NOW(), resolucion = ?, foto_resolucion = ? WHERE id = ? AND estado = 'en_curso'",
        [(int) $u['id'], $resolucion, $foto, $id]);
    $cambios = [];
    foreach (itemsDeNovedad($n) as $i) {
        // Si el ítem tiene otra novedad en curso (p. ej. la de su familia), sigue como está.
        $otra = fila("SELECT id FROM persistent_issues WHERE estado = 'en_curso' AND id <> ? AND (inventory_item_id = ? OR family_id = (SELECT family_id FROM inventory_items WHERE id = ?))",
            [$id, (int) $i['id'], (int) $i['id']]);
        $nuevo = $i['estado'] === 'baja' || $otra ? $i['estado'] : $estadoItem;
        if ($nuevo !== $i['estado']) {
            consulta('UPDATE inventory_items SET estado = ? WHERE id = ?', [$nuevo, (int) $i['id']]);
            $cambios[] = "{$i['codigo']} vuelve a " . ETIQUETA_ESTADO[$nuevo];
        }
        historial((int) $i['id'], 'novedad_resuelta', "Novedad permanente #$id resuelta por {$u['nombre']}: $resolucion"
            . ($nuevo !== $i['estado'] ? ' · ' . ETIQUETA_ESTADO[$i['estado']] . ' → ' . ETIQUETA_ESTADO[$nuevo] : ($otra ? " · sigue con la novedad #{$otra['id']}" : '')),
            (int) $u['id'], $revision['id'] ?? null, $id);
    }
    auditar('novedad', $id, (int) $n['environment_id'], 'resuelta', "Resuelta por {$u['nombre']}: $resolucion" . ($cambios ? ' · ' . implode(' · ', $cambios) : '') . ($revision['texto'] ?? ''),
        (int) $u['id'], $foto, ['estadoItem' => $estadoItem] + ($revision ? ['inspeccionId' => $revision['id']] : []));
    $n = buscarNovedad($id);
    avisarNovedad($n, 'novedad_resuelta', (int) $u['id']);
    $reporto = fila('SELECT id, rol FROM users WHERE id = ? AND activo = 1', [(int) $n['reportada_por']]);
    if ($reporto && !in_array($reporto['rol'], ROLES_INVENTARIO, true) && (int) $reporto['id'] !== (int) $u['id']) {
        notificar((int) $reporto['id'], 'novedad_resuelta', "Se resolvió la novedad que reportaste en el ambiente {$n['ambiente_codigo']}",
            objetivoNovedad($n)['nombre'] . ": $resolucion", $n['inspection_id'] !== null ? (int) $n['inspection_id'] : null, $id);
    }
    db()->commit();
    responder(detalleNovedad($n));
}

/**
 * GET /issues?ambienteId&itemId&naturaleza&estado&desde&hasta (instructor o administrativo)
 * Historial completo de novedades: todo lo reportado en las revisiones más
 * las novedades permanentes levantadas desde el módulo y las anuladas.
 * estado: en_revision (la entrega no se ha recibido, solo temporales y
 * limpieza) | en_curso | resuelta | anulada (permanentes) | cerrada
 * (temporales y de limpieza, al recibir el ambiente).
 */
function rutaHistorialNovedades(): never
{
    exigirRol('administrativo', 'instructor', 'almacen');
    $ambienteId = entero($_GET, 'ambienteId', false);
    $itemId = entero($_GET, 'itemId', false);
    $categoriaId = entero($_GET, 'categoriaId', false);
    $naturaleza = opcion($_GET, 'naturaleza', array_keys(NATURALEZAS), false);
    $estado = opcion($_GET, 'estado', ['en_revision', 'en_curso', 'resuelta', 'anulada', 'cerrada'], false);
    foreach (['desde', 'hasta'] as $campo) {
        if (!empty($_GET[$campo]) && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $_GET[$campo])) fallar(422, "La fecha '$campo' no es válida.", 'VALIDACION');
    }

    $reportes = filas(
        "SELECT d.id, d.inspection_id, d.inventory_item_id, d.family_id, d.ubicacion, d.naturaleza, d.tipo_dano, d.severidad, d.comentario, d.foto,
                d.reportado_en, d.persistent_issue_id, s.environment_id, s.estado AS insp_estado, s.recibida_en,
                e.codigo AS ambiente_codigo, e.nombre AS ambiente_nombre, it.codigo AS item_codigo, it.nombre AS item_nombre, it.estado AS item_estado,
                f.codigo AS familia_codigo, f.nombre AS familia_nombre, f.tipo AS familia_tipo, u.nombre AS usuario,
                n.estado AS nov_estado, n.resuelta_en, ur.nombre AS resuelta_por_nombre, n.resolucion
         FROM inspection_items d
         JOIN inspections s ON s.id = d.inspection_id
         JOIN environments e ON e.id = s.environment_id
         JOIN users u ON u.id = s.instructor_id
         LEFT JOIN inventory_items it ON it.id = d.inventory_item_id
         LEFT JOIN item_families f ON f.id = d.family_id
         LEFT JOIN persistent_issues n ON n.id = d.persistent_issue_id
         LEFT JOIN users ur ON ur.id = n.resuelta_por
         WHERE s.estado <> 'cancelada'"
    );
    // Levantadas desde el módulo (sin revisión) y anuladas (su reporte se retiró).
    $sueltas = filas(SQL_NOVEDADES . " WHERE n.inspection_id IS NULL OR n.estado = 'anulada'");

    $lista = [];
    foreach ($reportes as $r) {
        $est = $r['naturaleza'] === 'permanente' ? ($r['nov_estado'] ?? 'en_curso') : ($r['insp_estado'] !== 'recibida' ? 'en_revision' : 'cerrada');
        $lista[] = [
            'origen' => 'revision', 'id' => (int) $r['id'], 'inspeccionId' => (int) $r['inspection_id'],
            'novedadId' => $r['persistent_issue_id'] !== null ? (int) $r['persistent_issue_id'] : null,
            'ambiente' => ['id' => (int) $r['environment_id'], 'codigo' => $r['ambiente_codigo'], 'nombre' => $r['ambiente_nombre']],
            'objetivo' => objetivoNovedad($r), 'itemEstado' => $r['item_estado'],
            'categoria' => categoriaNovedad($r['inventory_item_id'] !== null ? (int) $r['inventory_item_id'] : null,
                $r['family_id'] !== null ? (int) $r['family_id'] : null, $r['ubicacion']),
            'naturaleza' => $r['naturaleza'], 'tipoDano' => $r['tipo_dano'], 'severidad' => $r['severidad'],
            'comentario' => $r['comentario'], 'foto' => $r['foto'], 'usuario' => $r['usuario'],
            'fecha' => iso($r['reportado_en']), 'estado' => $est,
            'resueltaEn' => iso($est === 'cerrada' ? $r['recibida_en'] : $r['resuelta_en']),
            'resueltaPor' => $r['resuelta_por_nombre'], 'resolucion' => $r['resolucion'],
            '_items' => array_filter([(int) $r['inventory_item_id']]), '_familia' => (int) $r['family_id'],
        ];
    }
    foreach ($sueltas as $n) {
        $lista[] = [
            'origen' => $n['inspection_id'] ? 'revision' : 'modulo', 'id' => (int) $n['id'],
            'inspeccionId' => $n['inspection_id'] !== null ? (int) $n['inspection_id'] : null, 'novedadId' => (int) $n['id'],
            'ambiente' => ['id' => (int) $n['environment_id'], 'codigo' => $n['ambiente_codigo'], 'nombre' => $n['ambiente_nombre']],
            'objetivo' => objetivoNovedad($n), 'itemEstado' => $n['item_estado'],
            'categoria' => categoriaNovedad($n['inventory_item_id'] !== null ? (int) $n['inventory_item_id'] : null,
                $n['family_id'] !== null ? (int) $n['family_id'] : null, $n['ubicacion']),
            'naturaleza' => 'permanente', 'tipoDano' => $n['tipo_dano'], 'severidad' => $n['severidad'],
            'comentario' => $n['descripcion'], 'foto' => $n['foto'], 'usuario' => $n['reportada_por_nombre'],
            'fecha' => iso($n['creada_en']), 'estado' => $n['estado'],
            'resueltaEn' => iso($n['resuelta_en'] ?? $n['anulada_en']), 'resueltaPor' => $n['resuelta_por_nombre'], 'resolucion' => $n['resolucion'],
            '_items' => array_filter([(int) $n['inventory_item_id']]), '_familia' => (int) $n['family_id'],
        ];
    }
    $familiaDelItem = $itemId ? (int) (fila('SELECT family_id FROM inventory_items WHERE id = ?', [$itemId])['family_id'] ?? 0) : 0;
    $lista = array_values(array_filter($lista, function ($x) use ($ambienteId, $itemId, $categoriaId, $familiaDelItem, $naturaleza, $estado) {
        $dia = substr($x['fecha'], 0, 10);
        return (!$ambienteId || $x['ambiente']['id'] === $ambienteId)
            && (!$categoriaId || ($x['categoria']['id'] ?? 0) === $categoriaId)
            && (!$itemId || in_array($itemId, $x['_items'], true) || ($familiaDelItem && $x['_familia'] === $familiaDelItem))
            && (!$naturaleza || $x['naturaleza'] === $naturaleza)
            && (!$estado || $x['estado'] === $estado)
            && (empty($_GET['desde']) || $dia >= $_GET['desde'])
            && (empty($_GET['hasta']) || $dia <= $_GET['hasta']);
    }));
    usort($lista, fn($a, $b) => strcmp($b['fecha'], $a['fecha']));
    responder(array_map(fn($x) => array_diff_key($x, ['_items' => 1, '_familia' => 1]), array_slice($lista, 0, 500)));
}
