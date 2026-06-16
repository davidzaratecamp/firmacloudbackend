CREATE DATABASE IF NOT EXISTS firmacloud CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE firmacloud;

CREATE TABLE agents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin', 'agent') DEFAULT 'agent',
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE signature_requests (
  id VARCHAR(36) PRIMARY KEY,
  agent_id INT NOT NULL,
  document_name VARCHAR(255) NOT NULL,
  document_original_path VARCHAR(500) NOT NULL,
  document_hash VARCHAR(64) NOT NULL,
  client_name VARCHAR(150) NOT NULL,
  client_email VARCHAR(150) NULL,
  client_phone VARCHAR(20),
  send_channel ENUM('email','whatsapp','both') NOT NULL DEFAULT 'email',
  token VARCHAR(128) UNIQUE NOT NULL,
  token_expires_at TIMESTAMP NOT NULL,
  status ENUM('pending','viewed','signed','expired') DEFAULT 'pending',
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  viewed_at TIMESTAMP NULL,
  signed_at TIMESTAMP NULL,
  signer_name VARCHAR(150) NULL,
  signer_ip VARCHAR(45) NULL,
  signer_user_agent TEXT NULL,
  signer_device VARCHAR(100) NULL,
  signer_geolocation JSON NULL,
  signed_document_path VARCHAR(500) NULL,
  certificate_path VARCHAR(500) NULL,
  webhook_url VARCHAR(500) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

CREATE TABLE activity_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  signature_request_id VARCHAR(36) NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  details JSON NULL,
  ip_address VARCHAR(45) NULL,
  user_agent TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (signature_request_id) REFERENCES signature_requests(id)
);

-- Default admin user
-- Password: Admin1234!
-- Hash generated with bcrypt, 10 salt rounds
INSERT INTO agents (name, email, password_hash, role) VALUES
('Administrador', 'admin@asistehealth.com', '$2a$10$7niosCltGRzhH1yR0Y5u7e878FluE0OQGhcJlkYTWINSJ.QLOxUmm', 'admin');
