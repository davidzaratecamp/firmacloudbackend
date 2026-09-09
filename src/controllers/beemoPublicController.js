const path = require('path');
const fs = require('fs').promises;
const db = require('../config/database');
const { stampBeemoSignature } = require('../services/beemoPdfService');

const SIGNED_DIR = path.resolve(process.env.SIGNED_DIR || path.join(__dirname, '../../signed'));

function getClientIP(req) {
  const raw = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.socket.remoteAddress
    || 'unknown';
  if (raw === '::1') return '127.0.0.1';
  const v4mapped = raw.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4mapped) return v4mapped[1];
  return raw;
}

// El parser de enlaces de WhatsApp pega texto extra al final del link.
function cleanToken(raw) {
  const m = (raw || '').match(/^[a-f0-9]+/i);
  return m ? m[0] : '';
}

async function getSigningPage(req, res, next) {
  try {
    const token = cleanToken(req.params.token);
    const [rows] = await db.query(
      'SELECT id, document_name, status, token_expires_at FROM beemo_documents WHERE token = ?',
      [token]
    );
    if (!rows.length) return res.status(404).json({ error: 'Enlace no válido' });

    const doc = rows[0];
    if (doc.token_expires_at && new Date() > new Date(doc.token_expires_at)) {
      return res.status(410).json({ error: 'Este enlace ha expirado' });
    }
    if (doc.status === 'signed') return res.status(409).json({ error: 'Este documento ya fue firmado' });

    res.json({ id: doc.id, documentName: doc.document_name, status: doc.status });
  } catch (err) {
    next(err);
  }
}

async function recordView(req, res, next) {
  try {
    const token = cleanToken(req.params.token);
    const [rows] = await db.query('SELECT * FROM beemo_documents WHERE token = ?', [token]);
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });

    const doc = rows[0];
    if (doc.status === 'pending') {
      await db.query("UPDATE beemo_documents SET status = 'viewed', viewed_at = ? WHERE id = ?", [new Date(), doc.id]);
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

async function getDocumentForSigning(req, res, next) {
  try {
    const token = cleanToken(req.params.token);
    const [rows] = await db.query('SELECT * FROM beemo_documents WHERE token = ?', [token]);
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });

    const doc = rows[0];
    if (doc.status === 'signed') return res.status(410).json({ error: 'Enlace no disponible' });

    const filePath = path.isAbsolute(doc.document_original_path)
      ? doc.document_original_path
      : path.join(__dirname, '../../', doc.document_original_path);

    res.setHeader('Content-Type', 'application/pdf');
    res.sendFile(filePath, (err) => {
      if (err) next(err);
    });
  } catch (err) {
    next(err);
  }
}

async function submitSignature(req, res, next) {
  try {
    const token = cleanToken(req.params.token);
    const { signatureDataUrl } = req.body;

    if (!signatureDataUrl) return res.status(400).json({ error: 'Firma requerida' });
    if (typeof signatureDataUrl !== 'string' || !signatureDataUrl.startsWith('data:image/png;base64,'))
      return res.status(400).json({ error: 'Formato de firma inválido' });
    if (Buffer.byteLength(signatureDataUrl, 'utf8') > 1.5 * 1024 * 1024)
      return res.status(400).json({ error: 'Imagen de firma demasiado grande' });

    const [rows] = await db.query('SELECT * FROM beemo_documents WHERE token = ?', [token]);
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });

    const doc = rows[0];
    if (doc.status === 'signed') return res.status(409).json({ error: 'Ya firmado' });
    if (doc.token_expires_at && new Date() > new Date(doc.token_expires_at)) {
      return res.status(410).json({ error: 'Enlace expirado' });
    }

    const ip = getClientIP(req);
    const ua = req.headers['user-agent'];
    const signedAt = new Date();

    const signedPdfBuffer = await stampBeemoSignature(doc.document_original_path, signatureDataUrl, {
      recipientName: doc.recipient_name,
      recipientEmail: doc.recipient_email,
      ip,
      documentId: doc.id,
    });

    const signedFileName = `BEEMO-FIRMADO-${doc.id}-${doc.document_name}`;
    const signedPath = path.join(SIGNED_DIR, signedFileName);
    await fs.writeFile(signedPath, signedPdfBuffer);

    const sigImagePath = path.join(SIGNED_DIR, `BEEMO-SIG-${doc.id}.png`);
    const sigImageBuffer = Buffer.from(signatureDataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
    await fs.writeFile(sigImagePath, sigImageBuffer);

    // Update atómico: solo firma si sigue en pending/viewed (previene doble firma por doble clic)
    const [updateResult] = await db.query(
      `UPDATE beemo_documents SET
        status = 'signed',
        signed_at = ?,
        signer_ip = ?,
        signer_user_agent = ?,
        signed_document_path = ?,
        signature_image_path = ?
       WHERE id = ? AND status IN ('pending', 'viewed')`,
      [signedAt, ip, ua, signedPath, sigImagePath, doc.id]
    );

    if (updateResult.affectedRows === 0) {
      await fs.unlink(signedPath).catch(() => {});
      await fs.unlink(sigImagePath).catch(() => {});
      return res.status(409).json({ error: 'Ya firmado' });
    }

    res.json({ ok: true, message: 'Documento firmado exitosamente', signedAt: signedAt.toISOString() });
  } catch (err) {
    next(err);
  }
}

module.exports = { getSigningPage, recordView, getDocumentForSigning, submitSignature };
