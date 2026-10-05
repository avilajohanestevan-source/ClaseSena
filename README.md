# Ambientes SENA

Prueba de concepto móvil y web para la **entrega y revisión de ambientes**
de formación y la **asistencia a clases** por ficha, con backend real en PHP + MySQL.

- **Entrega y revisión de ambientes** (backend real: PHP + MySQL de XAMPP):
  login por rol, perfiles, CRUD de ambientes (con capacidad de aprendices y
  especialidad) e inventario (categorías, familias de ítems, QR propios),
  revisión del salón por el instructor (checklist, ítems OK y novedades con
  foto), QR de entrega que genera el portero y el instructor escanea para
  recibirlo, novedades permanentes que instructores y administrativos levantan
  y resuelven (en curso hasta su resolución), asignación de instructores por
  jornada, avisos a coordinación, administrativo y almacén, historial de
  auditoría y reportes.
- **Fichas y asistencia** (backend real desde esta versión): fichas con
  importación masiva de aprendices (PhpSpreadsheet), credenciales por correo,
  primer ingreso obligatorio (confirmar correo con código y cambiar la
  contraseña), clases por ficha con QR del instructor, faltas calculadas,
  excusas con foto y periodo de cobertura, semáforo de faltas con listado de
  riesgo, horario del aprendiz con su profesor y P004. El servidor simulado
  (`js/api/mock`) se conserva para las pruebas (`CONFIG.usarMock`).

## Instalar y abrir

1. En el panel de XAMPP enciende **Apache** y **MySQL**.
2. Instala PhpSpreadsheet (carga masiva del inventario desde Excel) con
   [Composer](https://getcomposer.org). Queda en `api/vendor/`, que no va en git:

   ```
   composer install
   ```

3. Crea la base de prueba (borra y recrea `sena_ambientes`). Además de los
   datos de `seed.sql` (especialidades, ambientes 107 a 111, categorías,
   familias PC, novedades permanentes con su historial y asignaciones de
   instructores por jornada), carga
   `db/inventario-prueba.xlsx` con la misma carga masiva de la app: 196 filas
   (monitores, teclados y mouse de cada familia PC, sillas, mesas, la cocina
   del 110 y el kit audiovisual del 111) que crean 4 familias nuevas.

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
| 2020202020 | Administrativo (área administrativo) | Carlos Méndez Ruiz |
| 2020202021 | Administrativo (área coordinación) | Patricia Rondón Gil |
| 2020202022 | Almacén | Hernán Darío Ospina |
| 5050505050 | Instructora nueva (revisiones de inventario pendientes) | Rosa Elena Quintero |
| 1122334455 (TI) | Aprendiz · ficha 2758432 (al día) | Camila Rojas Herrera |
| 1122334456 | Aprendiz · ficha 2758432 (riesgo de deserción) | Mateo Torres Ramírez |
| 1122334457 | Aprendiz · ficha 2834519 | Sara Cárdenas Vega |
| 1122334468 | Aprendiz · ficha 2901122 (riesgo alto) | Natalia Rincón Ortiz |
| 1122334470 | Aprendiz · ficha 2901122 · **primer ingreso pendiente**, contraseña temporal `Temporal2026` | Valentina Ospina Rueda |

Hay 15 aprendices en tres fichas: **2758432** (Análisis y desarrollo de
software, mañana, ambiente 107, líder Laura), **2834519** (Electrónica,
mañana, 109, líder Diana) y **2901122** (Cocina, tarde, 110, líder Andrés),
con cuatro semanas de clases y asistencias para que el semáforo tenga todos
los colores, una excusa aprobada (Daniela) y una pendiente (María José).
Kevin (1122334465) está *aplazado* en el P004 y no puede registrar
asistencia. Justo después de instalar, la ficha 2758432 tiene una clase con la
ventana de registro abierta 30 minutos (para probar el QR enseguida); si ya
pasó, Laura puede **Programar clase** para ahora mismo.

Ambientes con su especialidad y capacidad de aprendices: 107 Sistemas (30),
108 Aula convencional (28), 109 Laboratorio (24), 110 Cocina (20) y 111
Audiovisual (18); hay además la especialidad Axo sin ambiente. Dos
inspecciones de días anteriores y tres novedades permanentes: el aire del 107
(en curso, fuera de servicio), la estación de soldadura del 109 (en curso) y
el ventilador del 108 (resuelta). Asignaciones: 107 mañana Laura (permanente;
mañana la reemplaza Diana ese día), 107 tarde Andrés (periodo), 108 noche
Diana (periodo), 109 mañana Diana (permanente), 110 tarde Andrés (reasignada
desde Laura) y un turno anulado en el 111.

## Flujo de la demostración

1. **Instructor** (1010101010) → *Inspecciones* → elige el ambiente 107 →
   **Ingresé** (se registra la hora de ingreso y empieza la revisión). La cabecera muestra los
   **instructores asignados hoy** en cada jornada (tú resaltado, o un aviso si
   no estás asignado). Las **novedades permanentes en curso** del ambiente
   aparecen arriba y, **resaltadas en amarillo, en su área del checklist** (el
   aire acondicionado en *Aire / ventilación*): no hace falta reportarlas otra
   vez. Desde ahí se abre su detalle e historial, se **adjunta una foto** o, si
   ya funciona, **Ya está en funcionamiento** la marca resuelta; todo queda en
   el historial de la novedad con fecha, usuario, evidencia y la revisión.
   - **Todo está bien** es un atajo: marca en la pantalla el checklist y todos
     los ítems revisables como OK. **No envía nada**, no termina la revisión
     ni escanea ningún QR (se puede deshacer);
   - si algo tiene una novedad, **Escanear ítem o familia** (QR o código de
     barras de la pegatina, o escribe el código, p. ej. `SILLA-107-04` o
     `SENA-FAM:FAM107-PC02`). Con la pegatina de una familia se elige
     **toda la familia** (PC = CPU + monitor + teclado + mouse) o un
     componente. Se toma la **foto de evidencia** y se indica si es
     **permanente** (daño que sigue hasta que lo arreglen), **temporal** o de
     **limpieza**, el tipo, la severidad y un comentario. La permanente queda
     **en curso** desde ese momento (visible en *Novedades*, con aviso a
     coordinación, administrativo y almacén) y deja el ítem *Dañado*; si
     se quita el reporte antes de entregar, queda anulada;
   - si el daño no es de un ítem (pared, techo, piso, puerta…), **Daño del
     salón**: se elige dónde está, con foto, y queda asociado al ambiente.
2. **Terminar revisión** (con el checklist completo): envía el checklist y los
   ítems OK y se avisa al portero. Es el único paso que envía la revisión.
3. **Portero** (4040404040) → *Inspecciones → Por entregar* → **Generar QR
   de entrega**. Aparece un QR grande con "Esperando que el instructor lo
   escanee…".
4. El instructor pulsa **Escanear QR del portero** (en Inicio, Inspecciones
   o la planilla) y lo escanea (o escribe `SENA-INSP:…`).
   **Al revés también sirve:** en la planilla el instructor pulsa **Mostrar mi
   QR de entrega** (`SENA-ENT:…`) y el portero lo lee con **Escanear QR del
   instructor** (en *Inspecciones* o en la planilla). La pantalla del
   instructor cambia sola a "Recibiste el ambiente".
5. Queda guardado quién revisó y recibió (`instructor_id`), quién entregó
   (`portero_id`), con qué QR se cerró (`recibida_via`), las horas de cada paso, el **estado del salón**
   (`estado_salon`: ítems por estado, marcados OK, novedades por naturaleza)
   y los reportes con foto.
6. **Novedades** (instructores y administrativos): las permanentes en curso,
   con su **historial de eventos** (creada, reportada de nuevo, modificada,
   resuelta, anulada) con fecha, usuario y foto. Un instructor también puede
   **levantar** una novedad grave sin revisión (con foto obligatoria), agregar
   **seguimiento** (nota, foto, severidad, dejar el ítem **fuera de
   servicio** o en reparación hasta su arreglo) y **marcarla resuelta** (con
   foto de la reparación). Dar de baja (inactivo) es solo de administrativos.
   **Coordinación, administrativo y almacén** (2020202021, 2020202020 y
   2020202022) reciben los avisos. La pestaña **Historial** tiene todas las
   novedades: equipo o ambiente, fecha, usuario, evidencia, naturaleza,
   estado y fecha de resolución (con CSV).
7. **Instructores asignados** en *Ambientes → Editar ambiente* (administrativo):
   en el mismo formulario se ven las asignaciones por jornada (mañana, tarde,
   noche y **fin de semana**, que solo aplica sábados y domingos) y quién está
   hoy, y se asigna **sin definir** (sin fecha final, opcionalmente solo
   algunos días de la semana), **por semanas** (semana de inicio, número de
   semanas y días de la semana: p. ej. lunes, miércoles y viernes), **por
   días** (uno o varios días sueltos) o **por rango de fechas** (inicio — fin); cada asignación se **edita** o se
   **anula** desde ahí (si ya empezó, cambiar de instructor la reasigna desde
   una fecha y los días anteriores se conservan). Al crear un ambiente, las
   asignaciones que agregues se crean al guardarlo. El tablero de
   **Asignaciones** se ve **por semana** (tabla de ambientes × jornadas) o
   **por mes** (calendario de lunes a domingo; en el celular, la jornada es una
   barra de color con las iniciales del instructor), con **filtro por jornada**
   y por ambiente. Se asigna con los mismos cuatro modos (vale la más
   específica: por días > por semanas o rango > sin definir), y se **reasigna** o **anula** un turno desde una fecha. El
   instructor recibe el aviso y ve el tablero y sus turnos.
8. **Auditoría** (administrativo): todos los eventos de novedades y
   asignaciones (reportes, resoluciones, reasignaciones, anulaciones) con
   fecha, usuario, detalle y evidencia, con filtros y CSV.
9. El administrativo consulta el historial en *Inspecciones* y genera
   **Reportes** (CSV o impresión).

10. **Fichas** (administrativo) → **Importar aprendices** desde Excel o CSV
    (`tipo_documento, documento, nombre, email, telefono`; hay plantilla):
    vista previa con nuevos, actualizados y filas con error; al confirmar,
    cada aprendiz nuevo recibe un correo con su usuario y una **contraseña
    temporal**. Los correos quedan en **Correos enviados** (en la prueba de
    concepto no salen a internet: `CORREO_MODO = 'registro'` en
    `api/config.php`; con `'mail'` se envían con `mail()` de PHP). Desde la
    ficha se reenvían credenciales.
    **Antes de enviar se puede cambiar el correo**: la contraseña temporal
    (generada para cada uno o escrita por ti, la misma para todos en una
    importación), el asunto y el cuerpo, con campos `{nombre}`,
    `{nombre_completo}`, `{tipo_documento}`, `{documento}`, `{rol}`, `{ficha}`,
    `{programa}`, `{clave}` y `{enlace}` (el cuerpo debe incluir `{clave}`),
    con **vista previa** tal como llega. Se puede guardar como plantilla
    (*Plantillas de correo*). El correo trae el botón **Ingresar a Ambientes
    SENA**, que abre la página de ingreso con el rol y el documento ya
    puestos (solo falta la contraseña). En la ficha también se **agrega un
    aprendiz** a mano y se reenvían credenciales con el mismo editor.
11. **Instructores** (administrativo): registrar un instructor (documento,
    nombre, correo, teléfono) con el mismo editor del correo y de la
    contraseña temporal; editarlo, desactivarlo o reenviarle credenciales.
    Ve sus fichas y asignaciones vigentes. También hace el primer ingreso.
12. **Primer ingreso** (Valentina, 1122334470 / `Temporal2026`): la app no
    deja hacer nada más hasta **confirmar el correo** (código de 6 dígitos;
    en modo registro la pantalla muestra el código de demostración) y
    **cambiar la contraseña** temporal. El backend responde
    `403 PRIMER_INGRESO` a cualquier otra ruta.
13. **Asistencia a clases** (instructor) → la clase de hoy → **Generar QR**.
    El aprendiz (Camila) → **Registrar asistencia** → escanea el QR (o pega
    su texto): queda *presente* (o *tarde* después de 5 minutos). Laura ve
    el registro en el modal. **Programar clase** crea otra sesión para una de
    sus fichas.
14. **Excusas**: el aprendiz sube la excusa con **foto** y el **periodo** que
    cubre; el instructor líder de la ficha (o coordinación) la **aprueba** o la
    **rechaza** con motivo. Aprobada, las faltas de esos días quedan
    *justificadas* y no cuentan en el semáforo.
15. **Semáforo de faltas** (administrativo): filtro por **ficha**, ambiente y
    competencia, conteos de faltas consecutivas y totales (las justificadas
    aparte) y **Listado de riesgo** en CSV (naranja, rojo claro y rojo). Cuando
    un aprendiz llega a rojo se avisa a coordinación y a su instructor líder.
16. **Mi horario** (aprendiz): sus clases de las próximas dos semanas con el
    **profesor**, el ambiente y la competencia.

Para volver al estado inicial: `C:\xampp\php\php.exe db\instalar.php`.

## Cuentadante y revisión del inventario

Cada ambiente tiene un **cuentadante**: quien responde por su inventario.
Antes de recibir el inventario hay que **revisarlo ítem por ítem** y
aceptarlo, como un acta de entrega:

- **Al crear un ambiente** (*Ambientes → Nuevo ambiente*) se elige el
  cuentadante (instructor, administrativo o almacén) y, opcionalmente, se sube
  el **Excel con el inventario que tenía** (placa, descripción, serial,
  categoría, valor…; acepta un encabezado arriba de los títulos y sin
  categoría los ítems quedan en *Sin clasificar*). El cuentadante lo revisa y
  queda como cuentadante al aceptarlo.
- **Al cambiar el cuentadante** (*Editar ambiente*) o al **asignar un
  instructor** marcando *Queda como cuentadante*, se abre la misma revisión;
  hasta que la acepte responde el anterior (la tarjeta del ambiente muestra
  *Laura → Rosa (revisando)*).
- **Un instructor asignado por primera vez** al ambiente también revisa el
  inventario: hasta aceptarlo **no puede hacer "Ingresé"** (la entrega diaria
  responde `409 REVISION_INVENTARIO` y la app lo lleva a la revisión).
- La revisión (*Revisión de inventario*, con insignia de pendientes): cada
  ítem **OK**, **Faltante** o **Dañado** (con observación), escaneando la
  pegatina (OK), con **Todo está bien** para los pendientes, o **descargando
  el acta en Excel**, llenando la columna *revision* (OK, FALTANTE, DAÑADO;
  con lista desplegable) y **subiéndola**. *Aceptar inventario* exige todo
  revisado y una observación general si hay faltantes o dañados; los dañados
  pasan a *Dañado*, todo queda en la trazabilidad de cada ítem y se avisa a
  coordinación, administrativo, almacén y al cuentadante anterior.
- **Excel del inventario del cuentadante** en *Editar ambiente*: descargar
  (con el ambiente, el cuentadante, la fecha y el valor total arriba) y volver
  a subir corregido (con vista previa); los ítems nuevos se suman a la
  revisión pendiente. Administrativo y almacén ven todas las revisiones y
  pueden anular una pendiente.

Demostración: **Rosa** (5050505050) tiene pendiente la revisión del **108**
(la asignaron a la tarde) y la del **111** como cuentadante (hoy lo es Laura).

## Inventario, pegatinas y carga masiva

Cada elemento del aula tiene una **pegatina** con su QR y su código de
barras Code 128 (el código solo). El QR lleva el `qr_value` del ítem: por
defecto `SENA-INV:<código>`, o lo que ya traía su placa (`PLACA-SENA-000457`).
Sirve con la cámara del celular y con lectores USB (escriben el código y
pulsan Enter). El código puede ser el consecutivo (`AMB107-012`), uno propio
(`SILLA-107-04`) o el código de barras del fabricante (`7701234500017`).

- **Categorías** (*Inventario → Categorías*, administrativo): Inmuebles,
  Mobiliario, Electrodomésticos, Equipos Informáticos, Periféricos,
  Audiovisual… Se agregan, renombran o desactivan; no se borran si están en uso.
- **Familias** (*Inventario → Familias*): un conjunto que se revisa y se
  reporta junto (Familia PC = monitor + CPU + teclado + mouse; Estación de
  cocina = estufa + campana + mesón). Tiene su propia pegatina
  (`SENA-FAM:<código>`). En la revisión se reporta la familia completa o un
  componente suelto.
- **Carga masiva** (*Inventario → Carga masiva*, administrativo): Excel
  (.xlsx, .xls, .ods) o CSV leídos con PhpSpreadsheet. Columnas `ambiente,
  codigo, nombre, categoria, serial, estado, familia, familia_nombre,
  familia_tipo, qr, valor`. La categoría debe existir; la familia que no exista se
  crea; `qr` llena el `qr_value`. Muestra una vista previa (nuevos,
  actualizados, familias nuevas, sin cambios y filas con error) antes de
  guardar. Si el código ya existe se actualiza; sin código se reconoce el
  ítem por serial o ambiente + nombre, así que subir el mismo archivo dos
  veces no duplica nada. *Exportar Excel* descarga el inventario con el mismo
  formato (sirve de plantilla). La API también la recibe por
  `multipart/form-data` en `/inventory/import`.
- **Registrar con escáner** (administrativo): se eligen ambiente, nombre base,
  categoría y familia; cada pegatina leída **crea** el ítem al instante
  (*Silla #31, #32…*) o, si ya existía, lo **actualiza**: lo traslada a este
  ambiente, lo asigna a la familia y anota el escaneo.
- **Escanear** (todo el personal): abre el ítem o la familia con su pegatina,
  estado y **trazabilidad** (registro, carga, traslados, familias, pegatinas,
  novedades con enlace a la planilla).
- **Reimprimir pegatina** desde el detalle del ítem o de la familia, o la hoja
  completa del ambiente (*Pegatinas*, con filtro por categoría y familias).
  Cada impresión queda en la trazabilidad.
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
- **Perfil:** un solo acceso, la tarjeta con el **nombre y el rol** de la
  cabecera del menú (no hay ítem *Mi perfil* repetido). La página muestra solo
  nombre y rol, y permite cambiar la contraseña.
- Ítems según el rol, indicador animado de la sección actual, insignias
  (revisiones por entregar o en proceso), foco atrapado mientras está abierto
  y áreas táctiles de 44 px.

| Sección | Instructor | Portero | Administrativo | Aprendiz |
|---|---|---|---|---|
| Inicio, Ambientes, Ajustes | ✓ | ✓ | ✓ (CRUD de ambientes y especialidades) | ✓ |
| Inspecciones | Revisar, reportar novedades (ítem, familia o salón) y escanear el QR | Generar y mostrar el QR de entrega | Historial | — |
| Inventario | Consulta y QR | Consulta y QR | CRUD, categorías y familias | — |
| Novedades | Levantar, seguimiento, resolver, historial | — | Lo mismo + dar de baja; filtro por categoría | — |
| Asignaciones | Tablero y mis turnos | — | Asignar, reasignar y anular por jornada | — |
| Auditoría | — | — | Eventos de novedades y asignaciones | — |
| Reportes | — | — | ✓ | — |
| Fichas | Las suyas (consulta) | — | Crear, importar o agregar aprendices, credenciales con correo editable, plantillas, correos | — |
| Instructores | — | — | Registrar, editar, desactivar, credenciales con correo editable | — |
| Asistencia | Clases (QR, programar), excusas, historial | — | Semáforo y riesgo, excusas, P004, historial | Mi horario, registrar asistencia, excusas |

### Rol Almacén

**Almacén** (2020202022) es un rol propio (antes era un administrativo del
área inventario): ve y gestiona **todos los artículos** (crear, editar,
trasladar, dejar *fuera de servicio* o *de baja* = inactivo), las
**categorías** y las **familias**, la **carga masiva**, el **registro con
escáner** (si el código leído no existe, se crea el artículo al escanearlo) y
la **impresión y reimpresión** de pegatinas con QR y código de barras. Recibe
los avisos de novedades igual que coordinación y administrativo, y puede darles
seguimiento y resolverlas. No revisa ni entrega ambientes ni edita ambientes o
asignaciones. Su menú: Inicio, Ambientes, Inventario, Novedades y Ajustes.

Las novedades (en curso e historial) se **filtran por categoría** del
inventario: la del ítem, la del primer componente de la familia o
*Inmuebles* si es un daño del salón. La categoría también sale en el CSV.

## Estructura

```
index.html              Página única (enrutador por hash)
API.md                  Contratos: asistencia (simulada) y entrega de ambientes (real)
api/                    Backend PHP: index.php (rutas), config.php, lib/ (base, correo), modulos/ (catalogos, ambientes,
                        inventario, familias, carga con PhpSpreadsheet, inspecciones, novedades, asignaciones, auditoria,
                        notificaciones, reportes, fichas, asistencia)
api/vendor/             PhpSpreadsheet (composer install; no va en git)
composer.json           Dependencias PHP
db/                     schema.sql, seed.sql, asistencia-prueba.php, inventario-prueba.xlsx e instalar.php (datos de prueba)
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
npm run test:api   # entrega (en los dos sentidos del QR), inventario, almacén, novedades, asignaciones, fichas, primer ingreso, asistencia y excusas contra la API real
```

`test:api` deja datos nuevos en la base; vuelve a correr `db\instalar.php`
para limpiar.

## Diseño

El login tiene **dos diseños** que se alternan con el botón *Clásico / Manual
SENA* de la esquina superior (se recuerda en cada dispositivo):

- **Clásico:** trazos finos y retícula de puntos del prototipo, piezas verde
  y azul.
- **Manual SENA:** textura principal del manual de identidad (ondas de
  líneas finas, generada con `node scripts/generar-texturas.mjs`), línea
  delgada entre el logo y el nombre del sistema y la **paleta principal**:
  verde institucional `#39A900` y blanco (con transparencias del mismo
  verde) y neutros para el texto. Las dos piezas conservan sus colores
  originales (verde y azul).

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
