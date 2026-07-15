const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const auth = require('../middleware/auth');
const apiKeyOrAuth = require('../middleware/apiKeyOrAuth');
const requireRole = require('../middleware/requireRole');
const {
  createOleada, listOleadas, getDailyUsage, getOleadaDetail, listOleadaRecipients,
  sendOleadaNow, retryFailedRecipients, deleteFailedRecipients, pauseOleada, resumeOleada, cancelOleada,
} = require('../controllers/oleadaController');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: (parseInt(process.env.OLEADA_UPLOAD_MAX_SIZE_MB) || 5) * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.csv', '.xlsx', '.xls'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

// Módulo NPN de actualización de datos — solo 'agent' (legado) o 'correo_datos' (admin siempre pasa)
const requireCorreoAccess = requireRole('agent', 'correo_datos');

router.post('/', auth, requireCorreoAccess, upload.single('file'), createOleada);

// Named sub-routes MUST come before /:id
router.get('/daily-usage', auth, requireCorreoAccess, getDailyUsage);
router.post('/:id/send-now', apiKeyOrAuth, requireCorreoAccess, sendOleadaNow);
router.patch('/:id/retry-failed', auth, requireCorreoAccess, retryFailedRecipients);
router.delete('/:id/failed', auth, requireCorreoAccess, deleteFailedRecipients);
router.patch('/:id/pause', auth, requireCorreoAccess, pauseOleada);
router.patch('/:id/resume', auth, requireCorreoAccess, resumeOleada);
router.patch('/:id/cancel', auth, requireCorreoAccess, cancelOleada);
router.get('/:id/recipients', auth, requireCorreoAccess, listOleadaRecipients);
router.get('/:id', auth, requireCorreoAccess, getOleadaDetail);

router.get('/', auth, requireCorreoAccess, listOleadas);

module.exports = router;
