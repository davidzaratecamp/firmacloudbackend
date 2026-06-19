const express = require('express');
const router = express.Router();
require('dotenv').config();

const NO_REPLY_TEXT = 'Este número es solo para el envío de notificaciones de Asiste Health Care y no está habilitado para recibir mensajes. Para asistencia, escríbenos a soporte@asistehealth.com';

async function sendAutoReply(to) {
  try {
    await fetch(`https://graph.facebook.com/v25.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: NO_REPLY_TEXT },
      }),
    });
  } catch (err) {
    console.error('[webhook] Error enviando auto-reply:', err.message);
  }
}

// Meta webhook verification (GET)
router.get('/', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    console.log('[webhook] Verificación exitosa');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// Message status events (POST)
router.post('/', (req, res) => {
  const body = req.body;
  if (body.object !== 'whatsapp_business_account') return res.sendStatus(404);

  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value;

      // Message status updates (delivered, read, failed)
      for (const status of value.statuses || []) {
        console.log(`[webhook] Mensaje ${status.id} → status: ${status.status}${status.errors ? ' | errores: ' + JSON.stringify(status.errors) : ''}`);
      }

      // Incoming messages — auto-reply
      for (const msg of value.messages || []) {
        console.log(`[webhook] Mensaje entrante de ${msg.from} — enviando auto-reply`);
        sendAutoReply(msg.from);
      }
    }
  }

  res.sendStatus(200);
});

module.exports = router;
