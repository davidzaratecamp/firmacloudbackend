const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const apiKeyOrAuth = require('../middleware/apiKeyOrAuth');
const requireRole = require('../middleware/requireRole');
const { sendCarta, listCartas, exportCartas, getCartaDetail, getCartaPhoto, downloadSignedCarta, deleteCarta } = require('../controllers/cartaController');

// Módulo NPN de actualización de datos — solo 'agent' (legado) o 'correo_datos' (admin siempre pasa)
const requireCorreoAccess = requireRole('agent', 'correo_datos');

router.post('/send', apiKeyOrAuth, requireCorreoAccess, sendCarta);

// Named sub-routes MUST come before /:id
router.get('/export', auth, requireCorreoAccess, exportCartas);
router.get('/:id/download', apiKeyOrAuth, requireCorreoAccess, downloadSignedCarta);
router.get('/:id/photo/:type', apiKeyOrAuth, requireCorreoAccess, getCartaPhoto);
router.get('/:id', apiKeyOrAuth, requireCorreoAccess, getCartaDetail);
router.delete('/:id', auth, requireCorreoAccess, deleteCarta);

router.use(auth, requireCorreoAccess);
router.get('/', listCartas);

module.exports = router;
