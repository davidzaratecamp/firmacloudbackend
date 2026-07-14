-- Migración: modo de envío "goteo" para Oleadas (10 cada 10 min, arranca al crear la oleada)
-- Ejecutar una vez sobre la base de datos firmacloud, después de migration_oleadas.sql.
-- No modifica signature_requests ni ninguna tabla del flujo original.
--
-- send_mode distingue el comportamiento de envío por oleada:
--   'daily' -> comportamiento histórico (una vez al día, hasta daily_limit destinatarios)
--   'drip'  -> nuevo comportamiento por defecto (lotes de tamaño fijo cada N minutos, dentro de horario laboral)
--
-- El ALTER aplica el DEFAULT 'drip' a las filas existentes; el UPDATE de abajo las
-- retrocede explícitamente a 'daily' para que las oleadas ya activas (creadas antes de
-- este cambio) sigan funcionando exactamente igual que hasta ahora. Solo las oleadas
-- creadas después de correr esta migración quedan en modo 'drip' por defecto.

ALTER TABLE oleadas
  ADD COLUMN send_mode ENUM('daily','drip') NOT NULL DEFAULT 'drip' AFTER daily_limit,
  ADD COLUMN last_batch_sent_at DATETIME NULL AFTER last_batch_sent_date;

UPDATE oleadas SET send_mode = 'daily' WHERE id > 0;
