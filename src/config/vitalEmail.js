const nodemailer = require('nodemailer');
require('dotenv').config();

// Transporter exclusivo del módulo Vital. Cuenta propia de Workspace
// (agente.seguros@vitalinsurence.com), distinta de soporte@firmahealthcare.com que usa el
// flujo original/NPN/RRHH/Beemo — mismo patrón que reclutamientoEmail.js (auth básica
// usuario/clave con App Password, no OAuth2, porque el refresh token global está atado a la
// otra cuenta de Google).
const vitalTransporter = nodemailer.createTransport({
  host: process.env.VITAL_SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.VITAL_SMTP_PORT) || 587,
  secure: process.env.VITAL_SMTP_SECURE === 'true',
  auth: {
    user: process.env.VITAL_SMTP_USER,
    pass: process.env.VITAL_SMTP_PASS,
  },
  connectionTimeout: parseInt(process.env.VITAL_SMTP_CONNECTION_TIMEOUT_MS) || 15000,
  greetingTimeout:   parseInt(process.env.VITAL_SMTP_GREETING_TIMEOUT_MS)   || 15000,
  socketTimeout:     parseInt(process.env.VITAL_SMTP_SOCKET_TIMEOUT_MS)     || 20000,
});

module.exports = vitalTransporter;
