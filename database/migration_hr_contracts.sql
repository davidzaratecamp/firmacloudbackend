-- Módulo Recursos Humanos — Firma de Contratos Laborales
-- Tabla propia y aislada: no comparte nada con signature_requests / activity_logs.
USE firmacloud;

CREATE TABLE hr_contracts (
  id VARCHAR(36) PRIMARY KEY,
  agent_id INT NOT NULL,

  -- Rutas de almacenamiento
  document_name          VARCHAR(255) NOT NULL,
  document_original_path VARCHAR(500) NOT NULL,   -- PDF cargado (el que se firma)
  signed_document_path   VARCHAR(500) NULL,        -- PDF ya firmado
  signature_image_path   VARCHAR(500) NULL,        -- PNG de la firma dibujada
  document_hash           VARCHAR(64)  NOT NULL,

  -- Contacto (uno u otro, según canal). Sin nombre, sin ningún otro dato.
  recipient_email VARCHAR(150) NULL,
  recipient_phone VARCHAR(20)  NULL,
  send_channel    ENUM('email','whatsapp') NOT NULL,

  token            VARCHAR(128) UNIQUE NOT NULL,
  token_expires_at TIMESTAMP NULL,

  status  ENUM('pending','viewed','signed') NOT NULL DEFAULT 'pending',
  sent_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  viewed_at TIMESTAMP NULL,
  signed_at TIMESTAMP NULL,

  -- Evidencia mínima (sin sumarium)
  signer_ip         VARCHAR(45) NULL,
  signer_user_agent TEXT NULL,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);
