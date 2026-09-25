import { useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, FileCheck2, Loader2, Pencil } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { formatSubmissionDate } from '@/utils/submissionDate';
import { toast } from 'sonner';
import {
  CurationDeliverables as Deliverables,
  requestCurationChanges,
  requestCurationReview,
  reviewCurationInterest,
  saveCurationDeliverables,
} from '@/services/api';

const CURATION_EMAIL = 'cdsicuration@mskcc.org';

const CHECKLIST = [
  ['accessGranted', `Shared the files with ${CURATION_EMAIL}`],
  ['deidentified', 'Removed patient-identifiable information'],
  ['metadataIncluded', 'Included study, patient and sample metadata'],
  ['formatChecked', 'File names and formats follow cBioPortal requirements'],
  ['validationCompleted', 'Ran validation checks'],
  ['readmeUpdated', 'Included an up-to-date README'],
] as const;

// Matches the tracker's form and button styles.
const LABEL = 'block space-y-1.5 text-xs font-medium text-gray-600';
const HINT = 'block text-[11px] font-normal text-gray-400';
const PRIMARY_BUTTON = 'inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50';
const SECONDARY_BUTTON = 'rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50';

const emptyDeliverables: Deliverables = {
  workspaceUrl: '',
  validationReportUrl: '',
  version: '',
  summary: '',
  dataTypes: [],
  checklist: {},
};

const isReady = (value: Deliverables | null) =>
  !!value?.workspaceUrl &&
  !!value.summary &&
  value.dataTypes.length > 0 &&
  CHECKLIST.every(([key]) => value.checklist[key] === true);

interface ReviewState {
  volunteerId?: string;
  name: string;
  status: 'accepted' | 'completed';
  reviewRequestedAt: string | null;
  reviewFeedback: string | null;
  reviewFeedbackAt: string | null;
}

interface Props {
  submissionId: string;
  deliverables: Deliverables | null;
  reviewState: ReviewState | null;
  canEdit: boolean;
  canRequestReview: boolean;
  canReview: boolean;
  onChanged: () => Promise<void>;
}

const LinkValue = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className="inline-flex items-center gap-1 break-all text-blue-600 underline hover:text-blue-800"
  >
    {children}<ExternalLink className="h-3 w-3 shrink-0" />
  </a>
);

/** A label/value row, laid out like the tracker's study information fields. */
const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="grid grid-cols-1 gap-0.5 text-xs sm:grid-cols-[minmax(108px,auto)_1fr] sm:gap-3">
    <span className="font-semibold text-gray-500">{label}</span>
    <span className="min-w-0 break-words text-gray-800">{children}</span>
  </div>
);

export const CurationDeliverables = ({
  submissionId,
  deliverables,
  reviewState,
  canEdit,
  canRequestReview,
  canReview,
  onChanged,
}: Props) => {
  const [editing, setEditing] = useState(canEdit && !deliverables);
  const [draft, setDraft] = useState<Deliverables>(deliverables ?? emptyDeliverables);
  const [dataTypesText, setDataTypesText] = useState((deliverables?.dataTypes ?? []).join(', '));
  const [saving, setSaving] = useState(false);
  const [requestingReview, setRequestingReview] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [reviewing, setReviewing] = useState(false);

  useEffect(() => {
    setDraft(deliverables ?? emptyDeliverables);
    setDataTypesText((deliverables?.dataTypes ?? []).join(', '));
  }, [deliverables]);

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        ...draft,
        dataTypes: dataTypesText.split(',').map(value => value.trim()).filter(Boolean),
      };
      await saveCurationDeliverables(submissionId, payload);
      toast.success('Curation deliverables saved.');
      setEditing(false);
      await onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save deliverables.');
    } finally {
      setSaving(false);
    }
  };

  const submitForReview = async () => {
    setRequestingReview(true);
    try {
      await requestCurationReview(submissionId);
      toast.success('Curation submitted for review.');
      await onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not submit for review.');
    } finally {
      setRequestingReview(false);
    }
  };

  const completeReview = async () => {
    if (!reviewState?.volunteerId) return;
    setReviewing(true);
    try {
      await reviewCurationInterest(submissionId, reviewState.volunteerId, 'completed');
      toast.success('Curation approved and contribution credited.');
      await onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not approve curation.');
    } finally {
      setReviewing(false);
    }
  };

  const sendFeedback = async () => {
    if (!reviewState?.volunteerId || !feedback.trim()) return;
    setReviewing(true);
    try {
      await requestCurationChanges(submissionId, reviewState.volunteerId, feedback);
      toast.success('Feedback sent to the Community Curator.');
      setFeedback('');
      setFeedbackOpen(false);
      await onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not request changes.');
    } finally {
      setReviewing(false);
    }
  };

  if (!deliverables && !canEdit) return null;

  const checkedCount = CHECKLIST.filter(([key]) => draft.checklist[key] === true).length;
  const submittedOn = formatSubmissionDate(reviewState?.reviewRequestedAt);

  return (
    <section className="mb-6 rounded-xl border border-gray-200 bg-gray-50/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-widest text-gray-700">
            <FileCheck2 className="h-3.5 w-3.5" />
            Curated data handoff
          </h4>
          <p className="mt-1.5 text-xs text-gray-500">
            Share a link to your curated files with the curation team. Don't include patient-identifiable information.
          </p>
        </div>
        {canEdit && !editing && !reviewState?.reviewRequestedAt && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800"
          >
            <Pencil className="h-3.5 w-3.5" /> Edit
          </button>
        )}
      </div>

      {reviewState?.reviewFeedback && !reviewState.reviewRequestedAt && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-xs font-semibold text-amber-900">Changes requested</p>
          <p className="mt-0.5 text-xs text-amber-800">{reviewState.reviewFeedback}</p>
        </div>
      )}

      {editing ? (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className={`${LABEL} sm:col-span-2`}>
            <span>Link to curated files</span>
            <Input
              type="url"
              value={draft.workspaceUrl}
              onChange={event => setDraft(current => ({ ...current, workspaceUrl: event.target.value }))}
              placeholder="https://drive.google.com/..."
              className="bg-white"
            />
            <span className={HINT}>Make sure {CURATION_EMAIL} can open and download it.</span>
          </label>
          <label className={LABEL}>
            <span>Files included</span>
            <Input
              value={dataTypesText}
              onChange={event => setDataTypesText(event.target.value)}
              placeholder="e.g. metadata, clinical, mutations"
              className="bg-white"
            />
            <span className={HINT}>Separate with commas.</span>
          </label>
          <label className={LABEL}>
            <span>Validation report link <span className="text-gray-400">(optional)</span></span>
            <Input
              type="url"
              value={draft.validationReportUrl}
              onChange={event => setDraft(current => ({ ...current, validationReportUrl: event.target.value }))}
              placeholder="https://..."
              className="bg-white"
            />
          </label>
          <label className={`${LABEL} sm:col-span-2`}>
            <span>Handoff summary</span>
            <Textarea
              value={draft.summary}
              onChange={event => setDraft(current => ({ ...current, summary: event.target.value }))}
              rows={3}
              placeholder="What you curated, transformed or excluded, and anything still open."
              className="bg-white"
            />
          </label>
          <fieldset className="rounded-lg border border-gray-200 bg-white p-3 sm:col-span-2">
            <legend className="sr-only">Before you submit</legend>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-gray-600">Before you submit</span>
              <span className={`text-[11px] font-semibold ${checkedCount === CHECKLIST.length ? 'text-green-700' : 'text-gray-400'}`}>
                {checkedCount}/{CHECKLIST.length}
              </span>
            </div>
            <div className="space-y-2">
              {CHECKLIST.map(([key, label]) => (
                <label key={key} className="flex items-start gap-2 text-xs text-gray-700">
                  <input
                    type="checkbox"
                    checked={draft.checklist[key] === true}
                    onChange={event => setDraft(current => ({
                      ...current,
                      checklist: { ...current.checklist, [key]: event.target.checked },
                    }))}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300"
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex justify-end gap-2 sm:col-span-2">
            {deliverables && (
              <button
                type="button"
                onClick={() => setEditing(false)}
                className={SECONDARY_BUTTON}
              >
                Cancel
              </button>
            )}
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className={PRIMARY_BUTTON}
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      ) : deliverables ? (
        <div className="mt-4 space-y-2.5">
          <Row label="Curated files">
            {deliverables.workspaceUrl
              ? <LinkValue href={deliverables.workspaceUrl}>{deliverables.workspaceUrl}</LinkValue>
              : <span className="text-gray-400">Not provided</span>}
          </Row>
          <Row label="Files included">
            {deliverables.dataTypes.join(', ') || <span className="text-gray-400">Not provided</span>}
          </Row>
          {deliverables.validationReportUrl && (
            <Row label="Validation report">
              <LinkValue href={deliverables.validationReportUrl}>Open report</LinkValue>
            </Row>
          )}
          <Row label="Summary">
            <span className="whitespace-pre-wrap">
              {deliverables.summary || <span className="text-gray-400">Not provided</span>}
            </span>
          </Row>
          <div className="grid gap-1.5 pt-1 sm:grid-cols-2">
            {CHECKLIST.map(([key, label]) => (
              <span key={key} className="flex items-start gap-1.5 text-xs text-gray-600">
                <CheckCircle2 className={`mt-px h-3.5 w-3.5 shrink-0 ${
                  deliverables.checklist[key] ? 'text-green-600' : 'text-gray-300'
                }`} />
                {label}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {canRequestReview && !editing && reviewState?.status === 'accepted' && (
        <div className="mt-4 border-t border-gray-200 pt-4">
          {reviewState.reviewRequestedAt ? (
            <p className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-800">
              Submitted for review{submittedOn ? ` on ${submittedOn}` : ''}. We'll let you know if anything needs changing.
            </p>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-gray-500">
                {isReady(deliverables)
                  ? 'Everything is in place.'
                  : 'Fill in every field and the checklist to submit.'}
              </p>
              <button
                type="button"
                onClick={() => void submitForReview()}
                disabled={!isReady(deliverables) || requestingReview}
                className={PRIMARY_BUTTON}
              >
                {requestingReview && <Loader2 className="h-4 w-4 animate-spin" />}
                {requestingReview ? 'Submitting…' : 'Submit for review'}
              </button>
            </div>
          )}
        </div>
      )}

      {canReview && reviewState?.reviewRequestedAt && reviewState.volunteerId && (
        <div className="mt-4 border-t border-gray-200 pt-4">
          <p className="text-xs font-semibold text-gray-800">
            Submitted by {reviewState.name}{submittedOn ? ` on ${submittedOn}` : ''}
          </p>
          {!feedbackOpen ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void completeReview()}
                disabled={reviewing}
                className={PRIMARY_BUTTON}
              >
                {reviewing ? 'Updating…' : 'Approve and mark complete'}
              </button>
              <button
                type="button"
                onClick={() => setFeedbackOpen(true)}
                className={SECONDARY_BUTTON}
              >
                Request changes
              </button>
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              <Textarea
                value={feedback}
                onChange={event => setFeedback(event.target.value)}
                rows={3}
                placeholder="What needs to change before approval?"
                className="bg-white"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setFeedbackOpen(false)}
                  className={SECONDARY_BUTTON}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void sendFeedback()}
                  disabled={reviewing || !feedback.trim()}
                  className={PRIMARY_BUTTON}
                >
                  {reviewing ? 'Sending…' : 'Send feedback'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export default CurationDeliverables;
