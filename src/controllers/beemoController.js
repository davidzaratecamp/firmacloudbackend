const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs').promises;
const db = require('../config/database');
const { generateSecureToken, getTokenExpiry } = require('../utils/token');
const { hashBuffer } = require('../utils/hash');
const { fillBeemoTemplate, getBeemoSignConfig } = require('../services/beemoPdfService');
const { sendBeemoSignatureRequest } = require('../services/beemoEmailService');
const { sendBeemoSignatureWhatsApp } = require('../services/beemoWhatsappService');
const { buildDailyTrend } = require('../utils/dailyTrend');

const UPLOADS_DIR = path.resolve(process.env.UPLOADS_DIR || path.join(__dirname, '../../uploads'));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function sendDocument(req, res, next) {
  try {
    const { source, recipientName, recipientEmail, recipientPhone, sendChannel, documentData } = req.body;

    if (!recipientName) return res.status(400).json({ error: 'Nombre del destinatario requerido' });
    if (!['email', 'whatsapp', 'both'].includes(sendChannel))
      return res.status(400).json({ error: 'Canal inválido. Use: email, whatsapp o both' });
    if ((sendChannel === 'email' || sendChannel === 'both') && !(recipientEmail && EMAIL_RE.test(recipientEmail)))
      return res.status(400).json({ error: 'Correo válido requerido para envío por correo' });
    if ((sendChannel === 'whatsapp' || sendChannel === 'both') && !recipientPhone)
      return res.status(400).json({ error: 'Teléfono requerido para envío por WhatsApp' });
    if (!['template', 'upload'].includes(source))
      return res.status(400).json({ error: 'Origen inválido. Use: template o upload' });

    let pdfBuffer, docName;

    if (source === 'template') {
      let parsedData;
      try {
        parsedData = JSON.parse(documentData || '{}');
      } catch {
        return res.status(400).json({ error: 'documentData debe ser JSON válido' });
      }
      // recipientName/Email/Phone se inyectan aparte para llenar los campos "Titular" de la
      // plantilla sin pedirle al agente que los tipee dos veces en el formulario.
      pdfBuffer = await fillBeemoTemplate({ ...parsedData, recipientName, recipientEmail: recipientEmail || '', recipientPhone: recipientPhone || '' });
      docName = `beemo-${recipientName}.pdf`;
    } else {
      if (!req.file) return res.status(400).json({ error: 'Archivo PDF requerido' });
      if (path.extname(req.file.originalname).toLowerCase() !== '.pdf')
        return res.status(400).json({ error: 'El archivo debe ser un PDF' });
      pdfBuffer = req.file.buffer;
      docName = path.basename(req.file.originalname);
    }

    const uploadPath = path.join(UPLOADS_DIR, `BEEMO-${uuidv4()}-${docName}`);
    await fs.writeFile(uploadPath, pdfBuffer);

    // Nota: en modo 'upload' NO se valida el número de páginas contra la plantilla — es un PDF
    // arbitrario. expectedPages solo se usa como heurística en stampBeemoSignature para decidir
    // si confiar en signField calibrado o caer al default BEEMO_SIGN_FIELD_* (ver beemoPdfService.js).
    const docHash = hashBuffer(pdfBuffer);
    const id = uuidv4();
    const token = generateSecureToken();
    const expiresHours = parseInt(process.env.BEEMO_TOKEN_EXPIRES_HOURS);
    const tokenExpiry = expiresHours ? getTokenExpiry(expiresHours) : null;

    await db.query(
      `INSERT INTO beemo_documents
       (id, agent_id, source, document_name, document_original_path, document_hash, document_data,
        recipient_name, recipient_email, recipient_phone, send_channel, token, token_expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, req.user.id, source, docName, uploadPath, docHash, source === 'template' ? (documentData || null) : null,
       recipientName, recipientEmail || null, recipientPhone || null, sendChannel, token, tokenExpiry]
    );

    const sendErrors = [];
    if (sendChannel === 'email' || sendChannel === 'both') {
      try {
        await sendBeemoSignatureRequest({ recipientName, recipientEmail, token, documentName: docName });
      } catch (err) {
        sendErrors.push({ channel: 'email', err });
      }
    }
    if (sendChannel === 'whatsapp' || sendChannel === 'both') {
      try {
        await sendBeemoSignatureWhatsApp({ recipientName, recipientPhone, token });
      } catch (err) {
        sendErrors.push({ channel: 'whatsapp', err });
      }
    }

    if (sendChannel !== 'both' && sendErrors.length) {
      await fs.unlink(uploadPath).catch(() => {});
      await db.query('DELETE FROM beemo_documents WHERE id = ?', [id]);
      const errorCode = sendChannel === 'whatsapp' ? 'WHATSAPP_UNAVAILABLE' : 'EMAIL_UNAVAILABLE';
      return res.status(503).json({
        errorCode,
        error: `No se pudo enviar por ${sendChannel === 'whatsapp' ? 'WhatsApp' : 'correo'}. Intenta nuevamente.`,
      });
    }

    if (sendChannel === 'both' && sendErrors.length === 2) {
      await fs.unlink(uploadPath).catch(() => {});
      await db.query('DELETE FROM beemo_documents WHERE id = ?', [id]);
      return res.status(503).json({ errorCode: 'EMAIL_UNAVAILABLE', error: 'No se pudo enviar por correo ni por WhatsApp. Intenta nuevamente.' });
    }

    if (sendChannel === 'both' && sendErrors.length === 1) {
      const failedChannel = sendErrors[0].channel;
      return res.status(201).json({
        id, status: 'pending',
        message: 'Documento enviado',
        warning: `No se pudo enviar por ${failedChannel === 'whatsapp' ? 'WhatsApp' : 'correo'}, pero sí por el otro canal.`,
      });
    }

    res.status(201).json({ id, status: 'pending', message: 'Documento enviado para firma' });
  } catch (err) {
    next(err);
  }
}

async function listDocuments(req, res, next) {
  try {
    const { status, search, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    let where = req.user.role === 'admin' ? '1=1' : 'bd.agent_id = ?';
    const params = req.user.role === 'admin' ? [] : [req.user.id];

    if (status) { where += ' AND bd.status = ?'; params.push(status); }
    if (search) { where += ' AND (bd.recipient_name LIKE ? OR bd.document_name LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

    const [rows] = await db.query(
      `SELECT bd.id, bd.document_name, bd.recipient_name, bd.recipient_email, bd.recipient_phone,
              bd.send_channel, bd.status, bd.sent_at, bd.viewed_at, bd.signed_at, a.name AS agent_name
       FROM beemo_documents bd
       JOIN agents a ON bd.agent_id = a.id
       WHERE ${where}
       ORDER BY bd.sent_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM beemo_documents bd WHERE ${where}`,
      params
    );

    res.json({ data: rows, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    next(err);
  }
}

async function getDocument(req, res, next) {
  try {
    const { id } = req.params;
    const ownerFilter = req.user.role !== 'admin' ? 'AND bd.agent_id = ?' : '';
    const params = req.user.role !== 'admin' ? [id, req.user.id] : [id];

    const [rows] = await db.query(
      `SELECT bd.*, a.name AS agent_name
       FROM beemo_documents bd
       JOIN agents a ON bd.agent_id = a.id
       WHERE bd.id = ? ${ownerFilter}`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
}

async function downloadSignedDocument(req, res, next) {
  try {
    const { id } = req.params;
    const ownerFilter = req.user.role !== 'admin' ? 'AND agent_id = ?' : '';
    const params = req.user.role !== 'admin' ? [id, req.user.id] : [id];

    const [rows] = await db.query(`SELECT * FROM beemo_documents WHERE id = ? ${ownerFilter}`, params);
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });

    const doc = rows[0];
    if (doc.status !== 'signed' || !doc.signed_document_path) return res.status(404).json({ error: 'Documento aún no firmado' });

    const buffer = await fs.readFile(path.resolve(doc.signed_document_path));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="FIRMADO-${doc.document_name}"`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
}

async function deleteDocument(req, res, next) {
  try {
    const { id } = req.params;
    const ownerFilter = req.user.role !== 'admin' ? 'AND agent_id = ?' : '';
    const params = req.user.role !== 'admin' ? [id, req.user.id] : [id];

    const [rows] = await db.query(`SELECT * FROM beemo_documents WHERE id = ? ${ownerFilter}`, params);
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });

    const doc = rows[0];
    const filesToDelete = [doc.document_original_path, doc.signed_document_path, doc.signature_image_path].filter(Boolean);
    await Promise.all(filesToDelete.map(f => fs.unlink(f).catch(() => {})));
    await db.query('DELETE FROM beemo_documents WHERE id = ?', [id]);

    res.json({ ok: true, message: 'Registro eliminado correctamente' });
  } catch (err) {
    next(err);
  }
}

// Reenvía el enlace de firma de un documento ya existente (mismo PDF, mismo destinatario,
// mismo canal). Genera un token nuevo — el enlace anterior deja de servir — y solo lo persiste
// si el (re)envío tuvo éxito, para no invalidar un enlace que sigue funcionando por un intento
// fallido. No crea una fila nueva en beemo_documents ni reinicia el estado 'viewed'/'signed'.
async function resendDocument(req, res, next) {
  try {
    const { id } = req.params;
    const ownerFilter = req.user.role !== 'admin' ? 'AND agent_id = ?' : '';
    const params = req.user.role !== 'admin' ? [id, req.user.id] : [id];

    const [rows] = await db.query(`SELECT * FROM beemo_documents WHERE id = ? ${ownerFilter}`, params);
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });

    const doc = rows[0];
    if (doc.status === 'signed') return res.status(409).json({ error: 'El documento ya fue firmado, no se puede reenviar' });

    const newToken = generateSecureToken();
    const expiresHours = parseInt(process.env.BEEMO_TOKEN_EXPIRES_HOURS);
    const newExpiry = expiresHours ? getTokenExpiry(expiresHours) : null;

    const sendErrors = [];
    if (doc.send_channel === 'email' || doc.send_channel === 'both') {
      try {
        await sendBeemoSignatureRequest({
          recipientName: doc.recipient_name, recipientEmail: doc.recipient_email,
          token: newToken, documentName: doc.document_name,
        });
      } catch (err) {
        sendErrors.push({ channel: 'email', err });
      }
    }
    if (doc.send_channel === 'whatsapp' || doc.send_channel === 'both') {
      try {
        await sendBeemoSignatureWhatsApp({ recipientName: doc.recipient_name, recipientPhone: doc.recipient_phone, token: newToken });
      } catch (err) {
        sendErrors.push({ channel: 'whatsapp', err });
      }
    }

    if (doc.send_channel !== 'both' && sendErrors.length) {
      const errorCode = doc.send_channel === 'whatsapp' ? 'WHATSAPP_UNAVAILABLE' : 'EMAIL_UNAVAILABLE';
      return res.status(503).json({
        errorCode,
        error: `No se pudo reenviar por ${doc.send_channel === 'whatsapp' ? 'WhatsApp' : 'correo'}. Intenta nuevamente.`,
      });
    }
    if (doc.send_channel === 'both' && sendErrors.length === 2) {
      return res.status(503).json({ errorCode: 'EMAIL_UNAVAILABLE', error: 'No se pudo reenviar por correo ni por WhatsApp. Intenta nuevamente.' });
    }

    await db.query('UPDATE beemo_documents SET token = ?, token_expires_at = ? WHERE id = ?', [newToken, newExpiry, doc.id]);

    if (doc.send_channel === 'both' && sendErrors.length === 1) {
      const failedChannel = sendErrors[0].channel;
      return res.json({
        ok: true, message: 'Documento reenviado',
        warning: `No se pudo reenviar por ${failedChannel === 'whatsapp' ? 'WhatsApp' : 'correo'}, pero sí por el otro canal.`,
      });
    }

    res.json({ ok: true, message: 'Documento reenviado exitosamente' });
  } catch (err) {
    next(err);
  }
}

async function getStats(req, res, next) {
  try {
    const ownerFilter = req.user.role !== 'admin' ? 'WHERE agent_id = ?' : '';
    const params = req.user.role !== 'admin' ? [req.user.id] : [];

    const [rows] = await db.query(
      `SELECT status, COUNT(*) AS count FROM beemo_documents ${ownerFilter} GROUP BY status`,
      params
    );

    const counts = { pending: 0, viewed: 0, signed: 0 };
    for (const row of rows) counts[row.status] = row.count;

    const dateFilter = req.user.role !== 'admin' ? 'AND agent_id = ?' : '';
    const [trendRows] = await db.query(
      `SELECT DATE(sent_at) AS day, COUNT(*) AS count FROM beemo_documents
       WHERE sent_at >= CURDATE() - INTERVAL 13 DAY ${dateFilter}
       GROUP BY DATE(sent_at)`,
      params
    );

    res.json({
      counts,
      trend: buildDailyTrend(trendRows),
      whatsappReady: Boolean(process.env.BEEMO_WHATSAPP_PHONE_NUMBER_ID && process.env.BEEMO_WHATSAPP_ACCESS_TOKEN),
    });
  } catch (err) {
    next(err);
  }
}

async function getTemplateFields(req, res, next) {
  try {
    const config = await getBeemoSignConfig();
    // Solo se piden en el formulario los campos con "label": los "recipient*" se llenan
    // automáticamente desde recipientName/Email/Phone, y algunos dataPath (ej. "agente.nombre")
    // aparecen dos veces en la plantilla (en una frase corrida y en su etiqueta propia) — la
    // copia sin label es un reflejo del mismo valor, no un campo nuevo a pedir.
    const fields = (config.fields || []).filter(f => f.label);
    res.json({ fields });
  } catch (err) {
    next(err);
  }
}

// Solo para probar el plasmado de datos en la plantilla: llena el PDF y lo devuelve directo,
// sin insertar en beemo_documents ni enviar correo/WhatsApp. No usar en el flujo real de envío.
async function previewTemplate(req, res, next) {
  try {
    const { recipientName, recipientEmail, recipientPhone, documentData } = req.body;
    const merged = {
      ...(documentData || {}),
      recipientName: recipientName || '',
      recipientEmail: recipientEmail || '',
      recipientPhone: recipientPhone || '',
    };
    const pdfBuffer = await fillBeemoTemplate(merged);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="beemo-preview.pdf"');
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
}

module.exports = { sendDocument, listDocuments, getDocument, downloadSignedDocument, deleteDocument, resendDocument, getStats, getTemplateFields, previewTemplate };
