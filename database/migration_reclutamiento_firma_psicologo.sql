-- Segunda firma (Selección/Administrador) sobre la hoja de vida ya firmada por el candidato.
-- Ver claude/planReclutamiento.md. cv_signed_path (solo firma del candidato) nunca se
-- sobrescribe: cada firma de selección/administrador parte siempre de ese archivo estable y
-- el resultado (con las dos firmas) se guarda en cv_final_signed_path — así la acción es
-- idempotente y re-firmable sin apilar sellos duplicados.
USE firmacloud;

ALTER TABLE reclutamiento_candidatos
  ADD COLUMN cv_final_signed_path           VARCHAR(500) NULL AFTER cv_signed_path,
  ADD COLUMN psicologo_signed_at            TIMESTAMP    NULL,
  ADD COLUMN psicologo_signed_by            VARCHAR(150) NULL,
  ADD COLUMN psicologo_signature_image_path VARCHAR(500) NULL;
