import { query } from './index.js';

export async function addStudyUpvote(submissionId, userId) {
  const { rowCount } = await query(
    `INSERT INTO study_upvotes (submission_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (submission_id, user_id) DO NOTHING`,
    [submissionId, userId],
  );
  const { rows } = await query(
    `SELECT count(*)::int AS upvote_count
       FROM study_upvotes
      WHERE submission_id = $1`,
    [submissionId],
  );

  return {
    created: rowCount === 1,
    upvoteCount: rows[0]?.upvote_count ?? 0,
  };
}

export async function countStudyUpvotes(submissionIds, userId = null) {
  if (!submissionIds.length) return {};

  const { rows } = await query(
    `SELECT submission_id,
            count(*)::int AS upvote_count,
            bool_or(user_id = $2) AS has_upvoted
       FROM study_upvotes
      WHERE submission_id = ANY($1::text[])
      GROUP BY submission_id`,
    [submissionIds, userId],
  );

  return Object.fromEntries(rows.map(row => [
    row.submission_id,
    {
      upvoteCount: row.upvote_count,
      hasUpvoted: row.has_upvoted === true,
    },
  ]));
}
