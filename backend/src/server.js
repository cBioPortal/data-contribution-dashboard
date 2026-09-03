import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { initializeDatabases, closeDatabases } from './db/index.js';
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import submitRoutes from './routes/submitRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';
import logger from './utils/logger.js';

const app = express();

// Requests arrive through the Traefik ingress, so the socket peer is the proxy,
// not the caller. Without this, req.ip is the same for everybody and the rate
// limiter below collapses into a single global bucket shared by all visitors.
//
// The value is a hop count, deliberately not `true`: trusting the whole
// X-Forwarded-For chain would let a client prepend an arbitrary address and get
// a fresh bucket per request, evading the limit entirely. Raise this only if
// another trusted proxy is added in front.
app.set('trust proxy', 1);

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:8080',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  // Every authenticated request carries an Authorization header, which makes it
  // a non-simple cross-origin request and earns it a preflight. Without this
  // header browsers cache that preflight for only ~5 seconds, so a page issuing
  // several API calls pays the extra round trip on nearly all of them. Ten
  // minutes is long enough to cover a page load and short enough that a change
  // to the methods/headers above reaches clients quickly.
  maxAge: 600,
}));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
// Rate limiter — higher limit in development, stricter in production
// Public read-only endpoints are exempt (see below)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 200 : 1000,
  standardHeaders: true,
  legacyHeaders: false,
});
// Apply to all API routes except the public submissions endpoint
app.use('/api/', (req, res, next) => {
  if (req.path === '/submit/public') return next();
  limiter(req, res, next);
});

// Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'success', timestamp: new Date().toISOString() });
});
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/submit', submitRoutes);
app.use('/api/analytics', analyticsRoutes);

// 404
app.use((req, res) => {
  res.status(404).json({ status: 'error', message: `Route ${req.originalUrl} not found` });
});

// Error handler
app.use((err, req, res, next) => {
  logger.error('Error:', err);
  const message = process.env.NODE_ENV === 'production' ? 'Something went wrong!' : err.message;
  res.status(err.statusCode || 500).json({
    status: 'error',
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

const PORT = process.env.PORT || 5001;

async function startServer() {
  try {
    await initializeDatabases();
    app.listen(PORT, () => {
      logger.info(`🚀 Server running on http://localhost:${PORT} [${process.env.NODE_ENV || 'development'}]`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

async function shutdown() {
  logger.info('\n🛑 Shutting down...');
  try {
    await closeDatabases();
    process.exit(0);
  } catch {
    process.exit(1);
  }
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('unhandledRejection', (err) => { logger.error('Unhandled Rejection:', err); shutdown(); });

startServer();
export default app;
