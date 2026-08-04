-- Activa la generación 'ambetter' para todos los NPN excepto Rosangela Santana.
-- Requiere haber corrido antes migration_template_generations.sql.
-- Ejecutar solo cuando se quiera hacer el corte real de plantillas (revisar que no
-- haya oleadas activas para estos NPN antes de correrlo).
--
-- Rollback (volver a la plantilla anterior para todos): correr el mismo UPDATE
-- cambiando 'ambetter' por 'oscar' en la subconsulta.

UPDATE npn_active_template nat
JOIN template_generations tg ON tg.label = 'ambetter'
SET nat.generation_id = tg.id
WHERE nat.npn_name <> 'Rosangela Santana';
