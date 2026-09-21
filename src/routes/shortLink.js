const express = require('express');
const router = express.Router();
const { resolveShortLink } = require('../controllers/publicController');

// GET /api/s/:code — enlace corto que usa el canal SMS (ver smsService.js).
router.get('/:code', resolveShortLink);

module.exports = router;
