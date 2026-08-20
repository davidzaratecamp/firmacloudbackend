const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const {
  getSigningPage, recordView, getCvDocument, getTratamientoDocument, submitSignature,
} = require('../controllers/reclutamientoPublicController');

const signLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Intenta más tarde.' },
});

router.get('/:token', getSigningPage);
router.post('/:token/view', recordView);
router.get('/:token/cv', getCvDocument);
router.get('/:token/tratamiento', getTratamientoDocument);
router.post('/:token/sign', signLimiter, submitSignature);

module.exports = router;
