const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const {
  submitPublicDataUpdate, listPublicDataUpdates, getPublicDataUpdatePhoto,
} = require('../controllers/publicDataUpdateController');

// Módulo NPN de actualización de datos — mismo gate que Cartas/Oleadas
const requireCorreoAccess = requireRole('agent', 'correo_datos');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, process.env.FORM_UPLOADS_DIR || path.join(__dirname, '../../form-uploads'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `${uuidv4()}-${file.fieldname}${ext}`);
  },
});

const MAX_PHOTO_SIZE_MB = 10;

const upload = multer({
  storage,
  limits: { fileSize: MAX_PHOTO_SIZE_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
    cb(null, allowed.includes(file.mimetype));
  },
});

const uploadFields = upload.fields([
  { name: 'social',            maxCount: 1 },
  { name: 'status_migratorio', maxCount: 1 },
]);

function handlePhotoUpload(req, res, next) {
  uploadFields(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: `La imagen es muy grande (máx. ${MAX_PHOTO_SIZE_MB}MB). Intenta con una foto más liviana.` });
    }
    return res.status(400).json({ error: 'No se pudo procesar la imagen. Verifica el formato (JPG, PNG o WEBP).' });
  });
}

const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Intenta más tarde.' },
});

// Público — sin auth, cualquiera puede enviarlo (solo una vez por email, ver controller)
router.post('/submit', submitLimiter, handlePhotoUpload, submitPublicDataUpdate);

// Panel interno — mismos roles que Cartas/Oleadas
router.get('/:id/photo/:type', auth, requireCorreoAccess, getPublicDataUpdatePhoto);
router.get('/', auth, requireCorreoAccess, listPublicDataUpdates);

module.exports = router;
