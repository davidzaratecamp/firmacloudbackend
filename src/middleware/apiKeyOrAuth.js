const jwt = require('jsonwebtoken');
const db = require('../config/database');

// Accepts either a Bearer JWT (agents via panel) or X-Api-Key (intranet integration)
async function apiKeyOrAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'];

  if (apiKey) {
    if (apiKey !== process.env.API_KEY) {
      return res.status(401).json({ error: 'API key inválida' });
    }
    // Inject a system user for API key calls
    req.user = { id: 1, name: 'Intranet Integration', role: 'agent', isApiKey: true };
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

module.exports = apiKeyOrAuth;
