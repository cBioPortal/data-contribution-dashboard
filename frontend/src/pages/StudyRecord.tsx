import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Loader2 } from 'lucide-react';
import SharedLayout from '@/components/SharedLayout';
import { CurationRecord } from '@/components/track-status/CurationRecord';
import { Questions } from '@/components/track-status/Questions';
import { formatSubmissionDate } from '@/utils/submissionDate';
import { getCurationRecord } from '@/services/api';
import { logger } from '@/utils/logger';

/**
 * One study's curation record, at its own URL.
 *
 * The tracker shows this inside an expanded row, which is right for browsing and
 * useless for referring to: there is no way to send someone "the curation notes
 * for this study". A permalink is what makes the record citable from a paper, an
 * email or DataHub — which is the whole point of writing it down long after the
 * curation is finished.
 *
 * Access is decided by the API, not here: a published study's record is public,
 * a pre-publication one is restricted to its submitter and the curation team.
 * This page renders whatever it is given and shows a plain not-available message
 * otherwise, so the URL never confirms that a private submission exists.
 */

interface RecordHeader {
  id: string;
  title: string;
  studyName: string | null;
  description: string | null;
  submissionType: string;
  publicationType: string;
  status: string | null;
  submittedAt: string | null;
  pmid: string | null;
  journal: string | null;
  publicationYear: string | null;
  dataTypes: string[] | string | null;
  referenceGenome: string | null;
  communityCurator: {
    name: string;
    status: 'accepted' | 'completed';
  } | null;
}

/** A published-work identifier, linked where we can resolve one. */
const PmidLink = ({ pmid }: { pmid: string }) =>
  /^\d+$/.test(pmid) ? (
    <a
      href={`https://pubmed.ncbi.nlm.nih.gov/${pmid}/`}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-600 hover:text-blue-800 underline inline-flex items-center gap-1"
    >
      {pmid}<ExternalLink className="h-3 w-3" />
    </a>
  ) : (
    <span className="break-all">{pmid}</span>
  );

const Fact: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="min-w-0">
    <dt className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-0.5">{label}</dt>
    <dd className="text-sm text-gray-800 break-words">{children}</dd>
  </div>
);

const StudyRecord = () => {
  const { id } = useParams<{ id: string }>();
  const [header, setHeader] = useState<RecordHeader | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    // Only the header is fetched here; CurationRecord fetches the record itself.
    // One extra request, and it keeps this page from having to thread the whole
    // record through as props.
    getCurationRecord(id)
      .then(res => {
        if (cancelled) return;
        setHeader(res.data.submission ?? null);
        setState('ready');
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        logger.warn('Could not load study record:', e instanceof Error ? e.message : e);
        setState('unavailable');
      });

    return () => { cancelled = true; };
  }, [id]);

  const dataTypes = Array.isArray(header?.dataTypes)
    ? header?.dataTypes.join(', ')
    : header?.dataTypes;

  return (
    <SharedLayout>
      <div className="min-h-[70vh] bg-gradient-to-b from-blue-50/50 to-white py-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">

          <Link
            to="/track-status"
            className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-5"
          >
            <ArrowLeft className="h-4 w-4" /> Back to Track Status
          </Link>

          {state === 'loading' && (
            <p className="flex items-center gap-2 text-sm text-gray-500 py-16">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading curation record…
            </p>
          )}

          {state === 'unavailable' && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-10 text-center">
              <h1 className="text-lg font-semibold text-gray-800 mb-1">Record not available</h1>
              <p className="text-sm text-gray-500 max-w-prose mx-auto">
                This study either has no curation record, or it belongs to a pre-publication
                submission visible only to its submitter and the curation team.
              </p>
            </div>
          )}

          {state === 'ready' && header && (
            <article className="bg-white rounded-xl shadow-sm border border-gray-100">
              <header className="px-6 md:px-8 pt-7 pb-5 border-b border-gray-100">
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  {header.status && (
                    <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-700">
                      {header.status}
                    </span>
                  )}
                  <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-600">
                    {header.publicationType === 'preprint' ? 'Pre-publication' : 'Published study'}
                  </span>
                  <span className="text-[11px] text-gray-400">
                    {header.submissionType === 'submit-data' ? 'Data submission' : 'Study suggestion'}
                  </span>
                </div>

                <h1 className="font-serif text-2xl md:text-[28px] leading-snug font-semibold text-gray-900 max-w-4xl">
                  {header.title || header.studyName || 'Untitled submission'}
                </h1>

                {header.description && (
                  <p className="mt-2.5 font-serif text-[15px] leading-relaxed text-gray-600 max-w-3xl">
                    {header.description}
                  </p>
                )}
              </header>

              {/* Composed from what the submission already holds, so nothing here
                  has to be retyped into the README or can drift out of step. */}
              <dl className="px-6 md:px-8 py-4 border-b border-gray-100 grid gap-x-8 gap-y-4 grid-cols-2 md:grid-cols-4 lg:grid-cols-6">
                {header.pmid && <Fact label="PMID / URL"><PmidLink pmid={header.pmid} /></Fact>}
                {header.journal && (
                  <Fact label="Journal">
                    {header.journal}{header.publicationYear ? `, ${header.publicationYear}` : ''}
                  </Fact>
                )}
                {header.referenceGenome && (
                  <Fact label="Reference genome"><span className="font-mono text-[13px]">{header.referenceGenome}</span></Fact>
                )}
                {dataTypes && <Fact label="Data types">{dataTypes}</Fact>}
                {header.communityCurator && (
                  <Fact label={header.communityCurator.status === 'completed'
                    ? 'Community contributor'
                    : 'Community Curator'}>
                    {header.communityCurator.name}
                    {header.communityCurator.status === 'completed' ? ' · Curation completed' : ''}
                  </Fact>
                )}
                {formatSubmissionDate(header.submittedAt) && (
                  <Fact label="Submitted">{formatSubmissionDate(header.submittedAt)}</Fact>
                )}
                <Fact label="Submission">
                  <span className="font-mono text-[12px] text-gray-500">
                    {header.id.replace(/^submission_/, '').slice(0, 8)}
                  </span>
                </Fact>
              </dl>

              <div className="px-6 md:px-8 pb-8">
                {/* The record renders itself, identically to the tracker panel —
                    one component, so the two can never drift apart. */}
                <CurationRecord submissionId={header.id} showPermalink={false} />

                {/* The long tail lands here, not on the grid panel: someone
                    arriving from the paper two years later has a URL, not a
                    row to expand. */}
                <section className="mt-8 pt-6 border-t border-gray-100">
                  <h2 className="text-[11px] font-bold uppercase tracking-[0.1em] text-gray-800 pb-1.5 mb-4 border-b-2 border-gray-800">
                    Questions
                  </h2>
                  <Questions submissionId={header.id} />
                </section>
              </div>
            </article>
          )}
        </div>
      </div>
    </SharedLayout>
  );
};

export default StudyRecord;
