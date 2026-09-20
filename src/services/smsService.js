const client = require('../config/twilio');
const { normalizePhone } = require('./whatsappService');

async function sendSignatureSms({ clientName, clientPhone, token, documentName }) {
  const publicBase = (process.env.PUBLIC_APP_URL || process.env.APP_URL || '').replace(/\/$/, '');
  const signingUrl = `${publicBase}/firmar/${token}`;
  const to = `+${normalizePhone(clientPhone)}`;

  const body = `Hola ${clientName}, ${process.env.SMTP_FROM_NAME || 'Asiste Health Care'} te envió el documento "${documentName}" para firmar. Ingresa aquí (válido 72h): ${signingUrl}`;

  return client.messages.create({
    from: process.env.TWILIO_SMS_FROM_NUMBER,
    to,
    body,
  });
}

module.exports = { sendSignatureSms };
