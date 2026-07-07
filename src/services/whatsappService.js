require('dotenv').config();

function normalizePhone(phone) {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('00')) return digits.slice(2);
  if (digits.startsWith('3') && digits.length === 10) return `57${digits}`;
  return digits;
}


async function sendSignatureWhatsApp({ clientName, clientPhone, token, documentName }) {
  const publicBase = process.env.PUBLIC_APP_URL || process.env.APP_URL;
  const signingUrl = `${publicBase}/firmar/${token}`;
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

async function sendFormWhatsApp({ clientName, clientPhone, token, npnName }) {
  const publicBase = (process.env.PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');
  const formularioUrl = `${publicBase}/formulario/${token}`;
  const phone = normalizePhone(clientPhone);
  const lang = process.env.WHATSAPP_FORM_TEMPLATE_LANG || process.env.WHATSAPP_TEMPLATE_LANG || 'es';
  const agentName = npnName || 'su agente';
  const docName = `${agentName}.pdf`;

  // Template principal con contenido completo igual al correo (4 params: nombre, agente, doc, url)
  // Texto del template en Meta debe ser:
  // Estimado/a {{1}},
  //
  // Nos comunicamos con usted de parte de la Aseguradora Oscar para informarle que, de acuerdo
  // con nuestros registros, es necesario actualizar su información personal en nuestra base de
  // datos de manera urgente.
  //
  // Esta actualización es obligatoria para garantizar la continuidad de su cobertura y el correcto
  // procesamiento de los beneficios de su póliza. Le recordamos que {{2}} está disponible para
  // acompañarle en este proceso.
  //
  // ⏰ Este enlace es de uso único y personal.
  //
  // 📄 Abra el siguiente enlace para leer el comunicado *{{3}}* completo.
  // Una vez leído, encontrará un botón para actualizar sus datos y firmar:
  //
  // {{4}}
  const primaryTemplate  = process.env.WHATSAPP_FORM_TEMPLATE_NAME || 'actualizacion_datos_v5';
  const fallback3Template = 'actualizacion_datos_v5'; // template con 3 params (nombre, agente, url)
  const fallbackTemplate  = 'firma_documento_v2';     // template con 2 params (nombre, url)

  // Indica si el template primario tiene un botón CTA de URL configurado en Meta
  const templateHasButton = process.env.WHATSAPP_FORM_TEMPLATE_HAS_BUTTON === 'true';

  async function trySend(templateName, bodyParams, buttonUrlParam = null) {
    const components = [{ type: 'body', parameters: bodyParams }];
    if (buttonUrlParam) {
      // CTA button: el template en Meta define el base URL, aquí se pasa el sufijo dinámico (token)
      components.push({
        type:       'button',
        sub_type:   'url',
        index:      '0',
        parameters: [{ type: 'text', text: buttonUrlParam }],
      });
    }

    const res = await fetch(
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
            name: templateName,
            language: { code: lang },
            components,
          },
        }),
      }
    );
    const data = await res.json();
    if (data.error?.code === 132001 || data.error?.code === 132000) return null;
    if (data.error) throw new Error(`WhatsApp API error: ${data.error.message}`);
    return data;
  }

  // 1. Template principal: nombre + agente + doc + URL completa en body (4 params)
  let result = await trySend(
    primaryTemplate,
    [
      { type: 'text', text: clientName },
      { type: 'text', text: agentName },
      { type: 'text', text: docName },
      { type: 'text', text: formularioUrl },
    ],
    templateHasButton ? token : null,
  );

  // 2. Fallback 3 params: nombre + agente + URL
  if (!result) {
    console.warn(`[whatsapp-carta] Template "${primaryTemplate}" (4 params) no disponible, intentando con 3 params`);
    result = await trySend(fallback3Template, [
      { type: 'text', text: clientName },
      { type: 'text', text: agentName },
      { type: 'text', text: formularioUrl },
    ]);
  }

  // 3. Fallback 2 params: nombre + URL
  if (!result) {
    console.warn(`[whatsapp-carta] Template "${fallback3Template}" no disponible, usando fallback "${fallbackTemplate}"`);
    result = await trySend(fallbackTemplate, [
      { type: 'text', text: clientName },
      { type: 'text', text: formularioUrl },
    ]);
  }

  if (!result) throw new Error('Ningún template de WhatsApp disponible para el formulario');
  return result;
}

module.exports = { sendSignatureWhatsApp, sendFormWhatsApp, normalizePhone };
