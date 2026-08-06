const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs').promises;
const db = require('../config/database');
const { generateSecureToken } = require('../utils/token');
const { hashFile } = require('../utils/hash');
const { sendCartaFormulario } = require('./cartaEmailService');
const { sendFormWhatsApp } = require('./whatsappService');

const UPLOADS_DIR = path.resolve(process.env.UPLOADS_DIR || path.join(__dirname, '../../uploads'));

function getPlantillaPath(npnName, folderName = '') {
  const dir = process.env.PLANTILLAS_DIR || path.join(__dirname, '../../../plantillas');
  return path.join(dir, folderName || '', `${npnName}.pdf`);
}

// Generación de plantilla actualmente activa para un NPN (tabla npn_active_template).
// Si el NPN no tiene fila (no debería pasar tras la migración de backfill), cae a la
// generación 'oscar' si existe; si tampoco existe esa fila (instalación sin migrar),
// resuelve como antes (raíz de PLANTILLAS_DIR).
async function getActiveGeneration(npnName) {
  const [rows] = await db.query(
    `SELECT tg.id, tg.folder_name, tg.insurer_display_name
     FROM npn_active_template nat
     JOIN template_generations tg ON tg.id = nat.generation_id
     WHERE nat.npn_name = ?`,
    [npnName]
  );
  if (rows[0]) return rows[0];

  const [fallback] = await db.query(
    `SELECT id, folder_name, insurer_display_name FROM template_generations WHERE label = 'oscar'`
  );
  return fallback[0] || null;
}

async function getGenerationByLabel(label) {
  const [rows] = await db.query(
    `SELECT id, folder_name, insurer_display_name FROM template_generations WHERE label = ?`,
    [label]
  );
  return rows[0] || null;
}

// Resuelve y valida la plantilla PDF de un NPN una sola vez (reusable por envío manual y por lotes de oleada).
// `generationLabel` es opcional — si se pasa (ej. 'oscar'/'ambetter', elegido por el agente al enviar),
// fuerza esa generación puntual en vez de usar la que esté activa en npn_active_template.
async function resolveNpnTemplate(npnName, generationLabel = null) {
  const trimmedName = npnName.trim();

  let generation;
  if (generationLabel) {
    generation = await getGenerationByLabel(generationLabel);
    if (!generation) {
      const err = new Error(`Aseguradora desconocida: ${generationLabel}`);
      err.code = 'GENERATION_NOT_FOUND';
      throw err;
    }
  } else {
    generation = await getActiveGeneration(trimmedName);
  }

  const cartaPath = getPlantillaPath(trimmedName, generation && generation.folder_name);
  try {
    await fs.access(cartaPath);
  } catch {
    const label = generation && generation.insurer_display_name;
    const err = new Error(
      label ? `${label} no tiene plantilla para ${npnName}` : `Plantilla no encontrada: ${npnName}.pdf`
    );
    err.code = 'TEMPLATE_NOT_FOUND';
    throw err;
  }
  const docName = `${trimmedName}.pdf`;
  const docHash = await hashFile(cartaPath);
  return {
    cartaPath,
    docName,
    docHash,
    generationId: generation ? generation.id : null,
    insurerName: generation ? generation.insurer_display_name : null,
  };
}

// Crea el signature_request + copia la plantilla + envía email/whatsapp para UN destinatario.
async function dispatchCartaToRecipient({
  agentId, npnName, npnCode, cartaPath, docName, docHash, generationId, insurerName,
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

  // Congela qué generación de plantilla (y por lo tanto qué coordenadas de firma) se usó
  // en ESTE envío puntual — un swap posterior de npn_active_template no debe afectar el
  // estampado de esta carta, que puede quedar pendiente de firma por tiempo indefinido.
  if (generationId) {
    await db.query(
      'INSERT INTO carta_template_snapshot (signature_request_id, generation_id) VALUES (?, ?)',
      [id, generationId]
    );
  }

  if (sendChannel === 'email' || sendChannel === 'both') {
    try {
      await sendCartaFormulario({
        clientName,
        clientEmail,
        token,
        requestId: id,
        cartaPath,
        npnName: npnName.trim(),
        insurerName,
      });
    } catch (emailErr) {
      // Si el email falla (p.ej. cupo diario de Gmail agotado) marcar la carta como
      // 'failed' en vez de dejarla 'pending' (engañoso, el cliente nunca la recibió)
      // o borrarla (se perdía el historial de que se intentó). Se adjunta el id al
      // error para que quien llama (oleadas) pueda enlazarlo sin adivinar por email.
      await db.query("UPDATE signature_requests SET status = 'failed' WHERE id = ?", [id]);
      emailErr.signatureRequestId = id;
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
