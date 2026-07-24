const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const auth = require('../middleware/auth');
const apiKeyOrAuth = require('../middleware/apiKeyOrAuth');
const requireRole = require('../middleware/requireRole');
const { sendDocument, listContracts, getContract, downloadSignedContract, deleteContract } = require('../controllers/hrContractController');

const uploadPdf = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: (parseInt(process.env.HR_UPLOAD_MAX_SIZE_MB) || 20) * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, path.extname(file.originalname).toLowerCase() === '.pdf'),
});

// Módulo RRHH de contratos laborales — solo 'agent' (legado) o 'rrhh' (admin siempre pasa)
const requireHrAccess = requireRole('agent', 'rrhh');

router.post('/send', apiKeyOrAuth, requireHrAccess, uploadPdf.single('file'), sendDocument);

// Named sub-routes MUST come before /:id
router.get('/:id/download', apiKeyOrAuth, requireHrAccess, downloadSignedContract);
router.get('/:id', apiKeyOrAuth, requireHrAccess, getContract);
router.delete('/:id', auth, requireHrAccess, deleteContract);

router.get('/', auth, requireHrAccess, listContracts);

module.exports = router;
