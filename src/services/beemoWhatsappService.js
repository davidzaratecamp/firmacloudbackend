require('dotenv').config();
const { normalizePhone } = require('./whatsappService'); // solo la función pura, sin estado ni credenciales

// Número de Meta PROPIO del módulo Beemo. NUNCA cae al token/phone_number_id global —
// un fallback silencioso mandaría el mensaje desde el número equivocado.
async function sendBeemoSignatureWhatsApp({ recipientName, recipientPhone, token }) {
  const phoneNumberId = process.env.BEEMO_WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.BEEMO_WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !accessToken) {
    throw new Error('WhatsApp Beemo no configurado (falta BEEMO_WHATSAPP_PHONE_NUMBER_ID / BEEMO_WHATSAPP_ACCESS_TOKEN)');
  }

  const phone = normalizePhone(recipientPhone);

  const response = await fetch(
    `https://graph.facebook.com/v25.0/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phone,
        type: 'template',
        template: {
          name: process.env.BEEMO_WHATSAPP_TEMPLATE_NAME || 'beemo_firma',
          language: { code: process.env.BEEMO_WHATSAPP_TEMPLATE_LANG || 'es' },
          components: [
            {
              // Plantilla aprobada "open_america_insurance" usa parameter_format NAMED:
              // body = "Hola {{nombre_cliente}}, le saluda Open America Insurance..."
              type: 'body',
              parameters: [
                { type: 'text', parameter_name: 'nombre_cliente', text: recipientName },
              ],
            },
            {
              // El enlace es un botón URL con sufijo dinámico, no un parámetro del body.
              // La URL base quedó fija al aprobar la plantilla en Meta: https://firmahealthcare.com/firmar/{{1}}
              // — apunta al flujo ORIGINAL de firmas (signature_requests), no a /firmar-beemo/.
              // TODO: reenviar la plantilla a Meta con la URL correcta (/firmar-beemo/{{1}}) cuando
              // el negocio lo apruebe; mientras tanto el botón lleva a "enlace no válido" para
              // documentos Beemo. Ver conversación 2026-09-08.
              type: 'button',
              sub_type: 'url',
              index: 0,
              parameters: [
                { type: 'text', text: token },
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

module.exports = { sendBeemoSignatureWhatsApp };
