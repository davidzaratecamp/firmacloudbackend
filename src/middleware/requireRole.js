// Gate por módulo encima de auth/apiKeyOrAuth (que ya ponen req.user.role).
// 'admin' siempre pasa. El resto de roles necesita estar en la lista permitida.
function requireRole(...allowed) {
  return function (req, res, next) {
    if (req.user.role === 'admin' || allowed.includes(req.user.role)) return next();
    return res.status(403).json({ error: 'No tienes permiso para acceder a este módulo' });
  };
}

module.exports = requireRole;
