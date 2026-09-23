/**
 * Submission Routes
 *
 * Handles content submissions from the /submit form
 * - Stores form data in Postgres
 * - Data is shared by the submitter via an external link (Google Drive, Dropbox,
 *   Box, etc.) with view access granted to the curation team
 * - Auto-registers users on submission
 */

import express from 'express';
import { body, validationResult } from 'express-validator';
import { v4 as uuidv4 } from 'uuid';
import { getSubmission, listSubmissions, saveSubmission, removeSubmission } from '../db/submissions.js';
import { createUser, findUserByEmail, findUserById } from '../db/users.js';
import { authenticateToken, optionalAuth } from '../middleware/auth.js';
import { notifyNewSubmission } from '../utils/slack.js';
import {
  normalizeIdentifier,
  findConflict,
  findSimilarByTitle,
} from '../utils/duplicateDetection.js';
import logger from '../utils/logger.js';
import { isOwnedBy } from '../utils/ownership.js';
import { lookupPublication } from '../utils/publicationLookup.js';
import curationRecordRoutes from './curationRecordRoutes.js';
import questionRoutes from './questionRoutes.js';
import curationVolunteerRoutes from './curationVolunteerRoutes.js';
import { countThreadActivity } from '../db/questions.js';
import { countCurationVolunteers } from '../db/curationVolunteers.js';
import { addStudyUpvote, countStudyUpvotes } from '../db/studyUpvotes.js';

// Curation team account that submitters must grant data access to.
export const CURATION_EMAIL = 'cdsicuration@mskcc.org';

const router = express.Router();

const submissionDate = () => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${value.year}-${value.month}-${value.day}`;
};

// The README and activity log for one submission live under the submission they
// describe. Mounted before the parameterised routes below so /:id/record is not
// swallowed by GET /:id.
router.use('/:id/record', curationRecordRoutes);
router.use('/:id/questions', questionRoutes);
router.use('/:id/curation-volunteers', curationVolunteerRoutes);

/**
 * Public-safe projection of a submission.
 *
 * Everything on a published submission is public except the submitter's
 * identity. Dropped: submitterName, submitterEmail, alternativeEmail,
 * canContactEmail, privateAccessEmails, and curationNotesUpdatedBy.
 *
 * The curation record is not here either, for size rather than secrecy: see
 * curationRecordRoutes, which serves it per submission.
 *
 * userId is withheld for a different reason, not privacy: the client identifies
 * an owned record by the presence of a matching userId or email, so a public
 * projection carrying it would drop other people's submissions into a user's own
 * "My Submissions" list.
 *
 * Still an allow-list on purpose — a field added to the submission document
 * later stays private until it is named here.
 */
function toPublicSubmission(s) {
  return {
    id: s.id,
    submissionType: s.submissionType,
    publicationType: s.publicationType,
    status: s.status,
    displayStatus: s.displayStatus,
    submittedAt: s.submittedAt,
    updatedAt: s.updatedAt,
    // Study / paper bibliographic info (already public for published work)
    paperTitle: s.paperTitle,
    studyName: s.studyName,
    description: s.description,
    journal: s.journal,
    authors: s.authors,
    publicationYear: s.publicationYear,
    pmid: s.pmid,
    associatedPaper: s.associatedPaper,
    isLeadAuthor: s.isLeadAuthor,
    wantsToHelpCurate: s.wantsToHelpCurate,
    // Data submission detail
    linkToData: s.linkToData,
    accessGranted: s.accessGranted === true,
    isDataTransformed: s.isDataTransformed,
    referenceGenome: s.referenceGenome,
    dataTypes: s.dataTypes,
    otherDataType: s.otherDataType,
    sharingPreference: s.sharingPreference,
    // Free text the submitter wrote on the form. The curation record — README
    // and notes — is deliberately absent: it is fetched per submission from
    // /api/submit/:id/record when a row is expanded, so a list of 84 studies
    // does not carry every word ever written about them.
    notes: s.notes,
    supersededBy: s.supersededBy || null,
    supersededAt: s.supersededAt || null,
    portalStudyUrl: s.portalStudyUrl || null,
    leadCuratorName: s.leadCuratorName || null,
  };
}

/**
 * GET /api/submit/public
 * Get public submissions for non-authenticated users:
 * - All published submissions (study suggestions + data submissions)
 * Pre-publication submissions (public or private) are intentionally excluded —
 * they are only visible to super users and the user who submitted them.
 */
router.get('/public', async (req, res) => {
  try {
    // Only published submissions are public; pre-publication submissions are
    // restricted to super users and their submitter (served via GET /api/submit).
    // Each is reduced to a public-safe projection: everything but the submitter's
    // name and contact details, curation notes included.
    const all = await listSubmissions();
    const submissions = all
      .filter(s => s.publicationType === 'published')
      .map(toPublicSubmission);
    const submissionIds = submissions.map(s => s.id);
    const [questionActivity, volunteerState, upvoteState] = await Promise.all([
      countThreadActivity(submissionIds),
      countCurationVolunteers(submissionIds),
      countStudyUpvotes(submissionIds),
    ]);
    submissions.forEach((submission) => {
      submission.questionCount = questionActivity[submission.id]?.total ?? 0;
      submission.needsResponseCount = 0;
      submission.latestQuestionActivityAt =
        questionActivity[submission.id]?.latestActivityAt ?? null;
      submission.volunteerCount = volunteerState[submission.id]?.volunteerCount ?? 0;
      submission.curationInterestAccepted =
        volunteerState[submission.id]?.curationInterestAccepted ?? false;
      submission.hasVolunteered = false;
      submission.myVolunteerStatus = null;
      submission.upvoteCount = upvoteState[submission.id]?.upvoteCount ?? 0;
      submission.hasUpvoted = false;
    });

    submissions.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));

    res.json({
      status: 'success',
      data: { submissions, count: submissions.length }
    });
  } catch (error) {
    logger.error('Get public submissions error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch submissions' });
  }
});

/**
 * POST /api/submit
 * Submit new content (paper suggestion or data submission)
 * Requires authentication
 */
router.post('/',
  authenticateToken,
  async (req, res) => {
    try {
      logger.info('📥 Received submission from:', req.user.email);

      // Form data arrives as a JSON object (no file uploads — data is shared
      // by the submitter via an external link with access granted to curation).
      const formData = req.body.data || {};

      // Data submissions (and all preprints) must include a data-sharing link
      // and confirm that curation has been granted access to it.
      const needsDataLink = formData.actionType === 'submit-data' || formData.publicationType === 'preprint';
      if (needsDataLink) {
        if (!formData.linkToData || !String(formData.linkToData).trim()) {
          return res.status(400).json({
            status: 'error',
            message: 'A link to your data (Google Drive, Dropbox, Box, etc.) is required.',
          });
        }
        if (formData.accessGranted !== true) {
          return res.status(400).json({
            status: 'error',
            message: `Please confirm you have granted data access to ${CURATION_EMAIL}.`,
          });
        }
      }

      let userId = req.user.id;
      
      // If user is temporary (guest), create them in DB now
      // But only if they're NOT a super user
      if (req.user.isTemporary && req.user.role !== 'super') {
        // Check if user already exists by email
        let existingUser = await findUserByEmail(req.user.email);
        
        if (!existingUser) {
          const newUser = await createUser({
            email: req.user.email,
            name: req.user.name || formData.name,
            provider: req.user.provider,
            providerId: req.user.providerId,
            role: 'user'
          });
          
          userId = newUser.id;
          logger.info(`✅ User auto-registered on submission: ${newUser.email}`);
        } else {
          userId = existingUser.id;
        }
      }
      
      // Generate submission ID
      const submissionId = `submission_${uuidv4()}`;

      // Create submission object
      const submission = {
        id: submissionId,
        userId,
        
        // Submission metadata
        submissionType: formData.actionType, // 'suggest-paper' or 'submit-data'
        publicationType: formData.publicationType, // 'published' or 'preprint'
        status: 'pending',
        submittedAt: submissionDate(),
        
        // Contact information
        submitterName: formData.name || req.user.name,
        submitterEmail: formData.email || req.user.email,
        canContactEmail: formData.canContactEmail,
        alternativeEmail: formData.alternativeEmail,
        
        // Paper-specific fields
        paperTitle: formData.paperTitle,
        pmid: formData.pmid,
        journal: formData.journal,
        isLeadAuthor: formData.isLeadAuthor,
        wantsToHelpCurate: formData.wantsToHelpCurate,
        
        // Data submission fields
        studyName: formData.studyName,
        description: formData.description,
        associatedPaper: formData.associatedPaper,
        linkToData: formData.linkToData,
        accessGranted: formData.accessGranted === true, // submitter confirmed curation access
        isDataTransformed: formData.isDataTransformed,
        referenceGenome: formData.referenceGenome,

        // Common fields
        dataTypes: formData.dataTypes || [],
        otherDataType: formData.otherDataType,
        notes: formData.notes,

        // Pre-print specific
        sharingPreference: formData.sharingPreference, // 'public' or 'private'
        privateAccessEmails: formData.privateAccessEmails,

        // Timestamps
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      // ─── Duplicate / conflict detection ────────────────────────────────────────
      const skipDuplicateCheck = req.body.skipDuplicateCheck === true;
      const isPublished = formData.publicationType === 'published';

      logger.info(`🔍 Duplicate check: isPublished=${isPublished}, role=${req.user.role}, skipDuplicateCheck=${skipDuplicateCheck}`);

      if (isPublished) {
        const incomingIds = new Set();
        for (const field of [formData.pmid, formData.associatedPaper, formData.linkToData]) {
          const n = normalizeIdentifier(field);
          if (n) incomingIds.add(n);
        }

        // Match on what the paper *is*, not only on the string that happened to
        // be typed. Every existing submission here is keyed by PMID, so pasting
        // the DOI of a study already suggested produced two different keys for
        // one paper, no overlap, and a duplicate that sailed straight through.
        // Resolving the identifier yields both keys and closes that.
        //
        // Cheap in the normal flow: the submit form has just looked the same
        // identifier up, so this is served from that cache. And never fatal —
        // lookupPublication does not throw, and an identifier it cannot resolve
        // leaves the set exactly as it was, which is the previous behaviour.
        // Bounded, and in parallel: duplicate detection is worth a moment, but a
        // slow index must never hold up a submission. Two fields against two
        // sources could otherwise stack four five-second timeouts onto the
        // submit path. On timeout the set is left exactly as it was.
        try {
          const resolutions = await Promise.race([
            Promise.all(
              [formData.pmid, formData.associatedPaper]
                .filter(Boolean)
                .map(field => lookupPublication(field)),
            ),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('identifier resolution timed out')), 3000),
            ),
          ]);

          for (const resolved of resolutions) {
            if (!resolved.found) continue;
            for (const alias of [resolved.metadata.pmid, resolved.metadata.doi]) {
              const n = normalizeIdentifier(alias);
              if (n) incomingIds.add(n);
            }
          }
        } catch (err) {
          // Falls back to matching on the typed string alone — the behaviour
          // before this block existed. A submission is never lost to it.
          logger.warn(`Identifier resolution skipped for duplicate check: ${err.message}`);
        }

        // Load all submissions once for both duplicate-detection layers
        const allSubmissions = await listSubmissions();

        // Layer 1: Hard conflict — PMID / DOI / URL exact match
        const conflict = findConflict(allSubmissions, formData.actionType, incomingIds);

        if (conflict) {
          const newIsData = formData.actionType === 'submit-data';
          const existingIsData = conflict.existingType === 'submit-data';

          if (existingIsData) {
            // Hard block: a data submission already exists — suggestion or new data sub both blocked
            return res.status(409).json({
              status: 'conflict',
              conflictType: 'data-submission-exists',
              message: existingIsData && !newIsData
                ? 'A data submission for this study is already in progress.'
                : 'A data submission for this study already exists.',
              existingSubmissionId: conflict.existingId,
              existingSubmissionType: conflict.existingType,
              existingTitle: conflict.existingTitle,
              existingStatus: conflict.existingStatus,
            });
          }

          if (!newIsData && !existingIsData) {
            // Soft block: suggestion already exists
            return res.status(409).json({
              status: 'conflict',
              conflictType: 'suggestion-exists',
              message: 'This study has already been suggested for curation.',
              existingSubmissionId: conflict.existingId,
              existingSubmissionType: conflict.existingType,
              existingTitle: conflict.existingTitle,
              existingStatus: conflict.existingStatus,
            });
          }

          // New data submission supersedes an existing suggestion:
          // allow it, but tag the existing suggestion as superseded
          if (newIsData && !existingIsData) {
            try {
              const existingSub = await getSubmission(conflict.existingId);
              if (existingSub) {
                existingSub.supersededBy = submissionId;
                existingSub.supersededAt = new Date().toISOString();
                existingSub.updatedAt = new Date().toISOString();
                await saveSubmission(conflict.existingId, existingSub);
                logger.info(`⚠️  Suggestion ${conflict.existingId} superseded by new data submission ${submissionId}`);
              }
            } catch (e) {
              logger.warn('⚠️  Could not tag superseded suggestion:', e.message);
            }
          }
        }

        // Layer 2: Soft warning — title similarity (skippable by user)
        if (!skipDuplicateCheck) {
          const incomingTitle = formData.paperTitle || formData.studyName || '';
          const similar = findSimilarByTitle(allSubmissions, incomingTitle);
          if (similar) {
            return res.status(409).json({
              status: 'conflict',
              conflictType: 'similar-title',
              message: `A similar study may already exist (${similar.similarityScore}% match). You can still submit if this is a different study.`,
              existingSubmissionId: similar.existingId,
              existingSubmissionType: similar.existingType,
              existingTitle: similar.existingTitle,
              existingStatus: similar.existingStatus,
              similarityScore: similar.similarityScore,
            });
          }
        }
      }

      // Save to Postgres
      await saveSubmission(submissionId, submission);
      
      // Notify Slack (fire-and-forget)
      notifyNewSubmission(submission);
      
      logger.info(`✅ Submission created: ${submissionId}`);
      logger.info(`   Type: ${submission.submissionType}`);
      logger.info(`   User: ${req.user.email}`);
      logger.info(`   Data link: ${submission.linkToData || '(none)'}`);

      res.status(201).json({
        status: 'success',
        message: 'Submission created successfully',
        data: {
          submissionId,
          submissionType: submission.submissionType,
          status: submission.status,
        }
      });
      
    } catch (error) {
      logger.error('❌ Create submission error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to create submission',
        error: error.message
      });
    }
  }
);

/**
 * GET /api/submit/:id
 * Get a specific submission by ID
 * Owner or super user only
 */
router.get('/:id',
  authenticateToken,
  async (req, res) => {
    try {
      const submission = await getSubmission(req.params.id);
      if (!submission) {
        return res.status(404).json({
          status: 'error',
          message: 'Submission not found'
        });
      }

      // Check permissions
      if (!isOwnedBy(submission, req.user) && req.user.role !== 'super') {
        return res.status(403).json({
          status: 'error',
          message: 'Access denied. You can only view your own submissions.'
        });
      }

      res.json({
        status: 'success',
        data: { submission }
      });

    } catch (error) {
      logger.error('Get submission error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to fetch submission'
      });
    }
  }
);

/**
 * GET /api/submit
 * Get all submissions (paginated)
 * Super users see all, regular users see only theirs
 */
router.get('/',
  authenticateToken,
  async (req, res) => {
    try {
      const all = await listSubmissions();
      // Super users see all submissions; regular users only see their own
      const submissions = all.filter(submission =>
        req.user.role === 'super' || isOwnedBy(submission, req.user)
      );
      const submissionIds = submissions.map(submission => submission.id);
      const visibleVolunteerIds = all
        .filter(submission =>
          submission.publicationType === 'published' ||
          req.user.role === 'super' ||
          isOwnedBy(submission, req.user))
        .map(submission => submission.id);
      const [questionActivity, volunteerState, upvoteState] = await Promise.all([
        countThreadActivity(submissionIds, {
          includePrivate: true,
          responder: req.user.role === 'super' ? 'curator' : 'submitter',
          viewerId: req.user.id,
        }),
        countCurationVolunteers(visibleVolunteerIds, req.user.id),
        countStudyUpvotes(visibleVolunteerIds, req.user.id),
      ]);
      submissions.forEach((submission) => {
        submission.questionCount = questionActivity[submission.id]?.total ?? 0;
        submission.needsResponseCount = questionActivity[submission.id]?.needsResponse ?? 0;
        submission.latestQuestionActivityAt =
          questionActivity[submission.id]?.latestActivityAt ?? null;
        submission.volunteerCount = volunteerState[submission.id]?.volunteerCount ?? 0;
        submission.curationInterestAccepted =
          volunteerState[submission.id]?.curationInterestAccepted ?? false;
        submission.hasVolunteered = volunteerState[submission.id]?.hasVolunteered ?? false;
        submission.myVolunteerStatus = volunteerState[submission.id]?.myVolunteerStatus ?? null;
        submission.upvoteCount = upvoteState[submission.id]?.upvoteCount ?? 0;
        submission.hasUpvoted = upvoteState[submission.id]?.hasUpvoted ?? false;
      });

      // Sort by submission date (newest first)
      submissions.sort((a, b) => 
        new Date(b.submittedAt) - new Date(a.submittedAt)
      );
      
      res.json({
        status: 'success',
        data: {
          submissions,
          count: submissions.length,
          volunteerState,
          upvoteState,
        }
      });
      
    } catch (error) {
      logger.error('Get submissions error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to fetch submissions'
      });
    }
  }
);

/**
 * POST /api/submit/:id/upvote
 * Add the signed-in user's vote for a published study suggestion.
 */
router.post('/:id/upvote', authenticateToken, async (req, res) => {
  try {
    const submission = await getSubmission(req.params.id);
    if (!submission) {
      return res.status(404).json({ status: 'error', message: 'Submission not found' });
    }
    if (submission.submissionType !== 'suggest-paper' || submission.publicationType !== 'published') {
      return res.status(400).json({
        status: 'error',
        message: 'Only published study suggestions can be upvoted',
      });
    }

    const result = await addStudyUpvote(req.params.id, req.user.id);
    return res.status(result.created ? 201 : 200).json({
      status: 'success',
      data: {
        upvoteCount: result.upvoteCount,
        hasUpvoted: true,
      },
    });
  } catch (error) {
    logger.error('Study upvote error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to upvote study' });
  }
});

/**
 * PATCH /api/submit/:id/status
 * Update submission status
 * Super users only
 */
router.patch('/:id/status',
  authenticateToken,
  body('status').isIn([
    'pending', 
    'received', 
    'in-progress', 
    'in-review',
    'missing-data',
    'not-curatable',
    'approved', 
    'rejected'
  ]).withMessage('Invalid status'),
  async (req, res) => {
    try {
      // Only super users can update status
      if (req.user.role !== 'super') {
        return res.status(403).json({
          status: 'error',
          message: 'Only super users can update submission status'
        });
      }
      
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          status: 'error',
          message: 'Validation failed',
          errors: errors.array()
        });
      }
      
      const submission = await getSubmission(req.params.id);
      if (!submission) {
        return res.status(404).json({
          status: 'error',
          message: 'Submission not found'
        });
      }

      submission.status = req.body.status;
      submission.displayStatus = req.body.displayStatus || null;
      submission.updatedAt = new Date().toISOString();
      submission.statusUpdatedBy = req.user.id;
      submission.statusUpdatedAt = new Date().toISOString();

      await saveSubmission(req.params.id, submission);

      logger.info(`✅ Status updated: ${req.params.id} → ${req.body.status}`);

      res.json({
        status: 'success',
        message: 'Status updated successfully',
        data: {
          submission
        }
      });

    } catch (error) {
      logger.error('Update status error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to update status'
      });
    }
  }
);

const OVERVIEW_STRING_LIMITS = {
  paperTitle: 500,
  studyName: 500,
  description: 5000,
  pmid: 500,
  associatedPaper: 500,
  journal: 500,
  authors: 2000,
  publicationYear: 4,
  linkToData: 2000,
  referenceGenome: 200,
  portalStudyUrl: 2000,
};
const OVERVIEW_BOOLEAN_FIELDS = new Set([
  'isLeadAuthor',
  'accessGranted',
  'isDataTransformed',
]);
const OVERVIEW_FIELDS = new Set([
  ...Object.keys(OVERVIEW_STRING_LIMITS),
  ...OVERVIEW_BOOLEAN_FIELDS,
  'dataTypes',
  'leadCuratorId',
]);

/**
 * PATCH /api/submit/:id/overview
 * Edit overview metadata. Super users only.
 */
router.patch('/:id/overview',
  authenticateToken,
  async (req, res) => {
    try {
      if (req.user.role !== 'super') {
        return res.status(403).json({
          status: 'error',
          message: 'Only super users can edit submission overview details'
        });
      }

      const submission = await getSubmission(req.params.id);
      if (!submission) {
        return res.status(404).json({
          status: 'error',
          message: 'Submission not found'
        });
      }

      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const unknownFields = Object.keys(body).filter(field => !OVERVIEW_FIELDS.has(field));
      if (unknownFields.length) {
        return res.status(400).json({
          status: 'error',
          message: `Unsupported overview fields: ${unknownFields.join(', ')}`
        });
      }

      const updates = {};
      for (const [field, limit] of Object.entries(OVERVIEW_STRING_LIMITS)) {
        if (!(field in body)) continue;
        if (body[field] !== null && typeof body[field] !== 'string') {
          return res.status(400).json({ status: 'error', message: `${field} must be text` });
        }
        const value = typeof body[field] === 'string' ? body[field].trim() : '';
        if (value.length > limit) {
          return res.status(400).json({
            status: 'error',
            message: `${field} must be ${limit} characters or fewer`
          });
        }
        updates[field] = value || null;
      }

      for (const field of OVERVIEW_BOOLEAN_FIELDS) {
        if (!(field in body)) continue;
        if (body[field] !== null && typeof body[field] !== 'boolean') {
          return res.status(400).json({ status: 'error', message: `${field} must be true, false, or null` });
        }
        updates[field] = body[field];
      }

      if ('dataTypes' in body) {
        if (!Array.isArray(body.dataTypes) ||
            body.dataTypes.some(value => typeof value !== 'string' || value.trim().length > 200)) {
          return res.status(400).json({
            status: 'error',
            message: 'dataTypes must be an array of text values'
          });
        }
        updates.dataTypes = body.dataTypes.map(value => value.trim()).filter(Boolean);
      }

      if ('leadCuratorId' in body) {
        if (body.leadCuratorId !== null && typeof body.leadCuratorId !== 'string') {
          return res.status(400).json({
            status: 'error',
            message: 'leadCuratorId must be a user ID or null'
          });
        }
        const leadCuratorId = typeof body.leadCuratorId === 'string'
          ? body.leadCuratorId.trim()
          : '';
        if (!leadCuratorId) {
          updates.leadCuratorId = null;
          updates.leadCuratorName = null;
        } else {
          const curator = await findUserById(leadCuratorId);
          if (!curator || curator.role !== 'super') {
            return res.status(400).json({
              status: 'error',
              message: 'Lead Curator must be a current curation-team member'
            });
          }
          updates.leadCuratorId = curator.id;
          updates.leadCuratorName = curator.name || curator.email;
        }
      }

      if (!Object.keys(updates).length) {
        return res.status(400).json({
          status: 'error',
          message: 'No editable overview fields were provided'
        });
      }

      if (updates.publicationYear && !/^\d{4}$/.test(updates.publicationYear)) {
        return res.status(400).json({ status: 'error', message: 'Publication year must contain four digits' });
      }
      if (updates.portalStudyUrl) {
        try {
          const url = new URL(updates.portalStudyUrl);
          if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid protocol');
        } catch {
          return res.status(400).json({
            status: 'error',
            message: 'cBioPortal study link must be a valid http or https URL'
          });
        }
      }

      Object.assign(submission, updates, {
        updatedAt: new Date().toISOString(),
        overviewUpdatedBy: req.user.id,
        overviewUpdatedAt: new Date().toISOString(),
      });
      await saveSubmission(req.params.id, submission);

      logger.info(`✏️ Overview updated: ${req.params.id}`);
      res.json({
        status: 'success',
        message: 'Submission overview updated successfully',
        data: { submission }
      });
    } catch (error) {
      logger.error('Update submission overview error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to update submission overview'
      });
    }
  }
);

/**
 * DELETE /api/submit/:id
 * Delete a submission
 * Super users only.
 *
 * Deliberately not the submitter: a submission accumulates curation work —
 * notes, decisions, a README — that belongs to the curation team rather than to
 * whoever filed it, and deletion destroys all of it. The tracker has only ever
 * shown the delete control to super users, but the route itself accepted the
 * owner too, so the restriction existed in the UI and not at the boundary that
 * enforces it.
 */
router.delete('/:id',
  authenticateToken,
  async (req, res) => {
    try {
      const submission = await getSubmission(req.params.id);
      if (!submission) {
        return res.status(404).json({
          status: 'error',
          message: 'Submission not found'
        });
      }

      if (req.user.role !== 'super') {
        return res.status(403).json({
          status: 'error',
          message: 'Access denied. Only the curation team can delete a submission.'
        });
      }

      // Delete from database
      await removeSubmission(req.params.id);

      logger.info(`✅ Submission deleted: ${req.params.id}`);
      
      res.json({
        status: 'success',
        message: 'Submission deleted successfully'
      });
      
    } catch (error) {
      logger.error('Delete submission error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to delete submission'
      });
    }
  }
);

export default router;
