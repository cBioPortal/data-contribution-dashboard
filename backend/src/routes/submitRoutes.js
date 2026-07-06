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
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { body, validationResult } from 'express-validator';
import { v4 as uuidv4 } from 'uuid';
import { getSubmission, listSubmissions, saveSubmission, removeSubmission } from '../db/submissions.js';
import { createUser, findUserByEmail } from '../db/users.js';
import { authenticateToken, optionalAuth } from '../middleware/auth.js';
import { notifyNewSubmission, notifyNoteAdded } from '../utils/slack.js';
import {
  normalizeIdentifier,
  findConflict,
  findSimilarByTitle,
} from '../utils/duplicateDetection.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Legacy file storage root — newer submissions share data via an external link,
// but older submissions may still have files on disk that we clean up on delete.
const DATA_SUBMISSIONS_DIR = process.env.DATA_SUBMISSIONS_DIR
  || path.join(__dirname, '../../data-submissions');

// Curation team account that submitters must grant data access to.
export const CURATION_EMAIL = 'cdsicuration@mskcc.org';

const router = express.Router();

/**
 * Public-safe projection of a submission.
 *
 * The full submission document contains submitter PII (email, alternative
 * email, contact preference), restricted fields (privateAccessEmails), and
 * internal curation content (curationNotes, submitterNotes). None of that may
 * be exposed on the unauthenticated /public endpoint — only non-sensitive
 * bibliographic/status fields needed to render the public board are returned.
 */
function toPublicSubmission(s) {
  return {
    id: s.id,
    submissionType: s.submissionType,
    publicationType: s.publicationType,
    status: s.status,
    displayStatus: s.displayStatus,
    submittedAt: s.submittedAt,
    // Study / paper bibliographic info (already public for published work)
    paperTitle: s.paperTitle,
    studyName: s.studyName,
    description: s.description,
    journal: s.journal,
    authors: s.authors,
    publicationYear: s.publicationYear,
    pmid: s.pmid,
    associatedPaper: s.associatedPaper,
    linkToData: s.linkToData,
    dataTypes: s.dataTypes,
    referenceGenome: s.referenceGenome,
    isDataTransformed: s.isDataTransformed,
    isLeadAuthor: s.isLeadAuthor,
    submitterName: s.submitterName,
    supersededBy: s.supersededBy || null,
    supersededAt: s.supersededAt || null,
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
    // Each is reduced to a public-safe projection so submitter PII and internal
    // curation notes are never exposed to unauthenticated callers.
    const all = await listSubmissions();
    const submissions = all
      .filter(s => s.publicationType === 'published')
      .map(toPublicSubmission);

    submissions.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));

    res.json({
      status: 'success',
      data: { submissions, count: submissions.length }
    });
  } catch (error) {
    console.error('Get public submissions error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch submissions' });
  }
});

/**
 * POST /api/submit/bulk-import
 * Bulk import study suggestions (e.g. from GitHub issues).
 * Super users only.
 * Body: { submissions: [...], clearExisting: boolean }
 *   clearExisting: if true, deletes all existing suggest-paper / github-import entries first.
 */
router.post('/bulk-import',
  authenticateToken,
  async (req, res) => {
    try {
      if (req.user.role !== 'super') {
        return res.status(403).json({ status: 'error', message: 'Super users only' });
      }

      const { submissions = [], clearExisting = false } = req.body;

      if (!Array.isArray(submissions) || submissions.length === 0) {
        return res.status(400).json({ status: 'error', message: 'No submissions provided' });
      }

      let deleted = 0;

      // Optionally wipe existing study-suggestion / github-import entries
      if (clearExisting) {
        const existing = await listSubmissions();
        const toDelete = existing
          .filter(val =>
            val.id.startsWith('github_') ||
            val.submissionType === 'suggest-paper' ||
            val.source === 'github-import'
          )
          .map(val => val.id);
        for (const key of toDelete) {
          await removeSubmission(key);
        }
        deleted = toDelete.length;
        console.log(`🗑️  Bulk import: deleted ${deleted} existing study-suggestion entries`);
      }

      // Insert each submission
      let imported = 0;
      const seenKeys = new Set();

      for (const sub of submissions) {
        if (!sub.id) continue;

        // Ensure unique key (handle duplicate PMIDs)
        let key = sub.id;
        let suffix = 1;
        while (seenKeys.has(key)) {
          key = `${sub.id}_${suffix++}`;
        }
        seenKeys.add(key);

        await saveSubmission(key, { ...sub, id: key });
        imported++;
      }

      console.log(`✅ Bulk import complete: ${imported} inserted, ${deleted} deleted`);

      res.status(201).json({
        status: 'success',
        message: 'Bulk import complete',
        data: { deleted, imported }
      });

    } catch (error) {
      console.error('Bulk import error:', error);
      res.status(500).json({ status: 'error', message: 'Bulk import failed', error: error.message });
    }
  }
);

/**
 * POST /api/submit
 * Submit new content (paper suggestion or data submission)
 * Requires authentication
 */
router.post('/',
  authenticateToken,
  async (req, res) => {
    try {
      console.log('📥 Received submission from:', req.user.email);

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
          console.log(`✅ User auto-registered on submission: ${newUser.email}`);
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
        submittedAt: new Date().toISOString(),
        
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

      console.log(`🔍 Duplicate check: isPublished=${isPublished}, role=${req.user.role}, skipDuplicateCheck=${skipDuplicateCheck}`);

      if (isPublished) {
        const incomingIds = new Set();
        for (const field of [formData.pmid, formData.associatedPaper, formData.linkToData]) {
          const n = normalizeIdentifier(field);
          if (n) incomingIds.add(n);
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
                console.log(`⚠️  Suggestion ${conflict.existingId} superseded by new data submission ${submissionId}`);
              }
            } catch (e) {
              console.warn('⚠️  Could not tag superseded suggestion:', e.message);
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
      
      console.log(`✅ Submission created: ${submissionId}`);
      console.log(`   Type: ${submission.submissionType}`);
      console.log(`   User: ${req.user.email}`);
      console.log(`   Data link: ${submission.linkToData || '(none)'}`);

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
      console.error('❌ Create submission error:', error);
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
      if (submission.userId !== req.user.id && req.user.role !== 'super') {
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
      console.error('Get submission error:', error);
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
        req.user.role === 'super' || submission.userId === req.user.id
      );

      // Sort by submission date (newest first)
      submissions.sort((a, b) => 
        new Date(b.submittedAt) - new Date(a.submittedAt)
      );
      
      res.json({
        status: 'success',
        data: {
          submissions,
          count: submissions.length
        }
      });
      
    } catch (error) {
      console.error('Get submissions error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to fetch submissions'
      });
    }
  }
);

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
    'in-portal',
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

      console.log(`✅ Status updated: ${req.params.id} → ${req.body.status}`);

      res.json({
        status: 'success',
        message: 'Status updated successfully',
        data: {
          submission
        }
      });

    } catch (error) {
      console.error('Update status error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to update status'
      });
    }
  }
);

/**
 * PATCH /api/submit/:id/curation-notes
 * Update curation team notes
 * Super users only
 */
router.patch('/:id/curation-notes',
  authenticateToken,
  async (req, res) => {
    try {
      if (req.user.role !== 'super') {
        return res.status(403).json({ status: 'error', message: 'Only super users can update curation notes' });
      }
      const submission = await getSubmission(req.params.id);
      if (!submission) {
        return res.status(404).json({ status: 'error', message: 'Submission not found' });
      }
      const { curationNotes, action, noteIndex } = req.body;

      // action='append'  → add a new note
      // action='edit'    → replace note at noteIndex
      // action='delete'  → remove note at noteIndex
      // (legacy: no action) → treat as append for backwards compat

      // Migrate legacy single-string curationNotes to array
      let notes = submission.curationNotesArray || [];
      if (!notes.length && submission.curationNotes) {
        notes = [{
          text: submission.curationNotes,
          addedAt: submission.curationNotesUpdatedAt || submission.updatedAt || new Date().toISOString(),
          addedBy: submission.curationNotesUpdatedBy || 'curation team',
        }];
      }

      if (action === 'edit' && noteIndex >= 0 && noteIndex < notes.length) {
        notes[noteIndex] = { ...notes[noteIndex], text: curationNotes, editedAt: new Date().toISOString() };
      } else if (action === 'delete' && noteIndex >= 0 && noteIndex < notes.length) {
        notes.splice(noteIndex, 1);
      } else {
        // append (default)
        notes.push({
          text: curationNotes ?? '',
          addedAt: new Date().toISOString(),
          addedBy: req.user.email,
        });
      }

      submission.curationNotesArray = notes;
      // Keep legacy field in sync with latest note for any old readers
      submission.curationNotes = notes.length ? notes[notes.length - 1].text : '';
      submission.curationNotesUpdatedAt = new Date().toISOString();
      submission.curationNotesUpdatedBy = req.user.email;
      submission.updatedAt = new Date().toISOString();

      await saveSubmission(req.params.id, submission);
      console.log(`✅ Curation notes updated: ${req.params.id} (${notes.length} note(s))`);
      res.json({ status: 'success', message: 'Curation notes updated', data: { curationNotesArray: notes, curationNotes: submission.curationNotes } });
    } catch (error) {
      console.error('Update curation notes error:', error);
      res.status(500).json({ status: 'error', message: 'Failed to update curation notes' });
    }
  }
);

/**
 * PATCH /api/submit/:id/add-note
 * Submitter appends a note to their submission.
 * Notes are stored in submitterNotes[] with timestamp — separate from curation team notes.
 * Owner only.
 */
router.patch('/:id/add-note',
  authenticateToken,
  async (req, res) => {
    try {
      const submission = await getSubmission(req.params.id);
      if (!submission) {
        return res.status(404).json({ status: 'error', message: 'Submission not found' });
      }

      const ownerById = submission.userId === req.user.id;
      const ownerByEmail = submission.submitterEmail &&
        req.user.email &&
        submission.submitterEmail.toLowerCase().trim() === req.user.email.toLowerCase().trim();

      if (!ownerById && !ownerByEmail && req.user.role !== 'super') {
        return res.status(403).json({ status: 'error', message: 'Access denied' });
      }

      const { note } = req.body;
      if (!note?.trim()) {
        return res.status(400).json({ status: 'error', message: 'Note cannot be empty' });
      }

      const newNote = {
        text: note.trim(),
        addedAt: new Date().toISOString(),
        addedBy: req.user.email,
      };

      submission.submitterNotes = [...(submission.submitterNotes || []), newNote];
      submission.updatedAt = new Date().toISOString();

      await saveSubmission(req.params.id, submission);

      console.log(`✅ Note added to submission ${req.params.id} by ${req.user.email}`);

      // Notify Slack — only for non-super users (submitter actions)
      if (req.user.role !== 'super') {
        const title = submission.studyName || submission.paperTitle || '';
        notifyNoteAdded(req.params.id, note.trim(), req.user.email, title);
      }

      res.json({
        status: 'success',
        message: 'Note added successfully',
        data: { note: newNote, totalNotes: submission.submitterNotes.length },
      });
    } catch (error) {
      console.error('Add note error:', error);
      res.status(500).json({ status: 'error', message: 'Failed to add note' });
    }
  }
);

/**
 * DELETE /api/submit/:id
 * Delete a submission
 * Owner or super user only
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

      // Check permissions
      if (submission.userId !== req.user.id && req.user.role !== 'super') {
        return res.status(403).json({
          status: 'error',
          message: 'Access denied. You can only delete your own submissions.'
        });
      }

      // Delete from database
      await removeSubmission(req.params.id);
      
      // Delete associated files for legacy submissions that uploaded attachments
      if (submission.hasAttachments) {
        const submissionDir = path.join(DATA_SUBMISSIONS_DIR, req.params.id);
        try {
          await fs.rm(submissionDir, { recursive: true, force: true });
          console.log(`🗑️  Deleted files for submission: ${req.params.id}`);
        } catch (error) {
          console.error(`⚠️  Failed to delete files for ${req.params.id}:`, error);
        }
      }

      console.log(`✅ Submission deleted: ${req.params.id}`);
      
      res.json({
        status: 'success',
        message: 'Submission deleted successfully'
      });
      
    } catch (error) {
      console.error('Delete submission error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to delete submission'
      });
    }
  }
);

export default router;
