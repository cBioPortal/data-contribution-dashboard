import { Loader2, BookOpen, AlertTriangle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DuplicateHit, LookupStatus, PublicationMetadata } from '@/hooks/usePublicationLookup';

interface PublicationLookupCardProps {
  status: LookupStatus;
  metadata: PublicationMetadata | null;
  duplicate: DuplicateHit | null;
  reason: string;
  /** The track the submitter chose, so a preprint pasted here can be flagged. */
  expectedType: 'published' | 'preprint';
  onApply: () => void;
  onDismiss: () => void;
}

/**
 * Why a lookup came back empty, in the submitter's terms.
 *
 * Every one of these is advisory. The identifier field is theirs to fill in
 * regardless of what any index knows, so none of this is phrased as an error.
 */
/**
 * Why the study details could not be filled in, in the submitter's terms.
 *
 * All four name the same thing that did not happen — "couldn't fill in the study
 * details" — and then say what to do. That matters because the submitter may not
 * know the form attempts this at all: told only that something "couldn't be
 * pulled", they have no idea what was being attempted or whether it mattered.
 * Naming the outcome makes the feature legible at the only moment they meet it.
 *
 * Every one of these is advisory. The field is theirs to fill in regardless of
 * what any index knows, so none is phrased as an error.
 */
const MISS_MESSAGE: Record<string, string> = {
  // Genuinely not an identifier — free text, a stray word. Only here is it fair
  // to point at the input.
  unrecognised_identifier:
    "Couldn't fill in the study details — that doesn't look like a PMID, DOI or article link. Please enter the details below.",
  // A real link we have no rule for. The link is very likely fine; we just can't
  // read an identifier out of it, and saying otherwise blames the submitter for
  // a gap on our side. Their link is still recorded and still counts for
  // duplicate matching.
  unsupported_link:
    "Couldn't fill in the study details from that link — please enter them below. Your link is fine; pasting the PMID or DOI instead usually works.",
  not_found:
    "Couldn't fill in the study details — no matching record in PMC. If the study is very recent it may not be indexed yet, so please enter them below.",
  lookup_unavailable:
    "Couldn't fill in the study details just now — please enter them below and submit as normal.",
};

/**
 * The result of resolving whatever was pasted into the identifier field.
 *
 * Shown rather than applied: the submitter confirms this is the right paper
 * before anything is written into the form. The duplicate warning is independent
 * of the metadata — a paper already in the pipeline is worth flagging even when
 * no index recognises the identifier.
 */
export const PublicationLookupCard = ({
  status, metadata, duplicate, reason, expectedType, onApply, onDismiss,
}: PublicationLookupCardProps) => {
  const isPreprint = metadata?.publicationType === 'preprint';
  const typeMismatch = metadata && isPreprint && expectedType === 'published';

  // Same derivation as the post-submit conflict banner in SubmitContent, so the
  // early warning and the one after submission point at the same record.
  const isDataConflict = duplicate?.existingType === 'submit-data';
  const shortId = duplicate?.existingId
    ?.replace(/^submission_/, '')
    .replace(/^github_/, '')
    .slice(0, 8);
  const trackerHref =
    `/track-status?tab=${isDataConflict ? 'submitted-data' : 'suggested-papers'}` +
    (shortId ? `&highlight=${shortId}` : '');

  if (status === 'idle' && !duplicate) return null;

  return (
    <div className="space-y-2">
      {/* Already submitted — the most useful thing we can say, so it goes first
          and shows regardless of whether the metadata itself resolved.

          An identifier match is a hard block: the server rejects it with a 409
          and, unlike the fuzzy similar-title case, offers no "Submit Anyway".
          So this says so, and hands over the tracker link now rather than after
          the submitter has filled in the whole form only to be turned away by a
          banner saying the same thing. Wording and colours follow that banner so
          the two read as one message, not two contradictory ones. */}
      {duplicate && (
        <div
          className={cn(
            'flex gap-2.5 items-start rounded-lg border px-3.5 py-3',
            isDataConflict ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50',
          )}
        >
          <AlertTriangle
            className={cn('h-4 w-4 shrink-0 mt-0.5', isDataConflict ? 'text-red-500' : 'text-amber-500')}
          />
          <div className={cn('text-sm min-w-0', isDataConflict ? 'text-red-800' : 'text-amber-800')}>
            <p className="font-semibold">
              {isDataConflict
                ? 'A data submission for this study already exists'
                : 'This study has already been suggested'}
            </p>
            {duplicate.existingTitle && (
              <p className={cn('mt-0.5 break-words', isDataConflict ? 'text-red-700' : 'text-amber-700')}>
                {duplicate.existingTitle}
              </p>
            )}
            {duplicate.existingStatus && (
              <span
                className={cn(
                  'inline-block mt-1 text-xs px-2 py-0.5 rounded-full font-medium',
                  isDataConflict ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700',
                )}
              >
                {duplicate.existingStatus}
              </span>
            )}
            <p className={cn('text-xs mt-2', isDataConflict ? 'text-red-700' : 'text-amber-700')}>
              It can't be submitted again — follow its progress in the tracker instead.
            </p>
            <a
              href={trackerHref}
              className={cn(
                'inline-block mt-1.5 text-sm font-medium underline',
                isDataConflict ? 'text-red-700 hover:text-red-900' : 'text-amber-700 hover:text-amber-900',
              )}
            >
              View in tracker →
              {shortId && <span className="ml-1 font-mono text-xs opacity-70">#{shortId}</span>}
            </a>
          </div>
        </div>
      )}

      {status === 'loading' && (
        <p className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Looking up publication details…
        </p>
      )}

      {status === 'found' && metadata && (
        <div className="rounded-lg border border-blue-200 bg-blue-50/60 px-3.5 py-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-blue-700">
            <BookOpen className="h-3.5 w-3.5" />
            Found this publication
          </p>

          <p className="mt-1.5 text-sm font-medium text-gray-800 break-words">
            {metadata.paperTitle || '(no title)'}
          </p>
          <p className="text-sm text-gray-600 break-words">
            {[metadata.journal, metadata.publicationYear].filter(Boolean).join(' · ')}
            {metadata.authors ? ` · ${metadata.authors}` : ''}
          </p>

          {typeMismatch && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-800">
              <Info className="h-3.5 w-3.5 shrink-0 mt-px" />
              This looks like a preprint rather than a published paper — you may want the
              pre-publication track instead.
            </p>
          )}

          <div className="mt-2.5 flex items-center gap-2">
            <button
              type="button"
              onClick={onApply}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
            >
              Use these details
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {status === 'miss' && (
        <p className="text-sm text-gray-500">{MISS_MESSAGE[reason] ?? MISS_MESSAGE.not_found}</p>
      )}

      {status === 'error' && (
        <p className="text-sm text-gray-500">{MISS_MESSAGE.lookup_unavailable}</p>
      )}
    </div>
  );
};

export default PublicationLookupCard;
