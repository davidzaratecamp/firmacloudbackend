// Rellena huecos en un resultado disperso de `GROUP BY DATE(col)` con ceros, para que el
// frontend siempre reciba exactamente `days` puntos consecutivos (el día sin actividad no
// desaparece del gráfico). Usa UTC en ambos lados porque el pool de mysql2 se conecta con
// timezone '+00:00' (ver src/config/database.js) — comparar en local rompería el borde
// "hoy" cuando el proceso de Node corre en otra zona horaria.
function buildDailyTrend(rows, days = 14) {
  const countByDay = new Map();
  for (const row of rows) {
    const key = row.day instanceof Date
      ? row.day.toISOString().slice(0, 10)
      : String(row.day).slice(0, 10);
    countByDay.set(key, Number(row.count) || 0);
  }

  const today = new Date();
  const todayUTC = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());

  const result = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = new Date(todayUTC - i * 86400000).toISOString().slice(0, 10);
    result.push({ date: key, count: countByDay.get(key) || 0 });
  }
  return result;
}

module.exports = { buildDailyTrend };
