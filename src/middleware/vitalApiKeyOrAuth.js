const jwt = require('jsonwebtoken');

// Middleware para las rutas de Firmas que consume la intranet Vital (send-with-data, y
// las de solo-lectura que necesita para hacer polling de estado si no le alcanza con el
// webhook: :id y :id/download). A diferencia de hydraApiKeyOrAuth.js (que es exclusivo de
// Reclutamiento porque esas rutas no las usa nadie más), estas rutas de /api/signatures ya
// las comparte la intranet legado (Obama, vía apiKeyOrAuth + API_KEY) — por eso este
// middleware acepta AMBAS credenciales (API_KEY legado o VITAL_API_KEY, completamente
// separada) en vez de vivir aislado como Hydra. No se tocó apiKeyOrAuth.js: Cartas/RRHH/
// Oleadas (que también lo usan) quedan en cero riesgo ante cualquier cambio de este archivo.
async function vitalApiKeyOrAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'];

  if (apiKey) {
    if (apiKey === process.env.VITAL_API_KEY) {
      req.user = { id: parseInt(process.env.VITAL_AGENT_ID) || 1, name: 'Vital Intranet', role: 'agent', isApiKey: true };
      return next();
    }
    if (apiKey === process.env.API_KEY) {
      // Compatibilidad: la intranet legado (Obama) también puede llamar estas rutas
      // (ej. para revisar el estado de documentos que envió antes de esta integración).
      req.user = { id: parseInt(process.env.INTRANET_AGENT_ID) || 1, name: 'Intranet Integration', role: 'agent', isApiKey: true };
      return next();
    }
    return res.status(401).json({ error: 'API key inválida' });
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

module.exports = vitalApiKeyOrAuth;
