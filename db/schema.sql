-- Base de datos de prueba · Entrega y revisión de ambientes SENA
-- MySQL / MariaDB (XAMPP). Se crea con `php db/instalar.php` o importando
-- este archivo y luego seed.sql en phpMyAdmin.
--
-- Flujo que modela (entrega del ambiente al instructor):
--   el instructor revisa el salón al entrar           → inspections (en_curso, instructor_id)
--   escanea los ítems dañados y deja foto              → inspection_items → inventory_items (estado 'danado')
--   termina la revisión                                → inspections (pendiente_recepcion) + notifications al portero
--   el portero genera el QR de entrega                 → inspections (portero_id, qr_token nuevo, qr_generado_en)
--   el instructor escanea el QR y confirma que recibe  → inspections (recibida, recibida_en)
--                                                        + notifications al portero y, si hay daños, a coordinación

CREATE DATABASE IF NOT EXISTS sena_ambientes CHARACTER SET utf8mb4 COLLATE utf8mb4_spanish_ci;
USE sena_ambientes;

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS notifications, inspection_items, inspections, inventory_items, environments, api_tokens, users;
SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE users (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tipo_documento  ENUM('CC','TI','CE','PPT') NOT NULL DEFAULT 'CC',
  documento       VARCHAR(12)  NOT NULL,
  nombre          VARCHAR(120) NOT NULL,
  email           VARCHAR(160) NULL,
  telefono        VARCHAR(20)  NULL,
  rol             ENUM('instructor','administrativo','portero','aprendiz') NOT NULL,
  ficha           VARCHAR(12)  NULL,              -- solo aprendices
  password_hash   VARCHAR(255) NOT NULL,
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

CREATE TABLE environments (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  codigo      VARCHAR(10)  NOT NULL,              -- número visible: 107, 108…
  nombre      VARCHAR(120) NOT NULL,
  bloque      VARCHAR(60)  NULL,
  capacidad   SMALLINT UNSIGNED NULL,
  portero_id  INT UNSIGNED NULL,                  -- portero asignado (recibe las notificaciones)
  activo      TINYINT(1)   NOT NULL DEFAULT 1,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_environments_codigo (codigo),
  CONSTRAINT fk_env_portero FOREIGN KEY (portero_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE inventory_items (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  environment_id  INT UNSIGNED NOT NULL,
  codigo          VARCHAR(30)  NOT NULL,           -- lo que lleva el QR de la etiqueta: SENA-INV:<codigo>
  nombre          VARCHAR(120) NOT NULL,
  categoria       VARCHAR(40)  NOT NULL,
  serial          VARCHAR(60)  NULL,
  estado          ENUM('operativo','danado','en_reparacion','baja') NOT NULL DEFAULT 'operativo',
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_items_codigo (codigo),
  KEY ix_items_env (environment_id),
  CONSTRAINT fk_items_env FOREIGN KEY (environment_id) REFERENCES environments(id) ON DELETE RESTRICT
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
  observaciones            VARCHAR(500) NULL,
  iniciada_en              DATETIME     NOT NULL,
  confirmada_en            DATETIME     NULL,       -- el instructor termina la revisión
  qr_generado_en           DATETIME     NULL,       -- el portero genera el QR de entrega
  recibida_en              DATETIME     NULL,       -- el instructor escanea el QR
  firma_portero            MEDIUMTEXT   NULL,       -- (sin uso: la constancia es el QR)
  firma_portero_nombre     VARCHAR(120) NULL,       -- nombre de quien entregó
  firma_instructor         MEDIUMTEXT   NULL,       -- (sin uso: la constancia es el QR)
  firma_instructor_nombre  VARCHAR(120) NULL,       -- nombre de quien recibió
  UNIQUE KEY uq_insp_qr (qr_token),
  KEY ix_insp_env (environment_id, iniciada_en),
  KEY ix_insp_estado (estado),
  CONSTRAINT fk_insp_env        FOREIGN KEY (environment_id) REFERENCES environments(id) ON DELETE RESTRICT,
  CONSTRAINT fk_insp_instructor FOREIGN KEY (instructor_id)  REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_insp_portero    FOREIGN KEY (portero_id)     REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- Cada daño reportado en una inspección, vinculado al ítem del inventario.
CREATE TABLE inspection_items (
  id                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  inspection_id      INT UNSIGNED NOT NULL,
  inventory_item_id  INT UNSIGNED NOT NULL,
  tipo_dano          ENUM('rotura','no_funciona','faltante','suciedad','otro') NOT NULL,
  severidad          ENUM('leve','moderada','grave') NOT NULL,
  comentario         VARCHAR(500) NOT NULL,
  foto               VARCHAR(160) NULL,             -- ruta relativa en uploads/danos/
  estado_item_anterior ENUM('operativo','danado','en_reparacion','baja') NOT NULL DEFAULT 'operativo', -- para deshacer el reporte
  reportado_en       DATETIME     NOT NULL,
  UNIQUE KEY uq_insp_item (inspection_id, inventory_item_id),
  CONSTRAINT fk_ii_insp FOREIGN KEY (inspection_id)     REFERENCES inspections(id) ON DELETE CASCADE,
  CONSTRAINT fk_ii_item FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE notifications (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id        INT UNSIGNED NOT NULL,
  tipo           ENUM('revision_lista','entrega_recibida','dano_reportado','dano_grave') NOT NULL,
  titulo         VARCHAR(160) NOT NULL,
  detalle        VARCHAR(300) NOT NULL,
  inspection_id  INT UNSIGNED NULL,
  leida          TINYINT(1)   NOT NULL DEFAULT 0,
  created_at     DATETIME     NOT NULL,
  KEY ix_notif_user (user_id, leida),
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id)       REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_notif_insp FOREIGN KEY (inspection_id) REFERENCES inspections(id) ON DELETE CASCADE
) ENGINE=InnoDB;
