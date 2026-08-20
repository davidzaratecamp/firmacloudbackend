-- Módulo Reclutamiento (consumo por intranet Hydra Reclutamiento) — ver claude/planReclutamiento.md
-- Tabla propia y aislada: nada de npn_name, webhook_url, ersd_*, ni FK a signature_requests.
USE firmacloud;

-- Rol nuevo para el panel interno de solo lectura del módulo (mismo patrón que 'rrhh'/'correo_datos').
ALTER TABLE agents
  MODIFY COLUMN role ENUM('admin', 'agent', 'firma_datos', 'correo_datos', 'rrhh', 'reclutamiento')
  NOT NULL DEFAULT 'agent';

-- Usuario sistema para las llamadas autenticadas con HYDRA_API_KEY (mismo patrón que
-- INTRANET_AGENT_ID para la intranet Obama, pero un agente propio y separado — nunca inicia
-- sesión con contraseña, el hash es un valor aleatorio sin uso real).
INSERT INTO agents (name, email, password_hash, role, active)
VALUES ('Hydra Reclutamiento (sistema)', 'sistema.hydra@firmahealthcare.com',
        '$2a$10$Rpu8rH6Fv/QYo4tCMQ3NXuIvL0gW5Dd/rdOLpKpMf2SzLBFAvIQT2', 'reclutamiento', TRUE);
-- Después de correr esta migración, consultar el id generado y ponerlo en HYDRA_AGENT_ID:
--   SELECT id FROM agents WHERE email = 'sistema.hydra@firmahealthcare.com';

CREATE TABLE reclutamiento_candidatos (
  id                        VARCHAR(36)  NOT NULL PRIMARY KEY,
  agent_id                  INT          NOT NULL,          -- usuario sistema de Hydra (HYDRA_AGENT_ID)

  candidate_name            VARCHAR(150) NOT NULL,
  candidate_email           VARCHAR(150) NULL,
  candidate_phone           VARCHAR(20)  NULL,
  send_channel              ENUM('email','whatsapp') NOT NULL,

  cv_original_path          VARCHAR(500) NOT NULL,
  cv_signed_path            VARCHAR(500) NULL,
  cv_hash                   VARCHAR(64)  NOT NULL,

  tratamiento_original_path VARCHAR(500) NOT NULL,          -- enviado por Hydra, igual que el CV
  tratamiento_signed_path   VARCHAR(500) NULL,
  tratamiento_hash          VARCHAR(64)  NOT NULL,

  signature_image_path      VARCHAR(500) NULL,

  token                     VARCHAR(128) UNIQUE NOT NULL,
  token_expires_at          TIMESTAMP    NULL,              -- NULL = sin expiración (mismo criterio que NPN)

  status                    ENUM('pending','viewed','signed') NOT NULL DEFAULT 'pending',
  sent_at                   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  viewed_at                 TIMESTAMP    NULL,
  signed_at                 TIMESTAMP    NULL,

  signer_ip                 VARCHAR(45)  NULL,
  signer_user_agent         TEXT         NULL,

  hydra_reference_id        VARCHAR(100) NULL,               -- id del candidato en Hydra, para trazabilidad

  created_at                TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at                TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);
