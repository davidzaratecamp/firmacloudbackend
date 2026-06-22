let cached = null;

async function resolveServerLocation() {
  try {
    const res = await fetch('https://ipinfo.io/json', { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    cached = {
      ip: data.ip,
      location: [data.city, data.region, data.country].filter(Boolean).join(', '),
    };
    console.log(`[server] IP de envío: ${cached.ip} (${cached.location})`);
  } catch (err) {
    console.warn('[server] No se pudo resolver la IP pública:', err.message);
  }
}

function getServerLocation() {
  return cached;
}

module.exports = { resolveServerLocation, getServerLocation };
