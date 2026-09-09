const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const {
  sendDocument, listDocuments, getDocument, downloadSignedDocument, deleteDocument, resendDocument, getStats, getTemplateFields, previewTemplate,
} = require('../controllers/beemoController');

const uploadPdf = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: (parseInt(process.env.BEEMO_UPLOAD_MAX_SIZE_MB) || 20) * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, path.extname(file.originalname).toLowerCase() === '.pdf'),
});

// Módulo nuevo sin legado que preservar: solo 'beemo' (admin siempre pasa vía requireRole)
const requireBeemoAccess = requireRole('beemo');

router.post('/enviar', auth, requireBeemoAccess, uploadPdf.single('file'), sendDocument);
router.get('/stats', auth, requireBeemoAccess, getStats);           // antes de /:id
router.get('/plantilla', auth, requireBeemoAccess, getTemplateFields); // antes de /:id
router.post('/plantilla/preview', auth, requireBeemoAccess, previewTemplate); // antes de /:id
router.get('/:id/download', auth, requireBeemoAccess, downloadSignedDocument);
router.post('/:id/reenviar', auth, requireBeemoAccess, resendDocument);
router.get('/:id', auth, requireBeemoAccess, getDocument);
router.delete('/:id', auth, requireBeemoAccess, deleteDocument);
router.get('/', auth, requireBeemoAccess, listDocuments);

module.exports = router;
