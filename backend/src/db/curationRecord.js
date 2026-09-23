/**
 * Curation Record Store (Postgres)
 *
 * Two things that describe a curated study, kept apart on purpose:
 *
 *   - the README, a document that is edited in place and describes the finished
 *     study — what it is, what was excluded, how the data was transformed;
 *   - the activity log, append-only notes anchored to the pipeline stage the
 *     submission was in when each was written.
 *
 * Blurring them is what turns a README into a changelog, so they get separate
 * tables and separate write paths. Neither lives in `submissions.doc`: see
 * schema.sql for why.
 */

import { v4 as uuidv4 } from 'uuid';
import { query } from './index.js';

/** Note kinds the UI knows how to label. Others render in a fallback group. */
export const NOTE_KINDS = ['note', 'transformation', 'decision', 'rejection', 'submitter'];

/** README sections, in the order they are presented. */
export const README_SECTIONS = [
  'summary',
  'sourceData',
  'whatWasCurated',
  'transformations',
  'curationDecisions',
  'caveats',
  'links',
];

// ─── README ──────────────────────────────────────────────────────────────────

/**
 * The README for a submission, or null when none has been written.
 * @returns {Promise<{sections: Object, updatedAt: string, updatedBy: string|null}|null>}
 */
export async function getReadme(submissionId) {
  const { rows } = await query(
    `SELECT sections, updated_at, updated_by
       FROM curation_readme
      WHERE submission_id = $1`,
    [submissionId],
  );
  if (!rows.length) return null;
  return {
    sections: rows[0].sections || {},
    updatedAt: rows[0].updated_at,
    updatedBy: rows[0].updated_by,
  };
}

/**
 * Create or replace a submission's README.
 *
 * The whole section map is written at once — it is one document, and a curator
 * editing it holds all of it — so a partial write cannot leave half a README
 * behind. Unknown keys are dropped rather than stored, so the section list stays
 * the one thing that defines the document's shape.
 */
export async function saveReadme(submissionId, sections, userId = null) {
  const clean = {};
  for (const key of README_SECTIONS) {
    const value = sections?.[key];
    if (typeof value === 'string' && value.trim()) clean[key] = value.trim();
  }

  const { rows } = await query(
    `INSERT INTO curation_readme (submission_id, sections, updated_at, updated_by)
     VALUES ($1, $2::jsonb, now(), $3)
     ON CONFLICT (submission_id) DO UPDATE SET
       sections   = EXCLUDED.sections,
       updated_at = now(),
       updated_by = EXCLUDED.updated_by
     RETURNING sections, updated_at, updated_by`,
    [submissionId, JSON.stringify(clean), userId],
  );
  return { sections: rows[0].sections, updatedAt: rows[0].updated_at, updatedBy: rows[0].updated_by };
}

function toDeliverables(row) {
  if (!row) return null;
  return {
    workspaceUrl: row.workspace_url,
    validationReportUrl: row.validation_report_url,
    version: row.version,
    summary: row.summary,
    dataTypes: Array.isArray(row.data_types) ? row.data_types : [],
    checklist: row.checklist || {},
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

export async function getDeliverables(submissionId) {
  const { rows } = await query(
    `SELECT *
       FROM curation_deliverables
      WHERE submission_id = $1`,
    [submissionId],
  );
  return toDeliverables(rows[0]);
}

export async function saveDeliverables({
  submissionId,
  workspaceUrl,
  validationReportUrl,
  version,
  summary,
  dataTypes,
  checklist,
  userId,
}) {
  const { rows } = await query(
    `INSERT INTO curation_deliverables
       (submission_id, workspace_url, validation_report_url, version, summary,
        data_types, checklist, updated_at, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, now(), $8)
     ON CONFLICT (submission_id) DO UPDATE SET
       workspace_url = EXCLUDED.workspace_url,
       validation_report_url = EXCLUDED.validation_report_url,
       version = EXCLUDED.version,
       summary = EXCLUDED.summary,
       data_types = EXCLUDED.data_types,
       checklist = EXCLUDED.checklist,
       updated_at = now(),
       updated_by = EXCLUDED.updated_by
     RETURNING *`,
    [
      submissionId,
      workspaceUrl,
      validationReportUrl,
      version,
      summary,
      JSON.stringify(dataTypes),
      JSON.stringify(checklist),
      userId,
    ],
  );
  return toDeliverables(rows[0]);
}

// ─── Notes ───────────────────────────────────────────────────────────────────

function toNote(row) {
  return {
    id: row.id,
    submissionId: row.submission_id,
    stage: row.stage,
    kind: row.kind,
    visibility: row.visibility,
    body: row.body,
    authorId: row.author_id,
    authorEmail: row.author_email ?? null,
    createdAt: row.created_at,
    editedAt: row.edited_at,
  };
}

/**
 * Notes on a submission, oldest first.
 *
 * `includeInternal` is the disclosure boundary and defaults to closed: a caller
 * that forgets to pass it gets the public log, never the curation team's working
 * notes. Retracted notes are never returned.
 */
export async function listNotes(submissionId, { includeInternal = false } = {}) {
  const { rows } = await query(
    `SELECT n.*, u.email AS author_email
       FROM curation_notes n
       LEFT JOIN users u ON u.id = n.author_id
      WHERE n.submission_id = $1
        AND n.deleted_at IS NULL
        ${includeInternal ? '' : "AND n.visibility = 'public'"}
      ORDER BY n.created_at ASC`,
    [submissionId],
  );
  return rows.map(toNote);
}

/** A single note, or null. Used to authorise edits and retractions. */
export async function getNote(id) {
  const { rows } = await query(
    `SELECT * FROM curation_notes WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  return rows.length ? toNote(rows[0]) : null;
}

/**
 * Append a note.
 *
 * `stage` is supplied by the caller from the submission's current status rather
 * than chosen by the curator: it is a record of where the submission actually
 * was, and asking someone to pick it invites it being wrong.
 */
export async function addNote({
  submissionId,
  body,
  stage = null,
  kind = 'note',
  visibility = 'public',
  authorId = null,
}) {
  const { rows } = await query(
    `INSERT INTO curation_notes
       (id, submission_id, stage, kind, visibility, body, author_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [`note_${uuidv4()}`, submissionId, stage, kind, visibility, body.trim(), authorId],
  );
  return toNote(rows[0]);
}

/** Rewrite a note's text, stamping when it was changed. */
export async function editNote(id, body) {
  const { rows } = await query(
    `UPDATE curation_notes
        SET body = $2, edited_at = now()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING *`,
    [id, body.trim()],
  );
  return rows.length ? toNote(rows[0]) : null;
}

/** Retract a note. Soft, so the log keeps its shape. */
export async function deleteNote(id) {
  const { rowCount } = await query(
    `UPDATE curation_notes SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  return rowCount > 0;
}

export default {
  NOTE_KINDS,
  README_SECTIONS,
  getReadme,
  saveReadme,
  getDeliverables,
  saveDeliverables,
  listNotes,
  getNote,
  addNote,
  editNote,
  deleteNote,
};
