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
define('MAX_FIRMA_BYTES', 400 * 1024);

date_default_timezone_set('America/Bogota');
