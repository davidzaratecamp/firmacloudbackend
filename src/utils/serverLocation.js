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

// Geolocaliza una IP arbitraria (a diferencia de resolveServerLocation, que solo resuelve
// la IP saliente de este servidor). Usado en el flujo vital para "Location:"/"Coordinates:"
// al firmar — la referencia real (Carta CMS Vital (1).pdf) usa datos de geolocalización por
// IP (precisión a nivel de ciudad, coordenadas del centro de la ciudad), no GPS del navegador,
// así que se resuelve del lado del servidor en vez de depender de que el cliente conceda
// permiso de ubicación en el navegador (poco confiable — muchos usuarios lo niegan).
// "País (CÓDIGO), Región - Ciudad" — mismo formato que trae Carta CMS Vital (1).pdf
// ("United States of America (US), Georgia - Atlanta"). El nombre completo del país se
// resuelve con Intl.DisplayNames (built-in en Node, sin dependencia nueva) a partir del
// código ISO de 2 letras que devuelve ipinfo.io.
const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });
function formatIpLocation(data) {
  const countryCode = data.country;
  let countryName = countryCode;
  try { countryName = countryNames.of(countryCode) || countryCode; } catch { /* código no reconocido, se queda con el código */ }
  const countryPart = countryCode ? `${countryName} (${countryCode})` : '';
  const regionCityPart = [data.region, data.city].filter(Boolean).join(' - ');
  return [countryPart, regionCityPart].filter(Boolean).join(', ');
}

async function resolveIpLocation(ip) {
  if (!ip) return null;
  try {
    const res = await fetch(`https://ipinfo.io/${ip}/json`, { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    if (!data || data.bogon) return null;

    const location = formatIpLocation(data);
    let latitude = null;
    let longitude = null;
    if (data.loc) {
      const [lat, lng] = data.loc.split(',').map(Number);
      if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
        latitude = lat;
        longitude = lng;
      }
    }
    return { location: location || null, latitude, longitude };
  } catch (err) {
    console.warn(`[ip-location] No se pudo resolver ubicación para ${ip}:`, err.message);
    return null;
  }
}

module.exports = { resolveServerLocation, getServerLocation, resolveIpLocation };
