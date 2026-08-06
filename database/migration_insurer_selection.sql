-- Permite elegir la aseguradora (Oscar/Ambetter) al enviar una carta o crear una oleada,
-- en vez de depender únicamente de "cuál está activa" en npn_active_template.
-- No modifica signature_requests ni ninguna tabla del flujo original.

-- Nombre de marca tal como debe leerse dentro de la frase del correo
-- ("Nos comunicamos con usted de parte de {insurer_display_name}...").
ALTER TABLE template_generations
  ADD COLUMN insurer_display_name VARCHAR(100) NOT NULL DEFAULT '';

UPDATE template_generations SET insurer_display_name = 'Aseguradora Oscar' WHERE label = 'oscar';
UPDATE template_generations SET insurer_display_name = 'Ambetter Health'   WHERE label = 'ambetter';

-- Oleadas: qué generación se fija para TODA la campaña (elegida una sola vez al crearla,
-- aplica a todos sus lotes). NULL = comportamiento de siempre (usa la generación activa
-- de npn_active_template en cada lote) — así las oleadas ya existentes no cambian.
ALTER TABLE oleadas
  ADD COLUMN template_generation_label VARCHAR(50) NULL;
