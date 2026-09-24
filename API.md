# Contratos de API — Asistencia y ambientes

Hay dos APIs:

1. **Asistencia a clases** (esta primera parte): todavía sin backend. Son
   los endpoints que el servidor real debe implementar. Mientras
   `CONFIG.usarMock` (en `js/config.js`) sea `true`, los responde el
   servidor simulado de `js/api/mock/servidor.js` con los mismos códigos de
   estado y cuerpos de error.
2. **Entrega y revisión de ambientes** (sección al final): ya implementada
   en PHP + MySQL en `api/`. El inventario y los daños de ambientes viven
   ahí; la versión simulada anterior se retiró.

Asistencia a clases:

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
| `users` | documento, tipo, nombre, contacto, `rol` (instructor, administrativo, portero, aprendiz), ficha, `password_hash` |
| `api_tokens` | sesiones |
| `environments` | `codigo` (107…), nombre, bloque, capacidad, `portero_id` asignado, activo |
| `inventory_items` | ítems por ambiente; `codigo` (AMB107-003) es lo que lleva el QR `SENA-INV:<codigo>`; estado |
| `inspections` | `environment_id`, `instructor_id` (revisa y recibe), `portero_id` (entrega), estado, resultado, `qr_token`, checklist (JSON), observaciones, `iniciada_en`, `confirmada_en`, `qr_generado_en`, `recibida_en`, nombres de quien entregó y recibió |
| `inspection_items` | daño reportado: `inspection_id` → `inventory_item_id`, tipo, severidad, comentario, foto |
| `notifications` | `revision_lista` (al portero: genera el QR), `entrega_recibida` (al portero), `dano_reportado` / `dano_grave` (a coordinación cuando se recibe un ambiente con daños) |

## Sesión y perfil

| Método | Ruta | Rol | Cuerpo → respuesta |
|---|---|---|---|
| POST | `/auth/login` | — | `{tipoDocumento?, identificacion, password, rol}` → `{token, usuario}` |
| POST | `/auth/logout` | todos | → `204` |
| GET | `/me` | todos | → `usuario` |
| PATCH | `/me` | todos | `{nombre, email?, telefono?}` → `usuario` |
| POST | `/me/password` | todos | `{actual, nueva}` → `204` (cierra las otras sesiones) |
| GET | `/users?rol=` | administrativo | → `usuario[]` |

## Ambientes e inventario

| Método | Ruta | Rol | Notas |
|---|---|---|---|
| GET | `/environments?asignados=1` | todos | Con portero, conteo de ítems y última inspección. `asignados` filtra los del portero |
| GET/PATCH/DELETE | `/environments/{id}` | GET todos; resto administrativo | DELETE → `409 EN_USO` si tiene inventario o inspecciones |
| POST | `/environments` | administrativo | `{codigo, nombre, bloque?, capacidad?, porteroId?, activo?}` |
| GET | `/environments/{id}/items` | personal | Ítems del ambiente |
| GET | `/items/by-code/{codigo}` | personal | Para el escáner |
| POST | `/items` | administrativo | `{ambienteId, nombre, categoria, serial?, estado?}`; el código se genera |
| PATCH/DELETE | `/items/{id}` | administrativo | DELETE → `409 EN_USO` si tiene daños reportados |

## Inspecciones (entrega del ambiente)

El instructor revisa el salón al entrar (checklist y daños con foto); el
portero genera un QR de entrega y el instructor lo escanea para confirmar
que recibe el ambiente.

```
en_curso ──confirm (instructor termina)──▶ pendiente_recepcion ──qr (portero genera el QR)──▶ pendiente_recepcion + qrGeneradoEn
         ──el instructor escanea el QR──▶ recibida
en_curso | pendiente_recepcion ──cancel (instructor)──▶ cancelada
```

`instructor_id` = quien revisa y recibe; `portero_id` = quien entrega
(genera el QR). El texto del QR (`qr`) solo lo reciben el portero y el
administrativo, y solo mientras la entrega está pendiente: el instructor
tiene que escanearlo en el celular del portero.

| Método | Ruta | Rol | Notas |
|---|---|---|---|
| GET | `/inspections` | personal | Filtros: `estado, resultado, ambienteId, instructorId, desde, hasta, asignados`. El instructor solo ve las suyas; con `asignados=1` el portero ve las que entregó y las de sus ambientes |
| POST | `/inspections` | instructor | `{ambienteId}` inicia la revisión. Si ya tiene una abierta en ese ambiente la devuelve; si es de otro instructor → `409 EN_CURSO` |
| GET | `/inspections/{id}` | personal | Detalle: checklist, inventario (con `reportado`), `reportes`, `entrega` y `recibe` (`{nombre, fecha}`) |
| GET | `/inspections/by-qr/{token}` | portero, administrativo | Consulta por el QR `SENA-INSP:<token>` |
| PATCH | `/inspections/{id}/checklist` | instructor dueño | `{checklist:[{clave, ok}], observaciones}` (guardado automático) |
| POST | `/inspections/{id}/items` | instructor dueño | `{itemId \| codigo, tipoDano, severidad, comentario, foto}` crea `inspection_items` y deja el ítem `danado` en el inventario. La foto (data URL JPG/PNG/WebP, ≤ 3 MB) es la evidencia y siempre es obligatoria |
| DELETE | `/inspections/{id}/items/{reporteId}` | instructor dueño | Quita el reporte y restaura el estado del ítem |
| POST | `/inspections/{id}/confirm` | instructor dueño | `{checklist, observaciones?}` termina la revisión. Checklist completo; observaciones obligatorias si hay novedad. Notifica al portero del ambiente (o a todos si no tiene) |
| POST | `/inspections/{id}/qr` | portero | Genera (o renueva) el QR de entrega; guarda `portero_id`. Antes de que el instructor termine → `409` |
| POST | `/inspections/by-qr/{token}/receive` | instructor | Sin cuerpo. → `recibida` con la hora; notifica al portero y, si hay daños o novedades, a los administrativos (coordinación). QR de otro instructor → `403`; QR viejo o inexistente → `404` |
| POST | `/inspections/{id}/cancel` | instructor dueño | Mientras no haya recibido el ambiente. Deshace los reportes |

`tipoDano` ∈ `rotura | no_funciona | faltante | suciedad | otro`;
`severidad` ∈ `leve | moderada | grave`.

## Notificaciones y reportes

| Método | Ruta | Rol | Notas |
|---|---|---|---|
| GET | `/inbox` | todos | `{sinLeer, notificaciones:[{id, tipo, titulo, detalle, inspeccionId, ambiente, leida, fecha}]}` |
| POST | `/inbox/{id}/read`, `/inbox/read-all` | todos | → `204` |
| GET | `/reports?desde&hasta&ambienteId&instructorId` | administrativo | `{resumen, porAmbiente, danos}` |
