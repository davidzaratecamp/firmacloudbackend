-- Limpieza manual de cartas huérfanas generadas hoy (2026-07-15) por el bug de
-- cartaDispatchService.js: se creaba la fila en signature_requests ANTES de intentar
-- el envío de email, y si el email fallaba (cupo diario de Gmail agotado) no había
-- cleanup — quedaban 'pending' sin que el cliente las recibiera. Ya corregido en el código;
-- esto limpia lo que quedó suelto de antes del fix.
--
-- Ejecutar en este orden, revisando el resultado de cada SELECT antes de pasar al DELETE.

-- 1. Identificar la oleada (ajustar el nombre/fecha si hace falta)
SELECT id, name, npn_name, created_by, status, sent_count, failed_count, total_recipients
FROM oleadas
ORDER BY created_at DESC
LIMIT 5;

-- 2. Con el <OLEADA_ID> de arriba: ver los destinatarios fallidos de esa oleada
SELECT id, name, email, row_status, send_error
FROM oleada_recipients
WHERE oleada_id = <OLEADA_ID> AND row_status = 'failed';

-- 3. Ver qué cartas huérfanas coinciden (mismo criterio que usa el botón "Eliminar fallidos":
--    email + npn_name + agente que creó la oleada + status='pending')
SELECT sr.id, sr.client_name, sr.client_email, sr.status, sr.created_at, sr.document_original_path
FROM signature_requests sr
WHERE sr.npn_name = (SELECT npn_name FROM oleadas WHERE id = <OLEADA_ID>)
  AND sr.agent_id = (SELECT created_by FROM oleadas WHERE id = <OLEADA_ID>)
  AND sr.status = 'pending'
  AND sr.client_email IN (
    SELECT email FROM oleada_recipients WHERE oleada_id = <OLEADA_ID> AND row_status = 'failed'
  );

-- 4. Si el resultado del paso 3 coincide con los 36 esperados, borrarlas
--    (nota: borrar primero de MySQL; los archivos PDF copiados en uploads/ quedan huérfanos
--    en disco, se pueden limpiar aparte con un `find uploads/ -mtime ...` si hace falta espacio)
DELETE FROM signature_requests
WHERE npn_name = (SELECT npn_name FROM oleadas WHERE id = <OLEADA_ID>)
  AND agent_id = (SELECT created_by FROM oleadas WHERE id = <OLEADA_ID>)
  AND status = 'pending'
  AND client_email IN (
    SELECT email FROM oleada_recipients WHERE oleada_id = <OLEADA_ID> AND row_status = 'failed'
  );

-- 5. (Opcional, solo si vas a reintentar los fallidos manualmente en vez de esperar el
--    deploy con el botón nuevo) volver a 'pending' los destinatarios fallidos:
-- UPDATE oleada_recipients SET row_status = 'pending', send_error = NULL
--   WHERE oleada_id = <OLEADA_ID> AND row_status = 'failed';
-- UPDATE oleadas SET status = 'active', last_batch_sent_date = NULL WHERE id = <OLEADA_ID>;
