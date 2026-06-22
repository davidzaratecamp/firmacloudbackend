const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs').promises;
const db = require('../config/database');
const { generateSecureToken, getTokenExpiry } = require('../utils/token');
const { hashFile } = require('../utils/hash');
const { sendSignatureRequest } = require('../services/emailService');
const { sendSignatureWhatsApp } = require('../services/whatsappService');
const { generateCertificate, mergePDFs } = require('../services/pdfService');
const { triggerWebhook } = require('../services/webhookService');

const UPLOADS_DIR = path.resolve(process.env.UPLOADS_DIR || path.join(__dirname, '../../uploads'));

async function sendDocument(req, res, next) {
  try {
    const { clientName, clientEmail, clientPhone, sendChannel = 'email', webhookUrl, agentName, agentCedula } = req.body;
    if (!clientName) return res.status(400).json({ error: 'Nombre del cliente requerido' });
    if ((sendChannel === 'email' || sendChannel === 'both') && !clientEmail)
      return res.status(400).json({ error: 'Email requerido para envío por correo' });
    if ((sendChannel === 'whatsapp' || sendChannel === 'both') && !clientPhone)
      return res.status(400).json({ error: 'Teléfono requerido para envío por WhatsApp' });
    if (req.user.isApiKey) {
      if (!agentName) return res.status(400).json({ error: 'Nombre del agente requerido' });
      if (!agentCedula) return res.status(400).json({ error: 'Cédula del agente requerida' });
    }

    const rootPdfPath = path.join(__dirname, '../../../carta-tratamiento-de-datos.pdf');

    // Verify file exists
    try {
      await fs.access(rootPdfPath);
    } catch {
      return res.status(404).json({ error: 'Documento no encontrado' });
    }

    const docName = path.basename(rootPdfPath);
    const docHash = await hashFile(rootPdfPath);

    const uploadPath = path.join(UPLOADS_DIR, `${uuidv4()}-${docName}`);
    await fs.copyFile(rootPdfPath, uploadPath);

    const id = uuidv4();
    const token = generateSecureToken();
    const tokenExpiry = getTokenExpiry(parseInt(process.env.TOKEN_EXPIRES_HOURS) || 72);

    await db.query(
      `INSERT INTO signature_requests
       (id, agent_id, document_name, document_original_path, document_hash, client_name, client_email, client_phone, send_channel, token, token_expires_at, agent_name_sent, agent_cedula, webhook_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, req.user.id, docName, uploadPath, docHash, clientName, clientEmail || null, clientPhone || null, sendChannel, token, tokenExpiry, agentName || null, agentCedula || null, webhookUrl || null]
    );

    await db.query(
      'INSERT INTO activity_logs (signature_request_id, event_type, details) VALUES (?, ?, ?)',
      [id, 'DOCUMENT_SENT', JSON.stringify({ channel: sendChannel, email: clientEmail, phone: clientPhone })]
    );

    const sendArgs = { clientName, clientEmail, clientPhone, token, documentName: docName, agentName: req.user.name };

    if (sendChannel === 'email' || sendChannel === 'both') {
      await sendSignatureRequest(sendArgs);
    }
    if (sendChannel === 'whatsapp' || sendChannel === 'both') {
      await sendSignatureWhatsApp(sendArgs);
    }

    const channelLabel = { email: 'correo electrónico', whatsapp: 'WhatsApp', both: 'correo y WhatsApp' };
    res.status(201).json({ id, status: 'pending', message: `Documento enviado por ${channelLabel[sendChannel]}` });
  } catch (err) {
    next(err);
  }
}

async function listSignatures(req, res, next) {
  try {
    const { status, search, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    let where = req.user.role === 'admin' ? '1=1' : 'sr.agent_id = ?';
    const params = req.user.role === 'admin' ? [] : [req.user.id];

    if (status) { where += ' AND sr.status = ?'; params.push(status); }
    if (search) { where += ' AND (sr.client_name LIKE ? OR sr.client_email LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

    const [rows] = await db.query(
      `SELECT sr.id, sr.document_name, sr.client_name, sr.client_email, sr.status,
              sr.sent_at, sr.viewed_at, sr.signed_at, a.name AS agent_name
       FROM signature_requests sr
       JOIN agents a ON sr.agent_id = a.id
       WHERE ${where}
       ORDER BY sr.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM signature_requests sr WHERE ${where}`,
      params
    );

    res.json({ data: rows, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    next(err);
  }
}

async function getSignature(req, res, next) {
  try {
    const { id } = req.params;
    const ownerFilter = req.user.role !== 'admin' ? 'AND sr.agent_id = ?' : '';
    const params = req.user.role !== 'admin' ? [id, req.user.id] : [id];
    const [rows] = await db.query(
      `SELECT sr.*, a.name AS agent_name
       FROM signature_requests sr
       JOIN agents a ON sr.agent_id = a.id
       WHERE sr.id = ? ${ownerFilter}`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });

    const [logs] = await db.query(
      'SELECT * FROM activity_logs WHERE signature_request_id = ? ORDER BY created_at ASC',
      [id]
    );

    const row = rows[0];
    if (row.signer_geolocation && typeof row.signer_geolocation === 'string') {
      try { row.signer_geolocation = JSON.parse(row.signer_geolocation); } catch {}
    }

    res.json({ ...row, activity_logs: logs });
  } catch (err) {
    next(err);
  }
}

async function downloadSignedDocument(req, res, next) {
  try {
    const { id } = req.params;
    const isApiKey = req.user.isApiKey;
    const ownerFilter = (req.user.role !== 'admin' && !isApiKey) ? 'AND sr.agent_id = ?' : '';
    const params = (req.user.role !== 'admin' && !isApiKey) ? [id, req.user.id] : [id];
    const [rows] = await db.query(
      `SELECT sr.*, a.name AS agent_name FROM signature_requests sr JOIN agents a ON sr.agent_id = a.id WHERE sr.id = ? ${ownerFilter}`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });

    const sig = rows[0];
    if (!sig.signed_document_path) return res.status(400).json({ error: 'Documento aún no firmado' });

    const [logs] = await db.query(
      'SELECT * FROM activity_logs WHERE signature_request_id = ? ORDER BY created_at ASC', [id]
    );

    const signedBuffer = await fs.readFile(path.resolve(sig.signed_document_path));
    const certBuffer = await generateCertificate(sig, logs);
    const mergedBuffer = await mergePDFs(signedBuffer, Buffer.from(certBuffer));

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="FIRMADO-${sig.document_name}"`);
    res.send(Buffer.from(mergedBuffer));
  } catch (err) {
    next(err);
  }
}

async function downloadCertificate(req, res, next) {
  try {
    const { id } = req.params;
    const ownerFilter = req.user.role !== 'admin' ? 'AND sr.agent_id = ?' : '';
    const params = req.user.role !== 'admin' ? [id, req.user.id] : [id];
    const [rows] = await db.query(
      `SELECT sr.*, a.name AS agent_name FROM signature_requests sr JOIN agents a ON sr.agent_id = a.id WHERE sr.id = ? ${ownerFilter}`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });

    const [logs] = await db.query('SELECT * FROM activity_logs WHERE signature_request_id = ? ORDER BY created_at ASC', [id]);

    const certBuffer = await generateCertificate(rows[0], logs);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="sumarium-${id}.pdf"`);
    res.send(Buffer.from(certBuffer));
  } catch (err) {
    next(err);
  }
}

async function getDashboardStats(req, res, next) {
  try {
    const [stats] = await db.query(`
      SELECT
        COUNT(*) AS total,
        SUM(status = 'pending') AS pending,
        SUM(status = 'viewed') AS viewed,
        SUM(status = 'signed') AS signed,
        SUM(status = 'expired') AS expired
      FROM signature_requests
      ${req.user.role !== 'admin' ? 'WHERE agent_id = ?' : ''}
    `, req.user.role !== 'admin' ? [req.user.id] : []);

    const [recent] = await db.query(`
      SELECT sr.id, sr.document_name, sr.client_name, sr.status, sr.sent_at
      FROM signature_requests sr
      ${req.user.role !== 'admin' ? 'WHERE sr.agent_id = ?' : ''}
      ORDER BY sr.created_at DESC LIMIT 5
    `, req.user.role !== 'admin' ? [req.user.id] : []);

    res.json({ stats: stats[0], recent });
  } catch (err) {
    next(err);
  }
}

async function deleteSignature(req, res, next) {
  try {
    const { id } = req.params;
    const ownerFilter = req.user.role !== 'admin' ? 'AND agent_id = ?' : '';
    const params = req.user.role !== 'admin' ? [id, req.user.id] : [id];
    const [rows] = await db.query(`SELECT * FROM signature_requests WHERE id = ? ${ownerFilter}`, params);
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });

    const sig = rows[0];

    // Delete associated files (ignore errors if files don't exist)
    const filesToDelete = [
      sig.document_original_path,
      sig.signed_document_path,
      sig.certificate_path,
    ].filter(Boolean);

    await Promise.all(filesToDelete.map(f =>
      fs.unlink(f).catch(() => {})
    ));

    // Delete DB records (logs first due to FK constraint)
    await db.query('DELETE FROM activity_logs WHERE signature_request_id = ?', [id]);
    await db.query('DELETE FROM signature_requests WHERE id = ?', [id]);

    res.json({ ok: true, message: 'Registro eliminado correctamente' });
  } catch (err) {
    next(err);
  }
}

module.exports = { sendDocument, listSignatures, getSignature, downloadSignedDocument, downloadCertificate, getDashboardStats, deleteSignature };
