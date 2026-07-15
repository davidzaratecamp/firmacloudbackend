-- Agrega 'failed' al ENUM de status de signature_requests, para poder marcar
-- correctamente las cartas NPN cuyo envío (email/whatsapp) falló, en vez de
-- dejarlas como 'pending' (engañoso, parecía que seguían en curso) o borrarlas
-- (se perdía el historial). El flujo original de firmas nunca asigna este valor
-- (solo lo usa cartaDispatchService.js, exclusivo del módulo NPN) — no cambia
-- ningún comportamiento existente de /firmas ni /api/signatures.
ALTER TABLE signature_requests
  MODIFY COLUMN status ENUM('pending', 'viewed', 'signed', 'expired', 'failed') DEFAULT 'pending';
