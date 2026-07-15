const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs').promises;
const db = require('../config/database');
const { generateSecureToken } = require('../utils/token');
const { hashFile } = require('../utils/hash');
const { sendCartaFormulario } = require('./cartaEmailService');
const { sendFormWhatsApp } = require('./whatsappService');

const UPLOADS_DIR = path.resolve(process.env.UPLOADS_DIR || path.join(__dirname, '../../uploads'));

function getPlantillaPath(npnName) {
  const dir = process.env.PLANTILLAS_DIR || path.join(__dirname, '../../../plantillas');
  return path.join(dir, `${npnName}.pdf`);
}

// Resuelve y valida la plantilla PDF de un NPN una sola vez (reusable por envío manual y por lotes de oleada)
async function resolveNpnTemplate(npnName) {
  const cartaPath = getPlantillaPath(npnName.trim());
  try {
    await fs.access(cartaPath);
  } catch {
    const err = new Error(`Plantilla no encontrada: ${npnName}.pdf`);
    err.code = 'TEMPLATE_NOT_FOUND';
    throw err;
  }
  const docName = `${npnName.trim()}.pdf`;
  const docHash = await hashFile(cartaPath);
  return { cartaPath, docName, docHash };
}

// Crea el signature_request + copia la plantilla + envía email/whatsapp para UN destinatario.
async function dispatchCartaToRecipient({
  agentId, npnName, npnCode, cartaPath, docName, docHash,
  sendChannel, clientName, clientEmail, clientPhone, sentFromIp,
}) {
  const id = uuidv4();
  const token = generateSecureToken();
  const tokenExpiry = new Date('2037-12-31T22:59:59.000Z'); // cartas NPN no expiran (máx TIMESTAMP MySQL)

  const uploadPath = path.join(UPLOADS_DIR, `${id}-${docName}`);
  await fs.copyFile(cartaPath, uploadPath);

  await db.query(
    `INSERT INTO signature_requests
     (id, agent_id, document_name, document_original_path, document_hash,
      client_name, client_email, client_phone, send_channel,
      token, token_expires_at, npn_name, npn_code, sent_from_ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, agentId, docName, uploadPath, docHash,
      clientName, clientEmail || null, clientPhone || null, sendChannel,
      token, tokenExpiry, npnName.trim(), npnCode || null,
      sentFromIp || null,
    ]
  );

  if (sendChannel === 'email' || sendChannel === 'both') {
    try {
      await sendCartaFormulario({
        clientName,
        clientEmail,
        token,
        requestId: id,
        cartaPath,
        npnName: npnName.trim(),
      });
    } catch (emailErr) {
      // Si el email falla (p.ej. cupo diario de Gmail agotado) no dejar una carta
      // "pendiente" huérfana en signature_requests — el cliente nunca la recibió.
      await db.query('DELETE FROM signature_requests WHERE id = ?', [id]);
      await fs.unlink(uploadPath).catch(() => {});
      throw emailErr;
    }
  }

  if (sendChannel === 'whatsapp' || sendChannel === 'both') {
    try {
      await sendFormWhatsApp({ clientName, clientPhone, token, npnName: npnName.trim() });
    } catch (waErr) {
      if (sendChannel === 'whatsapp') {
        await db.query('DELETE FROM signature_requests WHERE id = ?', [id]);
        await fs.unlink(uploadPath).catch(() => {});
        throw new Error(`WhatsApp no disponible: ${waErr.message}`);
      }
      console.error(`[whatsapp-carta] Fallo enviando a ${clientPhone}:`, waErr.message);
    }
  }

  return { id, clientName };
}

module.exports = { getPlantillaPath, resolveNpnTemplate, dispatchCartaToRecipient, UPLOADS_DIR };
