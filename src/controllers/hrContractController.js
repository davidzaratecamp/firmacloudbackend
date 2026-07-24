const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs').promises;
const db = require('../config/database');
const { generateSecureToken, getTokenExpiry } = require('../utils/token');
const { hashBuffer } = require('../utils/hash');
const { getContractSignConfig, getPageCount, detectSignLocations } = require('../services/hrContractPdfService');
const { sendContractEmail } = require('../services/hrEmailService');
const { sendContractWhatsApp } = require('../services/hrWhatsappService');

const UPLOADS_DIR = path.resolve(process.env.UPLOADS_DIR || path.join(__dirname, '../../uploads'));
const SIGNED_DIR = path.resolve(process.env.SIGNED_DIR || path.join(__dirname, '../../signed'));

// Solo caracteres seguros para nombre de archivo; agrega .pdf si falta.
function sanitizeFilename(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  const safe = trimmed.replace(/[^a-zA-Z0-9._\- ]/g, '_').slice(0, 150);
  return /\.pdf$/i.test(safe) ? safe : `${safe}.pdf`;
}

async function sendDocument(req, res, next) {
  try {
    const { sendChannel, recipientEmail, recipientPhone, customFilename } = req.body;

    if (!req.file) return res.status(400).json({ error: 'Archivo PDF requerido' });
    if (path.extname(req.file.originalname).toLowerCase() !== '.pdf')
      return res.status(400).json({ error: 'El archivo debe ser un PDF' });
    if (!['email', 'whatsapp'].includes(sendChannel))
      return res.status(400).json({ error: 'Canal inválido. Use: email o whatsapp' });
    if (sendChannel === 'email' && !recipientEmail)
      return res.status(400).json({ error: 'Correo requerido para envío por correo' });
    if (sendChannel === 'whatsapp' && !recipientPhone)
      return res.status(400).json({ error: 'Teléfono requerido para envío por WhatsApp' });

    const docName = path.basename(req.file.originalname);
    const uploadPath = path.join(UPLOADS_DIR, `HR-${uuidv4()}-${docName}`);

    // Validar que el PDF cargado coincide con la plantilla calibrada (mismo número de páginas)
    const tmpPath = uploadPath; // escribimos ya en destino final; si falla la validación se borra
    await fs.writeFile(tmpPath, req.file.buffer);

    const contractConfig = await getContractSignConfig();
    const pageCount = await getPageCount(tmpPath);
    if (contractConfig.expectedPages && pageCount !== contractConfig.expectedPages) {
      await fs.unlink(tmpPath).catch(() => {});
      return res.status(400).json({
        error: `El PDF debe tener ${contractConfig.expectedPages} páginas (plantilla de contrato laboral). El archivo cargado tiene ${pageCount}.`,
      });
    }

    // Falla rápido si el PDF no trae el bloque "FIRMA TRABAJADOR" detectable — evita enviarle
    // al trabajador un contrato donde luego no se pueda ubicar la firma al momento de firmar.
    const signLocations = await detectSignLocations(tmpPath);
    if (!signLocations.length) {
      await fs.unlink(tmpPath).catch(() => {});
      return res.status(400).json({
        error: 'No se detectó el bloque de firma ("FIRMA TRABAJADOR") en el PDF. Verifica que sea el contrato correcto.',
      });
    }

    const docHash = hashBuffer(req.file.buffer);
    const id = uuidv4();
    const token = generateSecureToken();
    const expiresHours = parseInt(process.env.HR_TOKEN_EXPIRES_HOURS);
    const tokenExpiry = expiresHours ? getTokenExpiry(expiresHours) : null;
    const finalFilename = sanitizeFilename(customFilename);

    await db.query(
      `INSERT INTO hr_contracts
       (id, agent_id, document_name, custom_filename, document_original_path, document_hash,
        recipient_email, recipient_phone, send_channel, token, token_expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, req.user.id, docName, finalFilename, uploadPath, docHash, recipientEmail || null, recipientPhone || null, sendChannel, token, tokenExpiry]
    );

    try {
      if (sendChannel === 'email') {
        await sendContractEmail({ recipientEmail, token, documentName: docName });
      } else {
        await sendContractWhatsApp({ recipientPhone, token });
      }
    } catch (sendErr) {
      await fs.unlink(uploadPath).catch(() => {});
      await db.query('DELETE FROM hr_contracts WHERE id = ?', [id]);
      const errorCode = sendChannel === 'whatsapp' ? 'WHATSAPP_UNAVAILABLE' : 'EMAIL_UNAVAILABLE';
      return res.status(503).json({
        errorCode,
        error: `No se pudo enviar por ${sendChannel === 'whatsapp' ? 'WhatsApp' : 'correo'}. Intenta nuevamente.`,
      });
    }

    const channelLabel = { email: 'correo electrónico', whatsapp: 'WhatsApp' };
    res.status(201).json({ id, status: 'pending', message: `Contrato enviado por ${channelLabel[sendChannel]}` });
  } catch (err) {
    next(err);
  }
}

async function listContracts(req, res, next) {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    let where = req.user.role === 'admin' ? '1=1' : 'hc.agent_id = ?';
    const params = req.user.role === 'admin' ? [] : [req.user.id];

    if (status) { where += ' AND hc.status = ?'; params.push(status); }

    const [rows] = await db.query(
      `SELECT hc.id, hc.document_name, hc.recipient_email, hc.recipient_phone, hc.send_channel,
              hc.status, hc.sent_at, hc.viewed_at, hc.signed_at, a.name AS agent_name
       FROM hr_contracts hc
       JOIN agents a ON hc.agent_id = a.id
       WHERE ${where}
       ORDER BY hc.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM hr_contracts hc WHERE ${where}`,
      params
    );

    res.json({ data: rows, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    next(err);
  }
}

async function getContract(req, res, next) {
  try {
    const { id } = req.params;
    const ownerFilter = req.user.role !== 'admin' ? 'AND hc.agent_id = ?' : '';
    const params = req.user.role !== 'admin' ? [id, req.user.id] : [id];

    const [rows] = await db.query(
      `SELECT hc.*, a.name AS agent_name
       FROM hr_contracts hc
       JOIN agents a ON hc.agent_id = a.id
       WHERE hc.id = ? ${ownerFilter}`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
}

async function downloadSignedContract(req, res, next) {
  try {
    const { id } = req.params;
    const ownerFilter = req.user.role !== 'admin' ? 'AND agent_id = ?' : '';
    const params = req.user.role !== 'admin' ? [id, req.user.id] : [id];

    const [rows] = await db.query(`SELECT * FROM hr_contracts WHERE id = ? ${ownerFilter}`, params);
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });

    const contract = rows[0];
    if (!contract.signed_document_path) return res.status(400).json({ error: 'Documento aún no firmado' });

    const buffer = await fs.readFile(path.resolve(contract.signed_document_path));
    const downloadName = contract.custom_filename || `FIRMADO-${contract.document_name}`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
}

async function deleteContract(req, res, next) {
  try {
    const { id } = req.params;
    const ownerFilter = req.user.role !== 'admin' ? 'AND agent_id = ?' : '';
    const params = req.user.role !== 'admin' ? [id, req.user.id] : [id];

    const [rows] = await db.query(`SELECT * FROM hr_contracts WHERE id = ? ${ownerFilter}`, params);
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });

    const contract = rows[0];
    const filesToDelete = [
      contract.document_original_path,
      contract.signed_document_path,
      contract.signature_image_path,
    ].filter(Boolean);

    await Promise.all(filesToDelete.map(f => fs.unlink(f).catch(() => {})));
    await db.query('DELETE FROM hr_contracts WHERE id = ?', [id]);

    res.json({ ok: true, message: 'Registro eliminado correctamente' });
  } catch (err) {
    next(err);
  }
}

module.exports = { sendDocument, listContracts, getContract, downloadSignedContract, deleteContract };
