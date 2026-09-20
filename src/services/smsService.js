const client = require('../config/twilio');
const { normalizePhone } = require('./whatsappService');

function buildSigningUrl(token) {
  const publicBase = (process.env.PUBLIC_APP_URL || process.env.APP_URL || '').replace(/\/$/, '');
  return `${publicBase}/firmar/${token}`;
}

// Flujo original (sendDocument) — branding Asiste Health Care, mismo texto que sendSignatureRequest.
async function sendSignatureSms({ clientName, clientPhone, token, documentName }) {
  const to = `+${normalizePhone(clientPhone)}`;
  const body = `Hola ${clientName}, ${process.env.SMTP_FROM_NAME || 'Asiste Health Care'} te envió el documento "${documentName}" para firmar. Ingresa aquí (válido 72h): ${buildSigningUrl(token)}`;

  return client.messages.create({ from: process.env.TWILIO_SMS_FROM_NUMBER, to, body });
}

// Módulo Vital — Firma Tratamiento de Datos: mismo texto/branding que sendVitalSignatureRequest
// (email) y sendVitalWhatsApp, para que el cliente reciba el mismo mensaje sin importar el canal.
// sendDocumentWithData es exclusiva de Vital, así que esta función reemplaza a sendSignatureSms
// ahí sin condicional (igual que sendVitalWhatsApp reemplazó a sendSignatureWhatsApp). El SMS no
// admite el botón "Firma Digital" que sí llevan el email y la plantilla de WhatsApp — se reemplaza
// por el enlace directo en el cuerpo, es la única diferencia respecto al texto aprobado.
async function sendVitalSignatureSms({ clientName, clientPhone, token }) {
  const to = `+${normalizePhone(clientPhone)}`;
  const body = `Estimado(a) ${clientName}, desde Vital Health Insurance le hacemos llegar el documento de autorización para el tratamiento de sus datos personales, necesario para continuar con el proceso de su solicitud de seguro médico. Fírmelo aquí (válido 72h, un solo uso): ${buildSigningUrl(token)}`;

  return client.messages.create({ from: process.env.TWILIO_SMS_FROM_NUMBER, to, body });
}

module.exports = { sendSignatureSms, sendVitalSignatureSms };
