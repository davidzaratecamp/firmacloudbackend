-- Migración: agente logueado en Obama que realizó el envío (distinto del NPN del documento)
-- Ejecutar una vez sobre la base de datos firmacloud

ALTER TABLE signature_requests
  ADD COLUMN logged_agent_name VARCHAR(150) NULL COMMENT 'Nombre del usuario logueado en Obama que envió el documento',
  ADD COLUMN logged_agent_id VARCHAR(50) NULL COMMENT 'ID del usuario logueado en Obama que envió el documento';
