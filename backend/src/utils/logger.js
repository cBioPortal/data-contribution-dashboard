/**
 * Minimal levelled logger.
 *
 * Replaces bare console.* calls so output can be filtered per environment
 * rather than always-on. Levels are ordered; anything below LOG_LEVEL is
 * dropped. Defaults to `debug` in development and `info` in production, so
 * request-level chatter stays out of production logs without code changes.
 *
 * Each line is prefixed with an ISO timestamp and level, which is what log
 * shippers (CloudWatch, Loki) key on. Deliberately dependency-free — this is
 * the only logging the service needs.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

const configured = (process.env.LOG_LEVEL || '').toLowerCase();
const fallback = process.env.NODE_ENV === 'production' ? 'info' : 'debug';
const threshold = LEVELS[configured] ?? LEVELS[fallback];

function emit(level, sink, args) {
  if (LEVELS[level] < threshold) return;
  sink(`${new Date().toISOString()} [${level.toUpperCase()}]`, ...args);
}

export const logger = {
  debug: (...args) => emit('debug', console.log, args),
  info: (...args) => emit('info', console.log, args),
  warn: (...args) => emit('warn', console.warn, args),
  error: (...args) => emit('error', console.error, args),
};

export default logger;
