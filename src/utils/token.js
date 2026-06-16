const crypto = require('crypto');

function generateSecureToken() {
  return crypto.randomBytes(48).toString('hex');
}

function getTokenExpiry(hours = 72) {
  const d = new Date();
  d.setHours(d.getHours() + hours);
  return d;
}

module.exports = { generateSecureToken, getTokenExpiry };
