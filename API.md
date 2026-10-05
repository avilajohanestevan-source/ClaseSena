# Contratos de API — Asistencia y ambientes

Hay dos APIs:

1. **Asistencia a clases** (esta primera parte): implementada en
   `api/modulos/asistencia.php` con estos mismos contratos, en el mismo
   backend y con la misma sesión que el resto (`CONFIG.usarMock = false`).
   Con `CONFIG.usarMock = true` los responde el servidor simulado de
   `js/api/mock/servidor.js` (lo usan las pruebas de `npm test`). Los ids
   del backend real son números.
2. **Entrega y revisión de ambientes** (sección al final): ya implementada
   en PHP + MySQL en `api/`. El inventario y los daños de ambientes viven
   ahí; la versión simulada anterior se retiró.

Asistencia a clases:

- Base: `api/index.php` (`CONFIG.apiBase`), igual que la segunda parte.
- Formato: JSON. Fechas en ISO 8601 (UTC).
- Autenticación: `Authorization: Bearer <token>` en todo excepto el login.
- Errores: `{ "mensaje": "texto para el usuario", "codigo": "CODIGO" }` con
  el status HTTP correspondiente. El front muestra `mensaje` tal cual.

## Autenticación

| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| POST | `/auth/login` | `{ tipoDocumento?, identificacion, password, rol }` | `{ token, usuario }` |
| POST | `/auth/logout` | — | `204` |

`usuario`: `{ id, identificacion, nombre, rol, ficha?, debeCambiarPassword, emailVerificado }`.
`rol` ∈ `instructor | administrativo | portero | aprendiz | almacen`.
`tipoDocumento` (opcional) ∈ `CC | TI | CE | PPT`; lo envía el login desde el
rediseño móvil v1. El servidor simulado lo ignora.

Errores: `401 CREDENCIALES`, `403 ROL` (el usuario no tiene ese rol),
`423 BLOQUEADA`.

## Catálogos

`GET /catalogs` → `{ ambientes: [{id, nombre, sede}], competencias: [{id, nombre}], fichas: [{ficha, programa, ambienteId}] }`

## Sesiones de clase

| Método | Ruta | Parámetros / cuerpo | Respuesta |
|---|---|---|---|
| GET | `/sessions` | `?instructorId&ficha&fecha=yyyy-mm-dd` | `Sesion[]` |
| POST | `/sessions/{id}/qr` | `{ validezSeg }` | `{ payload, texto }` |
| POST | `/sessions/{id}/cancel` | `{ motivo }` | `Sesion` |
| GET | `/sessions/{id}/attendance` | — | `Asistencia[]` |

`Sesion`: `{ id, ficha, programa, competenciaId, competencia, ambienteId,
ambiente, instructorId, instructor, startTime, endTime, ventanaMin,
cancelada, motivoCancelacion?, inscritos, registrados }`.

**QR.** `payload` = `{ sessionId, startTime, expiryTime, nonce }`. El texto
del QR es `SENA-ASIS:` + `JSON.stringify(payload)`. El servidor guarda los
`nonce` emitidos para rechazar QR fabricados, y `expiryTime` nunca pasa del
cierre de la ventana. Errores: `409 CANCELADA`, `409 FUERA_DE_VENTANA`,
`409 PENDIENTE`, `404 NO_EXISTE`.

**Cancelar.** Marca la sesión, deshabilita QR y registro, y crea una
notificación `clase-cancelada` para el rol administrativo. Errores:
`409 YA_CANCELADA`, `422 VALIDACION` (motivo de menos de 5 caracteres).

## Asistencia

`POST /attendance/scan`

```json
{ "payload": { "sessionId": "…", "startTime": "…", "expiryTime": "…", "nonce": "…" },
  "aprendizId": "…", "scannedAt": "2026-09-21T13:04:10.000Z" }
```

Respuesta `200` siempre que la petición sea válida; el resultado va en el cuerpo:

```json
{ "resultado": "aceptado", "estado": "presente | tarde", "registro": { … }, "motivo": "solo si es tarde" }
{ "resultado": "falla", "codigo": "QR_VENCIDO", "motivo": "El QR ya venció…" }
```

Códigos de falla: `QR_INVALIDO`, `QR_VENCIDO`, `CANCELADA`,
`FUERA_DE_VENTANA`, `NO_INSCRITO`, `P004` (estado académico inactivo),
`DUPLICADO`. Llegar después de `CONFIG.toleranciaTardeMin` desde el inicio
registra `tarde`.

`GET /attendance?desde&hasta&ficha&ambienteId&competenciaId&aprendizId` →
`Asistencia[]`. Con rol aprendiz el servidor ignora `aprendizId` y usa el
del token.

`Asistencia`: `{ id, sessionId, aprendizId, documento, aprendiz, ficha,
competenciaId, competencia, ambienteId, ambiente, fecha, hora?, estado }`,
`estado` ∈ `presente | tarde | falla | cancelada`.

## Semáforo y notificaciones

`GET /students/absences?ambienteId&competenciaId&fecha` →

```json
[{ "aprendizId": "…", "documento": "…", "nombre": "…", "ficha": "…",
   "faltasConsecutivas": 2, "faltasTotales": 5, "sesiones": 10, "ultimaFalta": "…" }]
```

La API solo entrega los conteos; **el color se calcula en el front**
(`calcularSemaforo` en `js/reglas.js`) con los umbrales de
`UMBRALES_SEMAFORO` en `js/config.js`: se toma el nivel más grave entre las
faltas consecutivas y las totales.

| Color | Consecutivas | Totales |
|---|---|---|
| Verde | 0 | 0–1 |
| Amarillo | 1 | 2–3 |
| Naranja | 2 | 4–5 |
| Rojo claro | 3 | 6–7 |
| Rojo | 4 o más | 8 o más |

`GET /notifications` → `[{ id, tipo, titulo, detalle, fecha, leida }]`,
`tipo` ∈ `clase-cancelada | dano-grave | riesgo | p004`.
`POST /notifications/{id}/read` → `204`.

## Programar clases, horario y excusas (backend real)

| Método | Ruta | Rol | Notas |
|---|---|---|---|
| POST | `/sessions` | instructor (sus fichas), administrativo | `{fichaId \| ficha, competenciaId \| competencia (nombre; si no existe se crea), ambienteId? (el de la ficha), fecha, horaInicio, horaFin, ventanaMin? (5–60, 15), instructorId? (administrativo)}` → `Sesion`. Días pasados → `422`; cruce con otra clase de la ficha → `409 DUPLICADO` |
| GET | `/my/schedule?dias=14` | aprendiz | `{ficha, clases: [Sesion + miRegistro]}`: horario con profesor y ambiente |
| GET | `/excuses?estado&ficha` | aprendiz (las suyas), instructor (sus fichas), administrativo | `[{id, aprendiz, ficha, desde, hasta, motivo, foto, estado, revisadaPor, revisadaEn, observacion, creadaEn, clasesCubiertas}]` |
| POST | `/excuses` | aprendiz | `{desde, hasta, motivo (10+), foto}` → `pendiente`. Máximo 31 días, desde los últimos 30. Avisa al instructor líder y a coordinación. Cruce con otra excusa → `409` |
| POST | `/excuses/{id}/review` | instructor de la ficha, administrativo | `{estado: aprobada \| rechazada, observacion (obligatoria al rechazar)}`. Avisa al aprendiz |

**Faltas.** No se guardan: una clase no cancelada cuya ventana ya cerró, sin
registro del aprendiz, es `falla`; si una excusa aprobada cubre ese día es
`justificada` (estado nuevo en `Asistencia`). Las justificadas no suman ni
rompen la racha de consecutivas. `/students/absences` acepta además `ficha`
y trae `justificadas` y `excusasPendientes`; cuando un aprendiz llega a rojo
se avisa (`riesgo`) a coordinación y al instructor líder, una vez por semana.
Un aprendiz importado después de una clase no tiene falla en ella.

## P004

| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| GET | `/p004` | — | `RegistroP004[]` |
| POST | `/p004/import` | `{ registros: RegistroP004[] }` | `{ importados, total }` |
| PATCH | `/p004/{documento}` | `{ estado }` | `RegistroP004` |

`RegistroP004`: `{ documento, nombre, ficha, programa, estado,
actualizadoPor?, actualizadoEn? }`. Estados: `EN FORMACION`,
`CONDICIONADO`, `APLAZADO`, `TRASLADADO`, `RETIRO VOLUNTARIO`, `CANCELADO`,
`POR CERTIFICAR`, `CERTIFICADO`. El front valida el archivo antes de enviar
(campos obligatorios, documento de 6 a 12 dígitos, ficha de 5 a 8 dígitos,
estado conocido, sin documentos repetidos) y solo manda las filas válidas.
El servidor registra quién hizo el cambio a partir del token.

---

# Entrega y revisión de ambientes (API real)

Implementada en `api/` (PHP 8 + MySQL/MariaDB de XAMPP, `mysqli` con
sentencias preparadas). Base de datos `sena_ambientes`: `db/schema.sql`,
datos de prueba en `db/seed.sql`, instalación con `php db/instalar.php`.

- Base: `api/index.php` relativa a `index.html` (`CONFIG.apiAmbientes`);
  la ruta va en PATH_INFO, p. ej. `api/index.php/inspections/3`.
- Fechas: ISO 8601 con zona (`2026-09-24T07:05:00-05:00`, America/Bogota).
- Autenticación: `Authorization: Bearer <token>` (64 hex, dura 12 h).
- Errores: `{ mensaje, codigo }` — `401 SIN_SESION`, `403 PERMISO`,
  `404 NO_ENCONTRADO`, `409 ESTADO|EN_CURSO|DUPLICADO|EN_USO`,
  `422 VALIDACION|CHECKLIST_INCOMPLETO|OTRO_AMBIENTE`, `503 SIN_BASE_DATOS`.

## Tablas

| Tabla | Contenido |
|---|---|
| `users` | documento, tipo, nombre, contacto, `rol` (instructor, administrativo, portero, aprendiz, **almacen**), `area` de los administrativos (`coordinacion`, `administrativo`), ficha, `password_hash` |
| `api_tokens` | sesiones |
| `especialidades_ambiente` | Cocina, Laboratorio, Audiovisual, Axo, Sistemas, Aula convencional… (`nombre`, `descripcion`, `activo`) |
| `environments` | `codigo` (107…), nombre, **`capacidad_aprendices`** (antes `capacidad` en puestos), **`especialidad_id`**, `portero_id` asignado, activo |
| `inventory_categories` | Inmuebles, Mobiliario, Electrodomésticos, Equipos Informáticos, Periféricos, Audiovisual, Redes, Laboratorio, Herramientas, Utensilios de cocina, Seguridad |
| `item_families` | familias de ítems por ambiente: `codigo` (FAM107-PC01, va en el QR `SENA-FAM:<codigo>`), `tipo` (PC, Estación de cocina…), `nombre` |
| `inventory_items` | ítems por ambiente; `codigo` único (código de barras), **`qr_value`** único (contenido del QR; por defecto `SENA-INV:<codigo>`), `category_id`, `family_id`, estado (`operativo`, `danado`, `en_reparacion`, `fuera_servicio`, `baja` = inactivo), `ultimo_escaneo_en` |
| `item_history` | trazabilidad de cada ítem: `registro`, `carga_masiva`, `escaneo`, `traslado`, `edicion`, `etiqueta`, `familia`, `dano`, `dano_retirado`, `novedad`, `novedad_resuelta`, `estado`, con usuario, detalle, revisión y novedad |
| `inspections` | `environment_id`, `instructor_id` (revisa y recibe), `portero_id` (entrega), estado, resultado, `qr_token`, checklist (JSON), **`items_ok`** (ítems marcados OK), **`estado_salon`** (JSON guardado al recibir), observaciones, horas de cada paso, nombres de quien entregó y recibió |
| `inspection_items` | novedad reportada: `inspection_id` → `inventory_item_id`, **`family_id`** (familia completa) o `ubicacion` del salón; **`naturaleza`** (`permanente`, `temporal`, `limpieza`), tipo, severidad, comentario, foto, `persistent_issue_id` |
| `persistent_issues` | novedades permanentes: ambiente, ítem / familia / ubicación, tipo, severidad, descripción, foto, `estado` (`en_curso`, `resuelta`, `anulada`), quién la reportó y en qué revisión, `resuelta_por`, `resuelta_en`, `resolucion`, `foto_resolucion`, `anulada_en` |
| `instructor_assignments` | asignación de instructores: ambiente, instructor, `jornada` (`manana`, `tarde`, `noche`, `fin_semana`), `tipo` (`dia`, `periodo`, `permanente`), `fecha_inicio`, `fecha_fin` (NULL = permanente), `dias_semana` ("1,3,5"; NULL = todos), `estado` (`vigente`, `reasignada`, `anulada`), motivo, `reemplaza_id`, quién la creó y quién la cerró |
| `audit_events` | historial para auditoría: `entidad` (`novedad`, `asignacion`), `entidad_id`, ambiente, `accion`, detalle, `foto` (evidencia), `datos` (antes/después), usuario y fecha |
| `notifications` | `revision_lista` (al portero: genera el QR), `entrega_recibida` (al portero), `dano_reportado` / `dano_grave` (resumen a coordinación, administrativo y almacén), `novedad_permanente` y `novedad_resuelta` (con `persistent_issue_id`), `asignacion` (al instructor asignado, reasignado o cuyo turno se anuló) |

## Sesión y perfil

| Método | Ruta | Rol | Cuerpo → respuesta |
|---|---|---|---|
| POST | `/auth/login` | — | `{tipoDocumento?, identificacion, password, rol}` → `{token, usuario}` (`usuario.area` en administrativos) |
| POST | `/auth/logout` | todos | → `204` |
| GET | `/me` | todos | → `usuario` |
| PATCH | `/me` | todos | `{nombre, email?, telefono?}` → `usuario` |
| POST | `/me/password` | todos | `{actual, nueva}` → `204` (cierra las otras sesiones) |
| GET | `/users?rol=` | administrativo | → `usuario[]` |

## Catálogos

| Método | Ruta | Rol | Notas |
|---|---|---|---|
| GET | `/specialties?todos=1` | todos | Especialidades activas (`todos=1`: también las inactivas, administrativo). `[{id, nombre, descripcion, activo, enUso}]` |
| POST / PATCH / DELETE | `/specialties`, `/specialties/{id}` | administrativo | `{nombre, descripcion?, activo?}`. Nombre repetido → `409 DUPLICADO`; borrar una en uso → `409 EN_USO` (se desactiva) |
| GET | `/inventory/categories?todos=1` | personal | Categorías del inventario, mismo formato |
| POST / PATCH / DELETE | `/inventory/categories`, `/inventory/categories/{id}` | administrativo | Igual que las especialidades |

## Ambientes e inventario

**Almacén:** todas las rutas de inventario marcadas *administrativo* (artículos,
`/items/scan`, categorías, familias, carga masiva, exportar, pegatinas)
también las puede usar el rol `almacen`. "Personal" = instructor, portero,
administrativo y almacén. Cada novedad trae `categoria: {id, nombre}` (la del
ítem, la de la familia o *Inmuebles* si es del salón).

| Método | Ruta | Rol | Notas |
|---|---|---|---|
| GET | `/environments?asignados=1&especialidadId=` | todos | Con portero, especialidad, `capacidadAprendices`, conteo de ítems, familias, `novedadesActivas` y última inspección |
| GET/PATCH/DELETE | `/environments/{id}` | GET todos; resto administrativo | DELETE → `409 EN_USO` si tiene inventario, familias o inspecciones |
| POST | `/environments` | administrativo | `{codigo, nombre, capacidad_aprendices?, especialidad_id?, porteroId?, activo?}`. Acepta también camelCase (`capacidadAprendices`, `especialidadId`) y la especialidad por nombre (`especialidad: "Cocina"`). Capacidad de 1 a 500 |
| GET | `/environments/{id}/items?familiaId=` | personal | Ítems del ambiente |
| GET | `/items/by-code/{codigo}` | personal | Acepta el código, `SENA-INV:<codigo>` o el `qr_value` del ítem |
| GET | `/inventory/lookup?codigo=` | personal | Lo que se leyó con la cámara o el lector → `{tipo:'item', item}` o `{tipo:'familia', familia}` (con componentes) |
| POST | `/items` | administrativo | `{ambienteId, codigo?, qr?, nombre, categoriaId \| categoria, familiaId?, serial?, estado?}`; sin código se genera el consecutivo; sin `qr`, `SENA-INV:<codigo>` |
| POST | `/items/scan` | administrativo | Registro con lector: `{codigo (lo leído), ambienteId, nombre, categoriaId \| categoria, familiaId?}` → `{item, creado, actualizado, cambios, otroAmbiente, movidoDesde}`. **Crea** el ítem si no existe (si lo leído no es un código, se genera el consecutivo y lo leído queda como `qr_value`) o lo **actualiza**: lo traslada al ambiente elegido, lo asigna a la familia y anota la hora del escaneo. Pegatina de familia → `422 ES_FAMILIA` |
| POST | `/inventory/import` (alias `/items/import`) | administrativo | Carga masiva con PhpSpreadsheet. JSON `{nombre: "x.xlsx", archivo: data URL, simular}` o `multipart/form-data` (`archivo`, `simular=1`) → `{total, nuevos, actualizados, sinCambios, familiasNuevas, errores:[{fila, mensaje}], filas}`. Columnas: `ambiente, codigo, nombre, categoria, serial, estado, familia, familia_nombre, familia_tipo, qr`. La categoría debe existir; una familia que no existe se crea; `qr` llena `qr_value`. Con `simular` no guarda |
| GET | `/inventory/export?ambienteId` (alias `/items/export`) | administrativo | Inventario en .xlsx con las columnas de la carga |
| POST | `/inventory/labels` (alias `/items/labels`) | personal | Reimpresión de pegatinas: `{ids?, familiaIds?, ambienteId?, motivo?}` → `{registradas, etiquetas:[{tipo, id, codigo, qr, nombre, ambiente, detalle, reimpresion}]}`. Queda en la trazabilidad (impresa o reimpresa) |
| GET | `/items/{id}/history` | personal | Trazabilidad del ítem |
| PATCH/DELETE | `/items/{id}` | administrativo | PATCH `{nombre, categoriaId, serial?, estado, familiaId?, qr?}` deja la edición en la trazabilidad. DELETE → `409 EN_USO` si tiene novedades |
| GET | `/inventory/families?ambienteId` | personal | Familias con sus componentes: `{id, codigo, qr: "SENA-FAM:…", tipo, nombre, componentesTotal, componentesConNovedad, novedadActivaId, componentes}` |
| GET | `/inventory/families/{id}` | personal | Una familia |
| POST | `/inventory/families` | administrativo | `{ambienteId, tipo, nombre, codigo?, itemIds}`; sin código se genera (FAM107-PC05). Los ítems deben ser del mismo ambiente (`422 OTRO_AMBIENTE`) |
| PATCH / DELETE | `/inventory/families/{id}` | administrativo | PATCH `{tipo, nombre, itemIds?}` deja exactamente esos componentes. DELETE deja los componentes sueltos; con novedades → `409 EN_USO` |

## Inspecciones (entrega del ambiente)

El instructor revisa el salón al entrar (checklist, ítems y novedades con
foto); el portero genera un QR de entrega y el instructor lo escanea para
confirmar que recibe el ambiente.

```
en_curso ──confirm (instructor termina)──▶ pendiente_recepcion ──qr (portero genera el QR)──▶ pendiente_recepcion + qrGeneradoEn
         ──el instructor escanea el QR──▶ recibida (+ estado_salon, persistent_issues, avisos)
en_curso | pendiente_recepcion ──cancel (instructor)──▶ cancelada
```

**"Todo está bien"** es un atajo de la pantalla: marca el checklist y todos
los ítems revisables como OK *en la interfaz* (`marcarTodoBien` en
`js/reglas.js`). No llama a la API, no termina la revisión ni escanea
ningún QR. El envío es siempre `confirm`, que el instructor pulsa aparte. El
antiguo `{todoBien: true}` ya no existe: sin checklist completo → `422`.

`instructor_id` = quien revisa y recibe; `portero_id` = quien entrega
(genera el QR). El texto del QR (`qr`) solo lo reciben el portero y el
administrativo, y solo mientras la entrega está pendiente.

| Método | Ruta | Rol | Notas |
|---|---|---|---|
| GET | `/inspections` | personal | Filtros: `estado, resultado, ambienteId, instructorId, desde, hasta, asignados` |
| POST | `/inspections` | instructor | `{ambienteId}` inicia la revisión. Si ya tiene una abierta en ese ambiente la devuelve; si es de otro instructor → `409 EN_CURSO` |
| GET | `/inspections/{id}` | personal | Detalle: checklist, `inventario` (con `reportado`, `reportadoPorFamilia`, `novedadActivaId`), `familias` (con `itemIds`, `reportado`), `novedadesActivas` del ambiente (cada una con su `area` del checklist), `asignadosHoy` (`[{jornada, instructorId, instructor, tipo}]`), `reportes`, `itemsOk`, `estadoSalon`, `entrega` y `recibe` |
| GET | `/inspections/by-qr/{token}` | portero, administrativo | Consulta por el QR `SENA-INSP:<token>` |
| PATCH | `/inspections/{id}/checklist` | instructor dueño | `{checklist:[{clave, ok}], observaciones}` (guardado automático de lo que el instructor marca a mano) |
| POST | `/inspections/{id}/items` | instructor dueño | Novedad con foto: `{itemId \| familiaId \| codigo (lo escaneado: ítem o familia) \| ubicacion, naturaleza?, tipoDano, severidad, comentario, foto}`. `naturaleza` ∈ `permanente \| temporal \| limpieza` (sin ella: `suciedad` → limpieza, lo demás → permanente). Solo la permanente deja el ítem (o todos los componentes de la familia) `danado` y abre en ese momento una novedad `en_curso` (o se suma a la que ya tenía), con aviso a coordinación, administrativo y almacén. Quitar el reporte (DELETE) la deja `anulada`. Un componente y su familia no se reportan a la vez (`409 DUPLICADO`). La foto (data URL JPG/PNG/WebP, ≤ 3 MB) siempre es obligatoria |
| DELETE | `/inspections/{id}/items/{reporteId}` | instructor dueño | Quita el reporte y restaura el estado de los ítems |
| POST | `/inspections/{id}/confirm` | instructor dueño | `{checklist, observaciones?, itemsOk?}` termina la revisión. Checklist completo; observaciones obligatorias si hay novedad; `itemsOk` deben ser del ambiente (los que tienen novedad se descartan). Notifica al portero del ambiente (o a todos si no tiene) |
| POST | `/inspections/{id}/qr` | portero | Genera (o renueva) el QR de entrega; guarda `portero_id`. Antes de que el instructor termine → `409` |
| POST | `/inspections/by-qr/{token}/receive` | instructor | Sin cuerpo. → `recibida`; guarda `estado_salon` (ítems por estado, marcados OK, novedades por naturaleza, novedades en curso); las permanentes ya quedaron en curso al reportarlas. Avisa al portero y, si hay novedades, a coordinación, administrativo y almacén. QR de otro instructor → `403`; QR viejo o inexistente → `404` |
| POST | `/inspections/{id}/delivery-qr` | instructor dueño | Sentido inverso: genera (o renueva) el QR de entrega del instructor, `qrInstructor: "SENA-ENT:<token>"` (solo lo recibe él). Antes de terminar la revisión → `409` |
| POST | `/inspections/by-delivery-qr/{token}/confirm` | portero | El portero escanea el QR del instructor: guarda `portero_id` (quien escanea), cierra la entrega igual que `receive` (`recibidaVia: "qr_instructor"`) y avisa al instructor. QR usado o inexistente → `404` |
| POST | `/inspections/{id}/cancel` | instructor dueño | Mientras no haya recibido el ambiente. Deshace los reportes |

`tipoDano` ∈ `rotura | no_funciona | faltante | suciedad | otro`;
`severidad` ∈ `leve | moderada | grave`.

## Novedades permanentes e historial

Una novedad permanente queda **`en_curso`** en el momento en que se reporta:
en una revisión (`POST /inspections/{id}/items` con `naturaleza: permanente`)
o desde el módulo de novedades. Instructores y administrativos le agregan
seguimiento y la marcan resuelta. Si el reporte de la revisión que la abrió
se retira antes de entregar el ambiente (o se cancela la revisión), queda
**`anulada`**. Cada cambio deja un evento en `audit_events`.

| Método | Ruta | Rol | Notas |
|---|---|---|---|
| GET | `/persistent-issues?estado=en_curso\|resuelta\|anulada&ambienteId&categoriaId` | personal | `[{id, estado, ambiente, objetivo:{tipo: item\|familia\|salon, id, codigo, nombre}, titulo, itemEstado, tipoDano, severidad, descripcion, foto, reportadaPor, inspeccionId, creadaEn, resueltaPor, resueltaEn, resolucion, fotoResolucion, anuladaEn, reportes}]` |
| GET | `/persistent-issues/{id}` | personal | + `items` afectados con su estado, `historial` de revisiones que la reportaron y `eventos` (auditoría: creada, reportada_de_nuevo, modificada, resuelta, anulada, reporte_retirado). Cada novedad trae `area`: el punto del checklist donde se resalta en la revisión (`ventilacion` para el aire acondicionado, `equipos`, `mobiliario`, `puertas`, `electrico`, `luces`, `senalizacion`; null si no encaja) |
| POST | `/persistent-issues` | instructor, administrativo | Levantar sin revisión: `{ambienteId?, itemId \| familiaId \| codigo \| ubicacion, tipoDano, severidad, descripcion, foto, estadoItem?}`. La foto es obligatoria para el instructor. `estadoItem` por defecto `danado` (`fuera_servicio`, `en_reparacion`; `baja` solo administrativo → si no `403`). Si el ítem o la familia ya tiene una en curso → `409 DUPLICADO`. Avisa a coordinación, administrativo y almacén |
| PATCH | `/persistent-issues/{id}` | instructor, administrativo | Seguimiento mientras siga en curso: `{estadoItem?, severidad?, descripcion?, nota?, foto?, inspeccionId?}` (con `inspeccionId`, desde la revisión del ambiente: el historial lo indica; debe ser del mismo ambiente y, si es instructor, suya) (p. ej. dejar el ítem **fuera de servicio** hasta su reparación). Sin cambios → `422`. Queda como evento `modificada` con el antes y el después |
| POST | `/persistent-issues/{id}/resolve` | instructor, administrativo | `{resolucion, estadoItem?, foto?, inspeccionId?}` ("Ya está en funcionamiento" desde la revisión envía `inspeccionId`) (`estadoItem` por defecto `operativo`; `baja` solo administrativo). Avisa a coordinación, administrativo y almacén y a quien la reportó |
| GET | `/issues?ambienteId&categoriaId&itemId&naturaleza&estado&desde&hasta` | instructor, administrativo, almacén | Historial completo: `[{origen: revision\|modulo, id, inspeccionId, novedadId, ambiente, objetivo, itemEstado, naturaleza, tipoDano, severidad, comentario, foto, usuario, fecha, estado, resueltaEn, resueltaPor, resolucion}]`. `estado` ∈ `en_revision \| en_curso \| resuelta \| anulada \| cerrada` (temporales y limpieza se cierran al recibir el ambiente). Con `itemId` incluye las novedades de su familia |

## Asignación de instructores por jornada

Se gestiona en el formulario *Editar ambiente* (y se consulta en el tablero
de Asignaciones, por semana o por mes). Jornadas: `manana` (6:00 a 12:00), `tarde` (12:00 a 18:00),
`noche` (18:00 a 22:00) y `fin_semana` (solo sábados y domingos). Periodo y
permanente aceptan `diasSemana` ([1..7], 1 = lunes): la asignación solo vale
esos días ("por semanas" en el front es un periodo de lunes a domingo con sus
días); dos asignaciones del mismo tipo con días distintos no chocan. Tipos: `dia` (por días: uno o varios días sueltos),
`periodo` (fecha inicio — fecha fin, máximo un año) y `permanente` (sin tiempo
definido, hasta que se cambie o se anule). Para cada
ambiente, jornada y día vale la vigente más específica: **día > periodo >
permanente**. No puede haber dos del mismo tipo cruzadas en el mismo ambiente
y jornada (`409 DUPLICADO`); si el instructor ya tiene esa jornada en otro
ambiente, se crea igual y la respuesta trae `advertencias`.

| Método | Ruta | Rol | Notas |
|---|---|---|---|
| GET | `/assignments/board?desde=aaaa-mm-dd&dias=7&ambienteId` | personal | Tablero (hasta 42 días: la vista mensual pide las semanas completas del mes; `fin_semana` es null entre semana): `{desde, hasta, fechas, jornadas, ambientes:[{id, codigo, nombre, celdas:{"2026-10-02": {manana: {id, instructorId, instructor, tipo, fechaInicio, fechaFin} \| null, tarde, noche}}}]}` |
| GET | `/assignments?ambienteId&instructorId&estado=vigente\|todas&fecha` | instructor, administrativo | Lista (el instructor solo ve las suyas). Por defecto, las vigentes desde hoy |
| GET | `/assignments/{id}` | instructor (las suyas), administrativo | + `eventos` (auditoría) |
| POST | `/assignments` | administrativo | `{ambienteId, instructorId, jornada, tipo, fechaInicio, fechaFin? (solo periodo), fechas? (solo dia: varios días sueltos), diasSemana? (periodo o permanente), motivo?}`. `fin_semana` por días en un día entre semana → `422` → `{asignacion, asignaciones, advertencias}`. Fechas ya pasadas → `422`. Avisa al instructor |
| PATCH | `/assignments/{id}` | administrativo | `{instructorId?, tipo?, fechaInicio?, fechaFin?, diasSemana? (null = todos), motivo?}` → `{asignacion, advertencias}`. Si aún no empieza se cambia todo; si ya empezó, solo la fecha final, el tipo (periodo ↔ sin tiempo definido) y el motivo: cambiar el instructor → `422 USAR_REASIGNAR` (se usa `/reassign` desde una fecha). Evento `modificada` con el antes y el después |
| POST | `/assignments/{id}/reassign` | administrativo | `{instructorId, motivo, desde?}`: el nuevo instructor toma la jornada desde `desde` (por defecto hoy) hasta donde iba la original. Si `desde` es su primer día, la original queda `reasignada`; si no, se recorta al día anterior. → `{asignacion, anterior, advertencias}`. Avisa a ambos |
| POST | `/assignments/{id}/cancel` | administrativo | `{motivo, desde?}`: anula el turno desde esa fecha (primer día → `anulada`; si no, se recorta). Avisa al instructor |

## Auditoría

| Método | Ruta | Rol | Notas |
|---|---|---|---|
| GET | `/audit?entidad=novedad\|asignacion&entidadId&ambienteId&usuarioId&accion&desde&hasta` | administrativo | `[{id, entidad, entidadId, ambiente, accion, detalle, foto, datos, usuario, usuarioRol, fecha}]`, lo más reciente primero (máx. 500). Acciones de novedad: `creada`, `reportada_de_nuevo`, `modificada`, `resuelta`, `anulada`, `reporte_retirado`; de asignación: `creada`, `reasignada`, `recortada`, `anulada` |

## Notificaciones y reportes

| Método | Ruta | Rol | Notas |
|---|---|---|---|
| GET | `/inbox` | todos | `{sinLeer, notificaciones:[{id, tipo, titulo, detalle, inspeccionId, novedadId, ambiente, leida, fecha}]}` |
| POST | `/inbox/{id}/read`, `/inbox/read-all` | todos | → `204` |
| GET | `/reports?desde&hasta&ambienteId&instructorId` | administrativo | `{resumen, porAmbiente, danos}`; cada novedad trae `naturaleza`, `familiaId`, `novedadId` y `novedadEstado` |

## Fichas, aprendices y primer ingreso

| Método | Ruta | Rol | Notas |
|---|---|---|---|
| GET | `/fichas` | administrativo (todas), instructor (las que dirige o en las que dicta) | `[{id, codigo, programa, jornada, ambiente, instructor (líder), fechaInicio, fechaFin, activo, aprendices, primerIngresoPendiente}]` |
| GET | `/fichas/{id}` | administrativo, instructor de la ficha | + `listaAprendices: [{id, tipoDocumento, documento, nombre, email, telefono, primerIngresoPendiente, emailVerificado, credencialesEnviadasEn, p004}]` |
| POST / PATCH | `/fichas`, `/fichas/{id}` | administrativo | `{codigo (5–12 dígitos), programa, jornada, ambienteId?, instructorId?, fechaInicio?, fechaFin?, activo?}`. Número repetido → `409` |
| POST | `/fichas/{id}/students/import` | administrativo | Carga masiva con PhpSpreadsheet (JSON `{nombre, archivo: data URL, simular}` o multipart, como `/inventory/import`). Columnas `tipo_documento, documento*, nombre*, email*, telefono`. Nuevos: usuario aprendiz con contraseña temporal y `debe_cambiar_password`, y correo con credenciales; existentes (mismo documento): se actualizan y pasan a la ficha. → `{total, nuevos, actualizados, sinCambios, correos, errores, filas}` |
| POST | `/fichas/{id}/students/{userId}/credentials` | administrativo | Contraseña temporal nueva, correo y primer ingreso de nuevo |
| POST | `/fichas/{id}/students` | administrativo | Agrega un aprendiz: `{tipoDocumento?, documento, nombre, email, telefono?, clave?, correo?, guardarPlantilla?}` → `{aprendiz, correo}` |
| GET | `/mail-outbox?userId` | administrativo | Correos registrados o enviados (`CORREO_MODO` en `api/config.php`): `{asunto, cuerpo (texto), html, estado…}` |
| GET | `/mail-templates` | administrativo | `{plantillas: [{clave (credenciales_aprendiz \| credenciales_instructor), nombre, asunto, cuerpo, porDefecto, personalizada}], campos}` |
| PUT | `/mail-templates/{clave}` | administrativo | `{asunto, cuerpo}` (el cuerpo debe tener `{clave}`; campo desconocido → `422`) o `{restablecer: true}` |
| POST | `/mail-templates/{clave}/preview` | administrativo | `{asunto?, cuerpo?, clave?, nombre?, documento?, tipoDocumento?, fichaId?}` → `{asunto, texto, html, enlace}` |
| GET | `/instructors` | administrativo | `[{id, tipoDocumento, documento, nombre, email, telefono, activo, primerIngresoPendiente, emailVerificado, credencialesEnviadasEn, fichas, asignacionesVigentes}]` |
| POST | `/instructors` | administrativo | `{tipoDocumento?, documento, nombre, email, telefono?, clave?, correo?, guardarPlantilla?}` → `{instructor, correo}`. Documento o correo repetido → `409` |
| PATCH | `/instructors/{id}` | administrativo | `{documento, nombre, email, telefono?, activo?}`; desactivado no puede ingresar (`423`) |
| POST | `/instructors/{id}/credentials` | administrativo | `{clave?, correo?, guardarPlantilla?}`: contraseña temporal nueva, correo y primer ingreso de nuevo |

**Envío de credenciales** (importar, agregar, reenviar, instructores): `clave`
= contraseña temporal escrita (8+ caracteres con letras y números; vacía =
se genera una por persona); `correo` = `{asunto, cuerpo}` solo para este
envío (vacío = la plantilla guardada); `guardarPlantilla` además lo deja como
plantilla. El correo va en texto y HTML con el botón **Ingresar a Ambientes
SENA** → `index.html#/login?documento=…&tipo=…&rol=…` (el login llega con el
rol y el documento puestos).
| POST | `/me/first-login/code` | el usuario con primer ingreso pendiente | `{email?}` (corrige el correo) → envía un código de 6 dígitos que vence en 15 min → `{enviadoA, expiraEn, codigoDemo?}` (`codigoDemo` solo en modo registro) |
| POST | `/me/first-login` | el mismo | `{codigo, nueva}` → confirma el correo y cambia la contraseña (distinta de la temporal) → `usuario` |

Mientras `debeCambiarPassword` sea `true`, cualquier otra ruta (salvo `/me`,
`/auth/logout` y las dos de arriba) responde `403 PRIMER_INGRESO`.

Tablas nuevas: `fichas`, `competencias`, `clases`, `clase_qr` (nonces de los
QR), `asistencias` (presente | tarde), `excusas`, `p004`, `correos`; en
`users`: `debe_cambiar_password`, `email_verificado_en`,
`codigo_verificacion`, `codigo_expira`, `credenciales_enviadas_en`.

## Cuenta antes y su revisión

La cuenta antes es el inventario con que se entrega el ambiente. En la base y
en la API su responsable se llama `cuentadante`.
`environments.cuentadante_id` = responsable de la cuenta antes;
`inventory_items.valor` = valor de compra. `GET /environments` trae
`cuentadante: {id, nombre}` y `cuentadantePendiente: {revisionId, id, nombre}`.
Elegir `cuentadanteId` al crear o editar un ambiente (o asignar con
`cuentadante: true` en `POST /assignments` o `/reassign`) abre una revisión
de tipo `cuentadante`; asignar un instructor que nunca ha revisado el ambiente
abre una de tipo `instructor` (la respuesta trae `revisionInventarioId`).
Con `cuentaAntes: true` en `POST /assignments` o `/reassign` se le entrega una
cuenta antes nueva: la revisión de tipo `instructor` se abre aunque ya
conociera el ambiente, y el Excel se sube después con
`POST /environments/{id}/inventory/import` (sus ítems se suman a la revisión).
Mientras la persona tenga una revisión pendiente en el ambiente,
`POST /inspections` → `409 REVISION_INVENTARIO`.

| Método | Ruta | Rol | Notas |
|---|---|---|---|
| GET | `/inventory-reviews?estado&ambienteId&mias` | personal (administrativo y almacén: todas; los demás: las suyas) | `[{id, tipo, estado, ambiente, responsable, cuentadanteAnterior, motivo, observaciones, conteo: {total, pendientes, ok, faltantes, danados}, creadaEn, cerradaEn}]` |
| GET | `/inventory-reviews/{id}` | quien recibe, administrativo, almacén | + `items: [{itemId, codigo, qr, nombre, serial, valor, estadoItem, categoria, familia, revision, observacion}]`, `valorTotal`. Mientras está pendiente siempre tiene todos los ítems del ambiente |
| PATCH | `/inventory-reviews/{id}/items` | quien recibe | `{items: [{itemId \| codigo (lo escaneado; una familia marca sus componentes), estado: ok \| faltante \| danado \| pendiente, observacion (obligatoria si faltante o dañado)}]}` o `{todoBien: true}` (los pendientes en `ok` = conforme) |
| POST | `/inventory-reviews/{id}/accept` | quien recibe | `{observaciones}` (obligatoria con faltantes o dañados). Todo revisado o `422 REVISION_INCOMPLETA`. Dañados → `danado`; trazabilidad; si es de cuentadante, `cuentadante_id` pasa a esa persona; avisos |
| POST | `/inventory-reviews/{id}/cancel` | administrativo, almacén | `{motivo}` → `anulada` (el responsable no cambia) |
| GET | `/inventory-reviews/{id}/export` | quien recibe, administrativo, almacén | Acta en .xlsx (encabezado + `codigo, nombre, serial, categoria, familia, valor, estado, revision, observacion`, con lista desplegable en *revision*) |
| POST | `/inventory-reviews/{id}/import` | quien recibe | El acta llena (como `/inventory/import`): por `codigo`/placa toma `revision` (CONFORME u OK, FALTANTE, DAÑADO…) y `observacion` → `{total, actualizados, sinCambios, errores, revision}` |
| GET | `/environments/{id}/inventory/export` | personal | Cuenta antes en .xlsx (encabezado con ambiente, responsable, fecha y valor total) |
| POST | `/environments/{id}/inventory/import` | administrativo, almacén | Cuenta antes (Excel/CSV, `simular` = vista previa): columnas de la carga masiva sin `ambiente`; acepta placa, descripción, valor y un encabezado arriba de los títulos; sin categoría → *Sin clasificar*. Los ítems nuevos se suman a la revisión pendiente |
