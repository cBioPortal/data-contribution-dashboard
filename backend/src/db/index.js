/**
 * Database Setup — Postgres (app data) + ClickHouse HTTP Client (genomics)
 *
 * App operational data (users, submissions) lives in Postgres, accessed via a
 * pooled `pg` connection. The read-only genomics analytics still use ClickHouse
 * over its HTTP interface (unchanged).
 */

import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// backend/ root (this file is at backend/src/db/index.js)
const BACKEND_ROOT = path.join(__dirname, '../../');

// ─── Lightweight ClickHouse HTTP client (genomics analytics — unchanged) ─────
const CH_HOST = process.env.CLICKHOUSE_HOST || '';
const CH_PORT = process.env.CLICKHOUSE_PORT || '';
const CH_USER = process.env.CLICKHOUSE_USERNAME || 'default';
const CH_PASS = process.env.CLICKHOUSE_PASSWORD || '';
const CH_DB = process.env.CLICKHOUSE_DATABASE || '';

// Build base URL from CLICKHOUSE_HOST (no hardcoded fallback). If it isn't set,
// CH_URL stays empty and queries throw a clear error when actually used, so the
// rest of the app still boots without ClickHouse configured.
let CH_URL = '';
if (CH_HOST) {
  const _chBase = new URL(CH_HOST);
  if (CH_PORT) _chBase.port = CH_PORT;
  CH_URL = _chBase.toString();
}

/**
 * Minimal ClickHouse client that matches the subset of the official API
 * used in this project: clickhouseClient.query({ query, format }) → .json()
 */
export const clickhouseClient = {
  query: async ({ query, format = 'JSONEachRow' }) => {
    if (!CH_URL) throw new Error('ClickHouse is not configured — set CLICKHOUSE_HOST.');
    const url = new URL('/', CH_URL);
    if (CH_DB) url.searchParams.set('database', CH_DB);
    // Append FORMAT to the SQL so ClickHouse returns the right shape
    const fullQuery = `${query.trim().replace(/;$/, '')} FORMAT ${format}`;

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'Authorization': 'Basic ' + Buffer.from(`${CH_USER}:${CH_PASS}`).toString('base64'),
      },
      body: fullQuery,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`ClickHouse HTTP error ${response.status}: ${errorBody}`);
    }

    const text = await response.text();

    return {
      /** Parse the response as JSON. For JSONEachRow, each line is a JSON object. */
      json: () => {
        if (!text.trim()) return [];
        if (format === 'JSONEachRow') {
          return text.trim().split('\n').map(line => JSON.parse(line));
        }
        // For other formats (e.g. JSON), parse the whole thing
        return JSON.parse(text);
      },
    };
  },
};

// ─── Postgres connection pool (app data) ─────────────────────────────────────

/**
 * Build the SSL config for the pool. node-pg does NOT honor PGSSLMODE /
 * PGSSLROOTCERT from the environment the way libpq does, so we apply them here.
 * - If PGSSLROOTCERT is set, verify against that CA (verify-full behaviour).
 * - Else if an SSL mode other than 'disable' is requested, encrypt without
 *   certificate verification.
 * - Else (e.g. local dev) disable SSL.
 */
function buildSslConfig() {
  const certName = process.env.PGSSLROOTCERT;
  const mode = (process.env.PGSSLMODE || '').toLowerCase();

  if (certName) {
    const certPath = path.isAbsolute(certName) ? certName : path.join(BACKEND_ROOT, certName);
    return {
      ca: fs.readFileSync(certPath, 'utf8'),
      rejectUnauthorized: true,
    };
  }
  if (mode && mode !== 'disable') {
    return { rejectUnauthorized: false };
  }
  return false;
}

const { Pool } = pg;

export const pool = new Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT) || 5432,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  ssl: buildSslConfig(),
  max: Number(process.env.PG_POOL_MAX) || 10,
});

pool.on('error', (err) => {
  console.error('❌ Unexpected Postgres pool error:', err);
});

/** Run a parameterized query against the pool. */
export function query(text, params) {
  return pool.query(text, params);
}

/**
 * Initialize the database: ensure the app schema exists. Safe to run on every
 * boot (CREATE TABLE IF NOT EXISTS). Also verifies connectivity early.
 */
export async function initializeDatabases() {
  try {
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await pool.query(schema);
    console.log(`✅ Postgres connected & schema ready (db: ${process.env.PGDATABASE} @ ${process.env.PGHOST})`);
  } catch (error) {
    console.error('❌ Failed to initialize Postgres:', error);
    throw error;
  }
}

/** Close the connection pool. */
export async function closeDatabases() {
  try {
    await pool.end();
    console.log('✅ Postgres pool closed');
  } catch (error) {
    console.error('❌ Failed to close Postgres pool:', error);
    throw error;
  }
}

export default {
  pool,
  query,
  clickhouseClient,
  initializeDatabases,
  closeDatabases,
};
