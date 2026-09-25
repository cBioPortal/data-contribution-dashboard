/**
 * Curation Record Routes
 *
 * The README and the activity log for one submission, mounted under
 * /api/submit/:id so the record sits with the thing it describes.
 *
 * Who sees what follows the submission, not the note. A published study's record
 * is public, because the study is; a pre-publication submission's record is
 * visible only to its submitter and the curation team, because the submission
 * itself never reaches the public endpoint. The one exception is a note marked
 * internal, which is a curator working note and is never disclosed publicly.
 *
 * Writing is limited to the curation team and the accepted Community Curator
 * assigned to this study. Submitters read it and cannot alter it.
 */

import express from 'express';
import { getSubmission } from '../db/submissions.js';
import { authenticateToken, optionalAuth } from '../middleware/auth.js';
import { isOwnedBy } from '../utils/ownership.js';
import {
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
} from '../db/curationRecord.js';
import { getMappedStage } from '../utils/pipelineStages.js';
import {
  getCurationVolunteer,
  listCurationVolunteers,
} from '../db/curationVolunteers.js';
import logger from '../utils/logger.js';

// mergeParams so :id from the parent mount is visible here.
const router = express.Router({ mergeParams: true });

/**
 * README editing and the activity log are paused for everyone while the
 * workflow they support is reworked. The endpoints and UI are kept intact —
 * flip this back to `true` to restore them; nothing else needs to change.
 */
const README_AND_NOTES_ENABLED = false;

/** Refuses a README or note write while that feature is paused. */
function requireReadmeAndNotesEnabled(req, res, next) {
  if (README_AND_NOTES_ENABLED) return next();
  return res.status(403).json({
    status: 'error',
    message: 'Editing the curation README and activity log is temporarily disabled',
  });
}

const MAX_NOTE = 5000;
const MAX_SECTION = 20000;
const COMMUNITY_NOTE_KINDS = new Set(['note', 'transformation', 'decision']);
const CHECKLIST_KEYS = [
  'accessGranted',
  'deidentified',
  'metadataIncluded',
  'formatChecked',
  'validationCompleted',
  'readmeUpdated',
];

const isHttpUrl = (value) => {
  if (!value) return true;
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

/**
 * Just enough of the submission to head a record page.
 *
 * Purpose-built rather than reusing the tracker's public projection: a permalink
 * needs a title, a status and the study's identifiers, and nothing here is
 * submitter PII, so the same object serves every caller regardless of role.
 */
function toRecordHeader(s) {
  return {
    id: s.id,
    title: s.paperTitle || s.studyName || '',
    studyName: s.studyName || null,
    description: s.description || null,
    submissionType: s.submissionType,
    publicationType: s.publicationType,
    status: s.displayStatus || s.status || null,
    submittedAt: s.submittedAt || null,
    pmid: s.pmid || null,
    journal: s.journal || null,
    publicationYear: s.publicationYear || null,
    authors: s.authors || null,
    dataTypes: s.dataTypes || null,
    referenceGenome: s.referenceGenome || null,
  };
}

/**
 * Load the submission and work out what this caller may see.
 *
 * Returns null and answers the request when the submission is missing or the
 * caller has no business reading it, so handlers can bail on a falsy result.
 */
async function resolveAccess(req, res) {
  const submission = await getSubmission(req.params.id);
  if (!submission) {
    res.status(404).json({ status: 'error', message: 'Submission not found' });
    return null;
  }

  const isSuper = req.user?.role === 'super';
  const isOwner = !!req.user && isOwnedBy(submission, req.user);
  const isPublished = submission.publicationType === 'published';

  // Pre-publication submissions are not public anywhere else either; the record
  // must not become the way around that.
  if (!isPublished && !isSuper && !isOwner) {
    res.status(403).json({ status: 'error', message: 'Access denied' });
    return null;
  }

  return { submission, isSuper, isOwner };
}

async function resolveWriteAccess(req, res) {
  const submission = await getSubmission(req.params.id);
  if (!submission) {
    res.status(404).json({ status: 'error', message: 'Submission not found' });
    return null;
  }

  const isSuper = req.user.role === 'super';
  const assignment = isSuper
    ? null
    : await getCurationVolunteer(req.params.id, req.user.id);
  const isAssignedCommunityCurator = assignment?.status === 'accepted';
  if (!isSuper && !isAssignedCommunityCurator) {
    res.status(403).json({
      status: 'error',
      message: 'Only the curation team or assigned Community Curator can edit this record',
    });
    return null;
  }

  return { submission, isSuper, isAssignedCommunityCurator };
}

/**
 * GET /api/submit/:id/record
 * The README and the visible notes for one submission.
 */
router.get('/', optionalAuth, async (req, res) => {
  try {
    const access = await resolveAccess(req, res);
    if (!access) return;

    const [readme, volunteers, ownApplication] = await Promise.all([
      getReadme(req.params.id),
      listCurationVolunteers(req.params.id),
      req.user && !access.isSuper
        ? getCurationVolunteer(req.params.id, req.user.id)
        : Promise.resolve(null),
    ]);
    const isAssignedCommunityCurator = ownApplication?.status === 'accepted';
    const canContribute = access.isSuper || isAssignedCommunityCurator;
    const canViewDeliverables = access.isSuper ||
      ['accepted', 'completed'].includes(ownApplication?.status);
    const [notes, deliverables] = await Promise.all([
      listNotes(req.params.id, { includeInternal: canContribute }),
      canViewDeliverables ? getDeliverables(req.params.id) : Promise.resolve(null),
    ]);
    const communityCurator = volunteers.find(volunteer =>
      volunteer.status === 'accepted' || volunteer.status === 'completed');

    res.json({
      status: 'success',
      data: {
        submission: {
          ...toRecordHeader(access.submission),
          communityCurator: communityCurator
            ? { name: communityCurator.name, status: communityCurator.status }
            : null,
        },
        readme,
        deliverables,
        reviewState: canViewDeliverables && communityCurator
          ? {
              volunteerId: access.isSuper ? communityCurator.id : undefined,
              name: communityCurator.name,
              status: communityCurator.status,
              reviewRequestedAt: communityCurator.reviewRequestedAt,
              reviewFeedback: communityCurator.reviewFeedback,
              reviewFeedbackAt: communityCurator.reviewFeedbackAt,
            }
          : null,
        notes: notes.map((n) => ({
          ...n,
          // The byline is an account, and the record is read by people outside
          // the team. Curators see who wrote what; nobody else does.
          authorEmail: access.isSuper ? n.authorEmail : undefined,
          authorId: access.isSuper ? n.authorId : undefined,
          canEdit: README_AND_NOTES_ENABLED && (access.isSuper ||
            (isAssignedCommunityCurator && n.authorId === req.user?.id)),
        })),
        canEdit: canContribute,
        permissions: {
          canEditReadme: README_AND_NOTES_ENABLED && canContribute,
          canEditDeliverables: canContribute,
          canAddNotes: README_AND_NOTES_ENABLED && canContribute,
          canAddRejection: access.isSuper,
          canViewDeliverablesSection: canViewDeliverables,
          // A community curator hands their work off through the deliverables
          // section; the README and activity log are the curation team's tools.
          canViewReadmeAndActivity: access.isSuper ||
            !['accepted', 'completed'].includes(ownApplication?.status),
          canRequestReview: isAssignedCommunityCurator,
          canReviewCuration: access.isSuper &&
            communityCurator?.status === 'accepted' &&
            !!communityCurator.reviewRequestedAt,
        },
      },
    });
  } catch (error) {
    logger.error('Get curation record error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load curation record' });
  }
});

router.put('/deliverables', authenticateToken, async (req, res) => {
  try {
    const access = await resolveWriteAccess(req, res);
    if (!access) return;

    const workspaceUrl = typeof req.body?.workspaceUrl === 'string'
      ? req.body.workspaceUrl.trim()
      : '';
    const validationReportUrl = typeof req.body?.validationReportUrl === 'string'
      ? req.body.validationReportUrl.trim()
      : '';
    const version = typeof req.body?.version === 'string' ? req.body.version.trim() : '';
    const summary = typeof req.body?.summary === 'string' ? req.body.summary.trim() : '';
    const dataTypes = Array.isArray(req.body?.dataTypes)
      ? [...new Set(req.body.dataTypes
          .filter(value => typeof value === 'string')
          .map(value => value.trim())
          .filter(Boolean))]
      : [];
    const checklist = Object.fromEntries(
      CHECKLIST_KEYS.map(key => [key, req.body?.checklist?.[key] === true]),
    );

    if (!isHttpUrl(workspaceUrl) || !isHttpUrl(validationReportUrl)) {
      return res.status(400).json({
        status: 'error',
        message: 'Deliverable and validation report links must use http or https',
      });
    }
    if (workspaceUrl.length > 2000 || validationReportUrl.length > 2000) {
      return res.status(400).json({ status: 'error', message: 'Deliverable links are too long' });
    }
    if (version.length > 200 || summary.length > 2000 || dataTypes.some(value => value.length > 100)) {
      return res.status(400).json({ status: 'error', message: 'Deliverable details are too long' });
    }

    const deliverables = await saveDeliverables({
      submissionId: req.params.id,
      workspaceUrl,
      validationReportUrl,
      version,
      summary,
      dataTypes,
      checklist,
      userId: req.user.id,
    });
    res.json({ status: 'success', data: { deliverables } });
  } catch (error) {
    logger.error('Save curation deliverables error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to save curation deliverables' });
  }
});

/**
 * PUT /api/submit/:id/record/readme
 * Replace the README. Curation team or assigned Community Curator.
 */
router.put('/readme', authenticateToken, requireReadmeAndNotesEnabled, async (req, res) => {
  try {
    const access = await resolveWriteAccess(req, res);
    if (!access) return;

    const sections = req.body?.sections;
    if (!sections || typeof sections !== 'object' || Array.isArray(sections)) {
      return res.status(400).json({ status: 'error', message: 'sections object is required' });
    }

    const oversized = README_SECTIONS.find(
      (key) => typeof sections[key] === 'string' && sections[key].length > MAX_SECTION,
    );
    if (oversized) {
      return res.status(400).json({
        status: 'error',
        message: `Section "${oversized}" is longer than ${MAX_SECTION} characters.`,
      });
    }

    const saved = await saveReadme(req.params.id, sections, req.user.id);
    logger.info(`📝 README saved for ${req.params.id} by ${req.user.email}`);
    res.json({ status: 'success', data: { readme: saved } });
  } catch (error) {
    logger.error('Save README error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to save README' });
  }
});

/**
 * POST /api/submit/:id/record/notes
 * Append a note. Curation team or assigned Community Curator.
 */
router.post('/notes', authenticateToken, requireReadmeAndNotesEnabled, async (req, res) => {
  try {
    const access = await resolveWriteAccess(req, res);
    if (!access) return;

    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    if (!body) {
      return res.status(400).json({ status: 'error', message: 'Note cannot be empty' });
    }
    if (body.length > MAX_NOTE) {
      return res.status(400).json({
        status: 'error',
        message: `Note is longer than ${MAX_NOTE} characters.`,
      });
    }

    const visibility = req.body?.visibility === 'internal' ? 'internal' : 'public';
    const kind = typeof req.body?.kind === 'string' ? req.body.kind : 'note';
    if (!NOTE_KINDS.includes(kind) || (!access.isSuper && !COMMUNITY_NOTE_KINDS.has(kind))) {
      return res.status(400).json({
        status: 'error',
        message: access.isSuper
          ? 'Select a valid note type'
          : 'Only the curation team can add rejection entries',
      });
    }

    const note = await addNote({
      submissionId: req.params.id,
      body,
      // Anchored to where the submission actually is, not to a stage the curator
      // picked from a list — the whole point is that it records what was true.
      stage: getMappedStage(access.submission),
      kind,
      visibility,
      authorId: req.user.id,
    });

    logger.info(`🗒️  Note added to ${req.params.id} (${note.kind}/${note.visibility})`);
    res.status(201).json({ status: 'success', data: { note } });
  } catch (error) {
    logger.error('Add curation note error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to add note' });
  }
});

/**
 * PATCH /api/submit/:id/record/notes/:noteId
 * Rewrite a note's text. Assigned Community Curators may edit only their own.
 */
router.patch('/notes/:noteId', authenticateToken, requireReadmeAndNotesEnabled, async (req, res) => {
  try {
    const access = await resolveWriteAccess(req, res);
    if (!access) return;

    const existing = await getNote(req.params.noteId);
    // Checked against the submission in the path so a note id cannot be used to
    // reach a record the caller did not name.
    if (!existing || existing.submissionId !== req.params.id) {
      return res.status(404).json({ status: 'error', message: 'Note not found' });
    }
    if (!access.isSuper && existing.authorId !== req.user.id) {
      return res.status(403).json({
        status: 'error',
        message: 'Community Curators can edit only their own notes',
      });
    }

    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    if (!body) {
      return res.status(400).json({ status: 'error', message: 'Note cannot be empty' });
    }
    if (body.length > MAX_NOTE) {
      return res.status(400).json({
        status: 'error',
        message: `Note is longer than ${MAX_NOTE} characters.`,
      });
    }

    const note = await editNote(req.params.noteId, body);
    res.json({ status: 'success', data: { note } });
  } catch (error) {
    logger.error('Edit curation note error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to edit note' });
  }
});

/**
 * DELETE /api/submit/:id/record/notes/:noteId
 * Retract a note. Assigned Community Curators may retract only their own.
 */
router.delete('/notes/:noteId', authenticateToken, requireReadmeAndNotesEnabled, async (req, res) => {
  try {
    const access = await resolveWriteAccess(req, res);
    if (!access) return;

    const existing = await getNote(req.params.noteId);
    if (!existing || existing.submissionId !== req.params.id) {
      return res.status(404).json({ status: 'error', message: 'Note not found' });
    }
    if (!access.isSuper && existing.authorId !== req.user.id) {
      return res.status(403).json({
        status: 'error',
        message: 'Community Curators can retract only their own notes',
      });
    }

    await deleteNote(req.params.noteId);
    res.json({ status: 'success', message: 'Note retracted' });
  } catch (error) {
    logger.error('Delete curation note error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to retract note' });
  }
});

export default router;
