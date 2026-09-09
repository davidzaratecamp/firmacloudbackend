const nodemailer = require('nodemailer');
require('dotenv').config();

// Transporter exclusivo del módulo Beemo. Usa las mismas credenciales SMTP que el flujo
// original (config/email.js) pero como instancia propia — mismo patrón que npnEmail.js /
// reclutamientoEmail.js — para no compartir estado con otros módulos.
const beemoTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    type: 'OAuth2',
    user: process.env.SMTP_USER,
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
  },
  connectionTimeout: parseInt(process.env.SMTP_CONNECTION_TIMEOUT_MS) || 15000,
  greetingTimeout:   parseInt(process.env.SMTP_GREETING_TIMEOUT_MS)   || 15000,
  socketTimeout:     parseInt(process.env.SMTP_SOCKET_TIMEOUT_MS)     || 20000,
});

module.exports = beemoTransporter;
