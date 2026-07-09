const db = require('../config/database');
const { resolveNpnTemplate, dispatchCartaToRecipient } = require('./cartaDispatchService');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function todayInTZ(tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
}

// Compartida entre el cron diario y el botón manual "Enviar lote de hoy".
// El guard atómico garantiza que solo uno de los dos gane la carrera del día.
async function sendNextBatch(oleadaId) {
  const tz = process.env.OLEADA_CRON_TIMEZONE || 'America/Bogota';
  const today = todayInTZ(tz);

  const [guard] = await db.query(
    `UPDATE oleadas SET last_batch_sent_date = ?
     WHERE id = ? AND status = 'active'
       AND (last_batch_sent_date IS NULL OR last_batch_sent_date < ?)`,
    [today, oleadaId, today]
  );
  if (guard.affectedRows === 0) {
    return { skipped: true, reason: 'already_sent_today_or_not_active' };
  }

  const [[oleada]] = await db.query('SELECT * FROM oleadas WHERE id = ?', [oleadaId]);

  let template;
  try {
    template = await resolveNpnTemplate(oleada.npn_name);
  } catch (err) {
    console.error(`[oleada ${oleadaId}] Plantilla no encontrada, pausando oleada:`, err.message);
    await db.query(`UPDATE oleadas SET status = 'paused' WHERE id = ?`, [oleadaId]);
    return { skipped: true, reason: 'template_not_found' };
  }

  const [pending] = await db.query(
    `SELECT * FROM oleada_recipients WHERE oleada_id = ? AND row_status = 'pending'
     ORDER BY id ASC LIMIT ?`,
    [oleadaId, oleada.daily_limit]
  );

  if (pending.length === 0) {
    await db.query(`UPDATE oleadas SET status = 'completed' WHERE id = ?`, [oleadaId]);
    return { sent: 0, failed: 0, completed: true };
  }

  const delayMs = parseInt(process.env.OLEADA_SEND_DELAY_MS) || 3000;
  let sent = 0;
  let failed = 0;

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
      await db.query(
        `UPDATE oleada_recipients SET row_status = 'failed', send_error = ? WHERE id = ?`,
        [String(err.message).slice(0, 500), recipient.id]
      );
      failed++;
    }
    await sleep(delayMs);
  }

  await db.query(
    `UPDATE oleadas SET sent_count = sent_count + ?, failed_count = failed_count + ? WHERE id = ?`,
    [sent, failed, oleadaId]
  );

  const [[{ remaining }]] = await db.query(
    `SELECT COUNT(*) AS remaining FROM oleada_recipients WHERE oleada_id = ? AND row_status = 'pending'`,
    [oleadaId]
  );
  if (remaining === 0) {
    await db.query(`UPDATE oleadas SET status = 'completed' WHERE id = ?`, [oleadaId]);
  }

  return { sent, failed, remaining };
}

module.exports = { sendNextBatch, todayInTZ };
