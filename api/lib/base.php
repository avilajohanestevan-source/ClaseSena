<?php
/**
 * Núcleo de la API: conexión, respuestas JSON, errores, lectura del
 * cuerpo, sesión por token y utilidades de fechas y archivos.
 * Todas las consultas usan sentencias preparadas.
 */

require_once __DIR__ . '/../config.php';

/** Error de la API: se convierte en {mensaje, codigo} con su status HTTP. */
class ErrorApi extends Exception
{
    public function __construct(public int $status, string $mensaje, public string $codigo = 'ERROR')
    {
        parent::__construct($mensaje);
    }
}

function db(): mysqli
{
    static $conn = null;
    if ($conn) return $conn;
    mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
    try {
        $conn = new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME);
    } catch (mysqli_sql_exception $e) {
        throw new ErrorApi(503, 'No se pudo conectar a la base de datos. Revisa que MySQL esté encendido y que hayas ejecutado db/instalar.php.', 'SIN_BASE_DATOS');
    }
    $conn->set_charset('utf8mb4');
    $conn->query("SET time_zone = '" . date('P') . "'");
    return $conn;
}

/** Ejecuta una consulta preparada. Los tipos se infieren de los valores. */
function consulta(string $sql, array $params = []): mysqli_stmt
{
    $stmt = db()->prepare($sql);
    if ($params) {
        $tipos = '';
        foreach ($params as $p) $tipos .= is_int($p) ? 'i' : (is_float($p) ? 'd' : 's');
        $stmt->bind_param($tipos, ...$params);
    }
    $stmt->execute();
    return $stmt;
}

function filas(string $sql, array $params = []): array
{
    $r = consulta($sql, $params)->get_result();
    return $r ? $r->fetch_all(MYSQLI_ASSOC) : [];
}

function fila(string $sql, array $params = []): ?array
{
    return filas($sql, $params)[0] ?? null;
}

function insertar(string $sql, array $params = []): int
{
    consulta($sql, $params);
    return db()->insert_id;
}

/* ---------------- respuestas ---------------- */

function responder($cuerpo, int $status = 200): never
{
    http_response_code($status);
    if ($status === 204) exit;
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($cuerpo, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function fallar(int $status, string $mensaje, string $codigo = 'ERROR'): never
{
    throw new ErrorApi($status, $mensaje, $codigo);
}

/** Cuerpo JSON de la petición (arreglo vacío si no hay). */
function cuerpo(): array
{
    static $datos = null;
    if ($datos !== null) return $datos;
    $crudo = file_get_contents('php://input');
    if ($crudo === '' || $crudo === false) return $datos = [];
    $datos = json_decode($crudo, true);
    if (!is_array($datos)) fallar(400, 'El cuerpo de la petición no es JSON válido.', 'JSON_INVALIDO');
    return $datos;
}

/** Texto obligatorio/opcional recortado, con largo máximo. */
function texto(array $d, string $campo, int $max, bool $obligatorio = true, string $nombre = ''): ?string
{
    $v = isset($d[$campo]) ? trim((string) $d[$campo]) : '';
    if ($v === '') {
        if ($obligatorio) fallar(422, 'Falta ' . ($nombre ?: $campo) . '.', 'VALIDACION');
        return null;
    }
    if (mb_strlen($v) > $max) fallar(422, ucfirst($nombre ?: $campo) . " admite máximo $max caracteres.", 'VALIDACION');
    return $v;
}

function entero(array $d, string $campo, bool $obligatorio = true): ?int
{
    if (!isset($d[$campo]) || $d[$campo] === '' || $d[$campo] === null) {
        if ($obligatorio) fallar(422, "Falta $campo.", 'VALIDACION');
        return null;
    }
    if (!is_numeric($d[$campo])) fallar(422, "$campo debe ser un número.", 'VALIDACION');
    return (int) $d[$campo];
}

function opcion(array $d, string $campo, array $validas, bool $obligatorio = true, string $nombre = ''): ?string
{
    $v = $d[$campo] ?? null;
    if ($v === null || $v === '') {
        if ($obligatorio) fallar(422, 'Elige ' . ($nombre ?: $campo) . '.', 'VALIDACION');
        return null;
    }
    if (!in_array($v, $validas, true)) fallar(422, ucfirst($nombre ?: $campo) . ' no es válido.', 'VALIDACION');
    return $v;
}

/* ---------------- sesión ---------------- */

function tokenDeLaPeticion(): ?string
{
    $cabeceras = function_exists('getallheaders') ? array_change_key_case(getallheaders(), CASE_LOWER) : [];
    $valor = $cabeceras['authorization'] ?? $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if (preg_match('/^Bearer\s+([a-f0-9]{64})$/i', $valor, $m)) return strtolower($m[1]);
    $alterno = $cabeceras['x-auth-token'] ?? '';
    return preg_match('/^[a-f0-9]{64}$/i', $alterno) ? strtolower($alterno) : null;
}

/** Usuario de la sesión actual o 401. */
function usuario(): array
{
    static $u = null;
    if ($u) return $u;
    $token = tokenDeLaPeticion();
    if (!$token) fallar(401, 'Tu sesión no es válida. Ingresa de nuevo.', 'SIN_SESION');
    $u = fila(
        'SELECT u.* FROM api_tokens t JOIN users u ON u.id = t.user_id
         WHERE t.token = ? AND t.expires_at > NOW() AND u.activo = 1',
        [$token]
    );
    if (!$u) fallar(401, 'Tu sesión venció. Ingresa de nuevo.', 'SIN_SESION');
    return $u;
}

/** Exige uno de los roles; devuelve el usuario. */
function exigirRol(string ...$roles): array
{
    $u = usuario();
    if (!in_array($u['rol'], $roles, true)) fallar(403, 'Tu rol no tiene permiso para esta acción.', 'PERMISO');
    return $u;
}

function usuarioPublico(array $u): array
{
    return [
        'id' => (int) $u['id'],
        'tipoDocumento' => $u['tipo_documento'],
        'identificacion' => $u['documento'],
        'nombre' => $u['nombre'],
        'email' => $u['email'],
        'telefono' => $u['telefono'],
        'rol' => $u['rol'],
        'ficha' => $u['ficha'],
    ];
}

/* ---------------- fechas y archivos ---------------- */

/** DATETIME de MySQL → ISO 8601 con zona (lo que espera el front). */
function iso(?string $v): ?string
{
    return $v ? (new DateTime($v))->format(DATE_ATOM) : null;
}

/** Guarda una imagen enviada como data URL; devuelve la ruta relativa. */
function guardarFoto(string $dataUrl): string
{
    if (!preg_match('#^data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$#', $dataUrl, $m)) {
        fallar(422, 'La foto debe ser una imagen JPG, PNG o WebP.', 'VALIDACION');
    }
    $bytes = base64_decode($m[2], true);
    if ($bytes === false || strlen($bytes) > MAX_FOTO_BYTES) fallar(422, 'La foto supera el tamaño permitido (3 MB).', 'VALIDACION');
    $info = @getimagesizefromstring($bytes);
    if (!$info || !in_array($info['mime'], ['image/jpeg', 'image/png', 'image/webp'], true)) {
        fallar(422, 'El archivo enviado no es una imagen válida.', 'VALIDACION');
    }
    $ext = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'][$info['mime']];
    $carpeta = __DIR__ . '/../../' . CARPETA_FOTOS;
    if (!is_dir($carpeta)) mkdir($carpeta, 0775, true);
    $nombre = date('Ymd') . '-' . bin2hex(random_bytes(8)) . '.' . $ext;
    file_put_contents("$carpeta/$nombre", $bytes);
    return CARPETA_FOTOS . '/' . $nombre;
}

/** Valida una firma (data URL PNG del lienzo). */
function validarFirma($firma): string
{
    if (!is_string($firma) || !preg_match('#^data:image/png;base64,[A-Za-z0-9+/=]+$#', $firma)) {
        fallar(422, 'Falta la firma.', 'VALIDACION');
    }
    if (strlen($firma) > MAX_FIRMA_BYTES) fallar(422, 'La firma es demasiado grande.', 'VALIDACION');
    return $firma;
}

function notificar(int $userId, string $tipo, string $titulo, string $detalle, ?int $inspeccionId): void
{
    insertar(
        'INSERT INTO notifications (user_id, tipo, titulo, detalle, inspection_id, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
        [$userId, $tipo, $titulo, $detalle, $inspeccionId]
    );
}
