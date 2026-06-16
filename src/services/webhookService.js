const crypto = require('crypto');

function signPayload(payload) {
  return crypto
    .createHmac('sha256', process.env.API_KEY)
    .update(JSON.stringify(payload))
    .digest('hex');
}

async function triggerWebhook(webhookUrl, payload) {
  const signature = signPayload(payload);
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
