import dotenv from 'dotenv';
import logger from './utils/logger.js';
dotenv.config();

const required = [
  'KEYCLOAK_ISSUER',
];
// In production, FRONTEND_URL must be set explicitly so CORS never silently
// falls back to the localhost dev origin (see server.js cors config).
if (process.env.NODE_ENV === 'production') {
  required.push('FRONTEND_URL');
}
const missing = required.filter(k => !process.env[k]);
if (missing.length) {
  logger.error(`❌ Missing required env vars: ${missing.join(', ')}`);
  process.exit(1);
}

import('./server.js');
