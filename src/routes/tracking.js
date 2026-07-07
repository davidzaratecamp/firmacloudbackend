const express = require('express');
const router  = express.Router();
const db      = require('../config/database');
const { PIXEL_PNG } = require('../services/cartaEmailService');

function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.socket.remoteAddress
    || 'unknown';
}

router.get('/:id/pixel.png', (req, res) => {
  // Respond immediately — never block on DB
  res.set({
    'Content-Type':   'image/png',
    'Content-Length': PIXEL_PNG.length,
    'Cache-Control':  'no-store, no-cache, must-revalidate, private',
    'Pragma':         'no-cache',
  });
  res.end(PIXEL_PNG);

  // Fire-and-forget: mark the signature_request as viewed (email opened)
  db.query(
    `UPDATE signature_requests
     SET status = 'viewed', viewed_at = NOW()
     WHERE id = ? AND status = 'pending' AND npn_name IS NOT NULL`,
    [req.params.id]
  ).catch(err => {
    console.error('[tracking] Error registrando apertura de email:', err.message);
  });
});

module.exports = router;
