const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const auth = require('../middleware/auth');
const hydraApiKeyOrAuth = require('../middleware/hydraApiKeyOrAuth');
const requireRole = require('../middleware/requireRole');
const {
  sendCandidato, listCandidatos, getCandidato, downloadCv, downloadTratamiento, firmarPsicologo,
} = require('../controllers/reclutamientoController');

const uploadPdfs = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: (parseInt(process.env.RECLUTAMIENTO_UPLOAD_MAX_SIZE_MB) || 20) * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, path.extname(file.originalname).toLowerCase() === '.pdf'),
});

// Módulo Reclutamiento — solo rol 'reclutamiento' (admin siempre pasa).
const requireReclutamientoAccess = requireRole('reclutamiento');

router.post(
  '/send',
  hydraApiKeyOrAuth,
  requireReclutamientoAccess,
  uploadPdfs.fields([{ name: 'cvFile', maxCount: 1 }, { name: 'tratamientoFile', maxCount: 1 }]),
  sendCandidato
);

// Named sub-routes MUST come before /:id
router.get('/:id/download/cv', hydraApiKeyOrAuth, requireReclutamientoAccess, downloadCv);
router.get('/:id/download/tratamiento', hydraApiKeyOrAuth, requireReclutamientoAccess, downloadTratamiento);
// Firma de selección/administrador sobre la hoja de vida ya firmada por el candidato — Hydra
// llama con HYDRA_API_KEY (nunca con la credencial individual de su usuario); la identidad de
// quien firma viaja como dato en el body (firmadoPor), no como autenticación.
router.post('/:id/firmar-psicologo', hydraApiKeyOrAuth, requireReclutamientoAccess, firmarPsicologo);
router.get('/:id', hydraApiKeyOrAuth, requireReclutamientoAccess, getCandidato);

router.get('/', auth, requireReclutamientoAccess, listCandidatos);

module.exports = router;
