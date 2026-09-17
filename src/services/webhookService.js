const crypto = require('crypto');

function signPayload(payload, signingKey) {
  return crypto
    .createHmac('sha256', signingKey)
    .update(JSON.stringify(payload))
    .digest('hex');
}

// signingKey: la API key del sistema dueño del documento, para que ese sistema pueda
// verificar la firma HMAC con SU PROPIA credencial — default API_KEY (Obama, legado) para
// no romper llamadas existentes; el módulo vital pasa VITAL_API_KEY explícitamente (ver
// publicController.js) porque su intranet nunca tuvo ni debe tener el valor de API_KEY.
async function triggerWebhook(webhookUrl, payload, signingKey = process.env.API_KEY) {
  const signature = signPayload(payload, signingKey);
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-FirmaCloud-Signature': signature,
        'X-FirmaCloud-Event': payload.event,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    console.error(`[webhook] Error enviando a ${webhookUrl}:`, err.message);
  }
}

module.exports = { triggerWebhook };
