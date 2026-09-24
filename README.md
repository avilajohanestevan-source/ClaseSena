# Ambientes SENA

Prueba de concepto móvil y web para la **entrega y revisión de ambientes**
de formación, más el módulo de **asistencia a clases** que ya existía.

- **Entrega y revisión de ambientes** (backend real: PHP + MySQL de XAMPP):
  login por rol, perfiles, CRUD de ambientes e inventario, revisión del
  salón por el instructor (checklist y daños con foto de evidencia), QR de
  entrega que genera el portero y el instructor escanea para recibirlo,
  avisos a coordinación y reportes.
- **Asistencia a clases** (QR de clase, semáforo de faltas, P004): sigue
  con datos simulados en el navegador (`js/api/mock`), como antes.

## Instalar y abrir

1. En el panel de XAMPP enciende **Apache** y **MySQL**.
2. Instala PhpSpreadsheet (carga masiva del inventario desde Excel) con
   [Composer](https://getcomposer.org). Queda en `api/vendor/`, que no va en git:

   ```
   composer install
   ```

3. Crea la base de prueba (borra y recrea `sena_ambientes`). Además de los
   datos de `seed.sql`, carga `db/inventario-prueba.xlsx` con la misma carga
   masiva de la app: 174 elementos con su código (computadores, monitores,
   teclados, mouse, sillas, mesas…).

   ```
   C:\xampp\php\php.exe db\instalar.php
   ```

   Sin consola: en phpMyAdmin importa `db/schema.sql` y luego `db/seed.sql`, y
   sube `db/inventario-prueba.xlsx` en *Inventario → Carga masiva*.
4. Abre `http://localhost/sena-ambientes/index.html`.

Si después de actualizar aparece un error como *"does not provide an export named…"*,
el navegador guardó una versión vieja de algún archivo: recarga con
**Ctrl + F5** una vez. El `.htaccess` de la raíz ya obliga a revalidar JS, CSS
y HTML, así que no debería repetirse.

La conexión está en `api/config.php` (por defecto `root` sin contraseña,
igual que sena-php). La cámara solo funciona en `localhost` o con HTTPS;
desde el celular por la IP de la red local usa las alternativas: subir una
foto del código o escribirlo.

### Usuarios de prueba

Contraseña de todos: `Sena2026*` (también se pueden elegir en el login).
El rol se elige en el desplegable *Ingresar como* (`js/ui/selector-rol.js`),
que también funciona con el teclado.

| Documento | Rol | Nombre |
|---|---|---|
| 1010101010 | Instructor | Laura Gómez Patiño |
| 1010101011 | Instructor | Andrés Felipe Castro |
| 1010101012 | Instructor | Diana Marcela Ruiz |
| 4040404040 | Portero (ambientes 107 y 108) | Jorge Enrique Salazar |
| 4040404041 | Portero (ambiente 109) | Martha Lucía Peña |
| 2020202020 | Administrativo | Carlos Méndez Ruiz |
| 1122334455 (TI) | Aprendiz | Camila Rojas Herrera |
| 1122334456 | Aprendiz | Mateo Torres Ramírez |
| 1122334457 | Aprendiz | Sara Cárdenas Vega |

Ambientes 107, 108 y 109 con 10 ítems cada uno y dos inspecciones de días
anteriores para que los reportes tengan datos.

## Flujo de la demostración

1. **Instructor** (1010101010) → *Inspecciones* → elige el ambiente 107 →
   **Iniciar revisión** (se registra la hora). Al entrar al salón:
   - si todo está en orden, **Todo está bien** marca el ambiente completo y
     termina, sin revisar ítem por ítem;
   - si algo está dañado (mouse, teclado, silla, mesa, computador…),
     **Escanear ítem dañado** (QR o código de barras de la pegatina, o
     escribe el código, p. ej. `SILLA-107-04`), toma la **foto de evidencia**
     y llena tipo, severidad y comentario. El ítem queda *Dañado* en el
     inventario y en su trazabilidad;
   - si el daño no es de un ítem (pared, techo, piso, puerta…), **Daño del
     salón**: se elige dónde está, con foto, y queda asociado al ambiente.
2. **Terminar revisión** (con el checklist completo): se avisa al portero.
3. **Portero** (4040404040) → *Inspecciones → Por entregar* → **Generar QR
   de entrega**. Aparece un QR grande con "Esperando que el instructor lo
   escanee…".
4. El instructor pulsa **Escanear QR del portero** (en Inicio, Inspecciones
   o la planilla) y lo escanea (o escribe `SENA-INSP:…`).
5. Queda guardado automáticamente quién revisó y recibió (`instructor_id`),
   quién entregó (`portero_id`), las horas de cada paso, el checklist y los
   daños con foto. La pantalla del portero cambia sola a **"Ambiente
   entregado"**.
6. Si había daños o novedades, **coordinación e inventario** (administrativo
   2020202020) reciben la notificación con los códigos que pasaron a
   *Dañado* y los daños del salón; el inventario ya muestra los ítems dañados.
7. El administrativo consulta el historial en *Inspecciones* y genera
   **Reportes** (CSV o impresión).

Para volver al estado inicial: `C:\xampp\php\php.exe db\instalar.php`.

## Inventario, pegatinas y carga masiva

Cada elemento del aula tiene una **pegatina** con su código en QR
(`SENA-INV:<código>`) y en código de barras Code 128 (el código solo). Sirve
con la cámara del celular y con lectores USB (escriben el código y pulsan
Enter). El código puede ser el consecutivo (`AMB107-012`), uno propio
(`SILLA-107-04`) o el código de barras del fabricante (`7701234500017`).

- **Carga masiva** (*Inventario → Carga masiva*, administrativo): Excel
  (.xlsx, .xls, .ods) o CSV leídos con PhpSpreadsheet. Columnas `ambiente,
  codigo, nombre, categoria, serial, estado`. Muestra una vista previa
  (nuevos, actualizados, sin cambios y filas con error) antes de guardar.
  Si el código ya existe se actualiza; sin código se reconoce el ítem por
  serial o ambiente + nombre, así que subir el mismo archivo dos veces no
  duplica nada. *Exportar Excel* descarga el inventario con el mismo formato
  (sirve de plantilla).
- **Registrar con escáner** (administrativo): se eligen ambiente, nombre base
  y categoría; cada pegatina leída se registra al instante (*Silla #31,
  #32…*). Si ya existía, lo avisa.
- **Escanear** (todo el personal): abre el ítem con su pegatina, estado y
  **trazabilidad** (registro, carga, ediciones, pegatinas impresas, daños con
  enlace a la planilla).
- **Reimprimir pegatina** desde el detalle del ítem, o la hoja completa del
  ambiente (*Pegatinas*, con filtro por categoría). Cada impresión queda en
  la trazabilidad.
- `db/inventario-prueba.xlsx` se genera con
  `php scripts/generar-inventario-prueba.php`.

## Menú lateral

`js/ui/drawer.js` + `css/shell.css`, con el comportamiento del prototipo
(`diseno/prototipo.html`):

- **Escritorio (≥ 900 px):** persistente a la izquierda (256 px). La
  hamburguesa lo pliega a un riel de íconos (76 px) y se recuerda.
- **Móvil:** la hamburguesa de la esquina superior lo abre (min(280 px,
  86 vw), 320 ms, out-cúbico) con un velo. También se abre deslizando desde
  el borde izquierdo y se cierra deslizando a la izquierda, tocando el velo,
  con Escape o al elegir una sección.
- Al **cerrar sesión** el panel se desvanece y el menú sale por la izquierda;
  en el login las dos piezas del fondo regresan y la tarjeta sube con un
  micro-rebote (inverso de la animación de ingreso).
- Ítems según el rol, indicador animado de la sección actual, insignias
  (revisiones por entregar o en proceso), foco atrapado mientras está abierto
  y áreas táctiles de 44 px.

| Sección | Instructor | Portero | Administrativo | Aprendiz |
|---|---|---|---|---|
| Inicio, Mi perfil, Ambientes, Ajustes | ✓ | ✓ | ✓ (CRUD de ambientes) | ✓ |
| Inspecciones | Revisar, reportar daños y escanear el QR | Generar y mostrar el QR de entrega | Historial | — |
| Inventario | Consulta y QR | Consulta y QR | CRUD | — |
| Reportes | — | — | ✓ | — |
| Asistencia (datos simulados) | Clases, historial | — | Semáforo, P004, historial | Registrar asistencia |

## Estructura

```
index.html              Página única (enrutador por hash)
API.md                  Contratos: asistencia (simulada) y entrega de ambientes (real)
api/                    Backend PHP: index.php (rutas), config.php, lib/, modulos/ (carga.php: PhpSpreadsheet)
api/vendor/             PhpSpreadsheet (composer install; no va en git)
composer.json           Dependencias PHP
db/                     schema.sql, seed.sql, inventario-prueba.xlsx e instalar.php (datos de prueba)
scripts/                vendor.mjs (librerías JS) y generar-inventario-prueba.php
uploads/danos/          Fotos de daños subidas (no va en git)
css/tokens.css          Tokens de diseño (copia de diseno/tokens.css)
css/sena-base.css       Identidad visual SENA (copia del estilo de sena-php)
css/ambientes.css       Estilos del módulo de asistencia
css/movil.css           Rediseño móvil v1 (login, botones, campos, modales)
css/shell.css           Menú lateral, barra superior, preferencias e impresión
css/modulos.css         Vistas de ambientes, inspección, planilla y reportes
diseno/                 Prototipo, guía de diseño, tokens.json y assets SVG
js/config.js            Rutas de las APIs, sondeo de notificaciones y ajustes del mock
js/reglas.js            Reglas puras (login, QR, semáforo, P004, daños, checklist)
js/api/ambientes.js     Funciones del backend real (entrega y revisión de ambientes)
js/api/contratos.js     Funciones de la API de asistencia
js/api/cliente.js       fetch al backend real y al servidor simulado
js/api/mock/            Datos de prueba y servidor simulado de asistencia
js/ui/                  Menú lateral, bandeja, selector de rol, recepción con QR, escáner, cámara, avisos, animaciones
js/vistas/              Una vista por ruta
vendor/                 Librerías (GSAP, ZXing, jsQR, qrcode.js)
tests/                  Pruebas (npm test y npm run test:api)
```

## Pruebas

```
npm test           # reglas, servidor simulado y códigos de barras
npm run test:api   # flujo de entrega, carga masiva, escáner, pegatinas y daños del salón contra la API real
```

`test:api` deja datos nuevos en la base; vuelve a correr `db\instalar.php`
para limpiar.

## Diseño

Mobile-first, fondo blanco y colores, logo y tipografías del manual de
identidad SENA. Tokens en `css/tokens.css` (fuente: `diseno/tokens.json`) y
guía de handoff en `diseno/guia.html` (estados de componentes, tiempos de
animación, contraste AA). En *Ajustes* cada usuario puede agrandar el texto,
reducir las animaciones o plegar el menú; se guarda solo en su dispositivo.

## Librerías

GSAP y ZXing se instalan con npm y se copian a `vendor/`, que sí va en el
repositorio (no hace falta build ni CDN):

```
npm install      # descarga GSAP y ZXing en node_modules/
npm run vendor   # copia las versiones minificadas a vendor/
```

- **GSAP** (`vendor/gsap/`): animaciones. Todo el movimiento pasa por
  `js/ui/anim.js` y respeta "reducir movimiento".
- **ZXing** (`vendor/zxing/`): lectura de códigos de barras cuando el
  navegador no trae `BarcodeDetector`.
- **jsQR** y **qrcode.js** (`vendor/qr/`): leer y dibujar los QR.
