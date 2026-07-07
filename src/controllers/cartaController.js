const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs').promises;
const db = require('../config/database');
const { generateSecureToken, getTokenExpiry } = require('../utils/token');
const { hashFile } = require('../utils/hash');
const { sendCartaFormulario } = require('../services/cartaEmailService');
const { sendFormWhatsApp, normalizePhone } = require('../services/whatsappService');
const { getServerLocation } = require('../utils/serverLocation');

const UPLOADS_DIR = path.resolve(process.env.UPLOADS_DIR || path.join(__dirname, '../../uploads'));

function getPlantillaPath(npnName) {
  const dir = process.env.PLANTILLAS_DIR || path.join(__dirname, '../../../plantillas');
  return path.join(dir, `${npnName}.pdf`);
}


async function sendCarta(req, res, next) {
  try {
    const { npnName, npnCode, recipients, sendChannel = 'email' } = req.body;

    if (!npnName || typeof npnName !== 'string' || !npnName.trim())
      return res.status(400).json({ error: 'NPN requerido' });
    if (!['email', 'whatsapp', 'both'].includes(sendChannel))
      return res.status(400).json({ error: 'Canal inválido. Use: email, whatsapp o both' });
    if (!Array.isArray(recipients) || recipients.length === 0)
      return res.status(400).json({ error: 'Se requiere al menos un destinatario' });

    const cartaPath = getPlantillaPath(npnName.trim());
    try {
      await fs.access(cartaPath);
    } catch {
      return res.status(404).json({ error: `Plantilla no encontrada: ${npnName}.pdf` });
    }

    const docName  = `${npnName.trim()}.pdf`;
    const docHash  = await hashFile(cartaPath);
    const serverLoc = getServerLocation();
    const results  = [];
    const errors   = [];

    for (const recipient of recipients) {
      const { name: clientName, email: clientEmail, phone: clientPhone } = recipient;

      if (!clientName || !clientName.trim()) {
        errors.push({ recipient, error: 'Nombre requerido' });
        continue;
      }
      if ((sendChannel === 'email' || sendChannel === 'both') && !clientEmail) {
        errors.push({ recipient, error: 'Email requerido' });
        continue;
      }
      if ((sendChannel === 'whatsapp' || sendChannel === 'both') && !clientPhone) {
        errors.push({ recipient, error: 'Teléfono requerido' });
        continue;
      }

      try {
        const id         = uuidv4();
        const token      = generateSecureToken();
        const tokenExpiry = new Date('2037-12-31T22:59:59.000Z'); // cartas NPN no expiran (máx TIMESTAMP MySQL)

        // Copy the NPN template for this specific signing request
        const uploadPath = path.join(UPLOADS_DIR, `${id}-${docName}`);
        await fs.copyFile(cartaPath, uploadPath);

        await db.query(
          `INSERT INTO signature_requests
           (id, agent_id, document_name, document_original_path, document_hash,
            client_name, client_email, client_phone, send_channel,
            token, token_expires_at, npn_name, npn_code, sent_from_ip)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id, req.user.id, docName, uploadPath, docHash,
            clientName.trim(), clientEmail || null, clientPhone || null, sendChannel,
            token, tokenExpiry, npnName.trim(), npnCode || null,
            serverLoc?.ip || null,
          ]
        );

        if (sendChannel === 'email' || sendChannel === 'both') {
          await sendCartaFormulario({
            clientName: clientName.trim(),
            clientEmail,
            token,
            requestId:  id,
            cartaPath,
            npnName:    npnName.trim(),
          });
        }

        if (sendChannel === 'whatsapp' || sendChannel === 'both') {
          try {
            await sendFormWhatsApp({ clientName: clientName.trim(), clientPhone, token, npnName: npnName.trim() });
          } catch (waErr) {
            if (sendChannel === 'whatsapp') {
              await db.query('DELETE FROM signature_requests WHERE id = ?', [id]);
              await fs.unlink(uploadPath).catch(() => {});
              errors.push({ recipient, error: `WhatsApp no disponible: ${waErr.message}` });
              continue;
            }
            console.error(`[whatsapp-carta] Fallo enviando a ${clientPhone}:`, waErr.message);
          }
        }

        results.push({ id, clientName: clientName.trim(), status: 'pending' });
      } catch (recipientErr) {
        console.error(`[carta] Error enviando a ${clientName}:`, recipientErr.message);
        errors.push({ recipient, error: recipientErr.message });
      }
    }

    if (results.length === 0)
      return res.status(500).json({ error: 'No se pudo enviar ninguna carta', errors });

    res.status(201).json({
      sent: results.length,
      failed: errors.length,
      results,
      ...(errors.length > 0 && { errors }),
    });
  } catch (err) {
    next(err);
  }
}

async function listCartas(req, res, next) {
  try {
    const { status, search, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let where  = 'sr.npn_name IS NOT NULL';
    const params = [];

    if (req.user.role !== 'admin') { where += ' AND sr.agent_id = ?'; params.push(req.user.id); }
    if (status)  { where += ' AND sr.status = ?'; params.push(status); }
    if (search)  {
      where += ' AND (sr.client_name LIKE ? OR sr.client_email LIKE ? OR sr.npn_name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const [rows] = await db.query(
      `SELECT sr.id, sr.client_name, sr.client_email, sr.client_phone,
              sr.send_channel, sr.status, sr.sent_at, sr.viewed_at, sr.signed_at,
              sr.npn_name, sr.npn_code, a.name AS agent_name
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

async function getCartaDetail(req, res, next) {
  try {
    const { id } = req.params;
    const ownerFilter = (req.user.role !== 'admin' && !req.user.isApiKey) ? 'AND sr.agent_id = ?' : '';
    const params = (req.user.role !== 'admin' && !req.user.isApiKey)
      ? [id, req.user.id]
      : [id];

    const [rows] = await db.query(
      `SELECT sr.id, sr.client_name, sr.client_email, sr.client_phone, sr.send_channel,
              sr.status, sr.sent_at, sr.viewed_at, sr.signed_at,
              sr.signer_name, sr.signer_ip, sr.sent_from_ip, sr.created_at,
              sr.npn_name, sr.npn_code, a.name AS agent_name,
              sr.form_name, sr.form_phone, sr.form_email, sr.form_postalcode,
              sr.form_submitted_at, sr.form_social_path, sr.form_status_path
       FROM signature_requests sr
       JOIN agents a ON sr.agent_id = a.id
       WHERE sr.id = ? AND sr.npn_name IS NOT NULL ${ownerFilter}`,
      params
    );

    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
}

async function downloadSignedCarta(req, res, next) {
  try {
    const { id } = req.params;
    const ownerFilter = (req.user.role !== 'admin' && !req.user.isApiKey) ? 'AND sr.agent_id = ?' : '';
    const params = (req.user.role !== 'admin' && !req.user.isApiKey) ? [id, req.user.id] : [id];

    const [rows] = await db.query(
      `SELECT sr.signed_document_path, sr.document_name, sr.status
       FROM signature_requests sr
       WHERE sr.id = ? AND sr.npn_name IS NOT NULL ${ownerFilter}`,
      params
    );

    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
    const sig = rows[0];
    if (sig.status !== 'signed' || !sig.signed_document_path)
      return res.status(400).json({ error: 'El documento aún no ha sido firmado' });

    const buffer = await fs.readFile(path.resolve(sig.signed_document_path));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="FIRMADO-${sig.document_name}"`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
}

module.exports = { sendCarta, listCartas, getCartaDetail, downloadSignedCarta };
