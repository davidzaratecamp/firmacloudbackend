-- ============================================================
-- Carta Formulario Service — correr en la BD interna (firmacloud)
-- ============================================================

-- Columnas NPN para el flujo de carta con firma
ALTER TABLE signature_requests
  ADD COLUMN npn_name VARCHAR(100) NULL,
  ADD COLUMN npn_code VARCHAR(20)  NULL;

USE firmacloud;

CREATE TABLE form_requests (
  id                    VARCHAR(36)   NOT NULL,
  agent_id              INT           NOT NULL,
  client_name           VARCHAR(150)  NOT NULL,
  client_email          VARCHAR(150)  NULL,
  client_phone          VARCHAR(20)   NULL,
  send_channel          ENUM('email','whatsapp','both') NOT NULL DEFAULT 'email',
  carta_path            VARCHAR(500)  NOT NULL,
  token                 CHAR(96)      NOT NULL,
  token_expires_at      DATETIME      NOT NULL,
  status                ENUM('pending','email_opened','form_submitted','expired') NOT NULL DEFAULT 'pending',
  email_opened_at       DATETIME      NULL,
  email_open_ip         VARCHAR(45)   NULL,
  email_open_user_agent TEXT          NULL,
  form_submitted_at     DATETIME      NULL,
  sent_at               DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_from_ip          VARCHAR(45)   NULL,
  webhook_url           VARCHAR(500)  NULL,
  npn_name              VARCHAR(100)  NULL,
  npn_code              VARCHAR(20)   NULL,
  created_at            TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_token (token),
  CONSTRAINT fk_form_requests_agent FOREIGN KEY (agent_id) REFERENCES agents(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE form_submissions (
  id                     VARCHAR(36)   NOT NULL,
  form_request_id        VARCHAR(36)   NOT NULL,
  name                   VARCHAR(150)  NOT NULL,
  phone                  VARCHAR(20)   NOT NULL,
  email                  VARCHAR(150)  NOT NULL,
  postalcode             VARCHAR(20)   NOT NULL,
  social_image_path      VARCHAR(500)  NULL,
  status_migratorio_path VARCHAR(500)  NULL,
  created_at             TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_form_request_id (form_request_id),
  CONSTRAINT fk_form_submissions_request FOREIGN KEY (form_request_id) REFERENCES form_requests(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
