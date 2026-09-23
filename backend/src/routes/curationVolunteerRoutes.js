import express from 'express';
import { getSubmission } from '../db/submissions.js';
import {
  getCurationVolunteer,
  listCurationVolunteers,
  requestCurationChanges,
  requestCurationReview,
  reviewCurationVolunteer,
  saveCurationVolunteer,
  withdrawCurationVolunteer,
} from '../db/curationVolunteers.js';
import { authenticateToken, optionalAuth } from '../middleware/auth.js';
import { isOwnedBy } from '../utils/ownership.js';
import {
  notifyCurationReviewRequested,
  notifyCurationVolunteer,
} from '../utils/slack.js';
import { isVolunteerStageOpen } from '../utils/pipelineStages.js';
import { getDeliverables } from '../db/curationRecord.js';
import logger from '../utils/logger.js';

const router = express.Router({ mergeParams: true });

const DESIGNATIONS = new Set([
  'Student',
  'Researcher',
  'Clinician',
  'Data Scientist',
  'Patient Advocate',
  'Other',
]);

const isVolunteerEligible = submission =>
  submission.submissionType === 'suggest-paper' &&
  submission.publicationType === 'published';

const isReviewReady = deliverables =>
  !!deliverables?.workspaceUrl &&
  !!deliverables?.summary &&
  deliverables.dataTypes?.length > 0 &&
  [
    'accessGranted',
    'deidentified',
    'metadataIncluded',
    'formatChecked',
    'validationCompleted',
    'readmeUpdated',
  ]
    .every(key => deliverables.checklist?.[key] === true);

async function resolveAccess(req, res) {
  const submission = await getSubmission(req.params.id);
  if (!submission) {
    res.status(404).json({ status: 'error', message: 'Submission not found' });
    return null;
  }

  const isSuper = req.user?.role === 'super';
  const isOwner = !!req.user && isOwnedBy(submission, req.user);
  if (submission.publicationType !== 'published' && !isSuper && !isOwner) {
    res.status(403).json({ status: 'error', message: 'Access denied' });
    return null;
  }
  return { submission, isSuper, isOwner };
}

router.get('/', optionalAuth, async (req, res) => {
  try {
    const access = await resolveAccess(req, res);
    if (!access) return;

    const [active, all, mine] = await Promise.all([
      listCurationVolunteers(req.params.id),
      access.isSuper
        ? listCurationVolunteers(req.params.id, { includeWithdrawn: true })
        : Promise.resolve(null),
      req.user
        ? getCurationVolunteer(req.params.id, req.user.id)
        : Promise.resolve(null),
    ]);
    const volunteerEligible =
      isVolunteerEligible(access.submission) &&
      isVolunteerStageOpen(access.submission);
    const hasAcceptedInterest = active.some(
      volunteer => volunteer.status === 'accepted' || volunteer.status === 'completed',
    );
    const accepted = active.filter(
      volunteer => volunteer.status === 'accepted' || volunteer.status === 'completed',
    );

    res.json({
      status: 'success',
      data: {
        volunteers: access.isSuper
          ? all
          : accepted.map(volunteer => ({ name: volunteer.name, status: volunteer.status })),
        volunteerCount: access.isSuper ? active.length : accepted.length,
        myVolunteer: mine,
        currentUser: req.user
          ? { name: req.user.name || '', email: req.user.email || '' }
          : null,
        isAuthenticated: !!req.user,
        isCurator: access.isSuper,
        signupOpen: volunteerEligible &&
          !access.submission.leadCuratorId &&
          !hasAcceptedInterest,
        canVolunteer: !!req.user &&
          volunteerEligible &&
          !access.isSuper &&
          !access.submission.leadCuratorId &&
          !hasAcceptedInterest &&
          (!mine || mine.status === 'withdrawn'),
      },
    });
  } catch (error) {
    logger.error('List curation volunteers error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load curation volunteers' });
  }
});

router.post('/', authenticateToken, async (req, res) => {
  try {
    const access = await resolveAccess(req, res);
    if (!access) return;
    if (!isVolunteerEligible(access.submission) || !isVolunteerStageOpen(access.submission)) {
      return res.status(400).json({
        status: 'error',
        message: 'Curation interest is available only for published Study Suggestions through Stage 3'
      });
    }
    if (access.isSuper) {
      return res.status(400).json({
        status: 'error',
        message: 'Curation-team members should review expressions of interest instead'
      });
    }
    if (access.submission.leadCuratorId) {
      return res.status(409).json({
        status: 'error',
        message: 'Expressions of interest are closed because a Lead Curator has been assigned'
      });
    }
    const applications = await listCurationVolunteers(req.params.id);
    if (applications.some(application =>
      application.status === 'accepted' || application.status === 'completed')) {
      return res.status(409).json({
        status: 'error',
        message: 'Expressions of interest are closed because an application has been accepted'
      });
    }
    const existing = await getCurationVolunteer(req.params.id, req.user.id);
    if (existing && existing.status !== 'withdrawn') {
      return res.status(409).json({
        status: 'error',
        message: 'You have already expressed interest in curating this study'
      });
    }

    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const designation = typeof req.body?.designation === 'string' ? req.body.designation.trim() : '';
    const currentWork = typeof req.body?.currentWork === 'string' ? req.body.currentWork.trim() : '';

    if (!name || name.length > 200) {
      return res.status(400).json({ status: 'error', message: 'Name is required and limited to 200 characters' });
    }
    if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ status: 'error', message: 'A valid email is required' });
    }
    if (!DESIGNATIONS.has(designation)) {
      return res.status(400).json({ status: 'error', message: 'Select a valid designation' });
    }
    if (!currentWork || currentWork.length > 500) {
      return res.status(400).json({
        status: 'error',
        message: 'Current work is required and limited to 500 characters'
      });
    }
    if (req.body?.publicNameConsent !== true) {
      return res.status(400).json({
        status: 'error',
        message: 'Acknowledgement of the application and public attribution terms is required'
      });
    }

    const volunteer = await saveCurationVolunteer({
      submissionId: req.params.id,
      userId: req.user.id,
      name,
      email,
      designation,
      currentWork,
    });

    void notifyCurationVolunteer({
      submissionId: req.params.id,
      title: access.submission.paperTitle || access.submission.studyName || '',
      name,
      email,
      designation,
      currentWork,
    });

    logger.info(`🙋 Curation interest registered for ${req.params.id}`);
    res.status(201).json({ status: 'success', data: { volunteer } });
  } catch (error) {
    logger.error('Register curation interest error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to register curation interest' });
  }
});

router.patch('/:volunteerId', authenticateToken, async (req, res) => {
  try {
    const access = await resolveAccess(req, res);
    if (!access) return;
    if (!access.isSuper) {
      return res.status(403).json({ status: 'error', message: 'Super users only' });
    }
    const status = req.body?.status;
    if (!['pending', 'accepted', 'completed', 'declined'].includes(status)) {
      return res.status(400).json({
        status: 'error',
        message: 'Status must be pending, accepted, completed, or declined'
      });
    }
    const volunteer = await reviewCurationVolunteer(
      req.params.id,
      req.params.volunteerId,
      status,
      access.submission.paperTitle || access.submission.studyName || 'this study',
    );
    if (!volunteer) {
      return res.status(status === 'completed' ? 409 : 404).json({
        status: 'error',
        message: status === 'completed'
          ? 'The Community Curator must submit completed deliverables for review first'
          : 'Expression of interest not found',
      });
    }
    res.json({ status: 'success', data: { volunteer } });
  } catch (error) {
    if (error?.code === '23505' && error?.constraint === 'curation_volunteers_one_assigned_idx') {
      return res.status(409).json({
        status: 'error',
        message: 'Another application has already been accepted for this study'
      });
    }
    logger.error('Review curation interest error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to review curation interest' });
  }
});

router.post('/me/review-request', authenticateToken, async (req, res) => {
  try {
    const access = await resolveAccess(req, res);
    if (!access) return;
    if (access.isSuper) {
      return res.status(400).json({
        status: 'error',
        message: 'Only an assigned Community Curator can request review',
      });
    }

    const deliverables = await getDeliverables(req.params.id);
    if (!isReviewReady(deliverables)) {
      return res.status(400).json({
        status: 'error',
        message: 'Add the shared data-files link, files included, handoff summary, and complete the required checklist before requesting review',
      });
    }

    const volunteer = await requestCurationReview(req.params.id, req.user.id);
    if (!volunteer) {
      return res.status(409).json({
        status: 'error',
        message: 'This curation is not assigned to you or is already awaiting review',
      });
    }

    void notifyCurationReviewRequested({
      submissionId: req.params.id,
      title: access.submission.paperTitle || access.submission.studyName || '',
      name: volunteer.name,
    });
    res.json({ status: 'success', data: { volunteer } });
  } catch (error) {
    logger.error('Request curation review error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to request curation review' });
  }
});

router.post('/:volunteerId/request-changes', authenticateToken, async (req, res) => {
  try {
    const access = await resolveAccess(req, res);
    if (!access) return;
    if (!access.isSuper) {
      return res.status(403).json({ status: 'error', message: 'Super users only' });
    }
    const feedback = typeof req.body?.feedback === 'string' ? req.body.feedback.trim() : '';
    if (!feedback || feedback.length > 2000) {
      return res.status(400).json({
        status: 'error',
        message: 'Feedback is required and limited to 2000 characters',
      });
    }
    const volunteer = await requestCurationChanges({
      submissionId: req.params.id,
      volunteerId: req.params.volunteerId,
      reviewerId: req.user.id,
      feedback,
      title: access.submission.paperTitle || access.submission.studyName || 'this study',
    });
    if (!volunteer) {
      return res.status(409).json({
        status: 'error',
        message: 'This curation is not currently awaiting review',
      });
    }
    res.json({ status: 'success', data: { volunteer } });
  } catch (error) {
    logger.error('Request curation changes error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to request curation changes' });
  }
});

router.delete('/me', authenticateToken, async (req, res) => {
  try {
    const access = await resolveAccess(req, res);
    if (!access) return;

    const volunteer = await withdrawCurationVolunteer(req.params.id, req.user.id);
    if (!volunteer) {
      return res.status(404).json({ status: 'error', message: 'Active expression of interest not found' });
    }
    res.json({ status: 'success', data: { volunteer } });
  } catch (error) {
    logger.error('Withdraw curation interest error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to withdraw expression of interest' });
  }
});

export default router;
