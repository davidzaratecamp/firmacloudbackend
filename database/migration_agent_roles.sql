-- Amplía los roles de agents para separar responsabilidades entre módulos:
-- 'firma_datos'  -> solo flujo original de firma/tratamiento de datos (/api/signatures)
-- 'correo_datos' -> solo módulo NPN de actualización de datos (/api/cartas, /api/oleadas)
-- 'agent' se conserva (acceso a ambos módulos) para no afectar a los agentes ya existentes.
ALTER TABLE agents
  MODIFY COLUMN role ENUM('admin', 'agent', 'firma_datos', 'correo_datos') NOT NULL DEFAULT 'agent';
