const path = require('path');
const fs = require('fs').promises;
const db = require('../config/database');
const { resolveNpnTemplate, dispatchCartaToRecipient } = require('../services/cartaDispatchService');
const { getServerLocation } = require('../utils/serverLocation');

async function sendCarta(req, res, next) {
  try {
    const { npnName, npnCode, recipients, sendChannel = 'email' } = req.body;

    if (!npnName || typeof npnName !== 'string' || !npnName.trim())
      return res.status(400).json({ error: 'NPN requerido' });
    if (!['email', 'whatsapp', 'both'].includes(sendChannel))
      return res.status(400).json({ error: 'Canal inválido. Use: email, whatsapp o both' });
    if (!Array.isArray(recipients) || recipients.length === 0)
      return res.status(400).json({ error: 'Se requiere al menos un destinatario' });

    let cartaPath, docName, docHash;
    try {
      ({ cartaPath, docName, docHash } = await resolveNpnTemplate(npnName));
    } catch {
      return res.status(404).json({ error: `Plantilla no encontrada: ${npnName}.pdf` });
    }

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
        const { id } = await dispatchCartaToRecipient({
          agentId: req.user.id,
          npnName,
          npnCode,
          cartaPath, docName, docHash,
          sendChannel,
          clientName: clientName.trim(),
          clientEmail,
          clientPhone,
          sentFromIp: serverLoc?.ip,
        });

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
              cfd.name AS form_name, cfd.phone AS form_phone, cfd.email AS form_email,
              cfd.postalcode AS form_postalcode, cfd.submitted_at AS form_submitted_at,
              cfd.social_path AS form_social_path, cfd.status_path AS form_status_path
       FROM signature_requests sr
       JOIN agents a ON sr.agent_id = a.id
       LEFT JOIN carta_form_data cfd ON cfd.signature_request_id = sr.id
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
