const { normalizePhone } = require('./whatsappService');

// Envío por WhatsApp del link de firma. Reusa SOLO el helper puro normalizePhone de
// whatsappService.js (mismo patrón ya usado por hrWhatsappService.js) — el envío en sí es
// propio de este módulo, con su propio template de Meta.
async function sendReclutamientoWhatsApp({ candidateName, candidatePhone, token }) {
  const publicBase = (process.env.PUBLIC_APP_URL || process.env.APP_URL || '').replace(/\/$/, '');
  const signingUrl = `${publicBase}/firmar-reclutamiento/${token}`;
  const phone = normalizePhone(candidatePhone);
  const lang = process.env.RECLUTAMIENTO_WHATSAPP_TEMPLATE_LANG || 'es';
  const templateName = process.env.RECLUTAMIENTO_WHATSAPP_TEMPLATE_NAME || 'reclutamiento_firma';

  const res = await fetch(
    `https://graph.facebook.com/v25.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phone,
        type: 'template',
        template: {
          name: templateName,
          language: { code: lang },
          components: [{ type: 'body', parameters: [
            { type: 'text', text: candidateName },
            { type: 'text', text: signingUrl },
          ] }],
        },
      }),
    }
  );
  const data = await res.json();
  if (data.error) throw new Error(`WhatsApp API error: ${data.error.message}`);
  return data;
}

module.exports = { sendReclutamientoWhatsApp };
