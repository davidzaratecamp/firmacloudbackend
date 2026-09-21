const crypto = require('crypto');

function generateSecureToken() {
  return crypto.randomBytes(48).toString('hex');
}

// Codigo corto solo para el enlace de SMS (ver migration_sms_channel.sql) -- 6 bytes en
// base64url son 8 caracteres, muchisimo mas cortos que el token completo de 96 caracteres
// que usan email/WhatsApp, y suficiente entropia (48 bits) para esta ventana de 72h.
function generateShortCode() {
  return crypto.randomBytes(6).toString('base64url');
}

function getTokenExpiry(hours = 72) {
  const d = new Date();
  d.setHours(d.getHours() + hours);
  return d;
}

module.exports = { generateSecureToken, generateShortCode, getTokenExpiry };
