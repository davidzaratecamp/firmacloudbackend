-- Migración: versionado de plantillas NPN (generaciones) con snapshot por envío.
-- Permite tener varias "generaciones" de plantilla/coordenadas de firma por NPN,
-- cambiar cuál está activa (swap) y volver atrás (rollback) sin afectar cartas
-- ya enviadas, cuyo estampado queda congelado en carta_template_snapshot.
-- No modifica signature_requests ni ninguna tabla del flujo original.

CREATE TABLE template_generations (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  label         VARCHAR(50)  NOT NULL UNIQUE,   -- 'oscar', 'ambetter', ...
  folder_name   VARCHAR(50)  NOT NULL,          -- subcarpeta dentro de PLANTILLAS_DIR ('' = raíz)
  sign_field_x  FLOAT NOT NULL,
  sign_field_y  FLOAT NOT NULL,
  sign_field_w  FLOAT NOT NULL,
  sign_field_h  FLOAT NOT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE npn_active_template (
  npn_name       VARCHAR(100) NOT NULL PRIMARY KEY,
  generation_id  INT NOT NULL,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_npn_active_template_generation
    FOREIGN KEY (generation_id) REFERENCES template_generations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Snapshot inmutable: qué generación se usó en CADA envío puntual, para que un
-- cambio posterior de npn_active_template nunca afecte el estampado de firma de
-- cartas ya enviadas (pueden quedar pendientes de firma por tiempo indefinido).
CREATE TABLE carta_template_snapshot (
  signature_request_id  VARCHAR(36) NOT NULL PRIMARY KEY,
  generation_id          INT NOT NULL,
  CONSTRAINT fk_carta_template_snapshot_request
    FOREIGN KEY (signature_request_id) REFERENCES signature_requests(id) ON DELETE CASCADE,
  CONSTRAINT fk_carta_template_snapshot_generation
    FOREIGN KEY (generation_id) REFERENCES template_generations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Backfill: generación 1 = comportamiento actual (raíz de PLANTILLAS_DIR,
-- coordenadas hoy en NPN_SIGN_FIELD_* del .env). Ajustar estos 4 valores si el
-- .env de destino no usa 35/95/280/60 antes de correr esta migración.
INSERT INTO template_generations (label, folder_name, sign_field_x, sign_field_y, sign_field_w, sign_field_h)
VALUES ('oscar', '', 35, 95, 280, 60);

SET @oscar_id = (SELECT id FROM template_generations WHERE label = 'oscar');

INSERT INTO npn_active_template (npn_name, generation_id)
SELECT DISTINCT npn_name, @oscar_id
FROM signature_requests
WHERE npn_name IS NOT NULL;

-- Por si algún NPN de la lista activa (constants/npns.js) aún no tiene ninguna
-- carta enviada y por lo tanto no salió en el SELECT anterior.
INSERT IGNORE INTO npn_active_template (npn_name, generation_id) VALUES
  ('Elaine Alfaro',      @oscar_id),
  ('Edislandy Agusti',   @oscar_id),
  ('Isser Milan',        @oscar_id),
  ('Jorge Otavo',        @oscar_id),
  ('Greter Ercia',       @oscar_id),
  ('Annalie Castañeda',  @oscar_id),
  ('Damaris Bueno',      @oscar_id),
  ('Dahanna Serrano',    @oscar_id),
  ('Daniel Ruiz',        @oscar_id),
  ('Katerine Chirino',   @oscar_id),
  ('Leonardo Pozo',      @oscar_id),
  ('Oscar Santana',      @oscar_id),
  ('Rosangela Santana',  @oscar_id),
  ('Josthin Hernandez',  @oscar_id),
  ('Alain Oropesa',      @oscar_id),
  ('Lazaro Quiros',      @oscar_id),
  ('Melanie Granados',   @oscar_id),
  ('Carlos Cruz Bracho', @oscar_id),
  ('Ernesto Redonet',    @oscar_id);

-- Generación nueva (plantillas Ambetter, calibrada 2026-08-04): misma X/W/H que 'oscar',
-- Y ajustada -16pt porque la línea "Firma de recibido" está más abajo en este diseño.
-- Todavía NO queda activa para ningún NPN — ver activate_ambetter_templates.sql para
-- el paso explícito de "hacer el corte" (swap) cuando se quiera.
INSERT INTO template_generations (label, folder_name, sign_field_x, sign_field_y, sign_field_w, sign_field_h)
VALUES ('ambetter', 'Ambetter', 35, 79, 280, 60);
