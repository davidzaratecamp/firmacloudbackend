const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const signaturesRoutes = require('./routes/signatures');
const publicRoutes = require('./routes/public');
const webhookRoutes = require('./routes/webhook');
const cartasRoutes = require('./routes/cartas');
const publicFormRoutes = require('./routes/publicForm');
const trackingRoutes = require('./routes/tracking');
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

// Global rate limit
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false }));

app.use('/api/auth', authRoutes);
app.use('/api/signatures', signaturesRoutes);
app.use('/api/sign', publicRoutes);
app.use('/api/webhook/whatsapp', webhookRoutes);
app.use('/api/cartas', cartasRoutes);
app.use('/api/formulario', publicFormRoutes);
app.use('/api/tracking', trackingRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.use(errorHandler);

module.exports = app;
