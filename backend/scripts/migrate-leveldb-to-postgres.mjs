/**
 * One-time migration: LevelDB (backend/data) → Postgres.
 *
 * Copies the existing `users` and `submissions` LevelDB stores into the
 * Postgres tables created by schema.sql. Idempotent — re-running skips rows
 * that already exist (ON CONFLICT (id) DO NOTHING), so it's safe to run again.
 *
 * The on-disk LevelDB data is only READ; nothing is deleted, so it remains a
 * fallback until you're confident in the migration.
 *
 *   Usage:  node scripts/migrate-leveldb-to-postgres.mjs
 */

import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import { Level } from 'level';
import { query, initializeDatabases, closeDatabases } from '../src/db/index.js';
import { saveSubmission } from '../src/db/submissions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../data');

async function migrateUsers() {
  const db = new Level(path.join(DATA_DIR, 'users'), { valueEncoding: 'json' });
  await db.open();
  let migrated = 0;
  let skipped = 0;
  try {
    for await (const [key, u] of db.iterator()) {
      const id = u.id || key;
      const res = await query(
        `INSERT INTO users (id, email, name, institution, role, provider, provider_id, created_at, last_login, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7, COALESCE($8, now()), $9, COALESCE($10, now()))
         ON CONFLICT (id) DO NOTHING`,
        [
          id,
          (u.email || '').toLowerCase(),
          u.name || '',
          u.institution || '',
          u.role || 'user',
          u.provider || null,
          u.providerId || null,
          u.createdAt || null,
          u.lastLogin || null,
          u.updatedAt || null,
        ]
      );
      if (res.rowCount === 1) migrated++; else skipped++;
    }
  } finally {
    await db.close();
  }
  console.log(`👤 users: ${migrated} migrated, ${skipped} already present`);
}

async function migrateSubmissions() {
  const db = new Level(path.join(DATA_DIR, 'submissions'), { valueEncoding: 'json' });
  await db.open();
  let migrated = 0;
  let skipped = 0;
  try {
    for await (const [key, sub] of db.iterator()) {
      const id = sub.id || key;
      // Skip if already there (keep migration idempotent without overwriting)
      const exists = await query('SELECT 1 FROM submissions WHERE id = $1', [id]);
      if (exists.rowCount) { skipped++; continue; }
      await saveSubmission(id, { ...sub, id });
      migrated++;
    }
  } finally {
    await db.close();
  }
  console.log(`📦 submissions: ${migrated} migrated, ${skipped} already present`);
}

async function main() {
  console.log('🔄 Migrating LevelDB → Postgres ...');
  await initializeDatabases(); // ensure tables exist
  await migrateUsers();
  await migrateSubmissions();
  console.log('✅ Migration complete');
}

main()
  .catch((err) => {
    console.error('❌ Migration failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabases().catch(() => {});
  });
