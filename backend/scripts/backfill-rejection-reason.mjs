/**
 * One-shot: copy each rejected submission's most recent public "rejection"
 * curation note into `submissions.doc.rejectionReason`.
 *
 * The Curation & Activity tab (and its notes feed) is temporarily hidden, and
 * the tracker's "Submission progress" card now reads the reason straight off
 * the submission document instead of fetching the curation record. Studies
 * that were rejected before this change have their reason sitting in
 * `curation_notes` only, so without this backfill they fall back to the
 * generic "Rejected" status text.
 *
 *   Usage:  node --env-file=.env scripts/backfill-rejection-reason.mjs [--commit]
 *
 * Dry by default: prints exactly what it would write and changes nothing. Pass
 * --commit to write. Idempotent — a submission that already has
 * doc.rejectionReason set is left untouched, so it is safe to re-run.
 */

import 'dotenv/config';
import { initializeDatabases, closeDatabases } from '../src/db/index.js';
import { listSubmissions, getSubmission, saveSubmission } from '../src/db/submissions.js';
import { listNotes } from '../src/db/curationRecord.js';

const COMMIT = process.argv.includes('--commit');
const REJECTED_STATUSES = new Set(['Rejected', 'Not Curatable', 'Missing Data']);

async function main() {
  await initializeDatabases();

  const submissions = await listSubmissions();
  let planned = 0;
  let skipped = 0;
  const touched = [];

  for (const sub of submissions) {
    const isRejected = REJECTED_STATUSES.has(sub.displayStatus) || REJECTED_STATUSES.has(sub.status);
    if (!isRejected) continue;
    if (typeof sub.rejectionReason === 'string' && sub.rejectionReason.trim()) {
      skipped++;
      continue;
    }

    const notes = await listNotes(sub.id, { includeInternal: false }).catch(() => []);
    const reasonNote = [...notes]
      .reverse()
      .find(note => note.kind === 'rejection' && typeof note.body === 'string' && note.body.trim());
    if (!reasonNote) {
      skipped++;
      continue;
    }

    planned++;
    touched.push({ id: sub.id, title: sub.studyName || sub.paperTitle || sub.id, reason: reasonNote.body.trim() });

    if (COMMIT) {
      const fresh = await getSubmission(sub.id);
      if (fresh && !(typeof fresh.rejectionReason === 'string' && fresh.rejectionReason.trim())) {
        fresh.rejectionReason = reasonNote.body.trim();
        fresh.updatedAt = new Date().toISOString();
        await saveSubmission(sub.id, fresh);
      }
    }
  }

  console.log(`${COMMIT ? 'Committed' : 'Planned'} ${planned} update(s), skipped ${skipped}.`);
  for (const t of touched) {
    console.log(`  - ${t.id} (${t.title}): ${JSON.stringify(t.reason)}`);
  }
  if (!COMMIT && planned) {
    console.log('\nDry run only — re-run with --commit to write these changes.');
  }

  await closeDatabases();
}

main().catch(async (error) => {
  console.error('Backfill failed:', error);
  await closeDatabases().catch(() => {});
  process.exit(1);
});
