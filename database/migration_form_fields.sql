-- Correr en la BD local (firmacloud)
-- Agrega campos del formulario de actualización de datos a signature_requests

ALTER TABLE signature_requests
  ADD COLUMN form_name        VARCHAR(150) NULL,
  ADD COLUMN form_phone       VARCHAR(20)  NULL,
  ADD COLUMN form_email       VARCHAR(150) NULL,
  ADD COLUMN form_postalcode  VARCHAR(20)  NULL,
  ADD COLUMN form_submitted_at DATETIME    NULL,
  ADD COLUMN form_social_path  VARCHAR(500) NULL,
  ADD COLUMN form_status_path  VARCHAR(500) NULL;
