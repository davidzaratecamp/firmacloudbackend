const express = require('express');
const router = express.Router();

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

      // Incoming messages
      for (const msg of value.messages || []) {
        console.log(`[webhook] Mensaje entrante de ${msg.from}: ${JSON.stringify(msg)}`);
      }
    }
  }

  res.sendStatus(200);
});

module.exports = router;
