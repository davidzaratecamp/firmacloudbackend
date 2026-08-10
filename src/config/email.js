const nodemailer = require('nodemailer');
require('dotenv').config();

// Transporter del flujo original de tratamiento de datos (y HR, ver hrEmailService.js).
// Timeouts propios para que un SMTP destino lento no cuelgue la request indefinidamente
// hasta que nginx corte con un 502 — mismo patrón que config/npnEmail.js.
const transporter = nodemailer.createTransport({
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

module.exports = transporter;
