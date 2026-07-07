const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const apiKeyOrAuth = require('../middleware/apiKeyOrAuth');
const { sendDocument, sendDocumentWithData, listSignatures, getSignature, downloadSignedDocument, downloadCertificate, getDashboardStats, deleteSignature } = require('../controllers/signatureController');

router.post('/send', apiKeyOrAuth, sendDocument);
router.post('/send-with-data', apiKeyOrAuth, sendDocumentWithData);

// Specific named routes MUST come before /:id to avoid being swallowed by the param matcher
router.get('/dashboard', auth, getDashboardStats);
router.get('/', auth, listSignatures);

// Param routes — accept JWT or X-Api-Key (intranet integration)
router.get('/:id/download', apiKeyOrAuth, downloadSignedDocument);
router.get('/:id/certificate', apiKeyOrAuth, downloadCertificate);
router.get('/:id', apiKeyOrAuth, getSignature);
router.delete('/:id', auth, deleteSignature);

module.exports = router;
