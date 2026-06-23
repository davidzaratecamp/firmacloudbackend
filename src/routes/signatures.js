const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const apiKeyOrAuth = require('../middleware/apiKeyOrAuth');
const { sendDocument, listSignatures, getSignature, downloadSignedDocument, downloadCertificate, getDashboardStats, deleteSignature } = require('../controllers/signatureController');

// POST /send accepts both JWT (panel agents) and X-Api-Key (intranet integration)
router.post('/send', apiKeyOrAuth, sendDocument);

// Download and certificate accept both JWT and API key (intranet integration)
router.get('/:id/download', apiKeyOrAuth, downloadSignedDocument);
router.get('/:id/certificate', apiKeyOrAuth, downloadCertificate);

// All other endpoints require JWT
router.use(auth);
router.get('/dashboard', getDashboardStats);
router.get('/', listSignatures);
router.get('/:id', getSignature);
router.delete('/:id', deleteSignature);

module.exports = router;
