-- Base de datos de prueba · Entrega y revisión de ambientes SENA
-- MySQL / MariaDB (XAMPP). Se crea con `php db/instalar.php` o importando
-- este archivo y luego seed.sql en phpMyAdmin.
--
-- Flujo que modela (entrega del ambiente al instructor):
--   el instructor revisa el salón al entrar           → inspections (en_curso, instructor_id)
--   "Todo está bien" es solo un atajo de la pantalla: marca checklist e ítems como OK sin enviar nada
--   escanea el ítem o la familia con novedad y deja foto → inspection_items (naturaleza permanente|temporal|limpieza)
--   o reporta un daño del salón sin ítem (pared, techo) → inspection_items (ubicacion, sin ítem ni familia)
--   termina la revisión                                → inspections (pendiente_recepcion, items_ok) + notifications al portero
--   el portero genera el QR de entrega                 → inspections (portero_id, qr_token nuevo, qr_generado_en)
--   el instructor escanea el QR y confirma que recibe  → inspections (recibida, recibida_en, estado_salon)
--   (o al revés: el instructor muestra su QR de entrega → inspections (qr_instructor_token)
--    y el portero lo escanea para confirmar             → inspections (recibida, portero_id, recibida_via))
--                                                        + persistent_issues por cada novedad permanente
--                                                        + notifications al portero y a coordinación, administrativo y almacén
--   el instructor o un administrativo la marca resuelta → persistent_issues (resuelta) + ítems de nuevo operativos
--   cada cambio de una novedad o de una asignación      → audit_events (fecha, usuario, detalle y evidencia)
--
-- Asignación de instructores por jornada (mañana, tarde, noche o fines de
-- semana): por días, por un periodo (rango de fechas o por semanas) o
-- permanente (sin fecha final, hasta que se cambie). Periodo y permanente
-- pueden limitarse a algunos días de la semana (dias_semana). Para cada ambiente, jornada y día vale la más específica:
-- día > periodo > permanente. Se reasignan o anulan; todo queda en audit_events.
--
-- Inventario: cada ítem tiene un código único y un qr_value (lo que lleva su
-- QR; por defecto SENA-INV:<codigo>) y su código de barras (Code 128 del
-- código). Los ítems se agrupan en categorías (inventory_categories) y,
-- opcionalmente, en familias (item_families: Familia PC = monitor + CPU +
-- teclado + mouse) con su propio QR SENA-FAM:<codigo>. Se cargan uno a uno,
-- escaneando o con carga masiva desde Excel/CSV (PhpSpreadsheet).
-- item_history guarda la trazabilidad de cada ítem.

CREATE DATABASE IF NOT EXISTS sena_ambientes CHARACTER SET utf8mb4 COLLATE utf8mb4_spanish_ci;
USE sena_ambientes;

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS audit_events, instructor_assignments, item_history, notifications, inspection_items, persistent_issues,
                     inspections, inventory_items, item_families, inventory_categories, environments, especialidades_ambiente,
                     api_tokens, users, fichas, competencias, clases, clase_qr, asistencias, excusas, p004, correos, plantillas_correo;
SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE users (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tipo_documento  ENUM('CC','TI','CE','PPT') NOT NULL DEFAULT 'CC',
  documento       VARCHAR(12)  NOT NULL,
  nombre          VARCHAR(120) NOT NULL,
  email           VARCHAR(160) NULL,
  telefono        VARCHAR(20)  NULL,
  rol             ENUM('instructor','administrativo','portero','aprendiz','almacen') NOT NULL, -- almacen: gestiona artículos, familias y códigos
  area            ENUM('coordinacion','administrativo') NULL, -- solo administrativos: a qué dependencia pertenece
  ficha           VARCHAR(12)  NULL,              -- solo aprendices
  password_hash   VARCHAR(255) NOT NULL,
  -- Primer ingreso (aprendices importados con su ficha): confirmar el correo con un código y cambiar la contraseña temporal.
  debe_cambiar_password TINYINT(1) NOT NULL DEFAULT 0,
  email_verificado_en   DATETIME   NULL,
  codigo_verificacion   CHAR(6)    NULL,
  codigo_expira         DATETIME   NULL,
  credenciales_enviadas_en DATETIME NULL,
  activo          TINYINT(1)   NOT NULL DEFAULT 1,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_documento (documento),
  KEY ix_users_rol (rol)
) ENGINE=InnoDB;

CREATE TABLE api_tokens (
  token       CHAR(64)     NOT NULL PRIMARY KEY,
  user_id     INT UNSIGNED NOT NULL,
  expires_at  DATETIME     NOT NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Especialidad de cada ambiente: Cocina, Laboratorio, Audiovisual, Axo…
CREATE TABLE especialidades_ambiente (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nombre       VARCHAR(60)  NOT NULL,
  descripcion  VARCHAR(200) NULL,
  activo       TINYINT(1)   NOT NULL DEFAULT 1,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_especialidad_nombre (nombre)
) ENGINE=InnoDB;

CREATE TABLE environments (
  id                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  codigo                VARCHAR(10)  NOT NULL,      -- número visible: 107, 108…
  nombre                VARCHAR(120) NOT NULL,
  capacidad_aprendices  SMALLINT UNSIGNED NULL,     -- cuántos aprendices caben (antes "capacidad" en puestos)
  especialidad_id       INT UNSIGNED NULL,
  portero_id            INT UNSIGNED NULL,          -- portero asignado (recibe las notificaciones)
  activo                TINYINT(1)   NOT NULL DEFAULT 1,
  created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_environments_codigo (codigo),
  CONSTRAINT fk_env_especialidad FOREIGN KEY (especialidad_id) REFERENCES especialidades_ambiente(id) ON DELETE RESTRICT,
  CONSTRAINT fk_env_portero      FOREIGN KEY (portero_id)      REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Categorías del inventario: Inmuebles, Mobiliario, Electrodomésticos, Equipos Informáticos, Periféricos…
CREATE TABLE inventory_categories (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nombre       VARCHAR(60)  NOT NULL,
  descripcion  VARCHAR(200) NULL,
  activo       TINYINT(1)   NOT NULL DEFAULT 1,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_categoria_nombre (nombre)
) ENGINE=InnoDB;

-- Familias de ítems: un conjunto que se revisa y se reporta junto (Familia PC = monitor + CPU + teclado + mouse).
-- Se puede reportar la familia completa o un componente suelto.
CREATE TABLE item_families (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  environment_id  INT UNSIGNED NOT NULL,
  codigo          VARCHAR(40)  NOT NULL,           -- FAM107-PC01: va en el QR (SENA-FAM:<codigo>) y en el código de barras
  tipo            VARCHAR(40)  NOT NULL,           -- PC, Estación de cocina, Kit de grabación…
  nombre          VARCHAR(120) NOT NULL,           -- "PC puesto 1"
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_families_codigo (codigo),
  KEY ix_families_env (environment_id),
  CONSTRAINT fk_fam_env FOREIGN KEY (environment_id) REFERENCES environments(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE inventory_items (
  id                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  environment_id     INT UNSIGNED NOT NULL,
  codigo             VARCHAR(40)  NOT NULL,        -- va en el código de barras de la pegatina
  qr_value           VARCHAR(120) NOT NULL,        -- contenido del QR de la pegatina (por defecto SENA-INV:<codigo>)
  nombre             VARCHAR(120) NOT NULL,
  category_id        INT UNSIGNED NOT NULL,
  family_id          INT UNSIGNED NULL,            -- familia a la que pertenece (NULL = ítem suelto)
  serial             VARCHAR(60)  NULL,
  -- fuera_servicio: daño permanente, no se usa mientras la novedad siga activa; baja: inactivo, retirado del inventario
  estado             ENUM('operativo','danado','en_reparacion','fuera_servicio','baja') NOT NULL DEFAULT 'operativo',
  ultimo_escaneo_en  DATETIME     NULL,            -- última vez que se escaneó su pegatina en el registro con lector
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_items_codigo (codigo),
  UNIQUE KEY uq_items_qr (qr_value),
  KEY ix_items_env (environment_id),
  KEY ix_items_familia (family_id),
  CONSTRAINT fk_items_env       FOREIGN KEY (environment_id) REFERENCES environments(id)          ON DELETE RESTRICT,
  CONSTRAINT fk_items_categoria FOREIGN KEY (category_id)    REFERENCES inventory_categories(id)  ON DELETE RESTRICT,
  CONSTRAINT fk_items_familia   FOREIGN KEY (family_id)      REFERENCES item_families(id)         ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE inspections (
  id                       INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  environment_id           INT UNSIGNED NOT NULL,
  instructor_id            INT UNSIGNED NOT NULL,   -- quien revisa y recibe el ambiente
  portero_id               INT UNSIGNED NULL,       -- quien lo entrega (genera el QR)
  estado                   ENUM('en_curso','pendiente_recepcion','recibida','cancelada') NOT NULL DEFAULT 'en_curso',
  resultado                ENUM('ok','con_danos') NULL,
  qr_token                 CHAR(16)     NOT NULL,   -- QR de la entrega: SENA-INSP:<qr_token> (se regenera al confirmar)
  checklist                JSON         NULL,       -- [{clave, etiqueta, ok}]
  items_ok                 JSON         NULL,       -- ids de los ítems que el instructor marcó OK al terminar la revisión
  estado_salon             JSON         NULL,       -- foto del estado del salón al recibirlo (conteos, reportes, novedades activas)
  observaciones            VARCHAR(500) NULL,
  iniciada_en              DATETIME     NOT NULL,
  confirmada_en            DATETIME     NULL,       -- el instructor termina la revisión
  qr_generado_en           DATETIME     NULL,       -- el portero genera el QR de entrega
  qr_instructor_token      CHAR(16)     NULL,       -- o el instructor muestra su QR (SENA-ENT:<token>) y el portero lo escanea
  qr_instructor_en         DATETIME     NULL,
  recibida_via             ENUM('qr_portero','qr_instructor') NULL, -- quién escaneó: el instructor el QR del portero o al revés
  recibida_en              DATETIME     NULL,       -- el instructor escanea el QR
  firma_portero            MEDIUMTEXT   NULL,       -- (sin uso: la constancia es el QR)
  firma_portero_nombre     VARCHAR(120) NULL,       -- nombre de quien entregó
  firma_instructor         MEDIUMTEXT   NULL,       -- (sin uso: la constancia es el QR)
  firma_instructor_nombre  VARCHAR(120) NULL,       -- nombre de quien recibió
  UNIQUE KEY uq_insp_qr (qr_token),
  UNIQUE KEY uq_insp_qr_instructor (qr_instructor_token),
  KEY ix_insp_env (environment_id, iniciada_en),
  KEY ix_insp_estado (estado),
  CONSTRAINT fk_insp_env        FOREIGN KEY (environment_id) REFERENCES environments(id) ON DELETE RESTRICT,
  CONSTRAINT fk_insp_instructor FOREIGN KEY (instructor_id)  REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_insp_portero    FOREIGN KEY (portero_id)     REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- Novedades permanentes (aire acondicionado dañado, video beam sin lámpara…):
-- nacen "en_curso" cuando un instructor las reporta (en una revisión o desde
-- el módulo de novedades) o las registra un administrativo, y siguen así,
-- revisión tras revisión, hasta que un instructor o un administrativo las
-- marca resueltas. Si el reporte que la abrió se retira antes de entregar el
-- ambiente, queda "anulada". Su historial completo está en audit_events.
CREATE TABLE persistent_issues (
  id                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  environment_id     INT UNSIGNED NOT NULL,
  inventory_item_id  INT UNSIGNED NULL,             -- ítem afectado, o
  family_id          INT UNSIGNED NULL,             -- la familia completa, o
  ubicacion          ENUM('pared','techo','piso','puerta','ventana','electrica','estructura','otro') NULL, -- el salón
  tipo_dano          ENUM('rotura','no_funciona','faltante','suciedad','otro') NOT NULL,
  severidad          ENUM('leve','moderada','grave') NOT NULL,
  descripcion        VARCHAR(500) NOT NULL,
  foto               VARCHAR(160) NULL,             -- evidencia con la que se abrió
  estado             ENUM('en_curso','resuelta','anulada') NOT NULL DEFAULT 'en_curso',
  reportada_por      INT UNSIGNED NULL,
  inspection_id      INT UNSIGNED NULL,             -- revisión en la que se reportó (NULL = registrada desde el módulo de novedades)
  creada_en          DATETIME     NOT NULL,
  resuelta_por       INT UNSIGNED NULL,
  resuelta_en        DATETIME     NULL,
  resolucion         VARCHAR(500) NULL,
  foto_resolucion    VARCHAR(160) NULL,             -- evidencia de la reparación (opcional)
  anulada_en         DATETIME     NULL,
  KEY ix_pi_estado (estado, environment_id),
  KEY ix_pi_item (inventory_item_id, estado),
  KEY ix_pi_familia (family_id, estado),
  CONSTRAINT fk_pi_env       FOREIGN KEY (environment_id)    REFERENCES environments(id)    ON DELETE RESTRICT,
  CONSTRAINT fk_pi_item      FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pi_familia   FOREIGN KEY (family_id)         REFERENCES item_families(id)   ON DELETE RESTRICT,
  CONSTRAINT fk_pi_reporta   FOREIGN KEY (reportada_por)     REFERENCES users(id)           ON DELETE SET NULL,
  CONSTRAINT fk_pi_insp      FOREIGN KEY (inspection_id)     REFERENCES inspections(id)     ON DELETE SET NULL,
  CONSTRAINT fk_pi_resuelve  FOREIGN KEY (resuelta_por)      REFERENCES users(id)           ON DELETE SET NULL,
  CONSTRAINT ck_pi_objetivo CHECK (inventory_item_id IS NOT NULL OR family_id IS NOT NULL OR ubicacion IS NOT NULL)
) ENGINE=InnoDB;

-- Cada novedad reportada en una revisión: de un ítem del inventario, de una
-- familia completa o, si es del salón (pared, techo, piso…), solo del ambiente
-- con su ubicación. naturaleza distingue lo permanente (va a persistent_issues
-- al recibir el ambiente) de las incidencias temporales y de limpieza.
CREATE TABLE inspection_items (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  inspection_id        INT UNSIGNED NOT NULL,
  inventory_item_id    INT UNSIGNED NULL,           -- ítem suelto o componente de una familia
  family_id            INT UNSIGNED NULL,           -- familia completa (todos sus componentes)
  ubicacion            ENUM('pared','techo','piso','puerta','ventana','electrica','estructura','otro') NULL,
  naturaleza           ENUM('permanente','temporal','limpieza') NOT NULL DEFAULT 'permanente',
  tipo_dano            ENUM('rotura','no_funciona','faltante','suciedad','otro') NOT NULL,
  severidad            ENUM('leve','moderada','grave') NOT NULL,
  comentario           VARCHAR(500) NOT NULL,
  foto                 VARCHAR(160) NULL,           -- evidencia: ruta relativa en uploads/danos/ (obligatoria desde la app)
  estado_item_anterior ENUM('operativo','danado','en_reparacion','fuera_servicio','baja') NOT NULL DEFAULT 'operativo', -- para deshacer el reporte
  estados_anteriores   JSON         NULL,           -- reporte de familia: {"<itemId>": "<estado>"} de cada componente
  persistent_issue_id  INT UNSIGNED NULL,           -- novedad permanente que abrió o a la que se sumó al recibir el ambiente
  reportado_en         DATETIME     NOT NULL,
  UNIQUE KEY uq_insp_item (inspection_id, inventory_item_id),
  UNIQUE KEY uq_insp_familia (inspection_id, family_id),
  KEY ix_ii_issue (persistent_issue_id),
  CONSTRAINT fk_ii_insp    FOREIGN KEY (inspection_id)       REFERENCES inspections(id)       ON DELETE CASCADE,
  CONSTRAINT fk_ii_item    FOREIGN KEY (inventory_item_id)   REFERENCES inventory_items(id)   ON DELETE RESTRICT,
  CONSTRAINT fk_ii_familia FOREIGN KEY (family_id)           REFERENCES item_families(id)     ON DELETE RESTRICT,
  CONSTRAINT fk_ii_issue   FOREIGN KEY (persistent_issue_id) REFERENCES persistent_issues(id) ON DELETE SET NULL,
  CONSTRAINT ck_ii_objetivo CHECK (inventory_item_id IS NOT NULL OR family_id IS NOT NULL OR ubicacion IS NOT NULL)
) ENGINE=InnoDB;

-- Trazabilidad de cada ítem del inventario.
CREATE TABLE item_history (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  inventory_item_id    INT UNSIGNED NOT NULL,
  user_id              INT UNSIGNED NULL,           -- NULL = proceso automático (instalación, carga por consola)
  accion               ENUM('registro','carga_masiva','escaneo','traslado','edicion','etiqueta','familia',
                            'dano','dano_retirado','novedad','novedad_resuelta','estado') NOT NULL,
  detalle              VARCHAR(300) NOT NULL,
  inspection_id        INT UNSIGNED NULL,
  persistent_issue_id  INT UNSIGNED NULL,
  created_at           DATETIME     NOT NULL,
  KEY ix_hist_item (inventory_item_id, created_at),
  CONSTRAINT fk_hist_item  FOREIGN KEY (inventory_item_id)   REFERENCES inventory_items(id)   ON DELETE CASCADE,
  CONSTRAINT fk_hist_user  FOREIGN KEY (user_id)             REFERENCES users(id)             ON DELETE SET NULL,
  CONSTRAINT fk_hist_insp  FOREIGN KEY (inspection_id)       REFERENCES inspections(id)       ON DELETE SET NULL,
  CONSTRAINT fk_hist_issue FOREIGN KEY (persistent_issue_id) REFERENCES persistent_issues(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE notifications (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id              INT UNSIGNED NOT NULL,
  tipo                 ENUM('revision_lista','entrega_recibida','dano_reportado','dano_grave','novedad_permanente','novedad_resuelta','asignacion',
                            'clase_cancelada','riesgo','excusa','excusa_revisada','p004') NOT NULL,
  titulo               VARCHAR(160) NOT NULL,
  detalle              VARCHAR(300) NOT NULL,
  inspection_id        INT UNSIGNED NULL,
  persistent_issue_id  INT UNSIGNED NULL,
  leida                TINYINT(1)   NOT NULL DEFAULT 0,
  created_at           DATETIME     NOT NULL,
  KEY ix_notif_user (user_id, leida),
  CONSTRAINT fk_notif_user  FOREIGN KEY (user_id)             REFERENCES users(id)             ON DELETE CASCADE,
  CONSTRAINT fk_notif_insp  FOREIGN KEY (inspection_id)       REFERENCES inspections(id)       ON DELETE CASCADE,
  CONSTRAINT fk_notif_issue FOREIGN KEY (persistent_issue_id) REFERENCES persistent_issues(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Asignación de instructores a ambientes por jornada.
--   dia:        fecha_inicio = fecha_fin
--   periodo:    fecha_inicio ≤ fecha_fin
--   permanente: fecha_fin NULL (vale hasta que se reasigne o se anule)
-- Reasignar desde una fecha recorta la asignación (fecha_fin = día anterior)
-- y crea la nueva con reemplaza_id; si es desde su primer día queda "reasignada".
CREATE TABLE instructor_assignments (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  environment_id  INT UNSIGNED NOT NULL,
  instructor_id   INT UNSIGNED NOT NULL,
  jornada         ENUM('manana','tarde','noche','fin_semana') NOT NULL, -- fin_semana: solo sábados y domingos
  tipo            ENUM('dia','periodo','permanente') NOT NULL,
  fecha_inicio    DATE         NOT NULL,
  fecha_fin       DATE         NULL,
  dias_semana     VARCHAR(13)  NULL,               -- "1,3,5" (ISO: 1 = lunes … 7 = domingo): solo esos días; NULL = todos
  estado          ENUM('vigente','reasignada','anulada') NOT NULL DEFAULT 'vigente',
  motivo          VARCHAR(300) NULL,
  reemplaza_id    INT UNSIGNED NULL,               -- asignación a la que reemplaza (reasignación)
  creada_por      INT UNSIGNED NULL,
  creada_en       DATETIME     NOT NULL,
  cerrada_por     INT UNSIGNED NULL,               -- quien la reasignó, recortó o anuló
  cerrada_en      DATETIME     NULL,
  motivo_cierre   VARCHAR(300) NULL,
  KEY ix_asig_env (environment_id, jornada, estado),
  KEY ix_asig_instructor (instructor_id, estado),
  CONSTRAINT fk_asig_env        FOREIGN KEY (environment_id) REFERENCES environments(id) ON DELETE RESTRICT,
  CONSTRAINT fk_asig_instructor FOREIGN KEY (instructor_id)  REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_asig_reemplaza  FOREIGN KEY (reemplaza_id)   REFERENCES instructor_assignments(id) ON DELETE SET NULL,
  CONSTRAINT fk_asig_crea       FOREIGN KEY (creada_por)     REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_asig_cierra     FOREIGN KEY (cerrada_por)    REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT ck_asig_fechas CHECK (fecha_fin IS NULL OR fecha_fin >= fecha_inicio)
) ENGINE=InnoDB;

-- Historial para auditoría: cada evento de una novedad (creada, reportada de
-- nuevo, modificada, resuelta, anulada) o de una asignación (creada,
-- reasignada, recortada, anulada) con fecha, usuario, detalle y evidencia.
CREATE TABLE audit_events (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entidad         ENUM('novedad','asignacion') NOT NULL,
  entidad_id      INT UNSIGNED NOT NULL,
  environment_id  INT UNSIGNED NULL,
  accion          VARCHAR(40)  NOT NULL,
  detalle         VARCHAR(500) NOT NULL,
  foto            VARCHAR(160) NULL,               -- evidencia del evento (foto del daño o de la reparación)
  datos           JSON         NULL,               -- antes/después de los campos que cambiaron
  user_id         INT UNSIGNED NULL,
  created_at      DATETIME     NOT NULL,
  KEY ix_audit_entidad (entidad, entidad_id, created_at),
  KEY ix_audit_fecha (created_at),
  CONSTRAINT fk_audit_env  FOREIGN KEY (environment_id) REFERENCES environments(id) ON DELETE SET NULL,
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id)        REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ===================== Fichas y asistencia a clases =====================
--
-- Una ficha es un grupo de aprendices de un programa. Coordinación la crea,
-- importa sus aprendices desde Excel/CSV (se crean como usuarios con una
-- contraseña temporal que llega por correo) y el primer ingreso obliga a
-- confirmar el correo y cambiar la contraseña. Las clases (sesiones) se
-- programan por ficha; el instructor muestra un QR y cada aprendiz lo escanea
-- dentro de la ventana de registro. Las faltas se calculan: clase no
-- cancelada, ventana cerrada y sin registro = falla, salvo que una excusa
-- aprobada cubra ese día (justificada).

CREATE TABLE fichas (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  codigo          VARCHAR(12)  NOT NULL,                 -- número de la ficha: 2758432
  programa        VARCHAR(160) NOT NULL,
  jornada         ENUM('manana','tarde','noche','fin_semana') NOT NULL DEFAULT 'manana',
  environment_id  INT UNSIGNED NULL,                     -- ambiente habitual
  instructor_id   INT UNSIGNED NULL,                     -- instructor líder: revisa las excusas de la ficha
  fecha_inicio    DATE         NULL,
  fecha_fin       DATE         NULL,
  activo          TINYINT(1)   NOT NULL DEFAULT 1,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_fichas_codigo (codigo),
  CONSTRAINT fk_ficha_env  FOREIGN KEY (environment_id) REFERENCES environments(id) ON DELETE SET NULL,
  CONSTRAINT fk_ficha_inst FOREIGN KEY (instructor_id)  REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE competencias (
  id      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nombre  VARCHAR(160) NOT NULL,
  UNIQUE KEY uq_competencia (nombre)
) ENGINE=InnoDB;

-- Sesión de clase: ficha, competencia, ambiente, instructor y horario. La
-- ventana de registro abre al inicio y dura ventana_min minutos.
CREATE TABLE clases (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ficha_id            INT UNSIGNED NOT NULL,
  competencia_id      INT UNSIGNED NOT NULL,
  environment_id      INT UNSIGNED NOT NULL,
  instructor_id       INT UNSIGNED NOT NULL,
  inicio              DATETIME     NOT NULL,
  fin                 DATETIME     NOT NULL,
  ventana_min         SMALLINT UNSIGNED NOT NULL DEFAULT 15,
  cancelada           TINYINT(1)   NOT NULL DEFAULT 0,
  motivo_cancelacion  VARCHAR(300) NULL,
  creada_por          INT UNSIGNED NULL,
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_clases_ficha (ficha_id, inicio),
  KEY ix_clases_inst (instructor_id, inicio),
  CONSTRAINT fk_clase_ficha FOREIGN KEY (ficha_id)       REFERENCES fichas(id)       ON DELETE CASCADE,
  CONSTRAINT fk_clase_comp  FOREIGN KEY (competencia_id) REFERENCES competencias(id) ON DELETE RESTRICT,
  CONSTRAINT fk_clase_env   FOREIGN KEY (environment_id) REFERENCES environments(id) ON DELETE RESTRICT,
  CONSTRAINT fk_clase_inst  FOREIGN KEY (instructor_id)  REFERENCES users(id)        ON DELETE RESTRICT,
  CONSTRAINT ck_clase_horas CHECK (fin > inicio)
) ENGINE=InnoDB;

-- QR emitidos para una clase: el nonce evita QR fabricados.
CREATE TABLE clase_qr (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  clase_id    INT UNSIGNED NOT NULL,
  nonce       CHAR(12)     NOT NULL,
  expira      DATETIME     NOT NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_qr_nonce (nonce),
  CONSTRAINT fk_qr_clase FOREIGN KEY (clase_id) REFERENCES clases(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Registro de entrada a clase (escaneando el QR del instructor). Las faltas no se guardan: se calculan.
CREATE TABLE asistencias (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  clase_id    INT UNSIGNED NOT NULL,
  aprendiz_id INT UNSIGNED NOT NULL,
  estado      ENUM('presente','tarde') NOT NULL,
  hora        DATETIME     NOT NULL,
  UNIQUE KEY uq_asistencia (clase_id, aprendiz_id),
  KEY ix_asis_aprendiz (aprendiz_id),
  CONSTRAINT fk_asis_clase    FOREIGN KEY (clase_id)    REFERENCES clases(id) ON DELETE CASCADE,
  CONSTRAINT fk_asis_aprendiz FOREIGN KEY (aprendiz_id) REFERENCES users(id)  ON DELETE CASCADE
) ENGINE=InnoDB;

-- Excusa del aprendiz con foto de evidencia y periodo de cobertura. Aprobada,
-- las faltas de esos días quedan "justificadas" (no cuentan en el semáforo).
CREATE TABLE excusas (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  aprendiz_id   INT UNSIGNED NOT NULL,
  ficha_id      INT UNSIGNED NULL,
  desde         DATE         NOT NULL,
  hasta         DATE         NOT NULL,
  motivo        VARCHAR(500) NOT NULL,
  foto          VARCHAR(160) NOT NULL,
  estado        ENUM('pendiente','aprobada','rechazada') NOT NULL DEFAULT 'pendiente',
  revisada_por  INT UNSIGNED NULL,
  revisada_en   DATETIME     NULL,
  observacion   VARCHAR(300) NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_excusa_aprendiz (aprendiz_id, desde),
  KEY ix_excusa_estado (estado),
  CONSTRAINT fk_excusa_aprendiz FOREIGN KEY (aprendiz_id)  REFERENCES users(id)  ON DELETE CASCADE,
  CONSTRAINT fk_excusa_ficha    FOREIGN KEY (ficha_id)     REFERENCES fichas(id) ON DELETE SET NULL,
  CONSTRAINT fk_excusa_revisa   FOREIGN KEY (revisada_por) REFERENCES users(id)  ON DELETE SET NULL,
  CONSTRAINT ck_excusa_fechas CHECK (hasta >= desde)
) ENGINE=InnoDB;

-- Estado académico (Sofía Plus, reporte P004): solo EN FORMACION y CONDICIONADO registran asistencia.
CREATE TABLE p004 (
  documento        VARCHAR(12)  NOT NULL PRIMARY KEY,
  nombre           VARCHAR(120) NOT NULL,
  ficha            VARCHAR(12)  NOT NULL,
  programa         VARCHAR(160) NOT NULL,
  estado           VARCHAR(30)  NOT NULL,
  actualizado_por  INT UNSIGNED NULL,
  actualizado_en   DATETIME     NULL,
  CONSTRAINT fk_p004_user FOREIGN KEY (actualizado_por) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Correos enviados (credenciales, códigos de verificación). En la prueba de
-- concepto quedan registrados aquí (CORREO_MODO = 'registro' en api/config.php)
-- y se consultan en Fichas → Correos enviados; con 'mail' además se envían.
CREATE TABLE correos (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     INT UNSIGNED NULL,
  para        VARCHAR(160) NOT NULL,
  asunto      VARCHAR(200) NOT NULL,
  cuerpo      TEXT         NOT NULL,              -- texto plano
  html        MEDIUMTEXT   NULL,                  -- versión HTML (con el botón "Ingresar a Ambientes SENA")
  estado      ENUM('registrado','enviado','error') NOT NULL,
  error       VARCHAR(300) NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_correos_user (user_id),
  CONSTRAINT fk_correo_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Plantillas editables del correo de credenciales (credenciales_aprendiz,
-- credenciales_instructor). Sin fila, se usa la de fábrica (api/lib/correo.php).
-- Campos: {nombre} {nombre_completo} {tipo_documento} {documento} {rol} {ficha} {programa} {clave} {enlace}
CREATE TABLE plantillas_correo (
  clave            VARCHAR(40)   NOT NULL PRIMARY KEY,
  asunto           VARCHAR(200)  NOT NULL,
  cuerpo           TEXT          NOT NULL,
  actualizado_por  INT UNSIGNED  NULL,
  actualizado_en   DATETIME      NOT NULL,
  CONSTRAINT fk_plantilla_user FOREIGN KEY (actualizado_por) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;
