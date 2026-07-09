const db = require('../config/database');

function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.socket.remoteAddress
    || 'unknown';
}

// Extracts the leading hex token and ignores trailing garbage (e.g. "%20Gracias." from WhatsApp URL parser)
function cleanToken(raw) {
  const m = (raw || '').match(/^[a-f0-9]+/i);
  return m ? m[0] : '';
}

async function findValidCarta(token) {
  const [rows] = await db.query(
    `SELECT id, client_name, status, token_expires_at
     FROM signature_requests
     WHERE token = ? AND npn_name IS NOT NULL`,
    [cleanToken(token)]
  );
  return rows[0] || null;
}

async function validateFormToken(req, res, next) {
  try {
    const { token } = req.params;
    const record = await findValidCarta(token);

    if (!record) return res.status(404).json({ error: 'Enlace no válido' });
    if (record.status === 'signed') return res.status(409).json({ error: 'Este documento ya fue firmado' });

    res.json({ clientName: record.client_name, status: record.status });
  } catch (err) {
    next(err);
  }
}

async function submitForm(req, res, next) {
  try {
    const { token } = req.params;
    const body = req.body || {};

    const record = await findValidCarta(token);
    if (!record) return res.status(404).json({ error: 'Enlace no válido' });
    if (record.status === 'signed') return res.status(409).json({ error: 'Este documento ya fue firmado' });

    const required = ['name', 'phone', 'email', 'postalcode'];
    for (const field of required) {
      if (!body[field] || typeof body[field] !== 'string' || !body[field].trim())
        return res.status(400).json({ error: `Campo requerido: ${field}` });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email))
      return res.status(400).json({ error: 'Email inválido' });

    const socialPath = req.files?.social?.[0]?.path           || null;
    const statusPath = req.files?.status_migratorio?.[0]?.path || null;

    await db.query(
      `INSERT INTO carta_form_data
         (signature_request_id, name, phone, email, postalcode, submitted_at, social_path, status_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name), phone = VALUES(phone), email = VALUES(email),
         postalcode = VALUES(postalcode), submitted_at = VALUES(submitted_at),
         social_path = VALUES(social_path), status_path = VALUES(status_path)`,
      [
        record.id,
        body.name.trim(),
        body.phone.trim(),
        body.email.trim().toLowerCase(),
        body.postalcode.trim(),
        new Date(),
        socialPath,
        statusPath,
      ]
    );

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

module.exports = { validateFormToken, submitForm };
