const db = require('../config/database');
const { resolveNpnTemplate, dispatchCartaToRecipient } = require('./cartaDispatchService');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function todayInTZ(tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
}

// "HH:mm" en la timezone dada, para comparar contra OLEADA_BUSINESS_HOURS_START/END
function timeOfDayInTZ(tz) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date());
}

function isWithinBusinessHours(tz) {
  const start = process.env.OLEADA_BUSINESS_HOURS_START || '08:00';
  const end = process.env.OLEADA_BUSINESS_HOURS_END || '19:00';
  const now = timeOfDayInTZ(tz);
  return now >= start && now < end;
}

// Gmail/Workspace corta el envío devolviendo 550 5.4.5 cuando la cuenta remitente
// (SMTP_USER) agota su cupo diario de envíos salientes. No es un fallo del destinatario:
// todo intento posterior en el mismo día va a fallar igual, así que hay que dejar de
// intentar en vez de quemar el resto de la lista contra un cupo agotado.
function isQuotaExceededError(err) {
  const text = `${err && err.responseCode || ''} ${err && err.response || ''} ${err && err.message || ''}`;
  return /5\.4\.5|daily user sending limit|daily sending quota/i.test(text);
}

// Envía hasta `limit` destinatarios pending de la oleada. Común a modo 'daily' y 'drip' —
// el guard de cuándo se puede llamar vive en cada modo, no aquí.
async function dispatchPendingBatch(oleada, limit) {
  let template;
  try {
    template = await resolveNpnTemplate(oleada.npn_name);
  } catch (err) {
    console.error(`[oleada ${oleada.id}] Plantilla no encontrada, pausando oleada:`, err.message);
    await db.query(`UPDATE oleadas SET status = 'paused' WHERE id = ?`, [oleada.id]);
    return { skipped: true, reason: 'template_not_found' };
  }

  const [pending] = await db.query(
    `SELECT * FROM oleada_recipients WHERE oleada_id = ? AND row_status = 'pending'
     ORDER BY id ASC LIMIT ?`,
    [oleada.id, limit]
  );

  if (pending.length === 0) {
    await db.query(`UPDATE oleadas SET status = 'completed' WHERE id = ?`, [oleada.id]);
    return { sent: 0, failed: 0, completed: true };
  }

  const delayMs = parseInt(process.env.OLEADA_SEND_DELAY_MS) || 3000;
  let sent = 0;
  let failed = 0;
  let quotaExceeded = false;

  for (const recipient of pending) {
    try {
      const { id } = await dispatchCartaToRecipient({
        agentId: oleada.created_by,
        npnName: oleada.npn_name,
        npnCode: oleada.npn_code,
        cartaPath: template.cartaPath,
        docName: template.docName,
        docHash: template.docHash,
        sendChannel: oleada.send_channel,
        clientName: recipient.name,
        clientEmail: recipient.email,
        clientPhone: recipient.phone,
      });
      await db.query(
        `UPDATE oleada_recipients SET row_status = 'sent', signature_request_id = ?, sent_at = NOW() WHERE id = ?`,
        [id, recipient.id]
      );
      sent++;
    } catch (err) {
      // dispatchCartaToRecipient adjunta el id de la carta que quedó marcada 'failed' —
      // se enlaza directo, sin tener que adivinar por email más adelante.
      await db.query(
        `UPDATE oleada_recipients SET row_status = 'failed', send_error = ?, signature_request_id = ? WHERE id = ?`,
        [String(err.message).slice(0, 500), err.signatureRequestId || null, recipient.id]
      );
      failed++;
      if (isQuotaExceededError(err)) {
        quotaExceeded = true;
        console.error(`[oleada ${oleada.id}] Cupo diario de envio agotado, pausando oleada:`, err.message);
        break;
      }
    }
    await sleep(delayMs);
  }

  await db.query(
    `UPDATE oleadas SET sent_count = sent_count + ?, failed_count = failed_count + ? WHERE id = ?`,
    [sent, failed, oleada.id]
  );

  if (quotaExceeded) {
    await db.query(`UPDATE oleadas SET status = 'paused' WHERE id = ?`, [oleada.id]);
    return { sent, failed, quotaExceeded: true, paused: true };
  }

  const [[{ remaining }]] = await db.query(
    `SELECT COUNT(*) AS remaining FROM oleada_recipients WHERE oleada_id = ? AND row_status = 'pending'`,
    [oleada.id]
  );
  if (remaining === 0) {
    await db.query(`UPDATE oleadas SET status = 'completed' WHERE id = ?`, [oleada.id]);
  }

  return { sent, failed, remaining };
}

// Modo histórico ('daily'): una vez al día, hasta daily_limit destinatarios.
// Compartida entre el cron diario y el botón manual "Enviar lote de hoy", para oleadas
// creadas antes del modo 'drip' (siguen funcionando exactamente igual que antes).
async function sendNextBatch(oleadaId) {
  const tz = process.env.OLEADA_CRON_TIMEZONE || 'America/Bogota';
  const today = todayInTZ(tz);

  const [guard] = await db.query(
    `UPDATE oleadas SET last_batch_sent_date = ?
     WHERE id = ? AND status = 'active' AND send_mode = 'daily'
       AND (last_batch_sent_date IS NULL OR last_batch_sent_date < ?)`,
    [today, oleadaId, today]
  );
  if (guard.affectedRows === 0) {
    return { skipped: true, reason: 'already_sent_today_or_not_active' };
  }

  const [[oleada]] = await db.query('SELECT * FROM oleadas WHERE id = ?', [oleadaId]);
  return dispatchPendingBatch(oleada, oleada.daily_limit);
}

// Modo por defecto ('drip'): lotes de tamaño fijo (OLEADA_DRIP_BATCH_SIZE) cada N minutos
// (OLEADA_DRIP_INTERVAL_MINUTES), sin importar el total de destinatarios de la oleada,
// solo dentro del horario laboral configurado. Se llama inmediatamente al crear la oleada
// y luego periódicamente desde el scheduler.
async function sendDripBatch(oleadaId) {
  const tz = process.env.OLEADA_CRON_TIMEZONE || 'America/Bogota';
  if (!isWithinBusinessHours(tz)) {
    return { skipped: true, reason: 'outside_business_hours' };
  }

  const intervalMinutes = parseInt(process.env.OLEADA_DRIP_INTERVAL_MINUTES) || 10;
  const batchSize = parseInt(process.env.OLEADA_DRIP_BATCH_SIZE) || 10;

  const [guard] = await db.query(
    `UPDATE oleadas SET last_batch_sent_at = NOW()
     WHERE id = ? AND status = 'active' AND send_mode = 'drip'
       AND (last_batch_sent_at IS NULL OR last_batch_sent_at <= DATE_SUB(NOW(), INTERVAL ? MINUTE))`,
    [oleadaId, intervalMinutes]
  );
  if (guard.affectedRows === 0) {
    return { skipped: true, reason: 'not_due_or_not_active_drip' };
  }

  const [[oleada]] = await db.query('SELECT * FROM oleadas WHERE id = ?', [oleadaId]);
  return dispatchPendingBatch(oleada, batchSize);
}

module.exports = { sendNextBatch, sendDripBatch, todayInTZ, isWithinBusinessHours };
