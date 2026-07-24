-- Nombre de archivo personalizado (opcional) para la descarga del contrato firmado.
-- Si queda NULL, se usa el nombre por defecto FIRMADO-{document_name}.
USE firmacloud;

ALTER TABLE hr_contracts
  ADD COLUMN custom_filename VARCHAR(255) NULL AFTER document_name;
