# Asistencia y ambientes SENA (front-end)

Front-end para el control de asistencia a clases y la gestión de ambientes
de formación: login por rol, QR dinámico por sesión con ventana horaria,
escaneo desde el celular, semáforo de faltas, gestión P004, inventario por
ambiente con códigos de barras y reporte fotográfico de daños.

Es **solo front-end**: no hay backend ni base de datos. Las llamadas a la
API las responde un servidor simulado en memoria (se reinicia al recargar
la página). Los contratos que debe cumplir el backend real están en
[API.md](API.md); para conectarlo basta poner `usarMock: false` en
`js/config.js`.

## Abrirlo

Es HTML y JavaScript sin build; necesita servirse por HTTP (los módulos ES
no cargan con `file://`). Con XAMPP:
`http://localhost/sena-ambientes/index.html`.

Usuarios de prueba (contraseña `Sena2026*`, también listados en el login):

| Identificación | Rol |
|---|---|
| 1010101010 | Instructor |
| 2020202020 | Administrativo |
| 1122334455 | Aprendiz |
| 3030303030 | Instructor con cuenta bloqueada (prueba de errores) |

Flujo de prueba sin cámara: como instructor, "Generar QR" en la clase con
ventana abierta; sal y entra como aprendiz y usa "Usar el último QR
generado (demo)". También se puede subir una foto del QR o de la etiqueta
de un activo (el detalle del activo muestra su código de barras).

La cámara solo funciona en `localhost` o con HTTPS; desde el celular por
IP de la red local hay que usar las alternativas (subir foto o escribir el
código).

## Estructura

```
index.html              Página única (enrutador por hash)
API.md                  Contratos de la API
css/tokens.css          Tokens de diseño (copia de diseno/tokens.css)
css/sena-base.css       Identidad visual SENA (copia del estilo de sena-php)
css/ambientes.css       Estilos propios del módulo
css/movil.css           Rediseño móvil v1 (se carga al final y sobrescribe)
diseno/                 Prototipo, guía de diseño, tokens.json y assets SVG
img/                    Logos SENA y piezas del fondo del login (img/fondo/)
js/config.js            Modo mock, tiempos del QR y umbrales del semáforo
js/reglas.js            Reglas puras: ventana horaria, QR, semáforo, P004, daños
js/api/contratos.js     Funciones de la API que usan las vistas
js/api/cliente.js       fetch real o servidor simulado según CONFIG.usarMock
js/api/mock/            Datos de prueba y servidor simulado
js/ui/                  Componentes: escáner, cámara, toasts, modales, animaciones
js/vistas/              Login, instructor, administrativo, P004, aprendiz,
                        inventario, daños e historial
vendor/                 Librerías (GSAP, ZXing, jsQR, qrcode.js)
tests/                  Pruebas (npm test)
```

## Rediseño móvil v1

La aplicación está pensada primero para el celular:

- **Login** sobre fondo blanco: dos piezas decorativas (verde y azul
  institucional) ancladas a las esquinas de la tarjeta, selector de rol
  segmentado y campos con etiqueta flotante. Al validar, la tarjeta hace
  un micro-rebote y las piezas salen de la pantalla (750 ms, in-out
  cúbico) antes de entrar al panel.
- **Navegación inferior** fija en móvil (etiquetas cortas); desde 900 px
  vuelve a ser una barra de pestañas bajo la cabecera.
- **Panel administrativo simplificado**: saludo, 4 indicadores con
  contador, alertas, notificaciones y el semáforo con barra de
  distribución y filtros plegables.
- Toasts desde arriba, modales como hoja inferior, campos de 16 px (sin
  zoom en iOS), áreas táctiles de 44 px y tablas con la primera columna fija.

Todo el estilo nuevo está en `css/movil.css` y solo usa los tokens de
`css/tokens.css`. La guía (tokens, estados de componentes, tiempos de
animación, contraste AA) está en `diseno/guia.html`.

## Librerías

GSAP y ZXing se instalan con npm y se copian a `vendor/`, que sí va en el
repositorio (no hace falta build ni CDN):

```
npm install      # descarga GSAP y ZXing en node_modules/
npm run vendor   # copia las versiones minificadas a vendor/
npm test         # pruebas de reglas, mocks y códigos de barras
```

- **GSAP** (`vendor/gsap/`): animaciones. Desde la versión 3.13 todos sus
  plugins son gratuitos, también para uso comercial: ScrollTrigger,
  SplitText, MorphSVG, DrawSVG, MotionPath, Flip, Draggable, Inertia,
  Physics2D, ScrambleText, CustomEase, etc. Todos quedan copiados; la página
  carga por ahora el núcleo, CustomEase, DrawSVG y Flip, y todo el
  movimiento pasa por `js/ui/anim.js` (respeta "reducir movimiento").
- **ZXing** (`vendor/zxing/`): lectura de códigos de barras cuando el
  navegador no trae `BarcodeDetector`.
- **jsQR** y **qrcode.js** (`vendor/qr/`): leer y dibujar los QR.
