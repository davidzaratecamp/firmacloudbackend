const express = require('express');
const router = express.Router();
const { getSigningPage, recordView, getDocumentForSigning, submitSignature } = require('../controllers/publicController');

router.get('/:token', getSigningPage);
router.post('/:token/view', recordView);
router.get('/:token/document', getDocumentForSigning);
router.post('/:token/sign', submitSignature);

module.exports = router;
