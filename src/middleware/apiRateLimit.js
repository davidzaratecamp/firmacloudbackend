const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');

// Antes había un único rate-limit global por IP (200 req/15min). Eso rompe cualquier
// integración/intranet donde muchos usuarios salen a internet por la misma IP (NAT de
// oficina) — todos comparten un solo cupo, sin importar que sean personas o llamadas
// distintas. Este middleware separa el cupo por IDENTIDAD ya autenticada (API key conocida
// o JWT válido) en vez de por IP, y solo cae a IP para tráfico sin autenticar (rutas
// públicas: formulario, /api/sign/:token, tracking, etc.), donde sí tiene sentido limitar
// por IP porque no hay otra forma de identificar al llamante.
//
// Importante: una API key o JWT INVÁLIDOS caen al límite por IP (no al de identidad) — si
// no, cualquiera podría mandar un header x-api-key inventado distinto en cada request para
// evadir el límite de anónimos por completo.
const KNOWN_API_KEYS = {
  vital: () => process.env.VITAL_API_KEY,
  obama: () => process.env.API_KEY,
  hydra: () => process.env.HYDRA_API_KEY,
};

function authenticatedIdentity(req) {
  const apiKey = req.headers['x-api-key'];
  if (apiKey) {
    for (const [name, getExpectedKey] of Object.entries(KNOWN_API_KEYS)) {
      const expected = getExpectedKey();
      if (expected && apiKey === expected) return `apikey:${name}`;
    }
    return null;
  }

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET);
      if (payload && payload.id) return `agent:${payload.id}`;
    } catch {
      return null;
    }
  }

  return null;
}

const WINDOW_MS = 15 * 60 * 1000;
const AUTHENTICATED_MAX = parseInt(process.env.RATE_LIMIT_AUTH_MAX) || 2000;
const PUBLIC_MAX = parseInt(process.env.RATE_LIMIT_PUBLIC_MAX) || 200;

const apiRateLimit = rateLimit({
  windowMs: WINDOW_MS,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req, res) => authenticatedIdentity(req) || req.ip,
  max: (req, res) => (authenticatedIdentity(req) ? AUTHENTICATED_MAX : PUBLIC_MAX),
});

module.exports = apiRateLimit;
