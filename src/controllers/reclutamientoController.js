const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs').promises;
const db = require('../config/database');
const { generateSecureToken, getTokenExpiry } = require('../utils/token');
const { hashBuffer } = require('../utils/hash');
const {
  detectSignLocations, cropSignatureToContent, stampPsicologoSignature, getPageCount,
  ANCHOR_CV, ANCHOR_TRATAMIENTO, ANCHOR_PSICOLOGO,
} = require('../services/reclutamientoPdfService');
const { buildDailyTrend } = require('../utils/dailyTrend');
const { sendReclutamientoEmail } = require('../services/reclutamientoEmailService');
const { sendReclutamientoWhatsApp } = require('../services/reclutamientoWhatsappService');

const UPLOADS_DIR = path.resolve(process.env.UPLOADS_DIR || path.join(__dirname, '../../uploads'));
const SIGNED_DIR = path.resolve(process.env.SIGNED_DIR || path.join(__dirname, '../../signed'));

// Envío desde Hydra: recibe los 2 PDFs YA armados (hoja de vida + tratamiento de datos) con
// los datos del candidato plasmados, valida que cada uno tenga su ancla de firma detectable,
// y envía el link de firma. FirmaCloud no arma ni conoce el contenido de ninguno de los dos.
async function sendCandidato(req, res, next) {
  const savedPaths = [];
  try {
    const { candidateName, candidateEmail, candidatePhone, sendChannel, hydraReferenceId } = req.body;
    const cvFile = req.files?.cvFile?.[0];
    const tratamientoFile = req.files?.tratamientoFile?.[0];

    if (!candidateName) return res.status(400).json({ error: 'candidateName requerido' });
    if (!cvFile) return res.status(400).json({ error: 'cvFile (hoja de vida) requerido' });
    if (!tratamientoFile) return res.status(400).json({ error: 'tratamientoFile (tratamiento de datos) requerido' });
    if (!['email', 'whatsapp'].includes(sendChannel))
      return res.status(400).json({ error: 'Canal inválido. Use: email o whatsapp' });
    if (sendChannel === 'email' && !candidateEmail)
      return res.status(400).json({ error: 'candidateEmail requerido para envío por correo' });
    if (sendChannel === 'whatsapp' && !candidatePhone)
      return res.status(400).json({ error: 'candidatePhone requerido para envío por WhatsApp' });
    for (const f of [cvFile, tratamientoFile]) {
      if (path.extname(f.originalname).toLowerCase() !== '.pdf') {
        return res.status(400).json({ error: `${f.fieldname} debe ser un PDF` });
      }
    }

    const id = uuidv4();
    const cvPath = path.join(UPLOADS_DIR, `RECLUTAMIENTO-CV-${id}-${path.basename(cvFile.originalname)}`);
    const tratamientoPath = path.join(UPLOADS_DIR, `RECLUTAMIENTO-TRAT-${id}-${path.basename(tratamientoFile.originalname)}`);
    await fs.writeFile(cvPath, cvFile.buffer);
    savedPaths.push(cvPath);
    await fs.writeFile(tratamientoPath, tratamientoFile.buffer);
    savedPaths.push(tratamientoPath);

    // Falla rápido si alguno de los 2 documentos no trae su ancla de firma detectable — evita
    // mandarle al candidato un link donde luego no se pueda ubicar dónde firmar.
    const [cvLocations, tratamientoLocations] = await Promise.all([
      detectSignLocations(cvPath, ANCHOR_CV),
      detectSignLocations(tratamientoPath, ANCHOR_TRATAMIENTO),
    ]);
    if (!cvLocations.length) {
      await Promise.all(savedPaths.map(p => fs.unlink(p).catch(() => {})));
      return res.status(400).json({ error: 'No se detectó "FIRMA DEL CANDIDATO" en la hoja de vida. Verifica la plantilla.' });
    }
    if (!tratamientoLocations.length) {
      await Promise.all(savedPaths.map(p => fs.unlink(p).catch(() => {})));
      return res.status(400).json({ error: 'No se detectó "FIRMA" en el tratamiento de datos. Verifica la plantilla.' });
    }

    const token = generateSecureToken();
    const expiresHours = parseInt(process.env.RECLUTAMIENTO_TOKEN_EXPIRES_HOURS);
    const tokenExpiry = expiresHours ? getTokenExpiry(expiresHours) : null;

    await db.query(
      `INSERT INTO reclutamiento_candidatos
       (id, agent_id, candidate_name, candidate_email, candidate_phone, send_channel,
        cv_original_path, cv_hash, tratamiento_original_path, tratamiento_hash,
        token, token_expires_at, hydra_reference_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, req.user.id, candidateName, candidateEmail || null, candidatePhone || null, sendChannel,
       cvPath, hashBuffer(cvFile.buffer), tratamientoPath, hashBuffer(tratamientoFile.buffer),
       token, tokenExpiry, hydraReferenceId || null]
    );

    try {
      if (sendChannel === 'email') {
        await sendReclutamientoEmail({ candidateEmail, candidateName, token });
      } else {
        await sendReclutamientoWhatsApp({ candidateName, candidatePhone, token });
      }
    } catch (sendErr) {
      await Promise.all(savedPaths.map(p => fs.unlink(p).catch(() => {})));
      await db.query('DELETE FROM reclutamiento_candidatos WHERE id = ?', [id]);
      const errorCode = sendChannel === 'whatsapp' ? 'WHATSAPP_UNAVAILABLE' : 'EMAIL_UNAVAILABLE';
      return res.status(503).json({
        errorCode,
        error: `No se pudo enviar por ${sendChannel === 'whatsapp' ? 'WhatsApp' : 'correo'}. Intenta nuevamente.`,
      });
    }

    // firmarUrl: para que Hydra pueda redirigir al candidato directo a la página de firma en la
    // misma sesión, sin depender de que revise el correo — el correo/WhatsApp sigue enviándose
    // igual, como respaldo/registro, pero no es el único camino para llegar a firmar.
    const firmarUrl = `${process.env.APP_URL}/firmar-reclutamiento/${token}`;
    res.status(201).json({
      id, token, firmarUrl, status: 'pending',
      message: `Enviado por ${sendChannel === 'whatsapp' ? 'WhatsApp' : 'correo electrónico'}`,
    });
  } catch (err) {
    await Promise.all(savedPaths.map(p => fs.unlink(p).catch(() => {})));
    next(err);
  }
}

async function listCandidatos(req, res, next) {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    let where = '1=1';
    const params = [];
    if (status) { where += ' AND status = ?'; params.push(status); }

    const [rows] = await db.query(
      `SELECT id, candidate_name, candidate_email, candidate_phone, send_channel,
              status, sent_at, viewed_at, signed_at, hydra_reference_id
       FROM reclutamiento_candidatos
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM reclutamiento_candidatos WHERE ${where}`,
      params
    );

    res.json({ data: rows, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    next(err);
  }
}

async function getCandidatosDashboard(req, res, next) {
  try {
    const [stats] = await db.query(`
      SELECT
        COUNT(*) AS total,
        SUM(status = 'pending') AS pending,
        SUM(status = 'viewed') AS viewed,
        SUM(status = 'signed') AS signed
      FROM reclutamiento_candidatos
    `);

    const [recent] = await db.query(`
      SELECT id, candidate_name, status, sent_at
      FROM reclutamiento_candidatos
      ORDER BY created_at DESC LIMIT 5
    `);

    const [trendRows] = await db.query(`
      SELECT DATE(sent_at) AS day, COUNT(*) AS count
      FROM reclutamiento_candidatos
      WHERE sent_at >= CURDATE() - INTERVAL 13 DAY
      GROUP BY DATE(sent_at)
    `);

    res.json({ stats: stats[0], recent, trend: buildDailyTrend(trendRows) });
  } catch (err) {
    next(err);
  }
}

async function getCandidato(req, res, next) {
  try {
    const [rows] = await db.query('SELECT * FROM reclutamiento_candidatos WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
}

// Firma de selección/administrador sobre la hoja de vida, posterior a la del candidato. Parte
// SIEMPRE de cv_signed_path (solo firma del candidato, nunca se sobrescribe) — así la acción es
// idempotente: re-firmar (ej. porque firmó la persona equivocada) nunca apila un sello encima de
// otro, siempre reemplaza cv_final_signed_path desde cero.
async function firmarPsicologo(req, res, next) {
  try {
    const { id } = req.params;
    const { signatureDataUrl, signatureMode, firmadoPor } = req.body;

    if (!signatureDataUrl) return res.status(400).json({ error: 'Firma requerida' });
    if (typeof signatureDataUrl !== 'string' || !signatureDataUrl.startsWith('data:image/png;base64,'))
      return res.status(400).json({ error: 'Formato de firma inválido' });
    if (Buffer.byteLength(signatureDataUrl, 'utf8') > 1.5 * 1024 * 1024)
      return res.status(400).json({ error: 'Imagen de firma demasiado grande' });

    const [rows] = await db.query('SELECT * FROM reclutamiento_candidatos WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });

    const candidato = rows[0];
    if (candidato.status !== 'signed') {
      return res.status(409).json({ error: 'El candidato aún no ha firmado la hoja de vida y el tratamiento de datos' });
    }

    const locations = await detectSignLocations(candidato.cv_signed_path, ANCHOR_PSICOLOGO);
    if (!locations.length) {
      return res.status(500).json({ error: 'No se detectó "PSICÓLOGO" en la hoja de vida. Verifica la plantilla.' });
    }

    const base64Data = signatureDataUrl.replace(/^data:image\/png;base64,/, '');
    const croppedSignature = await cropSignatureToContent(Buffer.from(base64Data, 'base64'));
    const cvFinalBytes = await stampPsicologoSignature(candidato.cv_signed_path, croppedSignature, locations, candidato.id, signatureMode);

    const cvFinalPath = path.join(SIGNED_DIR, `RECLUTAMIENTO-CV-FINAL-${candidato.id}.pdf`);
    const sigImagePath = path.join(SIGNED_DIR, `RECLUTAMIENTO-SIG-PSICOLOGO-${candidato.id}.png`);
    await Promise.all([
      fs.writeFile(cvFinalPath, cvFinalBytes),
      fs.writeFile(sigImagePath, croppedSignature),
    ]);

    await db.query(
      `UPDATE reclutamiento_candidatos SET
        cv_final_signed_path = ?,
        psicologo_signed_at = ?,
        psicologo_signed_by = ?,
        psicologo_signature_image_path = ?
       WHERE id = ?`,
      [cvFinalPath, new Date(), firmadoPor || null, sigImagePath, candidato.id]
    );

    res.json({ ok: true, message: 'Hoja de vida firmada' });
  } catch (err) {
    next(err);
  }
}

function downloadDocumento(tipo) {
  return async function (req, res, next) {
    try {
      const [rows] = await db.query('SELECT * FROM reclutamiento_candidatos WHERE id = ?', [req.params.id]);
      if (!rows.length) return res.status(404).json({ error: 'No encontrado' });

      const candidato = rows[0];
      const signedPath = tipo === 'cv'
        ? (candidato.cv_final_signed_path || candidato.cv_signed_path)
        : candidato.tratamiento_signed_path;
      if (!signedPath) return res.status(400).json({ error: 'Documento aún no firmado' });

      const buffer = await fs.readFile(path.resolve(signedPath));
      const label = tipo === 'cv' ? 'hoja-de-vida' : 'tratamiento-de-datos';
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="FIRMADO-${label}-${candidato.id}.pdf"`);
      res.send(buffer);
    } catch (err) {
      next(err);
    }
  };
}

module.exports = {
  sendCandidato,
  listCandidatos,
  getCandidatosDashboard,
  getCandidato,
  firmarPsicologo,
  downloadCv: downloadDocumento('cv'),
  downloadTratamiento: downloadDocumento('tratamiento'),
  getPageCount,
};
