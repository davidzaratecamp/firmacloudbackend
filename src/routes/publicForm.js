const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { validateFormToken, submitForm } = require('../controllers/publicFormController');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, process.env.FORM_UPLOADS_DIR || path.join(__dirname, '../../form-uploads'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `${uuidv4()}-${file.fieldname}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB por imagen
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
    cb(null, allowed.includes(file.mimetype));
  },
});

const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Intenta más tarde.' },
});

router.get('/:token', validateFormToken);
router.post(
  '/:token/submit',
  submitLimiter,
  upload.fields([
    { name: 'social',             maxCount: 1 },
    { name: 'status_migratorio',  maxCount: 1 },
  ]),
  submitForm
);

module.exports = router;
