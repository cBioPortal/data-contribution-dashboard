/**
 * Question Threads Store (Postgres)
 *
 * A question on a submission and the replies to it. Two audiences share the
 * shape: the submitter asking the curation team about their own submission
 * (private), and anyone asking about a released study afterwards (public). See
 * schema.sql for why they live in one table.
 *
 * "Answered" is derived, never stored: a thread is answered when it holds a
 * message from a curator. Storing a flag alongside the messages would give two
 * sources for one fact and, sooner or later, two different answers.
 */

import { v4 as uuidv4 } from 'uuid';
import { query } from './index.js';

function toMessage(row) {
  return {
    id: row.id,
    threadId: row.thread_id,
    body: row.body,
    authorId: row.author_id,
    authorName: row.author_name ?? null,
    authorEmail: row.author_email ?? null,
    fromCurator: row.from_curator,
    createdAt: row.created_at,
    editedAt: row.edited_at,
  };
}

function toThread(row) {
  return {
    id: row.id,
    submissionId: row.submission_id,
    visibility: row.visibility,
    askedBy: row.asked_by,
    askerName: row.asker_name ?? null,
    askerEmail: row.asker_email ?? null,
    createdAt: row.created_at,
    messages: [],
  };
}

/**
 * Every visible thread on a submission, with its messages, oldest first.
 *
 * `includePrivate` is the disclosure boundary and defaults to closed. Callers
 * that may see private threads pass the ids they are entitled to — the asker's
 * own, or all of them for the submitter and the curation team — rather than a
 * bare boolean, so "which private threads" is decided once, by the route.
 */
export async function listThreads(submissionId, { includePrivate = false, askerId = null } = {}) {
  const conditions = ["t.visibility = 'public'"];
  const params = [submissionId];

  if (includePrivate) {
    conditions.push("t.visibility = 'private'");
  } else if (askerId) {
    // Someone who is neither submitter nor curator still gets their own thread.
    params.push(askerId);
    conditions.push(`(t.visibility = 'private' AND t.asked_by = $${params.length})`);
  }

  const { rows } = await query(
    `SELECT t.*, u.name AS asker_name, u.email AS asker_email
       FROM question_threads t
       LEFT JOIN users u ON u.id = t.asked_by
      WHERE t.submission_id = $1
        AND t.deleted_at IS NULL
        AND (${conditions.join(' OR ')})
      ORDER BY t.created_at DESC`,
    params,
  );
  if (!rows.length) return [];

  const threads = rows.map(toThread);
  const byId = new Map(threads.map((t) => [t.id, t]));

  const { rows: msgs } = await query(
    `SELECT m.*, u.name AS author_name, u.email AS author_email
       FROM question_messages m
       LEFT JOIN users u ON u.id = m.author_id
      WHERE m.thread_id = ANY($1)
        AND m.deleted_at IS NULL
      ORDER BY m.created_at ASC`,
    [threads.map((t) => t.id)],
  );
  for (const row of msgs) byId.get(row.thread_id)?.messages.push(toMessage(row));

  // A thread whose every message has been retracted has nothing left to show.
  return threads.filter((t) => t.messages.length);
}

/** One thread with its messages, or null. Used to authorise replies. */
export async function getThread(id) {
  const { rows } = await query(
    `SELECT * FROM question_threads WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  if (!rows.length) return null;

  const thread = toThread(rows[0]);
  const { rows: msgs } = await query(
    `SELECT * FROM question_messages
      WHERE thread_id = $1 AND deleted_at IS NULL
      ORDER BY created_at ASC`,
    [id],
  );
  thread.messages = msgs.map(toMessage);
  return thread;
}

/**
 * Open a thread. The question itself is the first message, so both rows are
 * written together — a thread with no question in it is not a thing that should
 * ever exist, even briefly.
 */
export async function createThread({ submissionId, body, visibility = 'public', authorId, fromCurator = false }) {
  const threadId = `qthread_${uuidv4()}`;

  await query(
    `INSERT INTO question_threads (id, submission_id, visibility, asked_by)
     VALUES ($1, $2, $3, $4)`,
    [threadId, submissionId, visibility, authorId],
  );
  await query(
    `INSERT INTO question_messages (id, thread_id, body, author_id, from_curator)
     VALUES ($1, $2, $3, $4, $5)`,
    [`qmsg_${uuidv4()}`, threadId, body.trim(), authorId, fromCurator],
  );

  return getThread(threadId);
}

/** Append a reply. */
export async function addMessage({ threadId, body, authorId, fromCurator = false }) {
  const { rows } = await query(
    `INSERT INTO question_messages (id, thread_id, body, author_id, from_curator)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [`qmsg_${uuidv4()}`, threadId, body.trim(), authorId, fromCurator],
  );
  return toMessage(rows[0]);
}

/** A single message, for authorising edits and retractions. */
export async function getMessage(id) {
  const { rows } = await query(
    `SELECT * FROM question_messages WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  return rows.length ? toMessage(rows[0]) : null;
}

/**
 * Retract a message. Soft, like every other retraction here.
 *
 * When the last live message goes, the thread goes with it. A thread with
 * nothing left in it is already invisible — listThreads drops it — so leaving
 * the row open produced conversations nobody could ever see or reach again.
 * Closing it keeps "hidden" and "deleted" from drifting apart.
 *
 * Replies are deliberately left alone: retracting the opening question does not
 * erase the answers other people wrote to it. The thread only closes once
 * everything in it has been withdrawn.
 */
export async function deleteMessage(id) {
  const { rows } = await query(
    `UPDATE question_messages SET deleted_at = now()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING thread_id`,
    [id],
  );
  if (!rows.length) return false;

  await query(
    `UPDATE question_threads t
        SET deleted_at = now()
      WHERE t.id = $1
        AND t.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM question_messages m
           WHERE m.thread_id = t.id AND m.deleted_at IS NULL
        )`,
    [rows[0].thread_id],
  );
  return true;
}

/**
 * Visible thread totals and action counts for submission lists.
 *
 * A curator needs to respond when the latest live message is not from a
 * curator. A submitter needs to respond when a curator wrote last in either a
 * private thread on their submission or a public thread they opened.
 */
export async function countThreadActivity(
  submissionIds,
  { includePrivate = false, responder = 'none', viewerId = null } = {},
) {
  if (!submissionIds.length) return {};
  const { rows } = await query(
    `WITH live_threads AS (
       SELECT t.submission_id,
              t.visibility,
              t.asked_by,
              latest.from_curator AS latest_from_curator,
              latest.created_at AS latest_activity_at
         FROM question_threads t
         JOIN LATERAL (
           SELECT m.from_curator, m.created_at
             FROM question_messages m
            WHERE m.thread_id = t.id
              AND m.deleted_at IS NULL
            ORDER BY m.created_at DESC, m.id DESC
            LIMIT 1
         ) latest ON true
        WHERE t.submission_id = ANY($1)
          AND t.deleted_at IS NULL
          ${includePrivate ? '' : "AND t.visibility = 'public'"}
     )
     SELECT submission_id,
            count(*)::int AS total,
            count(*) FILTER (
              WHERE ($2::text = 'curator' AND latest_from_curator = false)
                 OR ($2::text = 'submitter'
                     AND latest_from_curator = true
                     AND (visibility = 'private' OR asked_by = $3))
            )::int AS needs_response,
            max(latest_activity_at) AS latest_activity_at
       FROM live_threads
      WHERE latest_from_curator IS NOT NULL
      GROUP BY submission_id`,
    [submissionIds, responder, viewerId],
  );
  return Object.fromEntries(rows.map((row) => [
    row.submission_id,
    {
      total: row.total,
      needsResponse: row.needs_response,
      latestActivityAt: row.latest_activity_at,
    },
  ]));
}

/** How many visible threads each of these submissions has. */
export async function countThreads(submissionIds, options = {}) {
  const activity = await countThreadActivity(submissionIds, options);
  return Object.fromEntries(
    Object.entries(activity).map(([submissionId, counts]) => [submissionId, counts.total]),
  );
}

export default {
  listThreads,
  getThread,
  createThread,
  addMessage,
  getMessage,
  deleteMessage,
  countThreadActivity,
  countThreads,
};
