/**
 * One-shot: create the application database on a Postgres server.
 *
 * Connects to the server's default `postgres` database, because CREATE DATABASE
 * must be issued from a connection to some *other* database on the same server.
 * Idempotent — skips creation if the database already exists.
 *
 *   Usage:  NEW_DB=dashboard node -r dotenv/config scripts/create-db.mjs
 *
 * Reads PGHOST / PGPORT / PGUSER / PGPASSWORD / PGSSLROOTCERT from backend/.env.
 * PGDATABASE is deliberately ignored; this always connects to `postgres`.
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.join(__dirname, '../');

const NEW_DB = process.env.NEW_DB || 'dashboard';

const certName = process.env.PGSSLROOTCERT;
if (!certName) {
  console.error('❌ Refusing to connect without PGSSLROOTCERT (path to the CA cert).');
  process.exit(1);
}
const certPath = path.isAbsolute(certName) ? certName : path.join(BACKEND_ROOT, certName);

const client = new pg.Client({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT) || 5432,
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD,
  database: 'postgres',
  ssl: { ca: fs.readFileSync(certPath, 'utf8'), rejectUnauthorized: true },
});

await client.connect();
console.log(`✅ Connected to ${process.env.PGHOST} (database: postgres)`);

const { rows } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [NEW_DB]);
if (rows.length > 0) {
  console.log(`ℹ️  Database "${NEW_DB}" already exists — nothing to do.`);
} else {
  await client.query(`CREATE DATABASE ${pg.escapeIdentifier(NEW_DB)}`);
  console.log(`✅ Created database "${NEW_DB}".`);
}

const all = await client.query(
  'SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname'
);
console.log('📋 Databases on this server:', all.rows.map((r) => r.datname).join(', '));

await client.end();
