const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const apiKeyOrAuth = require('../middleware/apiKeyOrAuth');
const { sendCarta, listCartas, exportCartas, getCartaDetail, downloadSignedCarta } = require('../controllers/cartaController');

router.post('/send', apiKeyOrAuth, sendCarta);

// Named sub-routes MUST come before /:id
router.get('/export', auth, exportCartas);
router.get('/:id/download', apiKeyOrAuth, downloadSignedCarta);
router.get('/:id', apiKeyOrAuth, getCartaDetail);

router.use(auth);
router.get('/', listCartas);

module.exports = router;
