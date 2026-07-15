const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { listAgents, createAgent, updateAgent } = require('../controllers/agentController');

// Gestión de agentes — solo 'admin' (lista vacía = requireRole solo deja pasar el bypass de admin)
router.use(auth, requireRole());

router.get('/', listAgents);
router.post('/', createAgent);
router.patch('/:id', updateAgent);

module.exports = router;
