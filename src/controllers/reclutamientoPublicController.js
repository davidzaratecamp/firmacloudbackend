const path = require('path');
const fs = require('fs').promises;
const db = require('../config/database');
const {
  detectSignLocations, cropSignatureToContent, stampSignature, ANCHOR_CV, ANCHOR_TRATAMIENTO,
} = require('../services/reclutamientoPdfService');

const SIGNED_DIR = path.resolve(process.env.SIGNED_DIR || path.join(__dirname, '../../signed'));

function getClientIP(req) {
  const raw = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.socket.remoteAddress
    || 'unknown';
  if (raw === '::1') return '127.0.0.1';
  const v4mapped = raw.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4mapped) return v4mapped[1];
  return raw;
}

async function getSigningPage(req, res, next) {
  try {
    const { token } = req.params;
    const [rows] = await db.query(
      'SELECT id, candidate_name, status, token_expires_at FROM reclutamiento_candidatos WHERE token = ?',
      [token]
    );
    if (!rows.length) return res.status(404).json({ error: 'Enlace no válido' });

    const candidato = rows[0];
    if (candidato.token_expires_at && new Date() > new Date(candidato.token_expires_at)) {
      return res.status(410).json({ error: 'Este enlace ha expirado' });
    }
    if (candidato.status === 'signed') return res.status(409).json({ error: 'Estos documentos ya fueron firmados' });

    res.json({ id: candidato.id, candidateName: candidato.candidate_name, status: candidato.status });
  } catch (err) {
    next(err);
  }
}

async function recordView(req, res, next) {
  try {
    const { token } = req.params;
    const [rows] = await db.query('SELECT * FROM reclutamiento_candidatos WHERE token = ?', [token]);
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });

    const candidato = rows[0];
    if (candidato.status === 'pending') {
      await db.query("UPDATE reclutamiento_candidatos SET status = 'viewed', viewed_at = ? WHERE id = ?", [new Date(), candidato.id]);
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

function servirDocumento(tipo) {
  return async function (req, res, next) {
    try {
      const { token } = req.params;
      const [rows] = await db.query('SELECT * FROM reclutamiento_candidatos WHERE token = ?', [token]);
      if (!rows.length) return res.status(404).json({ error: 'No encontrado' });

      const candidato = rows[0];
      if (candidato.status === 'signed') return res.status(410).json({ error: 'Enlace no disponible' });

      const originalPath = tipo === 'cv' ? candidato.cv_original_path : candidato.tratamiento_original_path;
      const filePath = path.isAbsolute(originalPath) ? originalPath : path.join(__dirname, '../../', originalPath);

      res.setHeader('Content-Type', 'application/pdf');
      res.sendFile(filePath, (err) => { if (err) next(err); });
    } catch (err) {
      next(err);
    }
  };
}

async function submitSignature(req, res, next) {
  try {
    const { token } = req.params;
    const { signatureDataUrl, signatureMode } = req.body;

    if (!signatureDataUrl) return res.status(400).json({ error: 'Firma requerida' });
    if (typeof signatureDataUrl !== 'string' || !signatureDataUrl.startsWith('data:image/png;base64,'))
      return res.status(400).json({ error: 'Formato de firma inválido' });
    if (Buffer.byteLength(signatureDataUrl, 'utf8') > 1.5 * 1024 * 1024)
      return res.status(400).json({ error: 'Imagen de firma demasiado grande' });

    const [rows] = await db.query('SELECT * FROM reclutamiento_candidatos WHERE token = ?', [token]);
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });

    const candidato = rows[0];
    if (candidato.status === 'signed') return res.status(409).json({ error: 'Ya firmado' });
    if (candidato.token_expires_at && new Date() > new Date(candidato.token_expires_at)) {
      return res.status(410).json({ error: 'Enlace expirado' });
    }

    const ip = getClientIP(req);
    const ua = req.headers['user-agent'];
    const signedAt = new Date();

    // Se vuelve a detectar sobre los documentos REALES en este momento — nunca se confía en
    // una posición calculada al momento del envío (ver reclutamientoPdfService.js).
    const [cvLocations, tratamientoLocations] = await Promise.all([
      detectSignLocations(candidato.cv_original_path, ANCHOR_CV),
      detectSignLocations(candidato.tratamiento_original_path, ANCHOR_TRATAMIENTO),
    ]);
    if (!cvLocations.length || !tratamientoLocations.length) {
      return res.status(500).json({ error: 'No se pudo determinar dónde colocar la firma en uno de los documentos' });
    }

    const base64Data = signatureDataUrl.replace(/^data:image\/png;base64,/, '');
    const croppedSignature = await cropSignatureToContent(Buffer.from(base64Data, 'base64'));

    const [cvSignedBytes, tratamientoSignedBytes] = await Promise.all([
      stampSignature(candidato.cv_original_path, croppedSignature, cvLocations, candidato.id, signatureMode),
      stampSignature(candidato.tratamiento_original_path, croppedSignature, tratamientoLocations, candidato.id, signatureMode),
    ]);

    const cvSignedPath = path.join(SIGNED_DIR, `RECLUTAMIENTO-CV-FIRMADO-${candidato.id}.pdf`);
    const tratamientoSignedPath = path.join(SIGNED_DIR, `RECLUTAMIENTO-TRAT-FIRMADO-${candidato.id}.pdf`);
    const sigImagePath = path.join(SIGNED_DIR, `RECLUTAMIENTO-SIG-${candidato.id}.png`);

    await Promise.all([
      fs.writeFile(cvSignedPath, cvSignedBytes),
      fs.writeFile(tratamientoSignedPath, tratamientoSignedBytes),
      fs.writeFile(sigImagePath, croppedSignature),
    ]);

    // UPDATE atómico: solo aplica si todavía no estaba firmado (previene condición de carrera).
    const [updateResult] = await db.query(
      `UPDATE reclutamiento_candidatos SET
        status = 'signed',
        signed_at = ?,
        signer_ip = ?,
        signer_user_agent = ?,
        cv_signed_path = ?,
        tratamiento_signed_path = ?,
        signature_image_path = ?
       WHERE id = ? AND status IN ('pending', 'viewed')`,
      [signedAt, ip, ua, cvSignedPath, tratamientoSignedPath, sigImagePath, candidato.id]
    );

    if (updateResult.affectedRows === 0) {
      await Promise.all([cvSignedPath, tratamientoSignedPath, sigImagePath].map(p => fs.unlink(p).catch(() => {})));
      return res.status(409).json({ error: 'Ya firmado' });
    }

    res.json({ ok: true, message: 'Documentos firmados exitosamente', signedAt: signedAt.toISOString() });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getSigningPage,
  recordView,
  getCvDocument: servirDocumento('cv'),
  getTratamientoDocument: servirDocumento('tratamiento'),
  submitSignature,
};
