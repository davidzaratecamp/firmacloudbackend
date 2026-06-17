const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { getSigningPage, recordView, getDocumentForSigning, submitSignature } = require('../controllers/publicController');

const signLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Intenta más tarde.' },
});

router.get('/:token', getSigningPage);
router.post('/:token/view', recordView);
router.get('/:token/document', getDocumentForSigning);
router.post('/:token/sign', signLimiter, submitSignature);

module.exports = router;
