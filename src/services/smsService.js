const client = require('../config/twilio');
const { normalizePhone } = require('./whatsappService');

function buildSigningUrl(token) {
  const publicBase = (process.env.PUBLIC_APP_URL || process.env.APP_URL || '').replace(/\/$/, '');
  return `${publicBase}/firmar/${token}`;
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
async function sendSignatureSms({ clientName, clientPhone, token, documentName }) {
  const to = `+${normalizePhone(clientPhone)}`;
  const body = toGsm7Safe(
    `Hola ${clientName}, ${process.env.SMTP_FROM_NAME || 'Asiste Health Care'} te envió el documento "${documentName}" para firmar. Ingresa aquí (válido 72h): ${buildSigningUrl(token)}`
  );

  return client.messages.create({ from: process.env.TWILIO_SMS_FROM_NUMBER, to, body });
}

// Módulo Vital — Firma Tratamiento de Datos: mismo branding que sendVitalSignatureRequest
// (email) y sendVitalWhatsApp, pero recortado y sin tildes -- el email/WhatsApp no tienen
// costo por longitud, el SMS si (por segmento), asi que aqui prima el costo sobre la
// fidelidad literal del texto aprobado. sendDocumentWithData es exclusiva de Vital, asi
// que esta funcion reemplaza a sendSignatureSms ahi sin condicional.
async function sendVitalSignatureSms({ clientName, clientPhone, token }) {
  const to = `+${normalizePhone(clientPhone)}`;
  const body = toGsm7Safe(
    `Estimado(a) ${clientName}, desde Vital Health Insurance le enviamos el documento de autorización para tratamiento de datos personales. Fírmelo aquí (72h, un solo uso): ${buildSigningUrl(token)}`
  );

  return client.messages.create({ from: process.env.TWILIO_SMS_FROM_NUMBER, to, body });
}

module.exports = { sendSignatureSms, sendVitalSignatureSms };
