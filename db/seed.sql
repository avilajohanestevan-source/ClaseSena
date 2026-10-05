-- Datos de prueba · Entrega y revisión de ambientes SENA
-- Contraseña de todos los usuarios: Sena2026*  (hash bcrypt de PHP)
-- 3 instructores, 2 porteros, 3 administrativos (administrativo, coordinación
-- e inventario), 3 aprendices; 6 especialidades; ambientes 107 a 111; 11
-- categorías de inventario; familias de ítems (PC, estación de cocina, kit de
-- grabación); 2 inspecciones históricas, 3 novedades permanentes (2 en curso)
-- con su historial de auditoría y asignaciones de instructores por jornada.
-- db/inventario-prueba.xlsx completa el inventario con la carga masiva
-- (monitores, teclados y mouse de cada familia PC y los ambientes 110 y 111).
USE sena_ambientes;

SET @hash = '$2y$10$gndglKUBR3dn4W68IgPFJeNQmFAkIer8R0qbGTdlyZgvnJB.NBuIa';

INSERT INTO users (id, tipo_documento, documento, nombre, email, telefono, rol, area, ficha, password_hash) VALUES
  (1,  'CC', '1010101010', 'Laura Gómez Patiño',      'lgomez@sena.edu.co',       '3001112233', 'instructor',     NULL,             NULL,      @hash),
  (2,  'CC', '1010101011', 'Andrés Felipe Castro',    'afcastro@sena.edu.co',     '3001112234', 'instructor',     NULL,             NULL,      @hash),
  (3,  'CC', '1010101012', 'Diana Marcela Ruiz',      'dmruiz@sena.edu.co',       '3001112235', 'instructor',     NULL,             NULL,      @hash),
  (4,  'CC', '4040404040', 'Jorge Enrique Salazar',   'jsalazar@sena.edu.co',     '3102223344', 'portero',        NULL,             NULL,      @hash),
  (5,  'CC', '4040404041', 'Martha Lucía Peña',       'mlpena@sena.edu.co',       '3102223345', 'portero',        NULL,             NULL,      @hash),
  (6,  'CC', '2020202020', 'Carlos Méndez Ruiz',      'cmendez@sena.edu.co',      '3203334455', 'administrativo', 'administrativo', NULL,      @hash),
  (7,  'TI', '1122334455', 'Camila Rojas Herrera',    'crojas@soy.sena.edu.co',   '3014445566', 'aprendiz',       NULL,             '2758432', @hash),
  (8,  'CC', '1122334456', 'Mateo Torres Ramírez',    'mtorres@soy.sena.edu.co',  '3014445567', 'aprendiz',       NULL,             '2758432', @hash),
  (9,  'CC', '1122334457', 'Sara Cárdenas Vega',      'scardenas@soy.sena.edu.co','3014445568', 'aprendiz',       NULL,             '2834519', @hash),
  (10, 'CC', '2020202021', 'Patricia Rondón Gil',     'prondon@sena.edu.co',      '3203334456', 'administrativo', 'coordinacion',   NULL,      @hash),
  (11, 'CC', '2020202022', 'Hernán Darío Ospina',     'hdospina@sena.edu.co',     '3203334457', 'almacen',        NULL,             NULL,      @hash);

INSERT INTO especialidades_ambiente (id, nombre, descripcion) VALUES
  (1, 'Sistemas',          'Computadores por puesto, red y video beam'),
  (2, 'Aula convencional', 'Sillas, mesas y tablero'),
  (3, 'Laboratorio',       'Equipos de medición y prácticas'),
  (4, 'Cocina',            'Estaciones de cocina y electrodomésticos'),
  (5, 'Audiovisual',       'Cámaras, iluminación y edición'),
  (6, 'Axo',               'Ambiente Axo');

-- 107, 108 y 110 los recibe Jorge; 109 y 111, Martha.
INSERT INTO environments (id, codigo, nombre, capacidad_aprendices, especialidad_id, portero_id) VALUES
  (1, '107', 'Sistemas y desarrollo de software',   30, 1, 4),
  (2, '108', 'Contabilidad y finanzas',             28, 2, 4),
  (3, '109', 'Electrónica y automatización',        24, 3, 5),
  (4, '110', 'Cocina y gastronomía',                20, 4, 4),
  (5, '111', 'Producción audiovisual y multimedia', 18, 5, 5);

INSERT INTO inventory_categories (id, nombre, descripcion) VALUES
  (1,  'Inmuebles',            'Puertas, ventanas, divisiones y elementos fijos del salón'),
  (2,  'Mobiliario',           'Sillas, mesas, tableros, archivadores'),
  (3,  'Electrodomésticos',    'Aire acondicionado, ventiladores, nevera, estufa, horno'),
  (4,  'Equipos Informáticos', 'Computadores de escritorio (CPU) y portátiles'),
  (5,  'Periféricos',          'Monitores, teclados, mouse, impresoras'),
  (6,  'Audiovisual',          'Video beam, televisores, cámaras, parlantes'),
  (7,  'Redes',                'Switches, routers, puntos de acceso'),
  (8,  'Laboratorio',          'Equipos de medición y prácticas'),
  (9,  'Herramientas',         'Herramientas de mano y de taller'),
  (10, 'Utensilios de cocina', 'Ollas, sartenes, cuchillos'),
  (11, 'Seguridad',            'Extintores, botiquines, señalización');

-- Familias: el computador (CPU o portátil) va en seed.sql; su monitor, teclado y
-- mouse llegan en db/inventario-prueba.xlsx con la columna "familia".
INSERT INTO item_families (id, environment_id, codigo, tipo, nombre) VALUES
  (1, 1, 'FAM107-PC01', 'PC', 'PC puesto 1'),
  (2, 1, 'FAM107-PC02', 'PC', 'PC puesto 2'),
  (3, 1, 'FAM107-PC03', 'PC', 'PC puesto 3'),
  (4, 1, 'FAM107-PC04', 'PC', 'PC puesto 4'),
  (5, 2, 'FAM108-PC01', 'PC', 'PC puesto 1'),
  (6, 2, 'FAM108-PC02', 'PC', 'PC puesto 2'),
  (7, 2, 'FAM108-PC03', 'PC', 'PC puesto 3'),
  (8, 3, 'FAM109-PC01', 'PC', 'PC del instructor');

-- Categorías: 1 Inmuebles · 2 Mobiliario · 3 Electrodomésticos · 4 Equipos Informáticos · 5 Periféricos
--             6 Audiovisual · 7 Redes · 8 Laboratorio · 9 Herramientas · 10 Utensilios de cocina · 11 Seguridad
-- AMB107-005 conserva la placa anterior en su QR (qr_value distinto de SENA-INV:<codigo>).
INSERT INTO inventory_items (environment_id, codigo, qr_value, nombre, category_id, family_id, serial, estado) VALUES
  (1, 'AMB107-001', 'SENA-INV:AMB107-001', 'Computador de escritorio #1', 4, 1, 'HP-7K21A01',   'operativo'),
  (1, 'AMB107-002', 'SENA-INV:AMB107-002', 'Computador de escritorio #2', 4, 2, 'HP-7K21A02',   'operativo'),
  (1, 'AMB107-003', 'SENA-INV:AMB107-003', 'Computador de escritorio #3', 4, 3, 'HP-7K21A03',   'operativo'),
  (1, 'AMB107-004', 'SENA-INV:AMB107-004', 'Computador de escritorio #4', 4, 4, 'HP-7K21A04',   'operativo'),
  (1, 'AMB107-005', 'PLACA-SENA-000457',   'Video beam Epson',            6, NULL, 'EPS-X41-0107', 'operativo'),
  (1, 'AMB107-006', 'SENA-INV:AMB107-006', 'Tablero acrílico',            2, NULL, NULL,           'operativo'),
  (1, 'AMB107-007', 'SENA-INV:AMB107-007', 'Aire acondicionado',          3, NULL, 'LG-AC-24K-07', 'fuera_servicio'),
  (1, 'AMB107-008', 'SENA-INV:AMB107-008', 'Switch 24 puertos',           7, NULL, 'TPL-SG24-07',  'operativo'),
  (1, 'AMB107-009', 'SENA-INV:AMB107-009', 'Silla ergonómica (lote 30)',  2, NULL, NULL,           'operativo'),
  (1, 'AMB107-010', 'SENA-INV:AMB107-010', 'Mesa de trabajo (lote 15)',   2, NULL, NULL,           'operativo'),

  (2, 'AMB108-001', 'SENA-INV:AMB108-001', 'Computador portátil #1',      4, 5, 'LEN-T14-0801', 'operativo'),
  (2, 'AMB108-002', 'SENA-INV:AMB108-002', 'Computador portátil #2',      4, 6, 'LEN-T14-0802', 'operativo'),
  (2, 'AMB108-003', 'SENA-INV:AMB108-003', 'Computador portátil #3',      4, 7, 'LEN-T14-0803', 'operativo'),
  (2, 'AMB108-004', 'SENA-INV:AMB108-004', 'Impresora multifuncional',    5, NULL, 'EPS-L6270-08', 'operativo'),
  (2, 'AMB108-005', 'SENA-INV:AMB108-005', 'Televisor 55"',               6, NULL, 'SAM-55-0108',  'operativo'),
  (2, 'AMB108-006', 'SENA-INV:AMB108-006', 'Tablero acrílico',            2, NULL, NULL,           'operativo'),
  (2, 'AMB108-007', 'SENA-INV:AMB108-007', 'Ventilador de techo',         3, NULL, NULL,           'operativo'),
  (2, 'AMB108-008', 'SENA-INV:AMB108-008', 'Calculadoras financieras (10)', 9, NULL, NULL,         'operativo'),
  (2, 'AMB108-009', 'SENA-INV:AMB108-009', 'Silla (lote 28)',             2, NULL, NULL,           'operativo'),
  (2, 'AMB108-010', 'SENA-INV:AMB108-010', 'Archivador metálico',         2, NULL, NULL,           'operativo'),

  (3, 'AMB109-001', 'SENA-INV:AMB109-001', 'Osciloscopio digital #1',     8, NULL, 'RIG-DS1054-01', 'operativo'),
  (3, 'AMB109-002', 'SENA-INV:AMB109-002', 'Osciloscopio digital #2',     8, NULL, 'RIG-DS1054-02', 'operativo'),
  (3, 'AMB109-003', 'SENA-INV:AMB109-003', 'Fuente de poder DC',          8, NULL, 'UNI-3005-109',  'operativo'),
  (3, 'AMB109-004', 'SENA-INV:AMB109-004', 'Multímetro (lote 12)',        9, NULL, NULL,            'operativo'),
  (3, 'AMB109-005', 'SENA-INV:AMB109-005', 'Estación de soldadura',       9, NULL, 'HAK-FX888-09',  'en_reparacion'),
  (3, 'AMB109-006', 'SENA-INV:AMB109-006', 'Kit Arduino (lote 12)',       8, NULL, NULL,            'operativo'),
  (3, 'AMB109-007', 'SENA-INV:AMB109-007', 'Computador de escritorio',    4, 8, 'DEL-OPT-1091',     'operativo'),
  (3, 'AMB109-008', 'SENA-INV:AMB109-008', 'Video beam',                  6, NULL, 'EPS-X41-0109',  'operativo'),
  (3, 'AMB109-009', 'SENA-INV:AMB109-009', 'Extintor ABC',                11, NULL, 'EXT-ABC-109',  'operativo'),
  (3, 'AMB109-010', 'SENA-INV:AMB109-010', 'Mesa de laboratorio (lote 6)', 2, NULL, NULL,           'operativo');

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

-- Novedades permanentes: la estación de soldadura (de la revisión de ayer, activa),
-- el aire acondicionado del 107 (registrado por coordinación, fuera de servicio,
-- activo) y el ventilador del 108 (ya resuelto por inventario).
INSERT INTO persistent_issues (id, environment_id, inventory_item_id, tipo_dano, severidad, descripcion, estado,
                               reportada_por, inspection_id, creada_en, resuelta_por, resuelta_en, resolucion)
  SELECT 1, 3, id, 'no_funciona', 'moderada', 'La punta no calienta aunque la estación enciende. Se retira de uso.', 'en_curso',
         3, 2, TIMESTAMP(CURDATE() - INTERVAL 1 DAY, '07:20:00'), NULL, NULL, NULL
  FROM inventory_items WHERE codigo = 'AMB109-005';
INSERT INTO persistent_issues (id, environment_id, inventory_item_id, tipo_dano, severidad, descripcion, estado,
                               reportada_por, inspection_id, creada_en, resuelta_por, resuelta_en, resolucion)
  SELECT 2, 1, id, 'no_funciona', 'grave', 'El aire acondicionado no enfría y el compresor hace ruido. Mantenimiento lo revisa la próxima semana.', 'en_curso',
         10, NULL, TIMESTAMP(CURDATE() - INTERVAL 3 DAY, '10:15:00'), NULL, NULL, NULL
  FROM inventory_items WHERE codigo = 'AMB107-007';
INSERT INTO persistent_issues (id, environment_id, inventory_item_id, tipo_dano, severidad, descripcion, estado,
                               reportada_por, inspection_id, creada_en, resuelta_por, resuelta_en, resolucion)
  SELECT 3, 2, id, 'rotura', 'moderada', 'Un aspa del ventilador está partida y vibra al encenderlo.', 'resuelta',
         6, NULL, TIMESTAMP(CURDATE() - INTERVAL 12 DAY, '09:30:00'), 11, TIMESTAMP(CURDATE() - INTERVAL 5 DAY, '15:40:00'), 'Se cambió el juego de aspas y se balanceó el ventilador.'
  FROM inventory_items WHERE codigo = 'AMB108-007';

INSERT INTO inspection_items (inspection_id, inventory_item_id, naturaleza, tipo_dano, severidad, comentario, foto, persistent_issue_id, reportado_en)
  SELECT 2, id, 'permanente', 'no_funciona', 'moderada', 'La punta no calienta aunque la estación enciende. Se retira de uso.', NULL, 1,
         TIMESTAMP(CURDATE() - INTERVAL 1 DAY, '07:02:00')
  FROM inventory_items WHERE codigo = 'AMB109-005';

-- Trazabilidad inicial: registro de los ítems base, sus familias, el daño histórico del 109 y las novedades permanentes.
INSERT INTO item_history (inventory_item_id, user_id, accion, detalle, created_at)
  SELECT id, 11, 'registro', 'Registrado en el inventario inicial', TIMESTAMP(CURDATE() - INTERVAL 30 DAY, '08:00:00') FROM inventory_items;
INSERT INTO item_history (inventory_item_id, user_id, accion, detalle, created_at)
  SELECT i.id, 11, 'familia', CONCAT('Asignado a la familia ', f.codigo, ' (', f.nombre, ')'), TIMESTAMP(CURDATE() - INTERVAL 30 DAY, '08:05:00')
  FROM inventory_items i JOIN item_families f ON f.id = i.family_id;
INSERT INTO item_history (inventory_item_id, user_id, accion, detalle, inspection_id, created_at)
  SELECT inventory_item_id, 3, 'dano', 'Daño reportado en revisión: no funciona (moderada) · novedad permanente', 2, reportado_en FROM inspection_items WHERE inspection_id = 2;
INSERT INTO item_history (inventory_item_id, user_id, accion, detalle, inspection_id, persistent_issue_id, created_at)
  SELECT inventory_item_id, reportada_por, 'novedad', CONCAT('Novedad permanente #', id, ' abierta: ', descripcion), inspection_id, id, creada_en
  FROM persistent_issues;
INSERT INTO item_history (inventory_item_id, user_id, accion, detalle, persistent_issue_id, created_at)
  SELECT inventory_item_id, 10, 'estado', 'Estado: Dañado → Fuera de servicio (novedad permanente #2)', 2, TIMESTAMP(CURDATE() - INTERVAL 3 DAY, '10:20:00')
  FROM persistent_issues WHERE id = 2;
INSERT INTO item_history (inventory_item_id, user_id, accion, detalle, persistent_issue_id, created_at)
  SELECT inventory_item_id, resuelta_por, 'novedad_resuelta', CONCAT('Novedad permanente #', id, ' resuelta: ', resolucion, ' Vuelve a Operativo.'), id, resuelta_en
  FROM persistent_issues WHERE estado = 'resuelta';

-- Historial de auditoría de las novedades: apertura (con su evidencia), cambio a
-- fuera de servicio del aire del 107 y resolución del ventilador del 108.
INSERT INTO audit_events (entidad, entidad_id, environment_id, accion, detalle, foto, user_id, created_at)
  SELECT 'novedad', id, environment_id, 'creada', CONCAT('Novedad permanente abierta: ', descripcion), foto, reportada_por, creada_en FROM persistent_issues;
INSERT INTO audit_events (entidad, entidad_id, environment_id, accion, detalle, user_id, created_at) VALUES
  ('novedad', 2, 1, 'modificada', 'Ítem AMB107-007: Dañado → Fuera de servicio hasta su reparación', 10, TIMESTAMP(CURDATE() - INTERVAL 3 DAY, '10:20:00')),
  ('novedad', 3, 2, 'resuelta', 'Resuelta: Se cambió el juego de aspas y se balanceó el ventilador. AMB108-007 vuelve a Operativo', 11, TIMESTAMP(CURDATE() - INTERVAL 5 DAY, '15:40:00'));

-- Asignación de instructores por jornada.
--   107 mañana: Laura (permanente); mañana la reemplaza Diana solo por ese día.
--   107 tarde: Andrés (periodo de 30 días). 108 noche: Diana (periodo).
--   109 mañana: Diana (permanente). 110 tarde: Laura hasta hace 4 días, reasignada a Andrés.
--   111 noche: un turno de Laura de antier que se anuló.
INSERT INTO instructor_assignments (id, environment_id, instructor_id, jornada, tipo, fecha_inicio, fecha_fin, estado, motivo, reemplaza_id,
                                    creada_por, creada_en, cerrada_por, cerrada_en, motivo_cierre) VALUES
  (1, 1, 1, 'manana', 'permanente', CURDATE() - INTERVAL 30 DAY, NULL, 'vigente', 'Ficha 2758432 · Análisis y desarrollo de software', NULL,
     10, TIMESTAMP(CURDATE() - INTERVAL 31 DAY, '09:00:00'), NULL, NULL, NULL),
  (2, 1, 2, 'tarde', 'periodo', CURDATE() - INTERVAL 10 DAY, CURDATE() + INTERVAL 20 DAY, 'vigente', 'Competencia de bases de datos', NULL,
     10, TIMESTAMP(CURDATE() - INTERVAL 11 DAY, '09:10:00'), NULL, NULL, NULL),
  (3, 3, 3, 'manana', 'permanente', CURDATE() - INTERVAL 30 DAY, NULL, 'vigente', 'Ficha 2834519 · Electrónica', NULL,
     10, TIMESTAMP(CURDATE() - INTERVAL 31 DAY, '09:20:00'), NULL, NULL, NULL),
  (4, 2, 3, 'noche', 'periodo', CURDATE() - INTERVAL 5 DAY, CURDATE() + INTERVAL 25 DAY, 'vigente', 'Curso complementario de contabilidad', NULL,
     6, TIMESTAMP(CURDATE() - INTERVAL 6 DAY, '14:00:00'), NULL, NULL, NULL),
  (5, 1, 3, 'manana', 'dia', CURDATE() + INTERVAL 1 DAY, CURDATE() + INTERVAL 1 DAY, 'vigente', 'Laura Gómez está en capacitación ese día', NULL,
     10, TIMESTAMP(CURDATE() - INTERVAL 1 DAY, '16:30:00'), NULL, NULL, NULL),
  (6, 4, 1, 'tarde', 'permanente', CURDATE() - INTERVAL 20 DAY, CURDATE() - INTERVAL 4 DAY, 'vigente', 'Ficha de cocina 2901122', NULL,
     10, TIMESTAMP(CURDATE() - INTERVAL 21 DAY, '08:00:00'), 10, TIMESTAMP(CURDATE() - INTERVAL 4 DAY, '17:00:00'), 'Cambio de horario de Laura Gómez'),
  (7, 4, 2, 'tarde', 'permanente', CURDATE() - INTERVAL 3 DAY, NULL, 'vigente', 'Cambio de horario de Laura Gómez', 6,
     10, TIMESTAMP(CURDATE() - INTERVAL 4 DAY, '17:00:00'), NULL, NULL, NULL),
  (8, 5, 1, 'noche', 'dia', CURDATE() - INTERVAL 2 DAY, CURDATE() - INTERVAL 2 DAY, 'anulada', 'Taller de edición', NULL,
     6, TIMESTAMP(CURDATE() - INTERVAL 5 DAY, '10:00:00'), 6, TIMESTAMP(CURDATE() - INTERVAL 3 DAY, '11:00:00'), 'Se aplazó el taller');

INSERT INTO audit_events (entidad, entidad_id, environment_id, accion, detalle, user_id, created_at)
  SELECT 'asignacion', a.id, a.environment_id, 'creada',
         CONCAT(u.nombre, ' · ', ELT(FIELD(a.jornada, 'manana', 'tarde', 'noche'), 'mañana', 'tarde', 'noche'), ' · ',
                CASE a.tipo WHEN 'dia' THEN CONCAT('solo el ', DATE_FORMAT(a.fecha_inicio, '%Y-%m-%d'))
                            WHEN 'periodo' THEN CONCAT('del ', DATE_FORMAT(a.fecha_inicio, '%Y-%m-%d'), ' al ', DATE_FORMAT(a.fecha_fin, '%Y-%m-%d'))
                            ELSE CONCAT('permanente desde el ', DATE_FORMAT(a.fecha_inicio, '%Y-%m-%d')) END),
         a.creada_por, a.creada_en
  FROM instructor_assignments a JOIN users u ON u.id = a.instructor_id;
INSERT INTO audit_events (entidad, entidad_id, environment_id, accion, detalle, user_id, created_at) VALUES
  ('asignacion', 6, 4, 'reasignada', 'Laura Gómez Patiño → Andrés Felipe Castro desde el día siguiente · Cambio de horario de Laura Gómez', 10, TIMESTAMP(CURDATE() - INTERVAL 4 DAY, '17:00:00')),
  ('asignacion', 8, 5, 'anulada', 'Turno anulado: Se aplazó el taller', 6, TIMESTAMP(CURDATE() - INTERVAL 3 DAY, '11:00:00'));
