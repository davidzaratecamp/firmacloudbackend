const fs = require('fs').promises;
const db = require('../config/database');
const { resolveNpnTemplate } = require('../services/cartaDispatchService');
const { parseRecipientsFile } = require('../services/oleadaFileParser');
const { sendNextBatch, sendDripBatch } = require('../services/oleadaBatchService');

function ownerClause(req, alias = 'o') {
  if (req.user.role === 'admin' || req.user.isApiKey) return { clause: '', params: [] };
  return { clause: `AND ${alias}.created_by = ?`, params: [req.user.id] };
}

async function createOleada(req, res, next) {
  try {
    const { npnName, npnCode, name, sendChannel = 'email', dailyLimit } = req.body;

    if (!req.file) return res.status(400).json({ error: 'Archivo requerido (CSV o Excel)' });
    if (!npnName || typeof npnName !== 'string' || !npnName.trim())
      return res.status(400).json({ error: 'NPN requerido' });
    if (!name || typeof name !== 'string' || !name.trim())
      return res.status(400).json({ error: 'Nombre de la oleada requerido' });
    if (!['email', 'whatsapp', 'both'].includes(sendChannel))
      return res.status(400).json({ error: 'Canal inválido. Use: email, whatsapp o both' });
    const limit = parseInt(dailyLimit);
    if (!limit || limit <= 0)
      return res.status(400).json({ error: 'dailyLimit debe ser un número mayor a 0' });

    try {
      await resolveNpnTemplate(npnName);
    } catch {
      return res.status(404).json({ error: `Plantilla no encontrada: ${npnName}.pdf` });
    }

    let valid, invalid;
    try {
      ({ valid, invalid } = parseRecipientsFile(req.file.buffer, sendChannel));
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    if (valid.length === 0)
      return res.status(400).json({ error: 'El archivo no contiene destinatarios válidos', invalidRows: invalid });

    const [result] = await db.query(
      `INSERT INTO oleadas (name, npn_name, npn_code, send_channel, daily_limit, total_recipients, source_filename, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [name.trim(), npnName.trim(), npnCode || null, sendChannel, limit, valid.length, req.file.originalname, req.user.id]
    );
    const oleadaId = result.insertId;

    for (const r of valid) {
      await db.query(
        `INSERT INTO oleada_recipients (oleada_id, name, email, phone) VALUES (?, ?, ?, ?)`,
        [oleadaId, r.name, r.email, r.phone]
      );
    }

    // Modo por defecto de la oleada es 'drip' (columna DEFAULT en BD): dispara el primer
    // lote de inmediato sin bloquear la respuesta HTTP (el envío de 10 correos puede
    // tardar ~30s por los delays anti-saturación de SMTP). El scheduler retoma cada
    // OLEADA_DRIP_INTERVAL_MINUTES a partir de este primer envío.
    sendDripBatch(oleadaId).catch((err) => {
      console.error(`[oleada ${oleadaId}] Error en envío inmediato:`, err.message);
    });

    res.status(201).json({
      oleada: { id: oleadaId, name: name.trim(), npnName: npnName.trim(), sendChannel, dailyLimit: limit, totalRecipients: valid.length },
      validRows: valid.length,
      invalidRows: invalid,
    });
  } catch (err) {
    next(err);
  }
}

async function listOleadas(req, res, next) {
  try {
    const { status, search, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const { clause: ownerFilter, params: ownerParams } = ownerClause(req);
    let where = '1=1';
    const params = [...ownerParams];

    if (status) { where += ' AND o.status = ?'; params.push(status); }
    if (search) { where += ' AND (o.name LIKE ? OR o.npn_name LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

    const [rows] = await db.query(
      `SELECT o.id, o.name, o.npn_name, o.npn_code, o.send_channel, o.daily_limit,
              o.status, o.total_recipients, o.sent_count, o.failed_count,
              o.last_batch_sent_date, o.created_at, a.name AS agent_name
       FROM oleadas o
       JOIN agents a ON o.created_by = a.id
       WHERE ${where} ${ownerFilter}
       ORDER BY o.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM oleadas o WHERE ${where} ${ownerFilter}`,
      params
    );

    res.json({ data: rows, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    next(err);
  }
}

async function getOleadaDetail(req, res, next) {
  try {
    const { id } = req.params;
    const { clause: ownerFilter, params: ownerParams } = ownerClause(req);

    const [rows] = await db.query(
      `SELECT o.*, a.name AS agent_name
       FROM oleadas o
       JOIN agents a ON o.created_by = a.id
       WHERE o.id = ? ${ownerFilter}`,
      [id, ...ownerParams]
    );
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });

    const [[counts]] = await db.query(
      `SELECT
         SUM(r.row_status = 'pending') AS pending_count,
         SUM(r.row_status = 'failed')  AS failed_count,
         SUM(r.row_status = 'sent' AND sr.status = 'pending') AS sent_count,
         SUM(r.row_status = 'sent' AND sr.status = 'viewed')  AS viewed_count,
         SUM(r.row_status = 'sent' AND sr.status = 'signed')  AS signed_count
       FROM oleada_recipients r
       LEFT JOIN signature_requests sr ON sr.id = r.signature_request_id
       WHERE r.oleada_id = ?`,
      [id]
    );

    res.json({ ...rows[0], counts });
  } catch (err) {
    next(err);
  }
}

async function listOleadaRecipients(req, res, next) {
  try {
    const { id } = req.params;
    const { filter, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const { clause: ownerFilter, params: ownerParams } = ownerClause(req, 'o');
    const [owned] = await db.query(`SELECT o.id FROM oleadas o WHERE o.id = ? ${ownerFilter}`, [id, ...ownerParams]);
    if (!owned.length) return res.status(404).json({ error: 'No encontrado' });

    let where = 'r.oleada_id = ?';
    const params = [id];

    if (filter === 'pending' || filter === 'failed') {
      where += ' AND r.row_status = ?';
      params.push(filter);
    } else if (filter === 'sent') {
      where += ` AND r.row_status = 'sent' AND sr.status = 'pending'`;
    } else if (filter === 'viewed') {
      where += ` AND r.row_status = 'sent' AND sr.status = 'viewed'`;
    } else if (filter === 'signed') {
      where += ` AND r.row_status = 'sent' AND sr.status = 'signed'`;
    }

    const [rows] = await db.query(
      `SELECT r.id, r.name, r.email, r.phone, r.row_status, r.send_error, r.sent_at,
              r.signature_request_id, sr.status AS carta_status, sr.viewed_at, sr.signed_at
       FROM oleada_recipients r
       LEFT JOIN signature_requests sr ON sr.id = r.signature_request_id
       WHERE ${where}
       ORDER BY r.id ASC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM oleada_recipients r LEFT JOIN signature_requests sr ON sr.id = r.signature_request_id WHERE ${where}`,
      params
    );

    res.json({ data: rows, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    next(err);
  }
}

async function sendOleadaNow(req, res, next) {
  try {
    const { id } = req.params;
    const { clause: ownerFilter, params: ownerParams } = ownerClause(req);
    const [rows] = await db.query(`SELECT id, send_mode FROM oleadas o WHERE o.id = ? ${ownerFilter}`, [id, ...ownerParams]);
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });

    const result = rows[0].send_mode === 'drip'
      ? await sendDripBatch(parseInt(id))
      : await sendNextBatch(parseInt(id));
    res.json(result);
  } catch (err) {
    next(err);
  }
}

// Vuelve a 'pending' los destinatarios que quedaron 'failed' (p.ej. por cupo diario de
// Gmail agotado) para que el próximo lote (drip/daily) los reintente. No cambia el status
// de la oleada — si quedó 'paused' por cupo agotado, el usuario la reanuda aparte.
async function retryFailedRecipients(req, res, next) {
  try {
    const { id } = req.params;
    const { clause: ownerFilter, params: ownerParams } = ownerClause(req);
    const [rows] = await db.query(`SELECT id FROM oleadas o WHERE o.id = ? ${ownerFilter}`, [id, ...ownerParams]);
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });

    const [result] = await db.query(
      `UPDATE oleada_recipients SET row_status = 'pending', send_error = NULL
       WHERE oleada_id = ? AND row_status = 'failed'`,
      [id]
    );
    res.json({ ok: true, requeued: result.affectedRows });
  } catch (err) {
    next(err);
  }
}

// Borra los destinatarios 'failed' de la oleada y la carta ligada a cada uno en
// signature_requests (marcada 'failed' por cartaDispatchService desde este fix — se
// enlaza directo por signature_request_id, sin adivinar). Para fallidos de ANTES de este
// fix, que no quedaron enlazados, se hace un respaldo correlacionando por email + npn_name
// + agente (cubre tanto el 'failed' nuevo sin enlazar como el viejo 'pending' huérfano).
async function deleteFailedRecipients(req, res, next) {
  try {
    const { id } = req.params;
    const { clause: ownerFilter, params: ownerParams } = ownerClause(req);
    const [rows] = await db.query(`SELECT o.id, o.npn_name, o.created_by FROM oleadas o WHERE o.id = ? ${ownerFilter}`, [id, ...ownerParams]);
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
    const oleada = rows[0];

    const [failedRecipients] = await db.query(
      `SELECT id, email, signature_request_id FROM oleada_recipients WHERE oleada_id = ? AND row_status = 'failed'`,
      [id]
    );
    if (!failedRecipients.length) return res.json({ ok: true, deletedRecipients: 0, deletedCartas: 0 });

    const linkedCartaIds = failedRecipients.map(r => r.signature_request_id).filter(Boolean);
    const unlinkedEmails = [...new Set(
      failedRecipients.filter(r => !r.signature_request_id).map(r => r.email).filter(Boolean)
    )];

    let cartaIds = [...linkedCartaIds];
    if (unlinkedEmails.length) {
      const [legacyCartas] = await db.query(
        `SELECT id FROM signature_requests
         WHERE npn_name = ? AND agent_id = ? AND status IN ('pending', 'failed') AND client_email IN (?)`,
        [oleada.npn_name, oleada.created_by, unlinkedEmails]
      );
      cartaIds.push(...legacyCartas.map(c => c.id));
    }
    cartaIds = [...new Set(cartaIds)];

    let deletedCartas = 0;
    if (cartaIds.length) {
      const [cartas] = await db.query(
        `SELECT id, document_original_path FROM signature_requests WHERE id IN (?)`,
        [cartaIds]
      );
      await db.query(`DELETE FROM signature_requests WHERE id IN (?)`, [cartaIds]);
      for (const c of cartas) {
        if (c.document_original_path) await fs.unlink(c.document_original_path).catch(() => {});
      }
      deletedCartas = cartas.length;
    }

    const [delResult] = await db.query(
      `DELETE FROM oleada_recipients WHERE oleada_id = ? AND row_status = 'failed'`,
      [id]
    );

    await db.query(
      `UPDATE oleadas SET failed_count = GREATEST(failed_count - ?, 0), total_recipients = GREATEST(total_recipients - ?, 0) WHERE id = ?`,
      [delResult.affectedRows, delResult.affectedRows, id]
    );

    res.json({ ok: true, deletedRecipients: delResult.affectedRows, deletedCartas });
  } catch (err) {
    next(err);
  }
}

function setOleadaStatus(newStatus) {
  return async function (req, res, next) {
    try {
      const { id } = req.params;
      const { clause: ownerFilter, params: ownerParams } = ownerClause(req);
      const [rows] = await db.query(`SELECT status FROM oleadas o WHERE o.id = ? ${ownerFilter}`, [id, ...ownerParams]);
      if (!rows.length) return res.status(404).json({ error: 'No encontrado' });

      const current = rows[0].status;
      const allowedFrom = { paused: ['active'], active: ['paused'], cancelled: ['active', 'paused'] };
      if (!allowedFrom[newStatus].includes(current))
        return res.status(400).json({ error: `No se puede pasar de '${current}' a '${newStatus}'` });

      await db.query(`UPDATE oleadas SET status = ? WHERE id = ?`, [newStatus, id]);
      res.json({ ok: true, status: newStatus });
    } catch (err) {
      next(err);
    }
  };
}

module.exports = {
  createOleada,
  listOleadas,
  getOleadaDetail,
  listOleadaRecipients,
  sendOleadaNow,
  retryFailedRecipients,
  deleteFailedRecipients,
  pauseOleada: setOleadaStatus('paused'),
  resumeOleada: setOleadaStatus('active'),
  cancelOleada: setOleadaStatus('cancelled'),
};
