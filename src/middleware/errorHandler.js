function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  if (process.env.NODE_ENV !== 'production') {
    console.error(err);
    return res.status(status).json({ error: err.message, stack: err.stack });
  }
  // Never expose internal errors to clients in production
  console.error(`[${new Date().toISOString()}] ${status} - ${err.message} - ${req.method} ${req.path}`);
  res.status(status).json({ error: status >= 500 ? 'Error interno del servidor' : err.message });
}

module.exports = errorHandler;
