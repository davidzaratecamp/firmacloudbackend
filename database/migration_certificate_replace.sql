-- Migración: permitir reemplazar el sumario/certificado (igual que ya se puede con el PDF firmado)
-- Ejecutar una vez sobre la base de datos firmacloud

ALTER TABLE signature_requests
  ADD COLUMN certificate_path VARCHAR(500) NULL COMMENT 'Ruta del sumario/certificado reemplazado manualmente; si es NULL se genera dinámicamente';
