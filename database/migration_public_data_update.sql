-- Link público y genérico de actualización de datos (no ligado a un token/cliente
-- pre-creado por un agente). Cualquiera puede enviarlo indicando su propio NPN, pero
-- solo una vez por email (UNIQUE) — a diferencia de carta_form_data (que sí permite
-- reenvío/actualización porque va ligada a un token de un destinatario ya conocido).
CREATE TABLE public_data_updates (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  npn_name       VARCHAR(100) NOT NULL,
  npn_code       VARCHAR(20)  NULL,
  name           VARCHAR(150) NOT NULL,
  phone          VARCHAR(20)  NOT NULL,
  email          VARCHAR(150) NOT NULL,
  postalcode     VARCHAR(20)  NOT NULL,
  -- Aseguradora (Oscar/Ambetter) que el propio cliente selecciona en el formulario público
  -- (la que le llegó en su carta) — validada contra template_generations.label al recibir
  -- el envío, no se recalcula después si cambia la generación activa del NPN.
  insurer_label  VARCHAR(50)  NULL,
  social_path    VARCHAR(500) NULL,
  status_path    VARCHAR(500) NULL,
  submitted_ip   VARCHAR(45)  NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_public_data_updates_email (email)
);
