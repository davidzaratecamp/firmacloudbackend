const cron = require('node-cron');
const db = require('../config/database');
const { sendNextBatch } = require('../services/oleadaBatchService');

function startOleadaScheduler() {
  const expr = process.env.OLEADA_CRON_SCHEDULE || '0 9 * * *';
  const tz = process.env.OLEADA_CRON_TIMEZONE || 'America/Bogota';

  cron.schedule(expr, async () => {
    let activeIds = [];
    try {
      const [rows] = await db.query(`SELECT id FROM oleadas WHERE status = 'active'`);
      activeIds = rows.map((r) => r.id);
    } catch (err) {
      console.error('[oleada-cron] Error listando oleadas activas:', err.message);
      return;
    }

    for (const id of activeIds) {
      try {
        const result = await sendNextBatch(id);
        console.log(`[oleada-cron] Oleada ${id}:`, result);
      } catch (err) {
        console.error(`[oleada-cron] Error en oleada ${id}:`, err.message);
      }
    }
  }, { timezone: tz });

  console.log(`[oleada-cron] Scheduler iniciado (${expr}, tz=${tz})`);
}

module.exports = { startOleadaScheduler };
