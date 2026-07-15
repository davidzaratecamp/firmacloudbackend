const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const auth = require('../middleware/auth');
const apiKeyOrAuth = require('../middleware/apiKeyOrAuth');
const requireRole = require('../middleware/requireRole');
const { sendDocument, sendDocumentWithData, listSignatures, getSignature, downloadSignedDocument, downloadCertificate, replaceSignedDocument, getDashboardStats, deleteSignature } = require('../controllers/signatureController');

const uploadPdf = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: (parseInt(process.env.SIGNATURE_REPLACE_MAX_SIZE_MB) || 20) * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, path.extname(file.originalname).toLowerCase() === '.pdf'),
});

// Módulo original de firma/tratamiento de datos — solo 'agent' (legado) o 'firma_datos' (admin siempre pasa)
const requireFirmaAccess = requireRole('agent', 'firma_datos');

router.post('/send', apiKeyOrAuth, requireFirmaAccess, sendDocument);
router.post('/send-with-data', apiKeyOrAuth, requireFirmaAccess, sendDocumentWithData);

// Specific named routes MUST come before /:id to avoid being swallowed by the param matcher
router.get('/dashboard', auth, requireFirmaAccess, getDashboardStats);
router.get('/', auth, requireFirmaAccess, listSignatures);

// Param routes — accept JWT or X-Api-Key (intranet integration)
router.get('/:id/download', apiKeyOrAuth, requireFirmaAccess, downloadSignedDocument);
router.get('/:id/certificate', apiKeyOrAuth, requireFirmaAccess, downloadCertificate);
router.put('/:id/replace-signed', auth, requireFirmaAccess, uploadPdf.single('file'), replaceSignedDocument);
router.get('/:id', apiKeyOrAuth, requireFirmaAccess, getSignature);
router.delete('/:id', auth, requireFirmaAccess, deleteSignature);

module.exports = router;
