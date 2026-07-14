const cron = require('node-cron');
const db = require('../config/database');
const { sendNextBatch, sendDripBatch } = require('../services/oleadaBatchService');

function startOleadaScheduler() {
  const dailyExpr = process.env.OLEADA_CRON_SCHEDULE || '0 9 * * *';
  const dripExpr = process.env.OLEADA_DRIP_CHECK_CRON || '* * * * *';
  const tz = process.env.OLEADA_CRON_TIMEZONE || 'America/Bogota';

  // Modo histórico 'daily' — una vez al día, solo oleadas creadas antes del modo 'drip'.
  cron.schedule(dailyExpr, async () => {
    let activeIds = [];
    try {
      const [rows] = await db.query(`SELECT id FROM oleadas WHERE status = 'active' AND send_mode = 'daily'`);
      activeIds = rows.map((r) => r.id);
    } catch (err) {
      console.error('[oleada-cron] Error listando oleadas activas (daily):', err.message);
      return;
    }

    for (const id of activeIds) {
      try {
        const result = await sendNextBatch(id);
        console.log(`[oleada-cron] Oleada ${id} (daily):`, result);
      } catch (err) {
        console.error(`[oleada-cron] Error en oleada ${id} (daily):`, err.message);
      }
    }
  }, { timezone: tz });

  // Modo por defecto 'drip' — chequeo frecuente; cada oleada solo envía cuando le toca
  // (guard atómico por last_batch_sent_at dentro de sendDripBatch).
  cron.schedule(dripExpr, async () => {
    let activeIds = [];
    try {
      const [rows] = await db.query(`SELECT id FROM oleadas WHERE status = 'active' AND send_mode = 'drip'`);
      activeIds = rows.map((r) => r.id);
    } catch (err) {
      console.error('[oleada-cron] Error listando oleadas activas (drip):', err.message);
      return;
    }

    for (const id of activeIds) {
      try {
        const result = await sendDripBatch(id);
        if (!result.skipped) console.log(`[oleada-cron] Oleada ${id} (drip):`, result);
      } catch (err) {
        console.error(`[oleada-cron] Error en oleada ${id} (drip):`, err.message);
      }
    }
  }, { timezone: tz });

  console.log(`[oleada-cron] Scheduler iniciado (daily=${dailyExpr}, drip=${dripExpr}, tz=${tz})`);
}

module.exports = { startOleadaScheduler };
