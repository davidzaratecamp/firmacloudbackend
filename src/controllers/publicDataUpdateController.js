const path = require('path');
const fs = require('fs').promises;
const db = require('../config/database');
const { getGenerationByLabel } = require('../services/cartaDispatchService');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.socket.remoteAddress
    || 'unknown';
}

// Formulario público sin token: cualquiera puede enviarlo indicando su NPN. El único
// control de duplicado es el UNIQUE de la columna email — no hay identidad previa que
// verificar, así que no se puede saber si alguien ya respondió hasta que lo intenta.
async function submitPublicDataUpdate(req, res, next) {
  try {
    const body = req.body || {};
    const required = ['npnName', 'name', 'phone', 'email', 'postalcode', 'insurer'];
    for (const field of required) {
      if (!body[field] || typeof body[field] !== 'string' || !body[field].trim())
        return res.status(400).json({ error: `Campo requerido: ${field}` });
    }
    if (!EMAIL_REGEX.test(body.email.trim()))
      return res.status(400).json({ error: 'Email inválido' });

    // El cliente elige su aseguradora en el formulario (decisión explícita del usuario:
    // resolverla sola por NPN activo dejaba demasiado al azar si el cliente recibió una
    // carta con una plantilla que ya no es la activa). Se valida contra template_generations
    // en vez de una lista fija en código, para que una generación nueva (ver sesión
    // 2026-08-04, "Cómo hacer el próximo cambio de plantilla") no requiera tocar este archivo.
    const insurerLabel = body.insurer.trim().toLowerCase();
    const generation = await getGenerationByLabel(insurerLabel);
    if (!generation)
      return res.status(400).json({ error: 'Aseguradora inválida' });

    const socialPath = req.files?.social?.[0]?.path           || null;
    const statusPath = req.files?.status_migratorio?.[0]?.path || null;

    try {
      await db.query(
        `INSERT INTO public_data_updates
           (npn_name, npn_code, name, phone, email, postalcode, insurer_label, social_path, status_path, submitted_ip)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          body.npnName.trim(),
          body.npnCode ? body.npnCode.trim() : null,
          body.name.trim(),
          body.phone.trim(),
          body.email.trim().toLowerCase(),
          body.postalcode.trim(),
          insurerLabel,
          socialPath,
          statusPath,
          getClientIP(req),
        ]
      );
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'Ya registraste tus datos anteriormente con este correo.' });
      }
      throw err;
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

async function listPublicDataUpdates(req, res, next) {
  try {
    const { page = 1, limit = 20, search, npnName, insurer } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let where = '1=1';
    const params = [];
    if (npnName) { where += ' AND npn_name = ?'; params.push(npnName); }
    if (insurer) { where += ' AND COALESCE(insurer_label, \'oscar\') = ?'; params.push(insurer); }
    if (search) {
      where += ' AND (name LIKE ? OR email LIKE ? OR npn_name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const [rows] = await db.query(
      `SELECT id, npn_name, npn_code, name, phone, email, postalcode,
              COALESCE(insurer_label, 'oscar') AS insurer,
              social_path IS NOT NULL AS has_social_photo,
              status_path IS NOT NULL AS has_status_photo,
              created_at
       FROM public_data_updates
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM public_data_updates WHERE ${where}`,
      params
    );

    res.json({ data: rows, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    next(err);
  }
}

const PHOTO_MIME_BY_EXT = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
};

async function getPublicDataUpdatePhoto(req, res, next) {
  try {
    const { id, type } = req.params;
    if (!['social', 'status'].includes(type)) return res.status(400).json({ error: 'Tipo de foto inválido' });

    const [rows] = await db.query(
      `SELECT social_path, status_path FROM public_data_updates WHERE id = ?`,
      [id]
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

module.exports = { submitPublicDataUpdate, listPublicDataUpdates, getPublicDataUpdatePhoto };
