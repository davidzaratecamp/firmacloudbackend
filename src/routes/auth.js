const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { login, me } = require('../controllers/authController');
const auth = require('../middleware/auth');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de acceso. Intenta en 15 minutos.' },
});

router.post('/login', loginLimiter, login);
router.get('/me', auth, me);

module.exports = router;
