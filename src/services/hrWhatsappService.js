require('dotenv').config();
const { normalizePhone } = require('./whatsappService');

// Sin nombre del destinatario ni ningún otro dato — solo el enlace de firma.
async function sendContractWhatsApp({ recipientPhone, token }) {
  const publicBase = process.env.PUBLIC_APP_URL || process.env.APP_URL;
  const signingUrl = `${publicBase}/firmar-contrato/${token}`;
  const phone = normalizePhone(recipientPhone);

  const response = await fetch(
    `https://graph.facebook.com/v25.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phone,
        type: 'template',
        template: {
          name: process.env.HR_WHATSAPP_TEMPLATE_NAME || 'contrato_laboral',
          language: { code: process.env.HR_WHATSAPP_TEMPLATE_LANG || 'es' },
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: signingUrl },
              ],
            },
          ],
        },
      }),
    }
  );

  if (!response.ok) {
    const err = await response.json();
    throw new Error(`WhatsApp API error: ${err.error?.message || JSON.stringify(err)}`);
  }

  return response.json();
}

module.exports = { sendContractWhatsApp };
