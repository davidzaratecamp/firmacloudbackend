-- Migración: extraer los campos del formulario NPN (actualización de datos)
-- de signature_requests hacia una tabla propia del módulo NPN.
-- Ejecutar una vez sobre la base de datos firmacloud.

CREATE TABLE carta_form_data (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  signature_request_id VARCHAR(36)  NOT NULL,
  name                  VARCHAR(150) NULL,
  phone                 VARCHAR(20)  NULL,
  email                 VARCHAR(150) NULL,
  postalcode            VARCHAR(20)  NULL,
  submitted_at          DATETIME     NULL,
  social_path           VARCHAR(500) NULL,
  status_path           VARCHAR(500) NULL,
  created_at            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_carta_form_data_request (signature_request_id),
  CONSTRAINT fk_carta_form_data_request
    FOREIGN KEY (signature_request_id) REFERENCES signature_requests(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Backfill: mover los datos ya existentes del módulo NPN (npn_name IS NOT NULL)
-- Solo copia filas que tengan al menos un campo de formulario diligenciado.
INSERT IGNORE INTO carta_form_data
  (signature_request_id, name, phone, email, postalcode, submitted_at, social_path, status_path)
SELECT sr.id, sr.form_name, sr.form_phone, sr.form_email, sr.form_postalcode,
       sr.form_submitted_at, sr.form_social_path, sr.form_status_path
FROM signature_requests sr
WHERE sr.npn_name IS NOT NULL
  AND (sr.form_name IS NOT NULL OR sr.form_phone IS NOT NULL OR sr.form_email IS NOT NULL
       OR sr.form_postalcode IS NOT NULL OR sr.form_submitted_at IS NOT NULL
       OR sr.form_social_path IS NOT NULL OR sr.form_status_path IS NOT NULL);
