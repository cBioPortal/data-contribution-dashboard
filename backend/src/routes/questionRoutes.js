/**
 * Question Routes
 *
 * Questions about a submission, mounted under /api/submit/:id/questions.
 *
 * Two conversations, one surface, told apart by a thread's visibility:
 *
 *   public   — anyone signed in may ask, anyone who can see the study may read.
 *              This is the long tail: someone arriving from the paper two years
 *              after the curation finished.
 *   private  — the submitter and the curation team. The submitter's line to the
 *              people curating their data.
 *
 * Reading follows the submission, as everywhere else here: a published study's
 * public threads are readable by anyone, and nothing on a pre-publication
 * submission is readable outside its submitter and the curation team.
 *
 * Asking requires a session. That is not a paywall — Keycloak already signs
 * people in with Google or GitHub — but an unauthenticated question has nobody
 * to send the answer to, and no cost to posting.
 */

import express from 'express';
import { getSubmission } from '../db/submissions.js';
import { authenticateToken, optionalAuth } from '../middleware/auth.js';
import { isOwnedBy } from '../utils/ownership.js';
import {
  listThreads,
  getThread,
  createThread,
  addMessage,
  getMessage,
  deleteMessage,
} from '../db/questions.js';
import { notifyQuestion } from '../utils/slack.js';
import logger from '../utils/logger.js';

const router = express.Router({ mergeParams: true });

const MAX_BODY = 5000;

/**
 * Who is this caller to this submission?
 *
 * Answers the request and returns null when the submission is missing or the
 * caller has no business reading it at all.
 */
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

  return { submission, isSuper, isOwner, userId: req.user?.id ?? null, canSeeAllPrivate: isSuper || isOwner };
}

/**
 * Strip the byline where the reader has no business knowing who wrote it.
 *
 * `isMine` is computed here rather than left to the client, because the client
 * cannot work it out: author ids are withheld from everyone but the curation
 * team, so without this a person could never recognise — or retract — their own
 * message. Answering "is this yours?" is not the same as disclosing whose it is.
 */
function present(thread, { isSuper, userId }) {
  return {
    ...thread,
    isMine: !!userId && thread.askedBy === userId,
    // Emails identify accounts. Curators need them to follow up; a public reader
    // gets a display name and nothing more.
    askerEmail: isSuper ? thread.askerEmail : undefined,
    messages: thread.messages.map((m) => ({
      ...m,
      isMine: !!userId && m.authorId === userId,
      authorEmail: isSuper ? m.authorEmail : undefined,
      authorId: isSuper ? m.authorId : undefined,
    })),
  };
}

function countNeedsResponse(threads, { isSuper, userId }) {
  if (!userId) return 0;
  return threads.filter((thread) => {
    const latest = thread.messages.at(-1);
    if (!latest) return false;
    if (isSuper) return !latest.fromCurator;
    return latest.fromCurator &&
      (thread.visibility === 'private' || thread.askedBy === userId);
  }).length;
}

function latestQuestionActivityAt(threads) {
  let latest = null;
  for (const thread of threads) {
    for (const message of thread.messages) {
      if (!latest || new Date(message.createdAt) > new Date(latest)) {
        latest = message.createdAt;
      }
    }
  }
  return latest;
}

/**
 * GET /api/submit/:id/questions
 * Threads this caller may read, newest first.
 */
router.get('/', optionalAuth, async (req, res) => {
  try {
    const access = await resolveAccess(req, res);
    if (!access) return;

    const threads = await listThreads(req.params.id, {
      includePrivate: access.canSeeAllPrivate,
      askerId: req.user?.id ?? null,
    });

    res.json({
      status: 'success',
      data: {
        threads: threads.map((t) => present(t, access)),
        // Drives the composer: only these two may open a private thread, and
        // only a signed-in caller may ask at all.
        canAsk: !!req.user,
        canAskPrivately: access.canSeeAllPrivate,
        isCurator: access.isSuper,
        needsResponseCount: countNeedsResponse(threads, access),
        latestQuestionActivityAt: latestQuestionActivityAt(threads),
      },
    });
  } catch (error) {
    logger.error('List questions error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load questions' });
  }
});

/**
 * POST /api/submit/:id/questions
 * Ask a question. Body: { body, visibility }.
 */
router.post('/', authenticateToken, async (req, res) => {
  try {
    const access = await resolveAccess(req, res);
    if (!access) return;

    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    if (!body) {
      return res.status(400).json({ status: 'error', message: 'A question cannot be empty' });
    }
    if (body.length > MAX_BODY) {
      return res.status(400).json({
        status: 'error',
        message: `A question is limited to ${MAX_BODY} characters.`,
      });
    }

    // Asking privately is not a preference anyone can select for someone else's
    // study: it is the submitter's channel to the curation team.
    const wantsPrivate = req.body?.visibility === 'private';
    if (wantsPrivate && !access.canSeeAllPrivate) {
      return res.status(403).json({
        status: 'error',
        message: 'Only the submitter and the curation team can open a private thread.',
      });
    }

    const thread = await createThread({
      submissionId: req.params.id,
      body,
      visibility: wantsPrivate ? 'private' : 'public',
      authorId: req.user.id,
      fromCurator: access.isSuper,
    });

    // Curators have Slack; there is no mailer, so the asker is told nothing yet.
    if (!access.isSuper) {
      notifyQuestion({
        submissionId: req.params.id,
        title: access.submission.paperTitle || access.submission.studyName || '',
        body,
        askedBy: req.user.email,
        visibility: thread.visibility,
        isReply: false,
      });
    }

    logger.info(`❓ Question opened on ${req.params.id} (${thread.visibility})`);
    res.status(201).json({ status: 'success', data: { thread: present(thread, access) } });
  } catch (error) {
    logger.error('Create question error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to post question' });
  }
});

/**
 * POST /api/submit/:id/questions/:threadId/messages
 * Reply to a thread.
 */
router.post('/:threadId/messages', authenticateToken, async (req, res) => {
  try {
    const access = await resolveAccess(req, res);
    if (!access) return;

    const thread = await getThread(req.params.threadId);
    // Checked against the submission in the path, so a thread id cannot be used
    // to reach a conversation on a submission the caller did not name.
    if (!thread || thread.submissionId !== req.params.id) {
      return res.status(404).json({ status: 'error', message: 'Thread not found' });
    }

    // A private thread is readable, and so answerable, only by its asker, the
    // submitter and the curation team.
    const mayRead =
      thread.visibility === 'public' ||
      access.canSeeAllPrivate ||
      thread.askedBy === req.user.id;
    if (!mayRead) {
      return res.status(403).json({ status: 'error', message: 'Access denied' });
    }

    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    if (!body) {
      return res.status(400).json({ status: 'error', message: 'A reply cannot be empty' });
    }
    if (body.length > MAX_BODY) {
      return res.status(400).json({
        status: 'error',
        message: `A reply is limited to ${MAX_BODY} characters.`,
      });
    }

    const message = await addMessage({
      threadId: thread.id,
      body,
      authorId: req.user.id,
      fromCurator: access.isSuper,
    });

    if (!access.isSuper) {
      notifyQuestion({
        submissionId: req.params.id,
        title: access.submission.paperTitle || access.submission.studyName || '',
        body,
        askedBy: req.user.email,
        visibility: thread.visibility,
        isReply: true,
      });
    }

    res.status(201).json({
      status: 'success',
      data: { message: present({ ...thread, messages: [message] }, access).messages[0] },
    });
  } catch (error) {
    logger.error('Reply to question error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to post reply' });
  }
});

/**
 * DELETE /api/submit/:id/questions/:threadId/messages/:messageId
 * Retract a message. Its author, or the curation team.
 */
router.delete('/:threadId/messages/:messageId', authenticateToken, async (req, res) => {
  try {
    const access = await resolveAccess(req, res);
    if (!access) return;

    const message = await getMessage(req.params.messageId);
    if (!message || message.threadId !== req.params.threadId) {
      return res.status(404).json({ status: 'error', message: 'Message not found' });
    }

    if (message.authorId !== req.user.id && !access.isSuper) {
      return res.status(403).json({ status: 'error', message: 'Access denied' });
    }

    await deleteMessage(req.params.messageId);
    res.json({ status: 'success', message: 'Message retracted' });
  } catch (error) {
    logger.error('Retract question message error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to retract message' });
  }
});

export default router;
