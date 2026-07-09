const nodemailer = require('nodemailer');
require('dotenv').config();

// Transporter exclusivo del módulo de actualización de datos (cartas NPN / Oleadas).
// Usa las mismas credenciales SMTP que el flujo original (config/email.js) pero con
// timeouts propios: evita que un servidor destino lento (greylisting/antispam corporativo)
// cuelgue un lote de Oleadas por varios minutos, sin tocar el transporter del flujo
// original de tratamiento de datos.
const npnTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  connectionTimeout: parseInt(process.env.NPN_SMTP_CONNECTION_TIMEOUT_MS) || 15000,
  greetingTimeout:   parseInt(process.env.NPN_SMTP_GREETING_TIMEOUT_MS)   || 15000,
  socketTimeout:     parseInt(process.env.NPN_SMTP_SOCKET_TIMEOUT_MS)     || 20000,
});

module.exports = npnTransporter;
