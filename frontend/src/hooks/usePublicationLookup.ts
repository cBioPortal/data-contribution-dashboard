import { useCallback, useRef, useState } from 'react';
import { lookupPublication } from '@/services/api';
import { logger } from '@/utils/logger';

export interface PublicationMetadata {
  paperTitle: string;
  journal: string;
  authors: string;
  publicationYear: string;
  pmid: string;
  doi: string;
  publicationType: 'published' | 'preprint';
}

/** An existing submission that already claims this identifier. */
export interface DuplicateHit {
  existingId: string;
  existingType: string;
  existingTitle: string;
  existingStatus: string;
}

/**
 * `miss` covers every "nothing to offer" outcome — unparseable input, a paper no
 * source knows, an upstream that timed out. They are kept apart only to word the
 * message; none of them stops the user filling the form in by hand.
 */
export type LookupStatus = 'idle' | 'loading' | 'found' | 'miss' | 'error';

/**
 * Look up a publication from whatever the submitter pasted.
 *
 * Deliberately not automatic: the caller decides when to `run` — on blur or on
 * paste, not on every keystroke — so a PMID typed digit by digit does not
 * produce a string of requests, each briefly resolving to a different paper.
 */
export function usePublicationLookup() {
  const [status, setStatus] = useState<LookupStatus>('idle');
  const [metadata, setMetadata] = useState<PublicationMetadata | null>(null);
  const [duplicate, setDuplicate] = useState<DuplicateHit | null>(null);
  const [reason, setReason] = useState<string>('');

  // The identifier the current result belongs to, so blurring a field the user
  // did not touch does not re-query.
  const lastQueried = useRef<string>('');
  // Monotonic, so a slow response for an identifier the user has already
  // replaced cannot overwrite a newer one.
  const sequence = useRef(0);

  const reset = useCallback(() => {
    sequence.current += 1;
    lastQueried.current = '';
    setStatus('idle');
    setMetadata(null);
    setDuplicate(null);
    setReason('');
  }, []);

  /** Hide the card without forgetting the answer, so re-blurring stays quiet. */
  const dismiss = useCallback(() => {
    setStatus('idle');
    setMetadata(null);
    setDuplicate(null);
  }, []);

  const run = useCallback(async (raw: string) => {
    const identifier = (raw || '').trim();
    if (!identifier) {
      reset();
      return;
    }
    if (identifier === lastQueried.current) return;

    lastQueried.current = identifier;
    const seq = ++sequence.current;

    setStatus('loading');
    setMetadata(null);
    setDuplicate(null);
    setReason('');

    try {
      const res = await lookupPublication(identifier);
      if (seq !== sequence.current) return;

      const data = res?.data ?? {};
      setDuplicate(data.duplicate ?? null);

      if (data.found && data.metadata) {
        setMetadata(data.metadata as PublicationMetadata);
        setStatus('found');
      } else {
        setReason(data.reason || 'not_found');
        setStatus('miss');
      }
    } catch (e: unknown) {
      if (seq !== sequence.current) return;
      // Never surfaced as a toast: a failed lookup is a missing convenience, not
      // a problem the submitter has to act on.
      logger.warn('Publication lookup failed:', e instanceof Error ? e.message : e);
      setStatus('error');
    }
  }, [reset]);

  return { status, metadata, duplicate, reason, run, reset, dismiss };
}
