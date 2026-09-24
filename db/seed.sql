-- Datos de prueba · Entrega y revisión de ambientes SENA
-- Contraseña de todos los usuarios: Sena2026*  (hash bcrypt de PHP)
-- 3 instructores, 2 porteros, 1 administrativo, 3 aprendices;
-- ambientes 107, 108 y 109 con 10 ítems cada uno; 2 inspecciones históricas.
USE sena_ambientes;

SET @hash = '$2y$10$gndglKUBR3dn4W68IgPFJeNQmFAkIer8R0qbGTdlyZgvnJB.NBuIa';

INSERT INTO users (id, tipo_documento, documento, nombre, email, telefono, rol, ficha, password_hash) VALUES
  (1, 'CC', '1010101010', 'Laura Gómez Patiño',      'lgomez@sena.edu.co',     '3001112233', 'instructor',     NULL,      @hash),
  (2, 'CC', '1010101011', 'Andrés Felipe Castro',    'afcastro@sena.edu.co',   '3001112234', 'instructor',     NULL,      @hash),
  (3, 'CC', '1010101012', 'Diana Marcela Ruiz',      'dmruiz@sena.edu.co',     '3001112235', 'instructor',     NULL,      @hash),
  (4, 'CC', '4040404040', 'Jorge Enrique Salazar',   'jsalazar@sena.edu.co',   '3102223344', 'portero',        NULL,      @hash),
  (5, 'CC', '4040404041', 'Martha Lucía Peña',       'mlpena@sena.edu.co',     '3102223345', 'portero',        NULL,      @hash),
  (6, 'CC', '2020202020', 'Carlos Méndez Ruiz',      'cmendez@sena.edu.co',    '3203334455', 'administrativo', NULL,      @hash),
  (7, 'TI', '1122334455', 'Camila Rojas Herrera',    'crojas@soy.sena.edu.co', '3014445566', 'aprendiz',       '2758432', @hash),
  (8, 'CC', '1122334456', 'Mateo Torres Ramírez',    'mtorres@soy.sena.edu.co','3014445567', 'aprendiz',       '2758432', @hash),
  (9, 'CC', '1122334457', 'Sara Cárdenas Vega',      'scardenas@soy.sena.edu.co','3014445568','aprendiz',      '2834519', @hash);

-- 107 y 108 los recibe Jorge; 109, Martha.
INSERT INTO environments (id, codigo, nombre, bloque, capacidad, portero_id) VALUES
  (1, '107', 'Sistemas y desarrollo de software', 'Bloque A · Piso 1', 30, 4),
  (2, '108', 'Contabilidad y finanzas',           'Bloque A · Piso 1', 28, 4),
  (3, '109', 'Electrónica y automatización',      'Bloque A · Piso 1', 24, 5);

INSERT INTO inventory_items (environment_id, codigo, nombre, categoria, serial, estado) VALUES
  (1, 'AMB107-001', 'Computador de escritorio #1', 'Cómputo',         'HP-7K21A01', 'operativo'),
  (1, 'AMB107-002', 'Computador de escritorio #2', 'Cómputo',         'HP-7K21A02', 'operativo'),
  (1, 'AMB107-003', 'Computador de escritorio #3', 'Cómputo',         'HP-7K21A03', 'operativo'),
  (1, 'AMB107-004', 'Computador de escritorio #4', 'Cómputo',         'HP-7K21A04', 'operativo'),
  (1, 'AMB107-005', 'Video beam Epson',             'Audiovisual',     'EPS-X41-0107', 'operativo'),
  (1, 'AMB107-006', 'Tablero acrílico',             'Mobiliario',      NULL,         'operativo'),
  (1, 'AMB107-007', 'Aire acondicionado',           'Infraestructura', 'LG-AC-24K-07','operativo'),
  (1, 'AMB107-008', 'Switch 24 puertos',            'Redes',           'TPL-SG24-07','operativo'),
  (1, 'AMB107-009', 'Silla ergonómica (lote 30)',   'Mobiliario',      NULL,         'operativo'),
  (1, 'AMB107-010', 'Mesa de trabajo (lote 15)',    'Mobiliario',      NULL,         'operativo'),

  (2, 'AMB108-001', 'Computador portátil #1',       'Cómputo',         'LEN-T14-0801', 'operativo'),
  (2, 'AMB108-002', 'Computador portátil #2',       'Cómputo',         'LEN-T14-0802', 'operativo'),
  (2, 'AMB108-003', 'Computador portátil #3',       'Cómputo',         'LEN-T14-0803', 'operativo'),
  (2, 'AMB108-004', 'Impresora multifuncional',     'Cómputo',         'EPS-L6270-08', 'operativo'),
  (2, 'AMB108-005', 'Televisor 55"',                'Audiovisual',     'SAM-55-0108',  'operativo'),
  (2, 'AMB108-006', 'Tablero acrílico',             'Mobiliario',      NULL,           'operativo'),
  (2, 'AMB108-007', 'Ventilador de techo',          'Infraestructura', NULL,           'operativo'),
  (2, 'AMB108-008', 'Calculadoras financieras (10)','Herramientas',    NULL,           'operativo'),
  (2, 'AMB108-009', 'Silla (lote 28)',              'Mobiliario',      NULL,           'operativo'),
  (2, 'AMB108-010', 'Archivador metálico',          'Mobiliario',      NULL,           'operativo'),

  (3, 'AMB109-001', 'Osciloscopio digital #1',      'Laboratorio',     'RIG-DS1054-01', 'operativo'),
  (3, 'AMB109-002', 'Osciloscopio digital #2',      'Laboratorio',     'RIG-DS1054-02', 'operativo'),
  (3, 'AMB109-003', 'Fuente de poder DC',           'Laboratorio',     'UNI-3005-109',  'operativo'),
  (3, 'AMB109-004', 'Multímetro (lote 12)',         'Herramientas',    NULL,            'operativo'),
  (3, 'AMB109-005', 'Estación de soldadura',        'Herramientas',    'HAK-FX888-09',  'en_reparacion'),
  (3, 'AMB109-006', 'Kit Arduino (lote 12)',        'Laboratorio',     NULL,            'operativo'),
  (3, 'AMB109-007', 'Computador de escritorio',     'Cómputo',         'DEL-OPT-1091',  'operativo'),
  (3, 'AMB109-008', 'Video beam',                   'Audiovisual',     'EPS-X41-0109',  'operativo'),
  (3, 'AMB109-009', 'Extintor ABC',                 'Seguridad',       'EXT-ABC-109',   'operativo'),
  (3, 'AMB109-010', 'Mesa de laboratorio (lote 6)', 'Mobiliario',      NULL,            'operativo');

-- Historial: dos inspecciones ya recibidas (ayer y antier) para que los
-- reportes tengan datos desde el primer momento.
SET @checklist_ok = '[{"clave":"aseo","etiqueta":"Aseo y orden","ok":true},{"clave":"luces","etiqueta":"Iluminación","ok":true},{"clave":"ventilacion","etiqueta":"Aire / ventilación","ok":true},{"clave":"puertas","etiqueta":"Puertas, ventanas y chapas","ok":true},{"clave":"mobiliario","etiqueta":"Sillas y mesas","ok":true},{"clave":"equipos","etiqueta":"Equipos encienden","ok":true},{"clave":"electrico","etiqueta":"Tomas y cableado seguros","ok":true},{"clave":"senalizacion","etiqueta":"Señalización y extintor","ok":true}]';
SET @checklist_novedad = REPLACE(@checklist_ok, '"clave":"equipos","etiqueta":"Equipos encienden","ok":true', '"clave":"equipos","etiqueta":"Equipos encienden","ok":false');

INSERT INTO inspections (id, environment_id, instructor_id, portero_id, estado, resultado, qr_token, checklist, observaciones,
                         iniciada_en, confirmada_en, qr_generado_en, recibida_en, firma_instructor_nombre, firma_portero_nombre) VALUES
  (1, 1, 1, 4, 'recibida', 'ok',        'H1A2B3C4D5E6F7A8', @checklist_ok,       NULL,
     TIMESTAMP(CURDATE() - INTERVAL 2 DAY, '06:52:00'), TIMESTAMP(CURDATE() - INTERVAL 2 DAY, '07:05:00'), TIMESTAMP(CURDATE() - INTERVAL 2 DAY, '07:10:00'), TIMESTAMP(CURDATE() - INTERVAL 2 DAY, '07:12:00'),
     'Laura Gómez Patiño', 'Jorge Enrique Salazar'),
  (2, 3, 3, 5, 'recibida', 'con_danos', 'H9B8C7D6E5F4A3B2', @checklist_novedad, 'La estación de soldadura no calienta; se envía a mantenimiento.',
     TIMESTAMP(CURDATE() - INTERVAL 1 DAY, '06:48:00'), TIMESTAMP(CURDATE() - INTERVAL 1 DAY, '07:09:00'), TIMESTAMP(CURDATE() - INTERVAL 1 DAY, '07:18:00'), TIMESTAMP(CURDATE() - INTERVAL 1 DAY, '07:20:00'),
     'Diana Marcela Ruiz', 'Martha Lucía Peña');

INSERT INTO inspection_items (inspection_id, inventory_item_id, tipo_dano, severidad, comentario, foto, reportado_en)
  SELECT 2, id, 'no_funciona', 'moderada', 'La punta no calienta aunque la estación enciende. Se retira de uso.', NULL,
         TIMESTAMP(CURDATE() - INTERVAL 1 DAY, '07:02:00')
  FROM inventory_items WHERE codigo = 'AMB109-005';

-- Trazabilidad inicial: registro de los ítems base y el daño histórico del 109.
INSERT INTO item_history (inventory_item_id, user_id, accion, detalle, created_at)
  SELECT id, 6, 'registro', 'Registrado en el inventario inicial', TIMESTAMP(CURDATE() - INTERVAL 30 DAY, '08:00:00') FROM inventory_items;
INSERT INTO item_history (inventory_item_id, user_id, accion, detalle, inspection_id, created_at)
  SELECT inventory_item_id, 3, 'dano', 'Daño reportado en revisión: no funciona (moderada)', 2, reportado_en FROM inspection_items WHERE inspection_id = 2;
