-- Paso final, SEPARADO y MANUAL — ejecutar solo después de confirmar en producción
-- que carta_form_data funciona correctamente y tras un periodo de observación.
-- No reversible sin repoblar desde carta_form_data (que ya contiene todos los datos).

ALTER TABLE signature_requests
  DROP COLUMN form_name,
  DROP COLUMN form_phone,
  DROP COLUMN form_email,
  DROP COLUMN form_postalcode,
  DROP COLUMN form_submitted_at,
  DROP COLUMN form_social_path,
  DROP COLUMN form_status_path;
