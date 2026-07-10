const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const auth = require('../middleware/auth');
const apiKeyOrAuth = require('../middleware/apiKeyOrAuth');
const { sendDocument, sendDocumentWithData, listSignatures, getSignature, downloadSignedDocument, downloadCertificate, replaceSignedDocument, getDashboardStats, deleteSignature } = require('../controllers/signatureController');

const uploadPdf = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: (parseInt(process.env.SIGNATURE_REPLACE_MAX_SIZE_MB) || 20) * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, path.extname(file.originalname).toLowerCase() === '.pdf'),
});

router.post('/send', apiKeyOrAuth, sendDocument);
router.post('/send-with-data', apiKeyOrAuth, sendDocumentWithData);

// Specific named routes MUST come before /:id to avoid being swallowed by the param matcher
router.get('/dashboard', auth, getDashboardStats);
router.get('/', auth, listSignatures);

// Param routes — accept JWT or X-Api-Key (intranet integration)
router.get('/:id/download', apiKeyOrAuth, downloadSignedDocument);
router.get('/:id/certificate', apiKeyOrAuth, downloadCertificate);
router.put('/:id/replace-signed', auth, uploadPdf.single('file'), replaceSignedDocument);
router.get('/:id', apiKeyOrAuth, getSignature);
router.delete('/:id', auth, deleteSignature);

module.exports = router;
