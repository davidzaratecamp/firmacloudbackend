const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const { stampSignature } = require('../services/pdfService');
const { hashBuffer } = require('../utils/hash');
const { triggerWebhook } = require('../services/webhookService');

const SIGNED_DIR = path.resolve(process.env.SIGNED_DIR || path.join(__dirname, '../../signed'));

function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
}

function detectDevice(ua) {
  if (!ua) return 'Desconocido';
  if (/mobile/i.test(ua)) return 'Móvil';
  if (/tablet|ipad/i.test(ua)) return 'Tablet';
  return 'Escritorio';
}

async function getSigningPage(req, res, next) {
  try {
    const { token } = req.params;
    const [rows] = await db.query(
      'SELECT id, document_name, client_name, status, token_expires_at FROM signature_requests WHERE token = ?',
      [token]
    );

    if (!rows.length) return res.status(404).json({ error: 'Enlace no válido' });

    const sig = rows[0];
    if (new Date() > new Date(sig.token_expires_at)) {
      await db.query("UPDATE signature_requests SET status = 'expired' WHERE id = ?", [sig.id]);
      return res.status(410).json({ error: 'Este enlace ha expirado' });
    }
    if (sig.status === 'signed') return res.status(409).json({ error: 'Este documento ya fue firmado' });
    if (sig.status === 'expired') return res.status(410).json({ error: 'Este enlace ha expirado' });

    res.json({ id: sig.id, documentName: sig.document_name, clientName: sig.client_name, status: sig.status });
  } catch (err) {
    next(err);
  }
}

async function recordView(req, res, next) {
  try {
    const { token } = req.params;
    const [rows] = await db.query('SELECT * FROM signature_requests WHERE token = ?', [token]);
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });

    const sig = rows[0];
    if (sig.status === 'pending') {
      await db.query("UPDATE signature_requests SET status = 'viewed', viewed_at = NOW() WHERE id = ?", [sig.id]);
    }

    const ip = getClientIP(req);
    const ua = req.headers['user-agent'];
    await db.query(
      'INSERT INTO activity_logs (signature_request_id, event_type, details, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)',
      [sig.id, 'DOCUMENT_VIEWED', JSON.stringify({ page: 'signing_page' }), ip, ua]
    );

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

async function getDocumentForSigning(req, res, next) {
  try {
    const { token } = req.params;
    const [rows] = await db.query('SELECT * FROM signature_requests WHERE token = ?', [token]);
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });

    const sig = rows[0];
    if (sig.status === 'signed' || sig.status === 'expired') {
      return res.status(410).json({ error: 'Enlace no disponible' });
    }

    // Resolve path: handle both absolute and relative (legacy) paths
    const filePath = path.isAbsolute(sig.document_original_path)
      ? sig.document_original_path
      : path.join(__dirname, '../../', sig.document_original_path);

    // Allow PDF to be embedded in iframe from the frontend origin
    res.setHeader('X-Frame-Options', 'ALLOWALL');
    res.setHeader('Access-Control-Allow-Origin', process.env.APP_URL || '*');
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
    const { token } = req.params;
    const { signatureDataUrl, signerName, geolocation } = req.body;

    if (!signatureDataUrl || !signerName) {
      return res.status(400).json({ error: 'Firma y nombre requeridos' });
    }

    const [rows] = await db.query('SELECT * FROM signature_requests WHERE token = ?', [token]);
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });

    const sig = rows[0];
    if (sig.status === 'signed') return res.status(409).json({ error: 'Ya firmado' });
    if (sig.status === 'expired') return res.status(410).json({ error: 'Expirado' });
    if (new Date() > new Date(sig.token_expires_at)) {
      await db.query("UPDATE signature_requests SET status = 'expired' WHERE id = ?", [sig.id]);
      return res.status(410).json({ error: 'Enlace expirado' });
    }

    const ip = getClientIP(req);
    const ua = req.headers['user-agent'];
    const device = detectDevice(ua);
    const signedAt = new Date();

    const signerInfo = {
      id: sig.id,
      signerName,
      signedAt: signedAt.toISOString().replace('T', ' ').slice(0, 19) + ' UTC',
      ipAddress: ip,
    };

    const signedPdfBuffer = await stampSignature(sig.document_original_path, signatureDataUrl, signerInfo);
    const signedHash = hashBuffer(Buffer.from(signedPdfBuffer));

    const signedFileName = `FIRMADO-${sig.id}-${sig.document_name}`;
    const signedPath = path.join(SIGNED_DIR, signedFileName);
    await fs.writeFile(signedPath, signedPdfBuffer);

    // Atomic update: only succeeds if still not signed (prevents race condition)
    const [updateResult] = await db.query(
      `UPDATE signature_requests SET
        status = 'signed',
        signed_at = ?,
        signer_name = ?,
        signer_ip = ?,
        signer_user_agent = ?,
        signer_device = ?,
        signer_geolocation = ?,
        signed_document_path = ?
       WHERE id = ? AND status IN ('pending', 'viewed')`,
      [signedAt, signerName, ip, ua, device, geolocation ? JSON.stringify(geolocation) : null, signedPath, sig.id]
    );

    if (updateResult.affectedRows === 0) {
      await fs.unlink(signedPath).catch(() => {});
      return res.status(409).json({ error: 'Ya firmado' });
    }

    await db.query(
      'INSERT INTO activity_logs (signature_request_id, event_type, details, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)',
      [sig.id, 'DOCUMENT_SIGNED', JSON.stringify({ signerName, device, documentHashSigned: signedHash }), ip, ua]
    );

    if (sig.webhook_url) {
      triggerWebhook(sig.webhook_url, {
        event: 'document.signed',
        id: sig.id,
        clientName: sig.client_name,
        clientEmail: sig.client_email,
        clientPhone: sig.client_phone,
        documentName: sig.document_name,
        signerName,
        signerIp: ip,
        signerDevice: device,
        signedAt: signedAt.toISOString(),
        downloadUrl: `${process.env.APP_URL?.replace(':5173', ':3000') || ''}/api/signatures/${sig.id}/download`,
      });
    }

    res.json({ ok: true, message: 'Documento firmado exitosamente', signedAt: signedAt.toISOString() });
  } catch (err) {
    next(err);
  }
}

module.exports = { getSigningPage, recordView, getDocumentForSigning, submitSignature };
