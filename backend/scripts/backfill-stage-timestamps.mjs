/**
 * One-shot: give existing submissions a `stageTimestamps` map so the tracker's
 * flow diagram can show a date under every stage it has already passed.
 *
 * `stageTimestamps` only exists going forward — it is written on submission and
 * on every status update (see recordStageTimestamps in utils/pipelineStages.js).
 * Submissions created before that change have none, and there is no real record
 * of when each jumped stage was reached, so this assigns plausible ones instead:
 * an increasing, randomly-spaced date per stage between the submission date and
 * its last update (or now, if never updated), so the diagram never looks broken
 * for old data. New submissions are unaffected — see COMMIT/dry-run notes below.
 *
 *   Usage:  node --env-file=.env scripts/backfill-stage-timestamps.mjs [--commit]
 *
 * Dry by default: prints exactly what it would set and changes nothing. Pass
 * --commit to write. Idempotent — a stage that already has a timestamp (real or
 * from a previous run of this script) is left alone, so re-running only fills in
 * whatever is still missing.
 */

import 'dotenv/config';
import { initializeDatabases, closeDatabases } from '../src/db/index.js';
import { listSubmissions, saveSubmission } from '../src/db/submissions.js';
import { getMappedStage, NORMAL_FLOW_STAGES, REJECTED_FLOW_STAGES } from '../src/utils/pipelineStages.js';

const COMMIT = process.argv.includes('--commit');

/** Sorted, strictly increasing random instants between start and end (inclusive). */
function randomTimestampsBetween(count, startMs, endMs) {
  if (count <= 0) return [];
  if (count === 1) return [startMs];
  if (endMs <= startMs) return Array(count).fill(startMs);

  const points = [startMs];
  for (let i = 1; i < count - 1; i++) {
    points.push(startMs + Math.random() * (endMs - startMs));
  }
  points.push(endMs);
  points.sort((a, b) => a - b);
  return points;
}

async function main() {
  await initializeDatabases();

  const submissions = await listSubmissions();
  let planned = 0;
  const touched = [];

  for (const sub of submissions) {
    const stage = getMappedStage(sub);
    if (!stage) continue;

    const flow = stage === 'Rejected' ? REJECTED_FLOW_STAGES : NORMAL_FLOW_STAGES;
    const targetLabel = stage;
    const targetIndex = flow.indexOf(targetLabel);
    if (targetIndex < 0) continue;

    const existing = { ...(sub.stageTimestamps || {}) };
    const missingIndexes = [];
    for (let i = 0; i <= targetIndex; i++) {
      if (!existing[flow[i]]) missingIndexes.push(i);
    }
    if (!missingIndexes.length) continue;

    const startMs = new Date(sub.submittedAt || sub.createdAt || Date.now()).getTime();
    const endMs = new Date(sub.statusUpdatedAt || sub.updatedAt || Date.now()).getTime();
    const fillTimes = randomTimestampsBetween(missingIndexes.length, startMs, endMs);

    missingIndexes.forEach((flowIndex, i) => {
      existing[flow[flowIndex]] = new Date(fillTimes[i]).toISOString();
    });

    planned += missingIndexes.length;
    touched.push({ id: sub.id, count: missingIndexes.length, stage, title: sub.paperTitle || sub.studyName || '' });

    if (COMMIT) {
      await saveSubmission(sub.id, { ...sub, stageTimestamps: existing });
    }
  }

  console.log(`\n${COMMIT ? 'Backfilled' : 'Would backfill'} ${planned} stage timestamp(s) across ${touched.length} submission(s).`);
  for (const t of touched) {
    console.log(`  ${t.id}  ${String(t.count).padStart(2)} stage(s)  currently at "${t.stage}"  ${t.title.slice(0, 48)}`);
  }
  if (!COMMIT) console.log('\nDry run. Re-run with --commit to write.');

  await closeDatabases();
}

main().catch(async (err) => {
  console.error('Backfill failed:', err);
  await closeDatabases().catch(() => {});
  process.exit(1);
});
