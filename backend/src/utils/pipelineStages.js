/**
 * Pipeline stages, server side.
 *
 * A curation note records the stage the submission was actually in when it was
 * written, so the server has to be able to name that stage at write time rather
 * than trusting a value from the client.
 *
 * This deliberately mirrors the client's two-step mapping in
 * components/track-status/flowDefinitions.ts and pages/TrackStatus.tsx: a stored
 * status code becomes a display label, and a display label becomes one of the
 * stages the tracker draws. Duplicating it is unfortunate — the two must be kept
 * in step by hand — but the alternative is either shipping the stage from the
 * browser, which makes the record only as trustworthy as its caller, or sharing
 * code across two packages that have no build relationship today.
 */

/**
 * Stored status code -> the label shown in the tracker, for a submission with
 * no displayStatus. Only ever a main stage label (see ASSIGNABLE_STAGES).
 * Mirrors mapBackendStatus in pages/TrackStatus.tsx.
 */
const STATUS_LABELS = {
  'pending': 'Submitted',
  'received': 'Initial Review',
  'in-progress': 'Curation in Progress',
  'in-review': 'Final Review',
  'missing-data': 'Rejected',
  'not-curatable': 'Rejected',
  'in-portal': 'Released',
  'approved': 'Released',
  'rejected': 'Rejected',
};

/**
 * Retired sub-labels -> the stage they belong to. Submissions no longer carry
 * these (schema.sql rewrites them to the main label), but the mapping stays so
 * a stray legacy value still lands on the right stage rather than none.
 */
const STAGE_ALIASES = {
  'Awaiting Review': 'Submitted',
  'Submission': 'Submitted',
  'Clarification Needed': 'Curation in Progress',
  'Changes Requested': 'Curation in Progress',
  'Awaiting Submitters Response': 'Curation in Progress',
  "Awaiting Submitter's Response": 'Curation in Progress',
  'In Progress': 'Curation in Progress',
  'Import in Progress': 'Preparing for Release',
  'Under Review': 'Final Review',
  'In Portal': 'Released',
  'Missing Data': 'Rejected',
  'Not Curatable': 'Rejected',
  'Approved for Portal Curation': 'Approved for Curation',
  'Approved for Portal': 'Approved for Curation',
};

const OPEN_VOLUNTEER_STAGES = new Set([
  'Submitted',
  'Initial Review',
  'Approved for Curation',
]);

/**
 * The stages a submission normally passes through, in order. Mirrors
 * suggestedPapersNormalFlow / submittedDataNormalFlow in
 * components/track-status/flowDefinitions.ts — both tracks use the same
 * stage names, so one ordering serves either.
 */
export const NORMAL_FLOW_STAGES = [
  'Submitted',
  'Initial Review',
  'Approved for Curation',
  'Curation in Progress',
  'Final Review',
  'Preparing for Release',
  'Released',
];

/**
 * The only labels a curator can assign: one per stage, plus the single
 * rejection label. Mirrors ASSIGNABLE_STATUSES in
 * components/track-status/GridConfig.tsx.
 */
export const ASSIGNABLE_STAGES = [...NORMAL_FLOW_STAGES, 'Rejected'];

/** The short-circuit flow a rejected submission takes instead. */
export const REJECTED_FLOW_STAGES = [
  'Submitted',
  'Initial Review',
  'Rejected',
];

/**
 * The pipeline stage a submission is currently at.
 *
 * `displayStatus` wins when present: a curator who has assigned a label has said
 * something more specific than the stored code. Returns null when the status is
 * unrecognised, so a note is left unanchored rather than filed under a stage
 * that was invented for it.
 *
 * @param {{status?: string, displayStatus?: string}} submission
 * @returns {string|null}
 */
export function getMappedStage(submission) {
  const raw = submission?.displayStatus || submission?.status;
  if (!raw || typeof raw !== 'string') return null;

  const label = STATUS_LABELS[raw] || raw;
  return STAGE_ALIASES[label] || label || null;
}

export function isVolunteerStageOpen(submission) {
  return OPEN_VOLUNTEER_STAGES.has(getMappedStage(submission));
}

/**
 * Merge in a timestamp for every stage a submission has now reached, without
 * disturbing stages it already had a timestamp for.
 *
 * A curator can jump straight from "Submitted" to "Curation in Progress",
 * skipping "Initial Review" and "Approved for Curation" — those never got
 * their own status update, so there is no real moment to date them. Rather
 * than leave them blank (which would break the "each stage has a date" UI) or
 * invent distinct fake moments (which would claim a precision that doesn't
 * exist), every stage the jump passed through — skipped or landed-on — is
 * stamped with the same timestamp: the moment the jump happened. A stage that
 * was already reached, and dated, on an earlier update keeps its original
 * date; only newly-reached stages are filled in.
 *
 * @param {{status?: string, displayStatus?: string, stageTimestamps?: Record<string, string>}} submission
 * @param {string} [at] ISO timestamp to stamp newly-reached stages with; defaults to now.
 * @returns {Record<string, string>} the merged stage -> ISO timestamp map
 */
export function recordStageTimestamps(submission, at = new Date().toISOString()) {
  const stage = getMappedStage(submission);
  const flow = stage === 'Rejected' ? REJECTED_FLOW_STAGES : NORMAL_FLOW_STAGES;
  const targetIndex = flow.indexOf(stage);

  const timestamps = { ...(submission?.stageTimestamps || {}) };
  if (targetIndex < 0) return timestamps;

  for (let i = 0; i <= targetIndex; i++) {
    const step = flow[i];
    if (!timestamps[step]) timestamps[step] = at;
  }
  return timestamps;
}

export default { getMappedStage, isVolunteerStageOpen, recordStageTimestamps, NORMAL_FLOW_STAGES, REJECTED_FLOW_STAGES, ASSIGNABLE_STAGES };
