/**
 * Submission Store (Postgres)
 *
 * Submissions are rich, sparse, evolving documents, so the full object is kept
 * in a JSONB `doc` column. A few fields are promoted into indexed columns for
 * querying; they are derived from the document on every write.
 *
 * The stored document always carries its own `id` (equal to the primary key),
 * so reads return `{ ...doc, id }` to match the previous LevelDB shape exactly.
 */

import { query } from './index.js';

// Pull the promoted/indexed values out of a submission document.
function promoted(doc) {
  return {
    userId: doc.userId ?? null,
    submissionType: doc.submissionType ?? null,
    publicationType: doc.publicationType ?? null,
    status: doc.status ?? null,
    submittedAt: doc.submittedAt ?? null,
  };
}

/**
 * Get a single submission by id.
 * @returns {Promise<Object|null>} the submission document, or null if missing
 */
export async function getSubmission(id) {
  const { rows } = await query('SELECT doc FROM submissions WHERE id = $1', [id]);
  if (!rows.length) return null;
  return { ...rows[0].doc, id };
}

/**
 * List all submissions (full documents). Equivalent to iterating the old
 * LevelDB store; callers filter/sort in memory as before.
 * @returns {Promise<Array<Object>>}
 */
export async function listSubmissions() {
  const { rows } = await query('SELECT id, doc FROM submissions');
  return rows.map((r) => ({ ...r.doc, id: r.id }));
}

/**
 * Insert or update a submission. The document is stored verbatim (with `id`
 * forced to the key); promoted columns are kept in sync.
 * @returns {Promise<Object>} the stored document
 */
export async function saveSubmission(id, doc) {
  const stored = { ...doc, id };
  const p = promoted(stored);

  await query(
    `INSERT INTO submissions
       (id, user_id, submission_type, publication_type, status, submitted_at, updated_at, doc)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, now()), $8)
     ON CONFLICT (id) DO UPDATE SET
       user_id          = EXCLUDED.user_id,
       submission_type  = EXCLUDED.submission_type,
       publication_type = EXCLUDED.publication_type,
       status           = EXCLUDED.status,
       submitted_at     = EXCLUDED.submitted_at,
       updated_at       = now(),
       doc              = EXCLUDED.doc`,
    [
      id,
      p.userId,
      p.submissionType,
      p.publicationType,
      p.status,
      p.submittedAt,
      stored.updatedAt ?? null,
      stored, // node-pg serializes the object to JSON for the JSONB column
    ]
  );

  return stored;
}

/** Delete a submission by id (no-op if it doesn't exist). */
export async function removeSubmission(id) {
  await query('DELETE FROM submissions WHERE id = $1', [id]);
}

export default {
  getSubmission,
  listSubmissions,
  saveSubmission,
  removeSubmission,
};
