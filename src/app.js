const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const apiRateLimit = require('./middleware/apiRateLimit');

const authRoutes = require('./routes/auth');
const signaturesRoutes = require('./routes/signatures');
const publicRoutes = require('./routes/public');
const webhookRoutes = require('./routes/webhook');
const cartasRoutes = require('./routes/cartas');
const publicFormRoutes = require('./routes/publicForm');
const publicDataUpdateRoutes = require('./routes/publicDataUpdate');
const trackingRoutes = require('./routes/tracking');
const oleadasRoutes = require('./routes/oleadas');
const agentsRoutes = require('./routes/agents');
const hrContractsRoutes = require('./routes/hrContracts');
const hrPublicRoutes = require('./routes/hrPublic');
const reclutamientoRoutes = require('./routes/reclutamiento');
const reclutamientoPublicRoutes = require('./routes/reclutamientoPublic');
const beemoRoutes = require('./routes/beemo');
const beemoPublicRoutes = require('./routes/beemoPublic');
const errorHandler = require('./middleware/errorHandler');

const app = express();

app.set('trust proxy', 1);

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  frameguard: false,        // allow PDFs to load in iframes from the frontend
  contentSecurityPolicy: false, // frontend handles its own CSP
}));
const isDev = process.env.NODE_ENV !== 'production';

const allowedOrigins = [
  process.env.APP_URL,
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  ...(process.env.CORS_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean),
].filter(Boolean);

app.use(cors({
  // En desarrollo se permite cualquier origen para facilitar pruebas por IP local.
  origin: (origin, cb) => cb(null, isDev || !origin || allowedOrigins.includes(origin)),
  credentials: true,
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limit: cupo separado por identidad (API key / JWT) en vez de por IP para tráfico
// autenticado — ver src/middleware/apiRateLimit.js (evita que una intranet completa detrás
// de un NAT comparta un solo cupo de 200 req/15min).
app.use(apiRateLimit);

app.use('/api/auth', authRoutes);
app.use('/api/signatures', signaturesRoutes);
app.use('/api/sign', publicRoutes);
app.use('/api/webhook/whatsapp', webhookRoutes);
app.use('/api/cartas', cartasRoutes);
app.use('/api/formulario', publicFormRoutes);
app.use('/api/actualizacion-datos', publicDataUpdateRoutes);
app.use('/api/tracking', trackingRoutes);
app.use('/api/oleadas', oleadasRoutes);
app.use('/api/agents', agentsRoutes);
app.use('/api/rrhh/contratos', hrContractsRoutes);
app.use('/api/rrhh-sign', hrPublicRoutes);
app.use('/api/reclutamiento', reclutamientoRoutes);
app.use('/api/reclutamiento-sign', reclutamientoPublicRoutes);
app.use('/api/beemo', beemoRoutes);
app.use('/api/beemo-sign', beemoPublicRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.use(errorHandler);

module.exports = app;
