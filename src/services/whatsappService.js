require('dotenv').config();

// Normalizes phone to Meta format: country code + number, no + sign (e.g. 573001234567)
function normalizePhone(phone) {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('57') && digits.length === 12) return digits;
  if (digits.startsWith('3') && digits.length === 10) return `57${digits}`;
  if (digits.startsWith('0057')) return digits.slice(4);
  return digits;
}

async function sendSignatureWhatsApp({ clientName, clientPhone, token, documentName }) {
  const signingUrl = `${process.env.APP_URL}/firmar/${token}`;
  const phone = normalizePhone(clientPhone);

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
          name: process.env.WHATSAPP_TEMPLATE_NAME || 'firma_documento',
          language: { code: process.env.WHATSAPP_TEMPLATE_LANG || 'es' },
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: clientName },
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

module.exports = { sendSignatureWhatsApp, normalizePhone };
