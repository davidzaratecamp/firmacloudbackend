-- Migración: soporte para endpoint send-with-data (contrato de activación)
-- Ejecutar una vez sobre la base de datos firmacloud

ALTER TABLE signature_requests
  ADD COLUMN document_data TEXT NULL COMMENT 'JSON con los datos llenados en la plantilla PDF',
  ADD COLUMN sign_page_index TINYINT NOT NULL DEFAULT 0 COMMENT 'Índice de página donde va la imagen de firma (0-based; 0 = página 1)';
