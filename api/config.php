<?php
/**
 * Configuración de la API de ambientes (prueba de concepto).
 *
 * En XAMPP estos valores funcionan sin cambios: MySQL en localhost con el
 * usuario root sin contraseña, igual que en sena-php. En un servidor real
 * solo hay que cambiar estas constantes.
 */

define('DB_HOST', 'localhost');
define('DB_USER', 'root');
define('DB_PASS', '');
define('DB_NAME', 'sena_ambientes');

// Horas que dura una sesión iniciada.
define('HORAS_SESION', 12);

// Fotos de daños: carpeta (relativa a la raíz del proyecto) y tamaño máximo.
define('CARPETA_FOTOS', 'uploads/danos');
define('MAX_FOTO_BYTES', 3 * 1024 * 1024);

// Correo de credenciales y códigos de verificación:
//   'registro' → solo queda en la tabla correos (Fichas → Correos enviados), para la demostración;
//   'mail'     → además se envía con mail() de PHP (configura SMTP en php.ini / sendmail de XAMPP).
define('CORREO_MODO', 'registro');
define('CORREO_REMITENTE', 'Ambientes SENA <no-responder@sena.edu.co>');
// Dirección de la app que va en el correo de credenciales.
define('URL_APP', 'http://localhost/sena-ambientes/index.html');

// Asistencia: minutos de tolerancia desde el inicio de la clase antes de registrar "tarde".
define('TOLERANCIA_TARDE_MIN', 5);

date_default_timezone_set('America/Bogota');
