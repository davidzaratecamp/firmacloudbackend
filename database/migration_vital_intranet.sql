-- Usuario sistema para las llamadas autenticadas con VITAL_API_KEY (intranet del módulo
-- Vital — Firma Tratamiento de Datos, ver claude/planObamaCareFirmaTratamiento.md). Mismo
-- patrón que INTRANET_AGENT_ID (Obama) y HYDRA_AGENT_ID (Reclutamiento): un agente propio y
-- separado por sistema externo, nunca inicia sesión con contraseña — el hash es un valor
-- aleatorio sin uso real. No requiere ALTER de agents.role: reutiliza el rol 'agent' ya
-- existente (mismo que usa la intranet Obama), Vital comparte el módulo Firmas, no es un
-- módulo nuevo con panel propio.
USE firmacloud;

INSERT INTO agents (name, email, password_hash, role, active)
VALUES ('Vital Intranet (sistema)', 'sistema.vital@firmahealthcare.com',
        '$2a$10$cIrxYpaJmjG2ZlD/JY4Qh.lIUYN0g/DDMV7BH43YyCQpTiaic2/Oa', 'agent', TRUE);
-- Después de correr esta migración, consultar el id generado y ponerlo en VITAL_AGENT_ID:
--   SELECT id FROM agents WHERE email = 'sistema.vital@firmahealthcare.com';
