const path = require('path');
const fs = require('fs').promises;
const XLSX = require('xlsx');
const db = require('../config/database');
const { resolveNpnTemplate, dispatchCartaToRecipient } = require('../services/cartaDispatchService');
const { getServerLocation } = require('../utils/serverLocation');

// Cartas enviadas antes de existir carta_template_snapshot no tienen fila ahí — todas
// se enviaron con la plantilla/marca "oscar" (la única que existía en ese momento).
const DEFAULT_INSURER_LABEL = 'oscar';

// LEFT JOIN reusado por listCartas/exportCartas (SELECT y COUNT) para poder filtrar y
// mostrar de qué generación de plantilla (marca de aseguradora) viene cada carta.
const INSURER_JOIN = `
  LEFT JOIN carta_template_snapshot cts ON cts.signature_request_id = sr.id
  LEFT JOIN template_generations tg ON tg.id = cts.generation_id`;
const INSURER_LABEL_SQL = `COALESCE(tg.label, '${DEFAULT_INSURER_LABEL}')`;

// Comparte los filtros de búsqueda entre el listado paginado y la exportación a Excel.
// Las queries que usan el `where` resultante deben incluir INSURER_JOIN en su FROM
// porque el filtro de aseguradora referencia el alias `tg`.
function buildCartaFilters(req) {
  const { status, search, dateFrom, dateTo, insurer } = req.query;
  let where = 'sr.npn_name IS NOT NULL';
  const params = [];

  if (req.user.role !== 'admin') { where += ' AND sr.agent_id = ?'; params.push(req.user.id); }
  if (status) { where += ' AND sr.status = ?'; params.push(status); }
  if (insurer) { where += ` AND ${INSURER_LABEL_SQL} = ?`; params.push(insurer); }
  if (search) {
    where += ' AND (sr.client_name LIKE ? OR sr.client_email LIKE ? OR sr.npn_name LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (dateFrom) { where += ' AND DATE(sr.sent_at) >= ?'; params.push(dateFrom); }
  if (dateTo)   { where += ' AND DATE(sr.sent_at) <= ?'; params.push(dateTo); }

  return { where, params };
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

    let cartaPath, docName, docHash, generationId;
    try {
      ({ cartaPath, docName, docHash, generationId } = await resolveNpnTemplate(npnName));
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
          cartaPath, docName, docHash, generationId,
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
    const { page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const { where, params } = buildCartaFilters(req);

    const [rows] = await db.query(
      `SELECT sr.id, sr.client_name, sr.client_email, sr.client_phone,
              sr.send_channel, sr.status, sr.sent_at, sr.viewed_at, sr.signed_at,
              sr.npn_name, sr.npn_code, a.name AS agent_name,
              ${INSURER_LABEL_SQL} AS insurer
       FROM signature_requests sr
       JOIN agents a ON sr.agent_id = a.id
       ${INSURER_JOIN}
       WHERE ${where}
       ORDER BY sr.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM signature_requests sr ${INSURER_JOIN} WHERE ${where}`,
      params
    );

    res.json({ data: rows, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    next(err);
  }
}

async function exportCartas(req, res, next) {
  try {
    const { where, params } = buildCartaFilters(req);

    const [rows] = await db.query(
      `SELECT sr.client_name AS 'Cliente', sr.client_email AS 'Email', sr.client_phone AS 'Teléfono',
              sr.npn_name AS 'NPN', sr.npn_code AS 'Código NPN', sr.send_channel AS 'Canal',
              sr.status AS 'Estado', sr.sent_at AS 'Enviado', sr.viewed_at AS 'Abierto', sr.signed_at AS 'Firmado',
              a.name AS 'Agente', ${INSURER_LABEL_SQL} AS 'Aseguradora',
              cfd.name AS 'Nombre actualizado', cfd.phone AS 'Teléfono actualizado',
              cfd.email AS 'Email actualizado', cfd.postalcode AS 'Código postal',
              cfd.submitted_at AS 'Formulario enviado'
       FROM signature_requests sr
       JOIN agents a ON sr.agent_id = a.id
       LEFT JOIN carta_form_data cfd ON cfd.signature_request_id = sr.id
       ${INSURER_JOIN}
       WHERE ${where}
       ORDER BY sr.created_at DESC`,
      params
    );

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Cartas');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="cartas-${new Date().toISOString().slice(0, 10)}.xlsx"`);
    res.send(buffer);
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

const PHOTO_MIME_BY_EXT = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
};

// Sirve las fotos del formulario (carnet de seguro social / estatus migratorio) solo a
// quien pueda ver la carta (mismo ownerFilter que el resto de endpoints de este controller).
async function getCartaPhoto(req, res, next) {
  try {
    const { id, type } = req.params;
    if (!['social', 'status'].includes(type)) return res.status(400).json({ error: 'Tipo de foto inválido' });

    const ownerFilter = (req.user.role !== 'admin' && !req.user.isApiKey) ? 'AND sr.agent_id = ?' : '';
    const params = (req.user.role !== 'admin' && !req.user.isApiKey) ? [id, req.user.id] : [id];

    const [rows] = await db.query(
      `SELECT cfd.social_path, cfd.status_path
       FROM signature_requests sr
       JOIN carta_form_data cfd ON cfd.signature_request_id = sr.id
       WHERE sr.id = ? AND sr.npn_name IS NOT NULL ${ownerFilter}`,
      params
    );

    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
    const filePath = type === 'social' ? rows[0].social_path : rows[0].status_path;
    if (!filePath) return res.status(404).json({ error: 'Foto no disponible' });

    const buffer = await fs.readFile(path.resolve(filePath));
    const mime = PHOTO_MIME_BY_EXT[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.send(buffer);
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

// Solo permite borrar cartas cuyo envío falló (status='failed') — nunca llegaron al
// cliente, así que no hay historial real que perder. Cartas pending/viewed/signed/expired
// no se pueden borrar por acá (evita perder registros de envíos que sí ocurrieron).
async function deleteCarta(req, res, next) {
  try {
    const { id } = req.params;
    const ownerFilter = (req.user.role !== 'admin' && !req.user.isApiKey) ? 'AND sr.agent_id = ?' : '';
    const params = (req.user.role !== 'admin' && !req.user.isApiKey) ? [id, req.user.id] : [id];

    const [rows] = await db.query(
      `SELECT sr.id, sr.status, sr.document_original_path
       FROM signature_requests sr
       WHERE sr.id = ? AND sr.npn_name IS NOT NULL ${ownerFilter}`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
    const sig = rows[0];
    if (sig.status !== 'failed')
      return res.status(400).json({ error: 'Solo se pueden eliminar cartas con envío fallido' });

    await db.query('DELETE FROM signature_requests WHERE id = ?', [id]);
    if (sig.document_original_path) await fs.unlink(sig.document_original_path).catch(() => {});

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

module.exports = { sendCarta, listCartas, exportCartas, getCartaDetail, getCartaPhoto, downloadSignedCarta, deleteCarta };
