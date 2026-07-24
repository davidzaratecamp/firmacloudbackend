-- Amplía los roles de agents para el módulo de Recursos Humanos (contratos laborales).
-- 'rrhh' -> solo módulo RRHH (/api/rrhh/contratos). 'agent' se conserva (acceso a todos
-- los módulos legado) para no afectar a los agentes ya existentes.
USE firmacloud;

ALTER TABLE agents
  MODIFY COLUMN role ENUM('admin', 'agent', 'firma_datos', 'correo_datos', 'rrhh')
  NOT NULL DEFAULT 'agent';
