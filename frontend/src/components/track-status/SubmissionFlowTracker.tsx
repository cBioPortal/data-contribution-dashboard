
import React, { useState } from 'react';
import { Check, Clock, X, Trash2, AlertTriangle } from 'lucide-react';
import { updateCurationNotes, deleteSubmission } from '@/services/api';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { 
  suggestedPapersNormalFlow, 
  suggestedPapersRejectedFlow, 
  submittedDataNormalFlow, 
  submittedDataRejectedFlow,
  stepDescriptions,
  getMappedStatus
} from './flowDefinitions';

interface SubmissionFlowTrackerProps {
  currentStatus: string;
  trackType?: 'suggested-papers' | 'submitted-data';
  data?: any;
  isSuperUser?: boolean;
  currentUserEmail?: string;
  onDeleted?: (submissionId: string) => void;
}

export const SubmissionFlowTracker = ({ currentStatus, trackType = 'suggested-papers', data, isSuperUser = false, currentUserEmail = '', onDeleted }: SubmissionFlowTrackerProps) => {
  const d = (data as any) || {};
  const [curationNotes, setCurationNotes] = useState<string>(d.curationNotes || '');
  const [curationNotesArray, setCurationNotesArray] = useState<any[]>(d.curationNotesArray || []);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Sync curationNotes if the data prop changes (e.g. when switching rows)
  React.useEffect(() => {
    setCurationNotes(d.curationNotes || '');
    setCurationNotesArray(d.curationNotesArray || []);
  }, [d.submissionId, d.curationNotes]);

  // The submitter is identified by matching the logged-in email to the submission email
  const isSubmitter = !!currentUserEmail && !!d.email &&
    currentUserEmail.toLowerCase().trim() === d.email.toLowerCase().trim();

  // Determine which flow to use
  const isNotCuratable = currentStatus === 'Not Curatable' || currentStatus === 'Missing Data';
  
  let flowSteps: string[];
  if (trackType === 'suggested-papers') {
    flowSteps = isNotCuratable ? suggestedPapersRejectedFlow : suggestedPapersNormalFlow;
  } else {
    flowSteps = isNotCuratable ? submittedDataRejectedFlow : submittedDataNormalFlow;
  }
  
  const mappedStatus = isNotCuratable ? 'Rejected' : getMappedStatus(currentStatus, trackType);
  const currentStepIndex = flowSteps.indexOf(mappedStatus);
  
  const getStepStatus = (stepIndex: number) => {
    if (stepIndex < currentStepIndex) return 'completed';
    if (stepIndex === currentStepIndex) return 'current';
    return 'pending';
  };

  const getStepIcon = (stepIndex: number, status: string, step: string) => {
    if (status === 'completed') {
      return <Check className="h-4 w-4 text-white" />;
    }
    if (status === 'current') {
      if (step === 'Rejected') {
        return <X className="h-4 w-4 text-white" />;
      }
      // Show green check mark for Released status instead of blue timer
      if (step === 'Released') {
        return <Check className="h-4 w-4 text-white" />;
      }
      return <Clock className="h-4 w-4 text-white" />;
    }
    // Return empty div for pending steps instead of step number
    return <div className="w-4 h-4" />;
  };

  const getStepColor = (status: string, step: string) => {
    if (status === 'completed') return 'bg-green-500';
    if (status === 'current') {
      if (step === 'Rejected') return 'bg-red-500';
      // Show green background for Released status
      if (step === 'Released') return 'bg-green-500';
      return 'bg-blue-500';
    }
    return 'bg-gray-300';
  };

  const getTooltipProps = (index: number, totalSteps: number) => {
    if (index === 0) return { side: 'top' as const, align: 'start' as const };
    if (index === totalSteps - 1) return { side: 'top' as const, align: 'end' as const };
    return { side: 'top' as const, align: 'center' as const };
  };

  // Function to split text into lines if too long and include step number in the text
  const formatStepLabel = (step: string, stepIndex: number) => {
    const stepNumber = stepIndex + 1;
    const labelText = `${stepNumber}. ${step}`;
    const words = labelText.split(' ');
    
    if (words.length > 3) {
      const midPoint = Math.ceil(words.length / 2);
      const firstLine = words.slice(0, midPoint).join(' ');
      const secondLine = words.slice(midPoint).join(' ');
      return (
        <>
          <div>{firstLine}</div>
          <div>{secondLine}</div>
        </>
      );
    }
    return <div>{labelText}</div>;
  };

  const Field = ({ label, value }: { label: string; value?: string | null }) =>
    value ? (
      <div className="flex gap-2 text-xs">
        <span className="font-semibold text-gray-500 min-w-[130px] flex-shrink-0">{label}:</span>
        <span className="text-gray-800 break-all">{value}</span>
      </div>
    ) : null;

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div>
      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">{title}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">{children}</div>
    </div>
  );

  const isSuggest = d.submissionType === 'suggest-paper';
  const isData = d.submissionType === 'submit-data' || d.publicationType === 'preprint';
  const formatDate = (v: string) => v ? new Date(v).toLocaleString('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) + ' EST' : undefined;

  return (
    <TooltipProvider>
      <div className="bg-white rounded-lg border border-gray-200 p-4">

        {/* Superseded banner — shown when a data submission has been made for the same study */}
        {d.supersededBy && (
          <SupersededBanner
            dataSubmissionId={d.supersededBy}
            supersededAt={d.supersededAt}
            allSubmissions={[]}
          />
        )}

        <h3 className="text-sm font-semibold text-gray-700 mb-3">Submission Details</h3>
        <div className="space-y-3 mb-3 pb-3 border-b border-gray-100">

          {/* Submission metadata — always shown */}
          <Section title="Submission">
            <Field label="Submission ID" value={d.submissionId?.replace(/^submission_/, '')} />
            <Field label="Submitted" value={formatDate(d.createdAt)} />
          </Section>

          {/* Contact — only super users, or the submitter viewing their own submission */}
          {(isSuperUser || isSubmitter) && (
            <Section title="Contact">
              <Field label="Name" value={d.author} />
              <Field label="Email" value={d.email} />
              {d.canContactEmail === false && <Field label="Alt. Email" value={d.alternativeEmail} />}
            </Section>
          )}

          {/* Study suggestion fields */}
          {isSuggest && (
            <Section title="Study Information">
              <Field label="PMID / URL" value={d.pmid} />
              <Field label="Journal / Source" value={d.journal} />
              <Field label="Authors" value={d.authors} />
              <Field label="Publication Year" value={d.publicationYear} />
              <Field label="Study Title" value={d.title || d.paperTitle} />
              <Field label="Lead Author?" value={d.isLeadAuthor === true ? 'Yes' : d.isLeadAuthor === false ? 'No' : undefined} />
              <Field label="Help Curate?" value={d.wantsToHelpCurate} />
            </Section>
          )}

          {/* Data submission fields */}
          {isData && (
            <Section title="Dataset Information">
              <Field label="Study Name" value={d.studyName} />
              <Field label="Description" value={d.studyDescription} />
              <Field label="PMID / URL" value={d.pmid || d.associatedPaper} />
              <Field label="Link to Data" value={d.curatedDataLink} />
              <Field label="Curation Access Granted?" value={d.accessGranted ? 'Yes' : undefined} />
              <Field label="Data Transformed?" value={d.isDataTransformed === true ? 'Yes' : d.isDataTransformed === false ? 'No' : undefined} />
              <Field label="Reference Genome" value={d.referenceGenome} />
              <Field label="Sharing" value={d.sharingPreference} />
              {d.sharingPreference === 'private' && <Field label="Private Emails" value={d.privateAccessEmails} />}
            </Section>
          )}

          {/* Common */}
          {(d.dataTypes || d.notes) && (
            <Section title="Additional">
              <Field label="Data Types" value={d.dataTypes} />
              <Field label="Comments" value={d.notes} />
            </Section>
          )}
        </div>

        <h3 className="text-sm font-semibold text-gray-700 mb-3">Submission Progress</h3>
        
        <div className="relative">
          {/* Progress line */}
          <div className="absolute top-6 left-6 right-6 h-0.5 bg-gray-200">
            <div 
              className={`h-full transition-all duration-500 ${
                isNotCuratable && currentStepIndex >= 0 ? 'bg-red-500' : 'bg-blue-500'
              }`}
              style={{ 
                width: currentStepIndex >= 0 ? `${(currentStepIndex / (flowSteps.length - 1)) * 100}%` : '0%' 
              }}
            />
          </div>

          {/* Steps */}
          <div className="relative flex justify-between">
            {flowSteps.map((step, index) => {
              const status = getStepStatus(index);
              const tooltipProps = getTooltipProps(index, flowSteps.length);
              
              return (
                <div key={step} className="flex flex-col items-center">
                  {/* Step circle with tooltip */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div 
                        className={`
                          relative z-10 flex items-center justify-center w-12 h-12 rounded-full border-4 border-white shadow-md transition-all duration-300 cursor-help
                          ${getStepColor(status, step)}
                        `}
                      >
                        {getStepIcon(index, status, step)}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent 
                      side={tooltipProps.side}
                      align={tooltipProps.align}
                      className="max-w-[280px] text-center z-50"
                    >
                      <div className="whitespace-normal break-words leading-relaxed">
                        {stepDescriptions[step]}
                      </div>
                    </TooltipContent>
                  </Tooltip>
                  
                  {/* Step label - centered and responsive with line breaks and step numbers included in text */}
                  <div className="mt-3 text-center max-w-[120px] px-1">
                    <div className={`text-sm font-medium leading-tight text-center ${
                      status === 'current' ? (
                        step === 'Rejected' ? 'text-red-600' : 
                        step === 'Released' ? 'text-green-600' : 'text-blue-600'
                      ) : 
                      status === 'completed' ? 'text-green-600' : 'text-gray-500'
                    }`}>
                      {formatStepLabel(step, index)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

      {/* ─── Super User: Delete Submission ───────────────────────────────── */}
      {isSuperUser && d.submissionId && (
        <div className="mt-5 pt-4 border-t border-gray-100">
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-700 font-medium"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete submission
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <span className="text-xs text-red-600 font-medium">Delete this submission permanently?</span>
              <button
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  try {
                    await deleteSubmission(d.submissionId);
                    onDeleted?.(d.submissionId);
                  } catch (e) {
                    console.error('Failed to delete submission:', e);
                    setDeleting(false);
                    setConfirmDelete(false);
                  }
                }}
                className="text-xs px-2.5 py-1 rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : 'Yes, delete'}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-xs px-2.5 py-1 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {/* ─── Updates Thread ─────────────────────────────────────────────── */}
      <NotesThread
        submissionId={d.submissionId}
        curationNotes={curationNotes}
        curationNotesArray={curationNotesArray}
        curationNotesUpdatedAt={d.curationNotesUpdatedAt}
        setCurationNotes={setCurationNotes}
        setCurationNotesArray={setCurationNotesArray}
        isSuperUser={isSuperUser}
      />

    </div>
    </TooltipProvider>
  );
};

// ─── Superseded banner ───────────────────────────────────────────────────────

const SupersededBanner: React.FC<{
  dataSubmissionId: string;
  supersededAt?: string | null;
  allSubmissions: any[];
}> = ({ dataSubmissionId, supersededAt }) => {
  const [exists, setExists] = React.useState<'loading' | 'yes' | 'no'>('loading');

  React.useEffect(() => {
    const API_URL = (import.meta as any).env?.VITE_API_URL || 'http://localhost:5001';
    const token = localStorage.getItem('authToken');
    // Try the public endpoint first (no auth needed) — it only exposes published subs
    // We just need to know if the ID resolves to something
    fetch(`${API_URL}/api/submit/public`)
      .then(r => r.json())
      .then(d => {
        const found = (d.data?.submissions || []).some((s: any) => s.id === dataSubmissionId);
        if (found) { setExists('yes'); return; }
        // Also check authed endpoint if logged in
        if (!token) { setExists('no'); return; }
        return fetch(`${API_URL}/api/submit`, {
          headers: { Authorization: `Bearer ${token}` }
        }).then(r => r.json()).then(d2 => {
          const found2 = (d2.data?.submissions || []).some((s: any) => s.id === dataSubmissionId);
          setExists(found2 ? 'yes' : 'no');
        });
      })
      .catch(() => setExists('no'));
  }, [dataSubmissionId]);

  if (exists === 'loading') return null;

  const shortId = dataSubmissionId.replace(/^submission_/, '').slice(0, 8);
  const fmt = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

  return (
    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-3">
      <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
      <div className="text-xs text-amber-800">
        <span className="font-semibold">A data submission for this study has been submitted</span>
        {supersededAt && <span className="text-amber-600 ml-1">({fmt(supersededAt)})</span>}
        {exists === 'yes' ? (
          <span>
            {' — '}
            <a
              href={`/track-status?tab=submitted-data`}
              className="underline font-medium hover:text-amber-900"
            >
              View data submission
            </a>
            <span className="font-mono ml-1 opacity-60">#{shortId}</span>
          </span>
        ) : (
          <span className="text-amber-600 ml-1">(the linked submission may have been deleted)</span>
        )}
      </div>
    </div>
  );
};

// ─── Notes Thread (card list with role badge) ──────────────────────────────────

interface CurationNote {
  text: string;
  addedAt: string;
  addedBy: string;
  editedAt?: string;
}

interface NotesThreadProps {
  submissionId: string;
  curationNotes: string;
  curationNotesArray: CurationNote[];
  curationNotesUpdatedAt?: string | null;
  setCurationNotes: (v: string) => void;
  setCurationNotesArray: (v: CurationNote[]) => void;
  isSuperUser: boolean;
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });

const NotesThread: React.FC<NotesThreadProps> = ({
  submissionId, curationNotes, curationNotesArray, curationNotesUpdatedAt, setCurationNotes, setCurationNotesArray,
  isSuperUser,
}) => {
  const [editingNoteIndex, setEditingNoteIndex] = useState<number | null>(null);
  const [editingNoteText, setEditingNoteText] = useState('');
  const [draft, setDraft] = useState('');
  const [savingCuration, setSavingCuration] = useState(false);
  const [flashMsg, setFlashMsg] = useState('');

  const flash = (msg: string) => { setFlashMsg(msg); setTimeout(() => setFlashMsg(''), 3000); };

  const handlePostCuration = async () => {
    if (!draft.trim()) return;
    setSavingCuration(true);
    try {
      const res = await updateCurationNotes(submissionId, draft, 'append');
      const updated = res.data.curationNotesArray;
      setCurationNotesArray(updated);
      setCurationNotes(updated[updated.length - 1]?.text || '');
      setDraft('');
      flash('Note posted');
    } catch (e) { console.error(e); }
    finally { setSavingCuration(false); }
  };

  const handleEditCuration = async (index: number, text: string) => {
    setSavingCuration(true);
    try {
      const res = await updateCurationNotes(submissionId, text, 'edit', index);
      const updated = res.data.curationNotesArray;
      setCurationNotesArray(updated);
      setCurationNotes(updated[updated.length - 1]?.text || '');
      setEditingNoteIndex(null);
      setEditingNoteText('');
      flash('Note updated');
    } catch (e) { console.error(e); }
    finally { setSavingCuration(false); }
  };

  const hasAnyContent = !!curationNotes || curationNotesArray.length > 0 || isSuperUser;
  if (!hasAnyContent) return null;

  return (
    <div className="mt-5 pt-4 border-t border-gray-100 space-y-4">

      {/* Curation Team Notes */}
      {(isSuperUser || curationNotesArray.length > 0 || !!curationNotes) && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Curation Team</p>

          {/* Render each note */}
          {(curationNotesArray.length > 0
            ? curationNotesArray
            : curationNotes ? [{ text: curationNotes, addedAt: curationNotesUpdatedAt || '', addedBy: '' }] : []
          ).map((n, i) => (
            <div key={i} className="flex gap-2.5 items-start mb-3">
              <span className="shrink-0 mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-full bg-gray-200 text-gray-600 text-[10px] font-bold">CT</span>
              <div className="pt-0.5 flex-1 min-w-0">
                {editingNoteIndex === i ? (
                  <div>
                    <textarea
                      value={editingNoteText}
                      onChange={e => setEditingNoteText(e.target.value)}
                      rows={2}
                      className="w-full text-xs border border-gray-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:border-gray-400 resize-none"
                    />
                    <div className="flex items-center gap-2 mt-1">
                      <button
                        disabled={!editingNoteText.trim() || savingCuration}
                        onClick={() => handleEditCuration(i, editingNoteText)}
                        className="text-xs px-2.5 py-1 rounded-md bg-gray-700 text-white hover:bg-gray-800 disabled:opacity-40"
                      >{savingCuration ? 'Saving…' : 'Save'}</button>
                      <button
                        onClick={() => { setEditingNoteIndex(null); setEditingNoteText(''); }}
                        className="text-xs px-2.5 py-1 rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50"
                      >Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed">{n.text}</p>
                    <div className="flex items-center gap-3 mt-0.5">
                      {n.addedAt && <p className="text-[10px] text-gray-400">{fmt(n.addedAt)}{n.editedAt ? ' (edited)' : ''}</p>}
                      {isSuperUser && (
                        <button
                          onClick={() => { setEditingNoteIndex(i); setEditingNoteText(n.text); }}
                          className="text-[10px] text-gray-400 hover:text-blue-500"
                        >Edit</button>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          ))}

          {/* Add new note compose box */}
          {isSuperUser && (
            <div className="ml-8">
              <textarea
                value={draft}
                onChange={e => setDraft(e.target.value)}
                rows={2}
                placeholder="Add a note for the submitter…"
                className="w-full text-xs border border-gray-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:border-gray-400 resize-none"
              />
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-[10px] text-green-600">{flashMsg}</span>
                <button
                  disabled={!draft.trim() || savingCuration}
                  onClick={handlePostCuration}
                  className="text-xs px-3 py-1.5 rounded-md bg-gray-700 text-white hover:bg-gray-800 disabled:opacity-40"
                >
                  {savingCuration ? 'Posting…' : 'Post Note'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  );
};
