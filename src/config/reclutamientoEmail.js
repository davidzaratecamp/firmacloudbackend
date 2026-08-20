const nodemailer = require('nodemailer');
require('dotenv').config();

// Transporter exclusivo del módulo Reclutamiento. Decisión explícita del usuario
// (2026-08-19): usa la cuenta de correo que ya tenía configurada Hydra (auth básica
// usuario/clave, SIN Google Workspace/OAuth2) — no la cuenta soporte@firmahealthcare.com que
// ya usan el flujo original, NPN y RRHH. Puede caer en spam por no tener Workspace; aceptado
// como algo a ajustar más adelante, no bloquea esta fase.
const reclutamientoTransporter = nodemailer.createTransport({
  host: process.env.RECLUTAMIENTO_SMTP_HOST,
  port: parseInt(process.env.RECLUTAMIENTO_SMTP_PORT) || 587,
  secure: process.env.RECLUTAMIENTO_SMTP_SECURE === 'true',
  auth: {
    user: process.env.RECLUTAMIENTO_SMTP_USER,
    pass: process.env.RECLUTAMIENTO_SMTP_PASS,
  },
  connectionTimeout: parseInt(process.env.RECLUTAMIENTO_SMTP_CONNECTION_TIMEOUT_MS) || 15000,
  greetingTimeout:   parseInt(process.env.RECLUTAMIENTO_SMTP_GREETING_TIMEOUT_MS)   || 15000,
  socketTimeout:     parseInt(process.env.RECLUTAMIENTO_SMTP_SOCKET_TIMEOUT_MS)     || 20000,
});

module.exports = reclutamientoTransporter;
