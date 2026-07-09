const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const { stampSignature, getContratoSignConfig } = require('../services/pdfService');
const { hashBuffer } = require('../utils/hash');
const { triggerWebhook } = require('../services/webhookService');

function buildWebhookBase(sig) {
  return {
    id: sig.id,
    clientName: sig.client_name,
    clientEmail: sig.client_email,
    clientPhone: sig.client_phone,
    documentName: sig.document_name,
  };
}

const SIGNED_DIR = path.resolve(process.env.SIGNED_DIR || path.join(__dirname, '../../signed'));

function getClientIP(req) {
  const raw = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.socket.remoteAddress
    || 'unknown';
  // Normalizar IPv6 loopback y IPv4-mapped IPv6 a formato IPv4 legible
  if (raw === '::1') return '127.0.0.1';
  const v4mapped = raw.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4mapped) return v4mapped[1];
  return raw;
}

// WhatsApp URL parser appends trailing text (e.g. " Gracias.") to links; extract only the leading hex token.
function cleanToken(raw) {
  const m = (raw || '').match(/^[a-f0-9]+/i);
  return m ? m[0] : '';
}

function detectDevice(ua) {
  if (!ua) return 'Desconocido';
  if (/mobile/i.test(ua)) return 'Móvil';
  if (/tablet|ipad/i.test(ua)) return 'Tablet';
  return 'Escritorio';
}

async function getSigningPage(req, res, next) {
  try {
    const token = cleanToken(req.params.token);
    const [rows] = await db.query(
      'SELECT id, document_name, client_name, client_email, client_phone, status, token_expires_at, webhook_url, npn_name FROM signature_requests WHERE token = ?',
      [token]
    );

    if (!rows.length) return res.status(404).json({ error: 'Enlace no válido' });

    const sig = rows[0];
    if (!sig.npn_name && new Date() > new Date(sig.token_expires_at)) {
      await db.query("UPDATE signature_requests SET status = 'expired' WHERE id = ?", [sig.id]);
      if (sig.webhook_url) triggerWebhook(sig.webhook_url, { ...buildWebhookBase(sig), event: 'document.expired', expiredAt: new Date().toISOString() });
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
    const token = cleanToken(req.params.token);
    const [rows] = await db.query('SELECT * FROM signature_requests WHERE token = ?', [token]);
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });

    const sig = rows[0];
    if (sig.status === 'pending') {
      const viewedAt = new Date();
      await db.query("UPDATE signature_requests SET status = 'viewed', viewed_at = ? WHERE id = ?", [viewedAt, sig.id]);
      if (sig.webhook_url) triggerWebhook(sig.webhook_url, { ...buildWebhookBase(sig), event: 'document.viewed', viewedAt: viewedAt.toISOString() });
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
    const token = cleanToken(req.params.token);
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

    // Nginx ya agrega X-Frame-Options: SAMEORIGIN a nivel servidor. Fijar aquí un valor
    // distinto (ALLOWALL) hacía que el navegador recibiera dos headers en conflicto y
    // bloqueara el iframe que lo embebe (FormularioPublico.jsx) en vez de mostrarlo.
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
    const { signatureDataUrl, signerName, geolocation, ersdAccepted } = req.body;

    if (!signatureDataUrl || !signerName) {
      return res.status(400).json({ error: 'Firma y nombre requeridos' });
    }
    if (!ersdAccepted) {
      return res.status(400).json({ error: 'Debe aceptar la divulgación de firma electrónica (ERSD)' });
    }
    if (typeof signerName !== 'string' || signerName.length > 150)
      return res.status(400).json({ error: 'Nombre inválido' });
    if (typeof signatureDataUrl !== 'string' || !signatureDataUrl.startsWith('data:image/png;base64,'))
      return res.status(400).json({ error: 'Formato de firma inválido' });
    if (Buffer.byteLength(signatureDataUrl, 'utf8') > 1.5 * 1024 * 1024)
      return res.status(400).json({ error: 'Imagen de firma demasiado grande' });

    const [rows] = await db.query('SELECT * FROM signature_requests WHERE token = ?', [token]);
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });

    const sig = rows[0];
    if (sig.status === 'signed') return res.status(409).json({ error: 'Ya firmado' });
    if (sig.status === 'expired') return res.status(410).json({ error: 'Expirado' });
    if (!sig.npn_name && new Date() > new Date(sig.token_expires_at)) {
      await db.query("UPDATE signature_requests SET status = 'expired' WHERE id = ?", [sig.id]);
      if (sig.webhook_url) triggerWebhook(sig.webhook_url, { ...buildWebhookBase(sig), event: 'document.expired', expiredAt: new Date().toISOString() });
      return res.status(410).json({ error: 'Enlace expirado' });
    }

    const ip = getClientIP(req);
    const ua = req.headers['user-agent'];
    const device = detectDevice(ua);
    const signedAt = new Date();

    const signerInfo = {
      id: sig.id,
      signerName,
      clientEmail: sig.client_email || '',
      signedAt,
      ipAddress: ip,
    };

    // Determinar página y coordenadas del campo de firma según el tipo de documento
    let signFieldOverride = null;
    let signPageIndex = sig.sign_page_index || 0;
    let extraSignLocations = [];

    if (sig.npn_name) {
      // Flujo NPN: coordenadas desde env vars
      const x = parseFloat(process.env.NPN_SIGN_FIELD_X);
      const y = parseFloat(process.env.NPN_SIGN_FIELD_Y);
      const w = parseFloat(process.env.NPN_SIGN_FIELD_W);
      const h = parseFloat(process.env.NPN_SIGN_FIELD_H);
      if (!isNaN(x) && !isNaN(y)) {
        signFieldOverride = { x, y, width: isNaN(w) ? 200 : w, height: isNaN(h) ? 50 : h };
      }
    } else if (signPageIndex > 0) {
      // Flujo contrato de activación (send-with-data): coordenadas desde config JSON
      try {
        const contratoConfig = await getContratoSignConfig();
        signFieldOverride = contratoConfig.signField;
        extraSignLocations = contratoConfig.extraSignLocations;
      } catch {
        // Si no se puede leer el config, usar coordenadas de env vars o defaults
        const x = parseFloat(process.env.ACTIVATION_SIGN_FIELD_X);
        const y = parseFloat(process.env.ACTIVATION_SIGN_FIELD_Y);
        const w = parseFloat(process.env.ACTIVATION_SIGN_FIELD_W);
        const h = parseFloat(process.env.ACTIVATION_SIGN_FIELD_H);
        if (!isNaN(x) && !isNaN(y)) {
          signFieldOverride = { x, y, width: isNaN(w) ? 200 : w, height: isNaN(h) ? 50 : h };
        }
      }
    }

    const signedPdfBuffer = await stampSignature(sig.document_original_path, signatureDataUrl, signerInfo, signFieldOverride, signPageIndex, extraSignLocations);
    const signedHash = hashBuffer(Buffer.from(signedPdfBuffer));

    const signedFileName = `FIRMADO-${sig.id}-${sig.document_name}`;
    const signedPath = path.join(SIGNED_DIR, signedFileName);
    await fs.writeFile(signedPath, signedPdfBuffer);

    // Save raw signature image for the sumarium
    const sigImagePath = path.join(SIGNED_DIR, `SIG-${sig.id}.png`);
    const sigImageBuffer = Buffer.from(signatureDataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
    await fs.writeFile(sigImagePath, sigImageBuffer);

    const ersdAcceptanceId = uuidv4();

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
        signed_document_path = ?,
        signature_image_path = ?,
        ersd_accepted_at = ?,
        ersd_acceptance_id = ?
       WHERE id = ? AND status IN ('pending', 'viewed')`,
      [signedAt, signerName, ip, ua, device, geolocation ? JSON.stringify(geolocation) : null, signedPath, sigImagePath, signedAt, ersdAcceptanceId, sig.id]
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
