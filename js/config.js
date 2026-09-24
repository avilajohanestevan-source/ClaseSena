// Configuración del front de asistencias y ambientes. Todo lo que el
// backend real pueda cambiar (umbrales, tiempos) vive aquí para poder
// ajustarlo sin tocar las vistas.

export const CONFIG = {
  // Backend real (PHP + MySQL de XAMPP, carpeta api/): login, perfil,
  // ambientes, inventario, inspecciones, notificaciones y reportes.
  // Ruta relativa a index.html; Apache entrega el resto en PATH_INFO.
  apiAmbientes: 'api/index.php',
  // Cada cuánto se consulta la bandeja de notificaciones (ms).
  sondeoNotificacionesMs: 15_000,
  // Muestra en el login la lista de usuarios de prueba (quitar en producción).
  mostrarUsuariosDemo: true,

  // Módulos de asistencia (QR de clase, semáforo, P004): siguen con datos
  // simulados mientras no exista su backend.
  // true: las llamadas se resuelven con el servidor simulado (js/api/mock).
  // false: se hacen con fetch contra apiBase (ver API.md).
  usarMock: true,
  apiBase: '/api/v1',
  // Latencia simulada de los mocks, en milisegundos [mínima, máxima].
  latenciaMock: [250, 650],

  // Validez del QR de sesión que ofrece el modal (segundos). El QR se
  // regenera solo cuando vence mientras la ventana siga abierta.
  validecesQr: [30, 60, 120, 300],
  validezQrPorDefecto: 60,

  // Minutos que dura la ventana de registro desde el inicio de la clase si
  // la sesión no trae su propio valor.
  ventanaPorDefectoMin: 15,
  // Después de estos minutos desde el inicio, el registro queda como "tarde"
  // (sigue siendo válido mientras la ventana esté abierta).
  toleranciaTardeMin: 5,
};

// Semáforo de faltas. Cada lista da el mínimo para llegar a amarillo,
// naranja, rojo claro y rojo. El color final es el más grave entre las
// faltas consecutivas y las totales.
export const UMBRALES_SEMAFORO = {
  consecutivas: [1, 2, 3, 4],
  totales:      [2, 4, 6, 8],
};
