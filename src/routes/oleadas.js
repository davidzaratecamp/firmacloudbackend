const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const auth = require('../middleware/auth');
const apiKeyOrAuth = require('../middleware/apiKeyOrAuth');
const {
  createOleada, listOleadas, getOleadaDetail, listOleadaRecipients,
  sendOleadaNow, pauseOleada, resumeOleada, cancelOleada,
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

router.post('/', auth, upload.single('file'), createOleada);

// Named sub-routes MUST come before /:id
router.post('/:id/send-now', apiKeyOrAuth, sendOleadaNow);
router.patch('/:id/pause', auth, pauseOleada);
router.patch('/:id/resume', auth, resumeOleada);
router.patch('/:id/cancel', auth, cancelOleada);
router.get('/:id/recipients', auth, listOleadaRecipients);
router.get('/:id', auth, getOleadaDetail);

router.get('/', auth, listOleadas);

module.exports = router;
