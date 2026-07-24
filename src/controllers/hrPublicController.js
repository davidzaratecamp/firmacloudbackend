const path = require('path');
const fs = require('fs').promises;
const db = require('../config/database');
const { stampContractSignature, detectSignLocations, detectFillInFields } = require('../services/hrContractPdfService');

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

// WhatsApp URL parser appends trailing text to links; extract only the leading hex token.
function cleanToken(raw) {
  const m = (raw || '').match(/^[a-f0-9]+/i);
  return m ? m[0] : '';
}

async function getSigningPage(req, res, next) {
  try {
    const token = cleanToken(req.params.token);
    const [rows] = await db.query(
      'SELECT id, document_name, document_original_path, status, token_expires_at FROM hr_contracts WHERE token = ?',
      [token]
    );
    if (!rows.length) return res.status(404).json({ error: 'Enlace no válido' });

    const contract = rows[0];
    if (contract.token_expires_at && new Date() > new Date(contract.token_expires_at)) {
      return res.status(410).json({ error: 'Este enlace ha expirado' });
    }
    if (contract.status === 'signed') return res.status(409).json({ error: 'Este documento ya fue firmado' });

    // Posiciones de los campos que el trabajador debe llenar a mano antes de firmar
    // (entidad de afiliación + tallas). Se calculan al vuelo, no se guardan en la BD.
    const fillInFields = await detectFillInFields(contract.document_original_path);

    res.json({ id: contract.id, documentName: contract.document_name, status: contract.status, fillInFields });
  } catch (err) {
    next(err);
  }
}

async function recordView(req, res, next) {
  try {
    const token = cleanToken(req.params.token);
    const [rows] = await db.query('SELECT * FROM hr_contracts WHERE token = ?', [token]);
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });

    const contract = rows[0];
    if (contract.status === 'pending') {
      await db.query("UPDATE hr_contracts SET status = 'viewed', viewed_at = ? WHERE id = ?", [new Date(), contract.id]);
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

async function getDocumentForSigning(req, res, next) {
  try {
    const token = cleanToken(req.params.token);
    const [rows] = await db.query('SELECT * FROM hr_contracts WHERE token = ?', [token]);
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });

    const contract = rows[0];
    if (contract.status === 'signed') return res.status(410).json({ error: 'Enlace no disponible' });

    const filePath = path.isAbsolute(contract.document_original_path)
      ? contract.document_original_path
      : path.join(__dirname, '../../', contract.document_original_path);

    res.setHeader('Content-Type', 'application/pdf');
    res.sendFile(filePath, (err) => {
      if (err) next(err);
    });
  } catch (err) {
    next(err);
  }
}

async function submitSignature(req, res, next) {
  try {
    const token = cleanToken(req.params.token);
    const { signatureDataUrl, signatureMode, entidadAfiliacion, tallaCamisa, tallaPantalon, tallaCalzado } = req.body;

    if (!signatureDataUrl) return res.status(400).json({ error: 'Firma requerida' });
    if (typeof signatureDataUrl !== 'string' || !signatureDataUrl.startsWith('data:image/png;base64,'))
      return res.status(400).json({ error: 'Formato de firma inválido' });
    if (Buffer.byteLength(signatureDataUrl, 'utf8') > 1.5 * 1024 * 1024)
      return res.status(400).json({ error: 'Imagen de firma demasiado grande' });

    const [rows] = await db.query('SELECT * FROM hr_contracts WHERE token = ?', [token]);
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });

    const contract = rows[0];
    if (contract.status === 'signed') return res.status(409).json({ error: 'Ya firmado' });
    if (contract.token_expires_at && new Date() > new Date(contract.token_expires_at)) {
      return res.status(410).json({ error: 'Enlace expirado' });
    }

    // Campos pre-firma (entidad de afiliación + tallas): si el documento los tiene detectables,
    // son obligatorios. No se guardan en la base de datos — solo se estampan en el PDF.
    const fillInValues = { entidadAfiliacion, tallaCamisa, tallaPantalon, tallaCalzado };
    const fillInFields = await detectFillInFields(contract.document_original_path);
    const FIELD_LABELS = {
      entidadAfiliacion: 'Entidad de afiliación',
      tallaCamisa: 'Talla de camisa',
      tallaPantalon: 'Talla de pantalón',
      tallaCalzado: 'Talla de calzado',
    };
    for (const key of Object.keys(fillInFields)) {
      if (fillInFields[key] && !String(fillInValues[key] || '').trim()) {
        return res.status(400).json({ error: `${FIELD_LABELS[key]} requerido` });
      }
    }

    const ip = getClientIP(req);
    const ua = req.headers['user-agent'];
    const signedAt = new Date();

    const signLocations = await detectSignLocations(contract.document_original_path);
    if (!signLocations.length) {
      return res.status(500).json({ error: 'No se pudo determinar dónde colocar la firma en este documento' });
    }
    const signedPdfBuffer = await stampContractSignature(contract.document_original_path, signatureDataUrl, signLocations, contract.id, signatureMode, fillInValues);

    const signedFileName = `HR-FIRMADO-${contract.id}-${contract.document_name}`;
    const signedPath = path.join(SIGNED_DIR, signedFileName);
    await fs.writeFile(signedPath, signedPdfBuffer);

    const sigImagePath = path.join(SIGNED_DIR, `HR-SIG-${contract.id}.png`);
    const sigImageBuffer = Buffer.from(signatureDataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
    await fs.writeFile(sigImagePath, sigImageBuffer);

    // Atomic update: only succeeds if still not signed (previene condición de carrera)
    const [updateResult] = await db.query(
      `UPDATE hr_contracts SET
        status = 'signed',
        signed_at = ?,
        signer_ip = ?,
        signer_user_agent = ?,
        signed_document_path = ?,
        signature_image_path = ?
       WHERE id = ? AND status IN ('pending', 'viewed')`,
      [signedAt, ip, ua, signedPath, sigImagePath, contract.id]
    );

    if (updateResult.affectedRows === 0) {
      await fs.unlink(signedPath).catch(() => {});
      await fs.unlink(sigImagePath).catch(() => {});
      return res.status(409).json({ error: 'Ya firmado' });
    }

    res.json({ ok: true, message: 'Documento firmado exitosamente', signedAt: signedAt.toISOString() });
  } catch (err) {
    next(err);
  }
}

module.exports = { getSigningPage, recordView, getDocumentForSigning, submitSignature };
