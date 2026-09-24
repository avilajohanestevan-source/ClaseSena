# Contratos de API — Asistencia y ambientes

Front-end sin backend: estos son los endpoints que el servidor real debe
implementar. Mientras `CONFIG.usarMock` (en `js/config.js`) sea `true`, los
responde el servidor simulado de `js/api/mock/servidor.js` con los mismos
códigos de estado y cuerpos de error.

- Base: `/api/v1` (`CONFIG.apiBase`).
- Formato: JSON. Fechas en ISO 8601 (UTC).
- Autenticación: `Authorization: Bearer <token>` en todo excepto el login.
- Errores: `{ "mensaje": "texto para el usuario", "codigo": "CODIGO" }` con
  el status HTTP correspondiente. El front muestra `mensaje` tal cual.

## Autenticación

| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| POST | `/auth/login` | `{ tipoDocumento?, identificacion, password, rol }` | `{ token, usuario }` |
| POST | `/auth/logout` | — | `204` |

`usuario`: `{ id, identificacion, nombre, rol, ficha?, ambienteIds? }`.
`rol` ∈ `instructor | administrativo | aprendiz`.
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

## Inventario

| Método | Ruta | Respuesta |
|---|---|---|
| GET | `/environments/{ambienteId}/assets` | `Activo[]` |
| GET | `/assets/by-code/{codigo}` | `Activo` (`404 NO_EXISTE` si no hay) |
| GET | `/assets/{id}` | `Activo` |

`Activo`: `{ id, codigo, nombre, tipo, ambienteId, estado, serial,
historial: [{fecha, evento, usuario}], fotos: [{url, fecha, descripcion}] }`,
`estado` ∈ `operativo | danado | en-reparacion | baja`. Las etiquetas usan
Code 128 con el `codigo` del activo.

## Daños

`POST /damages` → `201 Dano`

```json
{ "activoId": "…", "prioridad": "leve | moderada | grave",
  "descripcion": "10 a 500 caracteres", "foto": "data:image/jpeg;base64,… | null" }
```

Reglas: la foto es obligatoria si `prioridad = grave`
(`422 FOTO_OBLIGATORIA`). El activo queda en estado `danado`, se agrega al
historial y la foto a sus fotos previas. Un daño grave genera una
notificación `dano-grave`. El front reduce la foto a JPEG de máximo 1280 px
antes de enviarla; en producción conviene cambiar el data URL por una
subida `multipart/form-data`.
