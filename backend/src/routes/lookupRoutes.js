/**
 * Publication Lookup Routes
 *
 * Backs the "suggest a study" form: the submitter pastes a PMID, DOI or article
 * URL and gets the title, journal, author citation and year back, plus a warning
 * if that paper has already been submitted.
 *
 * The duplicate check is the half worth having. The autofill saves four fields
 * of typing; telling someone the paper is already in the pipeline before they
 * fill in the form saves the whole submission — and it reuses the identifier
 * matching that POST /api/submit already performs at the end.
 */

import express from 'express';
import { listSubmissions } from '../db/submissions.js';
import { authenticateToken } from '../middleware/auth.js';
import { lookupPublication } from '../utils/publicationLookup.js';
import { normalizeIdentifier, findConflict } from '../utils/duplicateDetection.js';
import logger from '../utils/logger.js';

const router = express.Router();

/**
 * @route   GET /api/lookup?identifier=<pmid|doi|url>
 * @desc    Resolve a publication identifier to form metadata, and report whether
 *          it duplicates an existing submission.
 * @access  Private
 *
 * Authenticated because the only caller is the submit form, which already sits
 * behind a login — and because an unauthenticated version is an open proxy to
 * Europe PMC and Crossref under this server's name. Relax it if the lookup is
 * ever wanted somewhere public.
 *
 * Always 200 on a well-formed request. "No such paper", "cannot parse that" and
 * "Europe PMC is down" are all reported in the body rather than as errors: the
 * form has to stay submittable by hand in every one of those cases, so the
 * client should not have to tell failures apart to keep working.
 */
router.get('/', authenticateToken, async (req, res) => {
  const raw = typeof req.query.identifier === 'string' ? req.query.identifier.trim() : '';

  if (!raw) {
    return res.status(400).json({
      status: 'error',
      message: 'An identifier query parameter is required.',
    });
  }

  // Bounded so a pasted document cannot be handed to the regex chain in
  // normalizeIdentifier or forwarded upstream.
  if (raw.length > 500) {
    return res.status(400).json({
      status: 'error',
      message: 'Identifier is too long to be a PMID, DOI or article URL.',
    });
  }

  try {
    const result = await lookupPublication(raw);

    // Duplicate detection runs off what the submitter typed, not off what the
    // lookup resolved: it should still fire when the paper is unknown upstream
    // but somebody has already submitted that same URL.
    let duplicate = null;
    try {
      const ids = new Set();
      for (const candidate of [raw, result.metadata?.pmid, result.metadata?.doi]) {
        const n = normalizeIdentifier(candidate);
        if (n) ids.add(n);
      }
      if (ids.size) {
        duplicate = findConflict(await listSubmissions(), 'suggest-paper', ids);
      }
    } catch (err) {
      // A duplicate-check failure must not cost the user their autofill.
      logger.error('Duplicate check during lookup failed:', err);
    }

    return res.json({
      status: 'success',
      data: {
        found: result.found,
        identifier: result.identifier,
        ...(result.found
          ? { source: result.source, metadata: result.metadata }
          : { reason: result.reason }),
        duplicate,
      },
    });
  } catch (error) {
    logger.error('Publication lookup error:', error);
    return res.status(500).json({ status: 'error', message: 'Lookup failed' });
  }
});

export default router;
