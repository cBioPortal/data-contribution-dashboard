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

/** Stored status code -> the label shown in the tracker. */
const STATUS_LABELS = {
  'pending': 'Submitted',
  'received': 'Awaiting Review',
  'in-progress': 'Curation in Progress',
  'in-review': 'In Review',
  'missing-data': 'Missing Data',
  'not-curatable': 'Not Curatable',
  'in-portal': 'Released',
  'approved': 'Released',
  'rejected': 'Not Curatable',
};

/** Display label -> the stage the flow diagram draws it at. */
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
  'Missing Data': 'Not Curatable',
  'Approved for Portal Curation': 'Approved for Curation',
  'Approved for Portal': 'Approved for Curation',
};

const OPEN_VOLUNTEER_STAGES = new Set([
  'Submitted',
  'Initial Review',
  'Approved for Curation',
]);

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

export default { getMappedStage, isVolunteerStageOpen };
