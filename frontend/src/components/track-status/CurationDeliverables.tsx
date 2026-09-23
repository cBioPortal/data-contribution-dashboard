import { useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, FileCheck2, Loader2, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import {
  CurationDeliverables as Deliverables,
  requestCurationChanges,
  requestCurationReview,
  reviewCurationInterest,
  saveCurationDeliverables,
} from '@/services/api';

const CHECKLIST = [
  ['accessGranted', 'I granted cdsicuration@mskcc.org access to the shared files'],
  ['deidentified', 'The files do not contain patient-identifiable information'],
  ['metadataIncluded', 'Required study, patient, and sample metadata files are included'],
  ['formatChecked', 'File names and formats follow cBioPortal requirements'],
  ['validationCompleted', 'Validation checks completed'],
  ['readmeUpdated', 'README or supporting documentation is included and current'],
] as const;

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
    className="inline-flex items-center gap-1 break-all font-medium text-blue-700 hover:underline"
  >
    {children}<ExternalLink className="h-3.5 w-3.5 shrink-0" />
  </a>
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

  return (
    <section className="mb-6 rounded-lg border border-slate-200 bg-slate-50/60 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <FileCheck2 className="h-4 w-4 text-blue-700" />
            Curated data handoff
          </h3>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">
            Upload the curated study files to approved external storage and paste the shared link below.
            Include all study metadata and applicable clinical or molecular data files, grant the
            curation team access, and do not include patient-identifiable information.
          </p>
        </div>
        {canEdit && !editing && !reviewState?.reviewRequestedAt && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-900"
          >
            <Pencil className="h-3.5 w-3.5" /> Edit deliverables
          </button>
        )}
      </div>

      {reviewState?.reviewFeedback && !reviewState.reviewRequestedAt && (
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-xs font-semibold text-amber-900">Changes requested</p>
          <p className="mt-1 text-sm text-amber-800">{reviewState.reviewFeedback}</p>
        </div>
      )}

      {editing ? (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="block min-w-0 text-xs font-semibold text-slate-700 md:col-span-2">
            Shared curated data files link *
            <input
              type="url"
              value={draft.workspaceUrl}
              onChange={event => setDraft(current => ({ ...current, workspaceUrl: event.target.value }))}
              placeholder="https://shared-folder.example/..."
              className="mt-1 block w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
            />
            <span className="mt-1 block font-normal text-slate-400">
              Confirm that cdsicuration@mskcc.org can open the link and download the files.
            </span>
          </label>
          <label className="block min-w-0 text-xs font-semibold text-slate-700">
            Validation report URL
            <input
              type="url"
              value={draft.validationReportUrl}
              onChange={event => setDraft(current => ({ ...current, validationReportUrl: event.target.value }))}
              placeholder="https://..."
              className="mt-1 block w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
            />
          </label>
          <label className="block min-w-0 text-xs font-semibold text-slate-700">
            Files included *
            <input
              value={dataTypesText}
              onChange={event => setDataTypesText(event.target.value)}
              placeholder="Study metadata, clinical, mutation, copy number"
              className="mt-1 block w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
            />
          </label>
          <label className="block min-w-0 text-xs font-semibold text-slate-700 md:col-span-2">
            Handoff summary *
            <textarea
              value={draft.summary}
              onChange={event => setDraft(current => ({ ...current, summary: event.target.value }))}
              rows={3}
              placeholder="Describe what was curated, transformed, excluded, validated, or still needs attention."
              className="mt-1 block w-full min-w-0 resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
            />
          </label>
          <div className="space-y-2 md:col-span-2">
            <p className="text-xs font-semibold text-slate-700">Required before review *</p>
            {CHECKLIST.map(([key, label]) => (
              <label key={key} className="flex items-start gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={draft.checklist[key] === true}
                  onChange={event => setDraft(current => ({
                    ...current,
                    checklist: { ...current.checklist, [key]: event.target.checked },
                  }))}
                  className="mt-0.5"
                />
                {label}
              </label>
            ))}
          </div>
          <div className="flex gap-2 md:col-span-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="rounded-md bg-[#2C5EBE] px-3 py-2 text-xs font-semibold text-white hover:bg-[#1A3B6D] disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save deliverables'}
            </button>
            {deliverables && (
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      ) : deliverables ? (
        <div className="mt-4 grid gap-4 text-sm md:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Curated data files</p>
            {deliverables.workspaceUrl
              ? <LinkValue href={deliverables.workspaceUrl}>{deliverables.workspaceUrl}</LinkValue>
              : <p className="mt-1 text-slate-500">Not provided</p>}
          </div>
          {deliverables.validationReportUrl && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Validation report</p>
              <LinkValue href={deliverables.validationReportUrl}>Open validation report</LinkValue>
            </div>
          )}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Files included</p>
            <p className="mt-1 text-slate-700">{deliverables.dataTypes.join(', ') || 'Not provided'}</p>
          </div>
          <div className="md:col-span-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Handoff summary</p>
            <p className="mt-1 whitespace-pre-wrap text-slate-700">{deliverables.summary || 'Not provided'}</p>
          </div>
          <div className="md:col-span-2 grid gap-2 sm:grid-cols-2">
            {CHECKLIST.map(([key, label]) => (
              <span key={key} className="flex items-center gap-2 text-xs text-slate-600">
                <CheckCircle2 className={`h-4 w-4 ${
                  deliverables.checklist[key] ? 'text-green-600' : 'text-slate-300'
                }`} />
                {label}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {canRequestReview && !editing && reviewState?.status === 'accepted' && (
        <div className="mt-4 border-t border-slate-200 pt-4">
          {reviewState.reviewRequestedAt ? (
            <p className="text-xs font-semibold text-blue-700">
              Submitted for curation-team review on{' '}
              {new Date(reviewState.reviewRequestedAt).toLocaleDateString()}.
            </p>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-slate-500">
                {isReady(deliverables)
                  ? 'Your deliverables are ready to submit.'
                  : 'Complete all required fields and checklist items before submitting.'}
              </p>
              <button
                type="button"
                onClick={() => void submitForReview()}
                disabled={!isReady(deliverables) || requestingReview}
                className="rounded-md bg-[#2C5EBE] px-3 py-2 text-xs font-semibold text-white hover:bg-[#1A3B6D] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {requestingReview ? 'Submitting…' : 'Submit curation for review'}
              </button>
            </div>
          )}
        </div>
      )}

      {canReview && reviewState?.reviewRequestedAt && reviewState.volunteerId && (
        <div className="mt-4 border-t border-slate-200 pt-4">
          <p className="text-sm font-semibold text-slate-800">
            Submitted by {reviewState.name} on {new Date(reviewState.reviewRequestedAt).toLocaleDateString()}
          </p>
          {!feedbackOpen ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void completeReview()}
                disabled={reviewing}
                className="rounded-md bg-[#2C5EBE] px-3 py-2 text-xs font-semibold text-white hover:bg-[#1A3B6D] disabled:opacity-50"
              >
                {reviewing ? 'Updating…' : 'Approve and mark complete'}
              </button>
              <button
                type="button"
                onClick={() => setFeedbackOpen(true)}
                className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-white"
              >
                Request changes
              </button>
            </div>
          ) : (
            <div className="mt-3">
              <textarea
                value={feedback}
                onChange={event => setFeedback(event.target.value)}
                rows={3}
                placeholder="Explain what needs to be updated before approval."
                className="w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              />
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => void sendFeedback()}
                  disabled={reviewing || !feedback.trim()}
                  className="rounded-md bg-[#2C5EBE] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {reviewing ? 'Sending…' : 'Send feedback'}
                </button>
                <button
                  type="button"
                  onClick={() => setFeedbackOpen(false)}
                  className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600"
                >
                  Cancel
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
