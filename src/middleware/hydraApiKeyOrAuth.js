const jwt = require('jsonwebtoken');

// Middleware exclusivo del módulo Reclutamiento — valida SOLO contra HYDRA_API_KEY, una
// credencial completamente separada de API_KEY (intranet Obama). No modifica ni depende de
// apiKeyOrAuth.js — así el resto de módulos (firmas, cartas NPN, RRHH) quedan con cero
// riesgo ante cualquier cambio de este middleware, y viceversa.
async function hydraApiKeyOrAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'];

  if (apiKey) {
    if (apiKey !== process.env.HYDRA_API_KEY) {
      return res.status(401).json({ error: 'API key inválida' });
    }
    req.user = { id: parseInt(process.env.HYDRA_AGENT_ID) || 1, name: 'Hydra Reclutamiento', role: 'reclutamiento', isApiKey: true };
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Autenticación requerida' });
  }
  try {
    req.user = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

module.exports = hydraApiKeyOrAuth;
