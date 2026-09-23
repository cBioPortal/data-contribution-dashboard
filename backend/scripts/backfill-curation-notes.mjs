/**
 * One-shot: move curation and submitter notes out of `submissions.doc` and into
 * the `curation_notes` table.
 *
 * Notes used to live as two arrays on the submission document —
 * `curationNotesArray` (the curation team) and `submitterNotes` (the submitter).
 * They now have their own rows, so each note can be addressed, retracted and
 * anchored to a pipeline stage without rewriting the whole submission.
 *
 *   Usage:  node --env-file=.env scripts/backfill-curation-notes.mjs [--commit]
 *
 * Dry by default: prints exactly what it would insert and changes nothing. Pass
 * --commit to write. Idempotent either way — a submission that already has rows
 * in curation_notes is skipped, so re-running after a partial failure is safe.
 *
 * The source arrays are deliberately left on the document. Reading them stops
 * the moment the API switches over, and leaving them means this can be re-run,
 * and the old data inspected, until everyone is confident.
 */

import 'dotenv/config';
import { initializeDatabases, closeDatabases, query } from '../src/db/index.js';
import { listSubmissions } from '../src/db/submissions.js';
import { addNote } from '../src/db/curationRecord.js';
import { findUserByEmail } from '../src/db/users.js';

const COMMIT = process.argv.includes('--commit');

/**
 * Which pipeline stage a historic note belongs to.
 *
 * The old notes carry no stage — they predate the idea — and there is no history
 * of status changes to reconstruct one from. Anchoring them all to the
 * submission's current status would be a guess dressed as a fact, so they are
 * left unanchored and the UI groups them under "Earlier notes".
 */
const HISTORIC_STAGE = null;

/** Resolve a note's `addedBy` email to a user id, if we have that account. */
async function resolveAuthor(email, cache) {
  if (!email || !email.includes('@')) return null;
  const key = email.toLowerCase();
  if (key in cache) return cache[key];
  const user = await findUserByEmail(key).catch(() => null);
  cache[key] = user?.id ?? null;
  return cache[key];
}

async function main() {
  await initializeDatabases();

  const submissions = await listSubmissions();
  const authorCache = {};
  let planned = 0;
  let skipped = 0;
  const touched = [];

  for (const sub of submissions) {
    const curation = Array.isArray(sub.curationNotesArray) ? sub.curationNotesArray : [];
    const submitter = Array.isArray(sub.submitterNotes) ? sub.submitterNotes : [];

    // A single legacy string with no array behind it is still one real note.
    const legacy =
      !curation.length && typeof sub.curationNotes === 'string' && sub.curationNotes.trim()
        ? [{
            text: sub.curationNotes,
            addedAt: sub.curationNotesUpdatedAt || sub.updatedAt,
            addedBy: sub.curationNotesUpdatedBy,
          }]
        : [];

    const incoming = [
      ...[...curation, ...legacy].map((n) => ({ ...n, kind: 'note' })),
      ...submitter.map((n) => ({ ...n, kind: 'submitter' })),
    ].filter((n) => typeof n.text === 'string' && n.text.trim());

    if (!incoming.length) continue;

    const { rows } = await query(
      'SELECT 1 FROM curation_notes WHERE submission_id = $1 LIMIT 1',
      [sub.id],
    );
    if (rows.length) {
      skipped += incoming.length;
      continue;
    }

    touched.push({ id: sub.id, count: incoming.length, title: sub.paperTitle || sub.studyName || '' });

    for (const note of incoming) {
      planned += 1;
      if (!COMMIT) continue;

      await addNote({
        submissionId: sub.id,
        body: note.text,
        stage: HISTORIC_STAGE,
        kind: note.kind,
        // Everything published so far was already visible on the public tracker;
        // marking any of it internal now would retract something people may have
        // already read.
        visibility: 'public',
        authorId: await resolveAuthor(note.addedBy, authorCache),
      });
    }

    // addNote stamps created_at as now(); restore the original timestamps so the
    // log reads in the order things actually happened.
    if (COMMIT) {
      const { rows: inserted } = await query(
        `SELECT id FROM curation_notes WHERE submission_id = $1 ORDER BY created_at ASC`,
        [sub.id],
      );
      for (let i = 0; i < inserted.length && i < incoming.length; i += 1) {
        const when = incoming[i].addedAt;
        if (!when) continue;
        await query('UPDATE curation_notes SET created_at = $2 WHERE id = $1', [
          inserted[i].id,
          new Date(when).toISOString(),
        ]);
      }
    }
  }

  console.log(`\n${COMMIT ? 'Migrated' : 'Would migrate'} ${planned} note(s) across ${touched.length} submission(s).`);
  for (const t of touched) {
    console.log(`  ${t.id}  ${String(t.count).padStart(2)} note(s)  ${t.title.slice(0, 56)}`);
  }
  if (skipped) console.log(`  (${skipped} note(s) skipped — those submissions already have rows)`);
  if (!COMMIT) console.log('\nDry run. Re-run with --commit to write.');

  await closeDatabases();
}

main().catch(async (err) => {
  console.error('Backfill failed:', err);
  await closeDatabases().catch(() => {});
  process.exit(1);
});
