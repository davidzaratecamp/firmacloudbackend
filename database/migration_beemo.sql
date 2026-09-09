-- Módulo Beemo — ver claude/planModuloBeemo.md
-- Tabla propia y aislada: nada de signature_requests, activity_logs, npn_name ni webhook_url.
USE firmacloud;

-- Rol nuevo para el panel del módulo (mismo patrón que 'rrhh' / 'reclutamiento').
ALTER TABLE agents
  MODIFY COLUMN role ENUM('admin', 'agent', 'firma_datos', 'correo_datos', 'rrhh', 'reclutamiento', 'beemo')
  NOT NULL DEFAULT 'agent';

CREATE TABLE beemo_documents (
  id                     VARCHAR(36)  NOT NULL PRIMARY KEY,
  agent_id               INT          NOT NULL,      -- usuario Beemo que envió

  -- Origen del documento
  source                 ENUM('template','upload') NOT NULL,
  document_name          VARCHAR(255) NOT NULL,
  document_original_path VARCHAR(500) NOT NULL,      -- PDF prellenado o cargado (el que se firma)
  signed_document_path   VARCHAR(500) NULL,
  signature_image_path   VARCHAR(500) NULL,
  document_hash          VARCHAR(64)  NOT NULL,
  document_data          JSON         NULL,          -- datos del formulario cuando source='template'

  -- Destinatario
  recipient_name         VARCHAR(150) NOT NULL,
  recipient_email        VARCHAR(150) NULL,
  recipient_phone        VARCHAR(20)  NULL,
  send_channel           ENUM('email','whatsapp','both') NOT NULL,

  token                  VARCHAR(128) UNIQUE NOT NULL,
  token_expires_at       TIMESTAMP    NULL,          -- NULL = sin expiración

  status                 ENUM('pending','viewed','signed') NOT NULL DEFAULT 'pending',
  sent_at                TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  viewed_at              TIMESTAMP NULL,
  signed_at              TIMESTAMP NULL,

  signer_ip              VARCHAR(45)  NULL,
  signer_user_agent      TEXT         NULL,

  created_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  INDEX idx_beemo_agent  (agent_id),
  INDEX idx_beemo_status (status),
  INDEX idx_beemo_sent   (sent_at)
);
