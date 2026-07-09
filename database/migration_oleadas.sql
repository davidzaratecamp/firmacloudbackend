-- Migración: feature "Oleadas" — envío masivo programado de cartas NPN.
-- Ejecutar una vez sobre la base de datos firmacloud.
-- No modifica signature_requests ni ninguna tabla del flujo original.

CREATE TABLE oleadas (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  name                  VARCHAR(150) NOT NULL,
  npn_name              VARCHAR(100) NOT NULL,
  npn_code              VARCHAR(20)  NULL,
  send_channel          ENUM('email','whatsapp','both') NOT NULL DEFAULT 'email',
  daily_limit           INT NOT NULL,
  status                ENUM('active','paused','completed','cancelled') NOT NULL DEFAULT 'active',
  total_recipients      INT NOT NULL DEFAULT 0,
  sent_count            INT NOT NULL DEFAULT 0,
  failed_count          INT NOT NULL DEFAULT 0,
  source_filename       VARCHAR(255) NULL,
  last_batch_sent_date  DATE NULL,
  created_by            INT NOT NULL,
  created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_oleadas_agent FOREIGN KEY (created_by) REFERENCES agents(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE oleada_recipients (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  oleada_id             INT NOT NULL,
  name                  VARCHAR(150) NOT NULL,
  email                 VARCHAR(150) NULL,
  phone                 VARCHAR(20)  NULL,
  row_status            ENUM('pending','sent','failed') NOT NULL DEFAULT 'pending',
  signature_request_id  VARCHAR(36) NULL,
  send_error            VARCHAR(500) NULL,
  sent_at               TIMESTAMP NULL,
  created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_oleada_recipients_oleada
    FOREIGN KEY (oleada_id) REFERENCES oleadas(id) ON DELETE CASCADE,
  CONSTRAINT fk_oleada_recipients_request
    FOREIGN KEY (signature_request_id) REFERENCES signature_requests(id) ON DELETE SET NULL,
  UNIQUE KEY uq_oleada_recipient_email (oleada_id, email),
  INDEX idx_oleada_recipients_status (oleada_id, row_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
