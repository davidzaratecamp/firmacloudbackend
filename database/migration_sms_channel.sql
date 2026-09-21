-- Migracion: agrega el canal 'sms' al ENUM send_channel de signature_requests, y una
-- columna para el enlace corto que usa el SMS. Ejecutar una vez sobre la base de datos
-- firmacloud, despues de migration_send_with_data.sql.
--
-- send_channel: el ENUM original (email/whatsapp/both) no incluia 'sms' -- cualquier envio
-- con sendChannel='sms' fallaba en el INSERT antes de siquiera intentar mandar el mensaje.
--
-- sms_short_code: el token de firma normal (96 caracteres hex, ver utils/token.js) hace la
-- URL muy larga para SMS (se cobra por segmento de ~153 caracteres GSM-7). Este codigo corto
-- (8 caracteres, unico) solo se genera y se usa para el enlace del SMS -- email y WhatsApp
-- siguen usando el token completo de siempre en /firmar/:token, sin cambio de conducta.
-- GET /api/s/:code (ver routes/shortLink.js) resuelve el codigo y redirige a /firmar/:token.

ALTER TABLE signature_requests
  MODIFY send_channel ENUM('email','whatsapp','sms','both') NOT NULL DEFAULT 'email',
  ADD COLUMN sms_short_code VARCHAR(12) NULL UNIQUE AFTER token;
