const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs').promises;
const db = require('../config/database');
const { generateSecureToken, getTokenExpiry } = require('../utils/token');
const { hashFile, hashBuffer } = require('../utils/hash');
const { sendSignatureRequest, sendVitalSignatureRequest } = require('../services/emailService');
const { sendSignatureWhatsApp, sendVitalWhatsApp } = require('../services/whatsappService');
const { generateCertificate, fillVitalDocument, getVitalSignConfig } = require('../services/pdfService');
const { triggerWebhook } = require('../services/webhookService');
const { buildDailyTrend } = require('../utils/dailyTrend');
const { getServerLocation } = require('../utils/serverLocation');

const UPLOADS_DIR      = path.resolve(process.env.UPLOADS_DIR      || path.join(__dirname, '../../uploads'));
const SIGNED_DIR       = path.resolve(process.env.SIGNED_DIR       || path.join(__dirname, '../../signed'));
// Módulo Vital — Firma Tratamiento de Datos: NO comparte carpeta con el resto de Firmas/Cartas
// (que usan UPLOADS_DIR); guarda sus documentos llenados en su propia carpeta.
const VITAL_UPLOADS_DIR = path.resolve(process.env.VITAL_UPLOADS_DIR || path.join(__dirname, '../../vital-uploads'));

// Validación laxa de formato (evita que espacios en blanco o valores mal formados
// pasen la validación de "requerido" y lleguen crudos a nodemailer/WhatsApp).
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Quita tildes/diacríticos y cualquier carácter no seguro para un nombre de archivo o para
// el header Content-Disposition (evita inyección de comillas/CRLF vía nombre del cliente).
function sanitizeFilenamePart(str) {
  return String(str || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

async function sendDocument(req, res, next) {
  try {
    let { clientName, clientEmail, clientPhone, sendChannel = 'email', webhookUrl, agentName, agentCedula, loggedAgentName, loggedAgentId } = req.body;
    if (typeof clientEmail === 'string') clientEmail = clientEmail.trim();
    if (typeof clientPhone === 'string') clientPhone = clientPhone.trim();

    if (!clientName) return res.status(400).json({ error: 'Nombre del cliente requerido' });
    if (sendChannel === 'email' || sendChannel === 'both') {
      if (!clientEmail) return res.status(400).json({ error: 'Email requerido para envío por correo' });
      if (!EMAIL_REGEX.test(clientEmail)) return res.status(400).json({ error: 'Email inválido' });
    }
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

    const serverLoc = getServerLocation();

    await db.query(
      `INSERT INTO signature_requests
       (id, agent_id, document_name, document_original_path, document_hash, client_name, client_email, client_phone, send_channel, token, token_expires_at, agent_name_sent, agent_cedula, logged_agent_name, logged_agent_id, sent_from_ip, sent_from_location, webhook_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, req.user.id, docName, uploadPath, docHash, clientName, clientEmail || null, clientPhone || null, sendChannel, token, tokenExpiry, agentName || null, agentCedula || null, loggedAgentName || null, loggedAgentId || null, serverLoc?.ip || null, serverLoc?.location || null, webhookUrl || null]
    );

    await db.query(
      'INSERT INTO activity_logs (signature_request_id, event_type, details) VALUES (?, ?, ?)',
      [id, 'DOCUMENT_SENT', JSON.stringify({ channel: sendChannel, email: clientEmail, phone: clientPhone })]
    );

    const sendArgs = { clientName, clientEmail, clientPhone, token, documentName: docName, agentName: req.user.name };

    if (sendChannel === 'email' || sendChannel === 'both') {
      try {
        await sendSignatureRequest(sendArgs);
      } catch (emailErr) {
        // El correo se intenta primero — si falla, aún no hubo ningún envío exitoso
        // que preservar, así que limpiamos igual que en el fallo de canal único de WhatsApp.
        console.error('[email] Fallo al enviar solicitud de firma:', emailErr.message);
        await fs.unlink(uploadPath).catch(() => {});
        await db.query('DELETE FROM activity_logs WHERE signature_request_id = ?', [id]);
        await db.query('DELETE FROM signature_requests WHERE id = ?', [id]);
        return res.status(503).json({
          errorCode: 'EMAIL_UNAVAILABLE',
          error: 'No se pudo enviar el correo en este momento. Verifica el correo del cliente o intenta de nuevo más tarde.',
        });
      }
    }

    if (sendChannel === 'whatsapp' || sendChannel === 'both') {
      try {
        await sendSignatureWhatsApp(sendArgs);
      } catch (waErr) {
        if (sendChannel === 'whatsapp') {
          // Canal único falló — limpiar registro para que el agente reintente por otro canal
          await db.query('DELETE FROM activity_logs WHERE signature_request_id = ?', [id]);
          await db.query('DELETE FROM signature_requests WHERE id = ?', [id]);
          return res.status(503).json({
            errorCode: 'WHATSAPP_UNAVAILABLE',
            error: 'WhatsApp no está disponible en este momento. Por favor reenvía el documento por correo electrónico.',
          });
        }
        // Canal 'both': el email ya se envió, solo registrar la falla de WA
        console.error('[whatsapp] Fallo en canal both, email enviado:', waErr.message);
      }
    }

    const channelLabel = { email: 'correo electrónico', whatsapp: 'WhatsApp', both: 'correo y WhatsApp' };
    res.status(201).json({ id, status: 'pending', message: `Documento enviado por ${channelLabel[sendChannel]}` });
  } catch (err) {
    next(err);
  }
}

async function listSignatures(req, res, next) {
  try {
    const { status, search, page = 1, limit = 20, documentType } = req.query;
    const offset = (page - 1) * limit;

    // npn_name IS NULL excluye las cartas NPN del flujo de firma original
    let where = req.user.role === 'admin' ? 'sr.npn_name IS NULL' : 'sr.agent_id = ? AND sr.npn_name IS NULL';
    const params = req.user.role === 'admin' ? [] : [req.user.id];

    // documentType: distingue Vital (document_name fijo, ver sendDocumentWithData) del resto
    // (tratamiento de datos original + contrato-activación/Obama legado, ambos mezclados bajo
    // "legacy" porque comparten la misma pantalla histórica del panel). Sin este parámetro,
    // el comportamiento es idéntico al de antes (todo junto) — no rompe al frontend actual.
    if (documentType === 'vital') {
      where += " AND sr.document_name = 'vital-firma-tratamiento-datos.pdf'";
    } else if (documentType === 'legacy') {
      where += " AND sr.document_name != 'vital-firma-tratamiento-datos.pdf'";
    }

    if (status) { where += ' AND sr.status = ?'; params.push(status); }
    if (search) { where += ' AND (sr.client_name LIKE ? OR sr.client_email LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

    const [rows] = await db.query(
      `SELECT sr.id, sr.document_name, sr.client_name, sr.client_email, sr.status,
              sr.sent_at, sr.viewed_at, sr.signed_at, a.name AS agent_name,
              sr.agent_name_sent, sr.agent_cedula, sr.logged_agent_name, sr.logged_agent_id
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
    const isApiKey = req.user.isApiKey;
    const ownerFilter = (req.user.role !== 'admin' && !isApiKey) ? 'AND sr.agent_id = ?' : '';
    const params = (req.user.role !== 'admin' && !isApiKey) ? [id, req.user.id] : [id];
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

    // Módulo vital: todos los documentos comparten el mismo document_name fijo
    // ("vital-firma-tratamiento-datos.pdf"), así que descargar varios daba siempre el mismo
    // nombre de archivo — se usa nombre del cliente + UUID de la firma para distinguirlos.
    let docKind = null;
    try { docKind = sig.document_data ? JSON.parse(sig.document_data)._docKind : null; } catch { /* no es JSON válido, no es vital */ }
    const downloadFilename = docKind === 'vital'
      ? `FIRMADO-${sanitizeFilenamePart(sig.client_name)}-${sig.id}.pdf`
      : `FIRMADO-${sig.document_name}`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"`);
    res.send(Buffer.from(signedBuffer));
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

    const sig = rows[0];

    // Módulo vital (Vital — Firma Tratamiento de Datos): sin sumario/certificado post-firma.
    let docKind = null;
    try { docKind = sig.document_data ? JSON.parse(sig.document_data)._docKind : null; } catch { /* documento sin JSON válido, no es vital */ }
    if (docKind === 'vital') {
      return res.status(400).json({ error: 'Este documento no genera sumario/certificado' });
    }

    let certBuffer;
    if (sig.certificate_path) {
      certBuffer = await fs.readFile(path.resolve(sig.certificate_path));
    } else {
      const [logs] = await db.query('SELECT * FROM activity_logs WHERE signature_request_id = ? ORDER BY created_at ASC', [id]);
      certBuffer = await generateCertificate(sig, logs);
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="sumarium-${id}.pdf"`);
    res.send(Buffer.from(certBuffer));
  } catch (err) {
    next(err);
  }
}

async function replaceSignedDocument(req, res, next) {
  try {
    const { id } = req.params;
    if (!req.file) return res.status(400).json({ error: 'Archivo PDF requerido' });
    if (path.extname(req.file.originalname).toLowerCase() !== '.pdf') {
      return res.status(400).json({ error: 'El archivo debe ser un PDF' });
    }

    const ownerFilter = req.user.role !== 'admin' ? 'AND agent_id = ?' : '';
    const params = req.user.role !== 'admin' ? [id, req.user.id] : [id];
    const [rows] = await db.query(`SELECT * FROM signature_requests WHERE id = ? ${ownerFilter}`, params);
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });

    const sig = rows[0];
    if (sig.status !== 'signed' || !sig.signed_document_path) {
      return res.status(400).json({ error: 'Solo se puede reemplazar el PDF de una firma ya completada' });
    }

    const safeName = path.basename(req.file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
    const newPath = path.join(SIGNED_DIR, `FIRMADO-${id}-${Date.now()}-${safeName}`);
    await fs.writeFile(newPath, req.file.buffer);

    const oldPath = sig.signed_document_path;
    await db.query('UPDATE signature_requests SET signed_document_path = ? WHERE id = ?', [newPath, id]);
    await fs.unlink(path.resolve(oldPath)).catch(() => {});

    await db.query(
      'INSERT INTO activity_logs (signature_request_id, event_type, details) VALUES (?, ?, ?)',
      [id, 'DOCUMENT_REPLACED', JSON.stringify({ replacedBy: req.user.name || req.user.email, originalName: req.file.originalname })]
    );

    res.json({ ok: true, message: 'PDF firmado reemplazado correctamente' });
  } catch (err) {
    next(err);
  }
}

async function replaceCertificate(req, res, next) {
  try {
    const { id } = req.params;
    if (!req.file) return res.status(400).json({ error: 'Archivo PDF requerido' });
    if (path.extname(req.file.originalname).toLowerCase() !== '.pdf') {
      return res.status(400).json({ error: 'El archivo debe ser un PDF' });
    }

    const ownerFilter = req.user.role !== 'admin' ? 'AND agent_id = ?' : '';
    const params = req.user.role !== 'admin' ? [id, req.user.id] : [id];
    const [rows] = await db.query(`SELECT * FROM signature_requests WHERE id = ? ${ownerFilter}`, params);
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });

    const sig = rows[0];
    if (sig.status !== 'signed' || !sig.signed_document_path) {
      return res.status(400).json({ error: 'Solo se puede reemplazar el sumario de una firma ya completada' });
    }

    const safeName = path.basename(req.file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
    const newPath = path.join(SIGNED_DIR, `SUMARIUM-${id}-${Date.now()}-${safeName}`);
    await fs.writeFile(newPath, req.file.buffer);

    const oldPath = sig.certificate_path;
    await db.query('UPDATE signature_requests SET certificate_path = ? WHERE id = ?', [newPath, id]);
    if (oldPath) await fs.unlink(path.resolve(oldPath)).catch(() => {});

    await db.query(
      'INSERT INTO activity_logs (signature_request_id, event_type, details) VALUES (?, ?, ?)',
      [id, 'CERTIFICATE_REPLACED', JSON.stringify({ replacedBy: req.user.name || req.user.email, originalName: req.file.originalname })]
    );

    res.json({ ok: true, message: 'Sumario reemplazado correctamente' });
  } catch (err) {
    next(err);
  }
}

async function getDashboardStats(req, res, next) {
  try {
    const isAdmin    = req.user.role === 'admin';
    const agentParams = isAdmin ? [] : [req.user.id];

    const [stats] = await db.query(`
      SELECT
        COUNT(*) AS total,
        SUM(status = 'pending') AS pending,
        SUM(status = 'viewed') AS viewed,
        SUM(status = 'signed') AS signed,
        SUM(status = 'expired') AS expired
      FROM signature_requests
      WHERE npn_name IS NULL ${isAdmin ? '' : 'AND agent_id = ?'}
    `, agentParams);

    const [recent] = await db.query(`
      SELECT sr.id, sr.document_name, sr.client_name, sr.status, sr.sent_at
      FROM signature_requests sr
      WHERE sr.npn_name IS NULL ${isAdmin ? '' : 'AND sr.agent_id = ?'}
      ORDER BY sr.created_at DESC LIMIT 5
    `, agentParams);

    const [trendRows] = await db.query(`
      SELECT DATE(sent_at) AS day, COUNT(*) AS count
      FROM signature_requests
      WHERE npn_name IS NULL AND sent_at >= CURDATE() - INTERVAL 13 DAY ${isAdmin ? '' : 'AND agent_id = ?'}
      GROUP BY DATE(sent_at)
    `, agentParams);

    res.json({ stats: stats[0], recent, trend: buildDailyTrend(trendRows) });
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
      sig.signature_image_path,
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

async function sendDocumentWithData(req, res, next) {
  try {
    let {
      clientName, clientEmail, clientPhone,
      sendChannel = 'email',
      webhookUrl, agentName, agentCedula,
      loggedAgentName, loggedAgentId,
      ventaId,
      documentData,
    } = req.body;
    if (typeof clientEmail === 'string') clientEmail = clientEmail.trim();
    if (typeof clientPhone === 'string') clientPhone = clientPhone.trim();

    // Validaciones básicas
    if (!clientName) return res.status(400).json({ error: 'Nombre del cliente requerido' });
    if (sendChannel === 'email' || sendChannel === 'both') {
      if (!clientEmail) return res.status(400).json({ error: 'Email requerido para envío por correo' });
      if (!EMAIL_REGEX.test(clientEmail)) return res.status(400).json({ error: 'Email inválido' });
    }
    if ((sendChannel === 'whatsapp' || sendChannel === 'both') && !clientPhone)
      return res.status(400).json({ error: 'Teléfono requerido para envío por WhatsApp' });
    if (!documentData || !documentData.vital)
      return res.status(400).json({ error: 'documentData con vital es requerido' });
    if (req.user.isApiKey) {
      if (!agentName)   return res.status(400).json({ error: 'Nombre del agente requerido' });
      if (!agentCedula) return res.status(400).json({ error: 'Cédula del agente requerida' });
    }

    // Si la intranet no duplica clientName/agentName dentro de documentData.vital, se
    // completan con los mismos valores ya enviados en la raíz del body (mismo dato, dos
    // usos: routing de envío arriba, texto del párrafo de consentimiento en el PDF aquí).
    if (!documentData.vital.clientName) documentData.vital.clientName = clientName;
    if (!documentData.vital.agentName)  documentData.vital.agentName  = agentName;

    // Llenar plantilla con los datos (módulo Vital — Firma Tratamiento de Datos)
    const filledPdfBuffer = await fillVitalDocument(documentData);

    const vitalConfig = await getVitalSignConfig();

    const docName = 'vital-firma-tratamiento-datos.pdf';
    const id = uuidv4();
    const uploadPath = path.join(VITAL_UPLOADS_DIR, `${id}-${docName}`);
    await fs.writeFile(uploadPath, filledPdfBuffer);

    const docHash = hashBuffer(filledPdfBuffer);

    const token = generateSecureToken();
    const tokenExpiry = getTokenExpiry(parseInt(process.env.TOKEN_EXPIRES_HOURS) || 72);
    const serverLoc = getServerLocation();

    await db.query(
      `INSERT INTO signature_requests
       (id, agent_id, document_name, document_original_path, document_hash,
        client_name, client_email, client_phone, send_channel, token, token_expires_at,
        agent_name_sent, agent_cedula, logged_agent_name, logged_agent_id,
        sent_from_ip, sent_from_location, webhook_url,
        document_data, sign_page_index)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, req.user.id, docName, uploadPath, docHash,
        clientName, clientEmail || null, clientPhone || null, sendChannel, token, tokenExpiry,
        agentName || null, agentCedula || null, loggedAgentName || null, loggedAgentId || null,
        serverLoc?.ip || null, serverLoc?.location || null,
        webhookUrl || null,
        JSON.stringify({ ...documentData, _docKind: 'vital', _ventaId: ventaId || null }),
        vitalConfig.signPageIndex,
      ]
    );

    await db.query(
      'INSERT INTO activity_logs (signature_request_id, event_type, details) VALUES (?, ?, ?)',
      [id, 'DOCUMENT_SENT', JSON.stringify({ channel: sendChannel, email: clientEmail, phone: clientPhone, ventaId: ventaId || null })]
    );

    const sendArgs = { clientName, clientEmail, clientPhone, token, documentName: docName, agentName: req.user.name || agentName };

    if (sendChannel === 'email' || sendChannel === 'both') {
      try {
        // sendDocumentWithData es exclusiva del módulo Vital — mismo texto/branding que la
        // plantilla de WhatsApp aprobada en Meta, nunca sendSignatureRequest (Obama/legado).
        await sendVitalSignatureRequest(sendArgs);
      } catch (emailErr) {
        console.error('[email] Fallo al enviar solicitud de firma (send-with-data):', emailErr.message);
        await fs.unlink(uploadPath).catch(() => {});
        await db.query('DELETE FROM activity_logs WHERE signature_request_id = ?', [id]);
        await db.query('DELETE FROM signature_requests WHERE id = ?', [id]);
        return res.status(503).json({
          errorCode: 'EMAIL_UNAVAILABLE',
          error: 'No se pudo enviar el correo en este momento. Verifica el correo del cliente o intenta de nuevo más tarde.',
        });
      }
    }

    if (sendChannel === 'whatsapp' || sendChannel === 'both') {
      try {
        // sendDocumentWithData es exclusiva del módulo Vital (ver fillVitalDocument arriba) —
        // usa siempre la plantilla/credenciales propias de Vital, nunca sendSignatureWhatsApp.
        await sendVitalWhatsApp(sendArgs);
      } catch (waErr) {
        if (sendChannel === 'whatsapp') {
          await fs.unlink(uploadPath).catch(() => {});
          await db.query('DELETE FROM activity_logs WHERE signature_request_id = ?', [id]);
          await db.query('DELETE FROM signature_requests WHERE id = ?', [id]);
          return res.status(503).json({
            errorCode: 'WHATSAPP_UNAVAILABLE',
            error: 'WhatsApp no está disponible en este momento. Por favor reenvía el documento por correo electrónico.',
          });
        }
        console.error('[whatsapp] Fallo en canal both, email enviado:', waErr.message);
      }
    }

    const channelLabel = { email: 'correo electrónico', whatsapp: 'WhatsApp', both: 'correo y WhatsApp' };
    res.status(201).json({ id, status: 'pending', message: `Documento enviado por ${channelLabel[sendChannel]}` });
  } catch (err) {
    next(err);
  }
}

module.exports = { sendDocument, sendDocumentWithData, listSignatures, getSignature, downloadSignedDocument, downloadCertificate, replaceSignedDocument, replaceCertificate, getDashboardStats, deleteSignature };
