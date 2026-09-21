const client = require('../config/twilio');
const { normalizePhone } = require('./whatsappService');

// El SMS usa el codigo corto (sms_short_code, ver migration_sms_channel.sql) en vez del
// token completo de 96 caracteres que usan email/WhatsApp -- ese token solo hace la URL
// mas larga sin ganar nada en SMS (se paga por segmento). GET /api/s/:code redirige a
// /firmar/:token del lado del servidor, transparente para el cliente. Va bajo /api porque
// nginx solo proxya ese prefijo al backend -- una ruta "/s/:code" en la raiz del dominio
// caeria en el catch-all del SPA (try_files ... /index.html) y nunca llegaria a Node.
function buildSigningUrl(smsShortCode) {
  const publicBase = (process.env.PUBLIC_APP_URL || process.env.APP_URL || '').replace(/\/$/, '');
  return `${publicBase}/api/s/${smsShortCode}`;
}

// Cualquier tilde (á/í/ó/ú) fuerza a Twilio a codificar el SMS en UCS-2 (67
// caracteres por segmento) en vez de GSM-7 (153 por segmento) -- un mensaje
// transaccional entero pasa de costar 2 segmentos a 5 solo por llevar tildes.
// Se aplica al body ya armado, nunca a datos del cliente (nombre) antes de
// esto -- normalize('NFD') + quitar diacriticos es la misma tecnica que
// sanitizeFilenamePart() usa en signatureController.js.
function toGsm7Safe(str) {
  return str.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Flujo original (sendDocument) — branding Asiste Health Care, mismo texto que sendSignatureRequest.
async function sendSignatureSms({ clientName, clientPhone, smsShortCode, documentName }) {
  const to = `+${normalizePhone(clientPhone)}`;
  const body = toGsm7Safe(
    `Hola ${clientName}, ${process.env.SMTP_FROM_NAME || 'Asiste Health Care'} te envió el documento "${documentName}" para firmar. Ingresa aquí (válido 72h): ${buildSigningUrl(smsShortCode)}`
  );

  return client.messages.create({ from: process.env.TWILIO_SMS_FROM_NUMBER, to, body });
}

// Módulo Vital — Firma Tratamiento de Datos: mismo branding que sendVitalSignatureRequest
// (email) y sendVitalWhatsApp, pero recortado y sin tildes -- el email/WhatsApp no tienen
// costo por longitud, el SMS si (por segmento), asi que aqui prima el costo sobre la
// fidelidad literal del texto aprobado. sendDocumentWithData es exclusiva de Vital, asi
// que esta funcion reemplaza a sendSignatureSms ahi sin condicional.
async function sendVitalSignatureSms({ clientName, clientPhone, smsShortCode }) {
  const to = `+${normalizePhone(clientPhone)}`;
  const body = toGsm7Safe(
    `Estimado(a) ${clientName}, desde Vital Health Insurance le enviamos el documento de autorización para tratamiento de datos personales. Fírmelo aquí (72h, un solo uso): ${buildSigningUrl(smsShortCode)}`
  );

  return client.messages.create({ from: process.env.TWILIO_SMS_FROM_NUMBER, to, body });
}

module.exports = { sendSignatureSms, sendVitalSignatureSms };
