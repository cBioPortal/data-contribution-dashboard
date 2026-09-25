
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Clock, X, Trash2, AlertTriangle, ExternalLink, FileCheck2, Loader2, MoreHorizontal, Pencil, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import {
  deleteSubmission,
  getCurationTeamMembers,
  getCurationVolunteers,
  getQuestions,
  registerCurationVolunteer,
  reviewCurationInterest,
  updateSubmissionOverview,
  withdrawCurationVolunteer,
} from '@/services/api';
import { CurationRecord } from './CurationRecord';
import { Questions, QUESTIONS_STALE_TIME, questionsQueryKey } from './Questions';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Submission } from '@/types/submission';
import { formatSubmissionDate } from '@/utils/submissionDate';
import { isCommunityVolunteerStudy } from '@/utils/curationEligibility';
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
  currentUserId?: string;
  submissionIndex?: ReadonlyMap<string, Submission>;
  activePanelTab?: SubmissionPanelTab;
  onPanelTabChange?: (tab: SubmissionPanelTab) => void;
  onQuestionCountsChange?: (
    submissionId: string,
    total: number,
    needsResponse: number,
    latestActivityAt: string | null,
  ) => void;
  onOverviewUpdated?: (submissionId: string, updates: Partial<Submission>) => void;
  onDeleted?: (submissionId: string) => void;
  requestedOverviewAction?: {
    type: 'volunteer' | 'assign-curator';
    requestId: number;
  };
  onRequestedOverviewActionHandled?: () => void;
}

export type SubmissionPanelTab = 'details' | 'record' | 'questions';

/**
 * The "Curation & Activity" tab (README, activity log, deliverables review) is
 * paused for now — not removed, just hidden — while the workflow it supports is
 * reworked. Flip this back to `true` to bring it back; nothing else needs to
 * change.
 */
const SHOW_CURATION_ACTIVITY_TAB = false;

interface OverviewDraft {
  title: string;
  leadCuratorId: string;
  reference: string;
  journal: string;
  authors: string;
  publicationYear: string;
  isLeadAuthor: string;
  description: string;
  linkToData: string;
  referenceGenome: string;
  dataTypes: string;
  accessGranted: string;
  isDataTransformed: string;
  portalStudyUrl: string;
  datahubReadmeUrl: string;
  rejectionReason: string;
}

interface CurationVolunteer {
  id?: string;
  name: string;
  email?: string;
  designation?: string;
  currentWork?: string;
  status?: 'pending' | 'accepted' | 'completed' | 'declined' | 'withdrawn';
  createdAt?: string;
  reviewRequestedAt?: string | null;
  reviewFeedback?: string | null;
}

interface CurationVolunteersResponse {
  data: {
    volunteers: CurationVolunteer[];
    volunteerCount: number;
    myVolunteer: CurationVolunteer | null;
    currentUser: { name: string; email: string } | null;
    isAuthenticated: boolean;
    isCurator: boolean;
    signupOpen: boolean;
    canVolunteer: boolean;
  };
}

interface VolunteerDraft {
  name: string;
  email: string;
  designation: string;
  currentWork: string;
  publicNameConsent: boolean;
}

const emptyOverviewDraft: OverviewDraft = {
  title: '',
  leadCuratorId: '',
  reference: '',
  journal: '',
  authors: '',
  publicationYear: '',
  isLeadAuthor: '',
  description: '',
  linkToData: '',
  referenceGenome: '',
  dataTypes: '',
  accessGranted: '',
  isDataTransformed: '',
  portalStudyUrl: '',
  datahubReadmeUrl: '',
  rejectionReason: '',
};

const emptyVolunteerDraft: VolunteerDraft = {
  name: '',
  email: '',
  designation: '',
  currentWork: '',
  publicNameConsent: false,
};

const VOLUNTEER_DESIGNATIONS = [
  'Student',
  'Researcher',
  'Clinician',
  'Data Scientist',
  'Patient Advocate',
  'Other',
];

const VOLUNTEER_BACKGROUND_LIMIT = 500;

export const SubmissionFlowTracker = ({ currentStatus, trackType = 'suggested-papers', data, isSuperUser = false, currentUserEmail = '', currentUserId = '', submissionIndex, activePanelTab, onPanelTabChange, onQuestionCountsChange, onOverviewUpdated, onDeleted, requestedOverviewAction, onRequestedOverviewActionHandled }: SubmissionFlowTrackerProps) => {
  const d = (data as any) || {};
  const volunteerStudy = isCommunityVolunteerStudy(d);
  // Details first: expanding a row has always shown the fields and the
  // stepper, and that stays true. The record is one click away.
  const [localPanelTab, setLocalPanelTab] = useState<SubmissionPanelTab>('details');
  const panelTab = activePanelTab ?? localPanelTab;
  const [questionsActivated, setQuestionsActivated] = useState(panelTab === 'questions');
  // Filled by the Questions tab once it has loaded, so the tab label can
  // carry a count without the panel fetching the threads a second time.
  const [questionCount, setQuestionCount] = useState<number | null>(
    typeof d.questionCount === 'number' ? d.questionCount : null,
  );
  const [needsResponseCount, setNeedsResponseCount] = useState(
    typeof d.needsResponseCount === 'number' ? d.needsResponseCount : 0,
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [editingOverview, setEditingOverview] = useState(false);
  const [overviewDraft, setOverviewDraft] = useState<OverviewDraft>(emptyOverviewDraft);
  const [savingOverview, setSavingOverview] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [curationTeam, setCurationTeam] = useState<Array<{ id: string; name?: string; email: string }> | null>(null);
  const [loadingCurationTeam, setLoadingCurationTeam] = useState(false);
  const [curationTeamError, setCurationTeamError] = useState<string | null>(null);
  const [volunteerDialogOpen, setVolunteerDialogOpen] = useState(false);
  const [volunteerDraft, setVolunteerDraft] = useState<VolunteerDraft>(emptyVolunteerDraft);
  const [volunteerError, setVolunteerError] = useState<string | null>(null);
  const [confirmWithdrawVolunteer, setConfirmWithdrawVolunteer] = useState(false);
  const handledOverviewActionRef = useRef<number | null>(null);
  const queryClient = useQueryClient();
  const volunteerQueryKey = ['curation-volunteers', d.submissionId] as const;

  const volunteersQuery = useQuery<CurationVolunteersResponse>({
    queryKey: volunteerQueryKey,
    queryFn: () => getCurationVolunteers(d.submissionId),
    enabled: !!d.submissionId && volunteerStudy,
    staleTime: 60 * 1000,
  });

  const registerVolunteerMutation = useMutation({
    mutationFn: () => registerCurationVolunteer(d.submissionId, volunteerDraft),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: volunteerQueryKey });
      setVolunteerDialogOpen(false);
      setVolunteerError(null);
      onRequestedOverviewActionHandled?.();
      onOverviewUpdated?.(d.submissionId, {
        hasVolunteered: true,
        myVolunteerStatus: 'pending',
        volunteerCount: (d.volunteerCount ?? 0) + (d.hasVolunteered ? 0 : 1),
        curationInterestAccepted: false,
      });
      toast.success('Your interest in curating this study has been submitted.');
    },
    onError: (error: unknown) => {
      const message = error instanceof Error && error.message
        ? error.message
        : 'Could not submit your expression of interest.';
      setVolunteerError(message);
      toast.error(message);
    },
  });

  const withdrawVolunteerMutation = useMutation({
    mutationFn: () => withdrawCurationVolunteer(d.submissionId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: volunteerQueryKey });
      setConfirmWithdrawVolunteer(false);
      onOverviewUpdated?.(d.submissionId, {
        hasVolunteered: false,
        myVolunteerStatus: null,
        volunteerCount: Math.max(0, (d.volunteerCount ?? 0) - (d.hasVolunteered ? 1 : 0)),
        curationInterestAccepted: false,
      });

      toast.success('Your expression of interest was withdrawn.');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error && error.message
        ? error.message
        : 'Could not withdraw your expression of interest.');
    },
  });

  const reviewInterestMutation = useMutation({
    mutationFn: ({
      volunteerId,
      status,
    }: {
      volunteerId: string;
      status: 'pending' | 'accepted' | 'completed' | 'declined';
    }) => reviewCurationInterest(d.submissionId, volunteerId, status),
    onSuccess: async (_response, variables) => {
      await queryClient.invalidateQueries({ queryKey: volunteerQueryKey });
      onOverviewUpdated?.(d.submissionId, {
        curationInterestAccepted:
          variables.status === 'accepted' ||
          variables.status === 'completed' ||
          volunteersQuery.data?.data?.volunteers.some(volunteer =>
            volunteer.id !== variables.volunteerId &&
            (volunteer.status === 'accepted' || volunteer.status === 'completed')) === true,
      });

      toast.success(
        variables.status === 'accepted'
          ? 'Community Curator assigned.'
          : variables.status === 'completed'
            ? 'Completed contribution credited.'
          : 'Application status updated.',
      );
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error && error.message
        ? error.message
        : 'Could not update the application status.');
    },
  });

  const prefetchQuestions = () => {
    if (!d.submissionId) return;
    void queryClient.prefetchQuery({
      queryKey: questionsQueryKey(d.submissionId),
      queryFn: () => getQuestions(d.submissionId),
      staleTime: QUESTIONS_STALE_TIME,
    }).then(() => {
      const cached = queryClient.getQueryData<any>(questionsQueryKey(d.submissionId));
      if (Array.isArray(cached?.data?.threads)) {
        setQuestionCount(cached.data.threads.length);
        setNeedsResponseCount(cached.data.needsResponseCount ?? 0);
      }
    });
  };

  useEffect(() => {
    if (panelTab === 'questions') setQuestionsActivated(true);
  }, [panelTab]);

  // Mirrors the backend's isOwnedBy() (submitRoutes.js): the account filed it, or
  // the login email is the address on the form. Both anchored on the logged-in
  // identity, so a different form email neither disowns a record the account filed
  // nor claims one for whoever owns that address.
  const isSubmitter =
    (!!currentUserId && d.userId === currentUserId) ||
    (!!currentUserEmail && !!d.email &&
      currentUserEmail.toLowerCase().trim() === d.email.toLowerCase().trim());

  const handleQuestionCountsChange = useCallback((counts: {
    total: number;
    needsResponse: number;
    latestActivityAt: string | null;
  }) => {
    setQuestionCount(counts.total);
    setNeedsResponseCount(counts.needsResponse);
    if (d.submissionId) {
      onQuestionCountsChange?.(
        d.submissionId,
        counts.total,
        isSuperUser || isSubmitter ? counts.needsResponse : 0,
        counts.latestActivityAt,
      );
    }
  }, [d.submissionId, isSubmitter, isSuperUser, onQuestionCountsChange]);

  // Determine which flow to use
  const isRejected = currentStatus === 'Rejected' || currentStatus === 'Not Curatable' || currentStatus === 'Missing Data';
  
  let flowSteps: string[];
  if (trackType === 'suggested-papers') {
    flowSteps = isRejected ? suggestedPapersRejectedFlow : suggestedPapersNormalFlow;
  } else {
    flowSteps = isRejected ? submittedDataRejectedFlow : submittedDataNormalFlow;
  }
  
  const mappedStatus = isRejected ? 'Rejected' : getMappedStatus(currentStatus, trackType);
  const currentStepIndex = flowSteps.indexOf(mappedStatus);
  const rejectionReason = isRejected && typeof d.rejectionReason === 'string' && d.rejectionReason.trim()
    ? d.rejectionReason.trim()
    : undefined;
  
  const getStepStatus = (stepIndex: number) => {
    if (stepIndex < currentStepIndex) return 'completed';
    if (stepIndex === currentStepIndex) return 'current';
    return 'pending';
  };




  // Split longer labels across two balanced lines.
  const formatStepLabel = (step: string) => {
    const words = step.split(' ');
    if (words.length > 3) {
      const mid = Math.ceil(words.length / 2);
      return (
        <>
          <div>{words.slice(0, mid).join(' ')}</div>
          <div>{words.slice(mid).join(' ')}</div>
        </>
      );
    }
    return <div>{step}</div>;
  };

  const getStepIcon = (stepIndex: number, status: string, step: string) => {
    if (status === 'completed') return <Check className="h-5 w-5 text-white" />;
    if (status === 'current') {
      if (step === 'Rejected') return <X className="h-5 w-5 text-white" />;
      // Released is an ending, not a state to wait in — a tick, not a clock.
      if (step === 'Released') return <Check className="h-5 w-5 text-white" />;
      return <Clock className="h-5 w-5 text-white" />;
    }
    // The step number is on the label, so the node stays empty rather than
    // printing it twice.
    return null;
  };

  const getStepColor = (status: string, step: string) => {
    if (status === 'completed') return 'bg-green-500';
    if (status === 'current') {
      if (step === 'Rejected') return 'bg-red-500';
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
  const Field = ({ label, value }: { label: string; value?: React.ReactNode }) =>
    value ? (
      <div className="grid grid-cols-1 gap-0.5 text-xs sm:grid-cols-[minmax(108px,auto)_1fr] sm:gap-3">
        <span className="font-semibold text-gray-500">{label}</span>
        <span className="min-w-0 break-words text-gray-800">{value}</span>
      </div>
    ) : null;

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section className="rounded-xl border border-gray-200 bg-gray-50/60 p-4">
      <h4 className="mb-3 text-[11px] font-bold uppercase tracking-widest text-gray-500">{title}</h4>
      <div className="space-y-2.5">{children}</div>
    </section>
  );

  const isSuggest = d.submissionType === 'suggest-paper';
  const isData = d.submissionType === 'submit-data' || d.publicationType === 'preprint';
  const displayTitle = d.title || d.paperTitle || d.studyName ||
    `${isSuggest ? 'Study suggestion' : 'Data submission'}${d.pmid || d.associatedPaper ? ` · ${d.pmid || d.associatedPaper}` : ''}`;
  const statusTone = mappedStatus === 'Released'
    ? 'bg-green-100 text-green-800'
    : mappedStatus === 'Rejected'
      ? 'bg-red-100 text-red-800'
      : 'bg-blue-100 text-blue-800';
  const reference = d.pmid || d.associatedPaper;
  const referenceValue = reference
    ? (/^\d+$/.test(reference)
        ? <a className="text-blue-600 underline hover:text-blue-800" href={`https://pubmed.ncbi.nlm.nih.gov/${reference}/`} target="_blank" rel="noopener noreferrer">{reference}</a>
        : /^https?:\/\//i.test(reference)
          ? <a className="text-blue-600 underline hover:text-blue-800" href={reference} target="_blank" rel="noopener noreferrer">{reference}</a>
          : reference)
    : undefined;
  const volunteerData = volunteersQuery.data?.data;
  const myVolunteer = volunteerData?.myVolunteer;
  const yesNoValue = (value: unknown) => {
    if (value === true || String(value).toLowerCase() === 'yes') return 'Yes';
    if (value === false || String(value).toLowerCase() === 'no') return 'No';
    return typeof value === 'string' ? value : undefined;
  };
  const booleanDraft = (value: unknown) =>
    value === true ? 'true' : value === false ? 'false' : '';
  const draftBoolean = (value: string) =>
    value === 'true' ? true : value === 'false' ? false : null;

  const loadCurationTeam = async () => {
    setLoadingCurationTeam(true);
    setCurationTeamError(null);
    try {
      const response = await getCurationTeamMembers();
      setCurationTeam(response.data.users);
    } catch (error) {
      console.error('Failed to load curation team:', error);
      setCurationTeamError('Could not load curation-team members.');
    } finally {
      setLoadingCurationTeam(false);
    }
  };

  const openOverviewEditor = () => {
    setOverviewError(null);
    setOverviewDraft({
      title: String(isSuggest ? (d.paperTitle || d.title || '') : (d.studyName || d.title || '')),
      leadCuratorId: String(d.leadCuratorId || ''),
      reference: String(isSuggest ? (d.pmid || '') : (d.associatedPaper || d.pmid || '')),
      journal: String(d.journal || ''),
      authors: String(d.authors || ''),
      publicationYear: String(d.publicationYear || ''),
      isLeadAuthor: booleanDraft(d.isLeadAuthor),
      description: String(d.studyDescription || ''),
      linkToData: String(d.curatedDataLink || ''),
      referenceGenome: String(d.referenceGenome || ''),
      dataTypes: Array.isArray(d.dataTypes) ? d.dataTypes.join(', ') : String(d.dataTypes || ''),
      accessGranted: booleanDraft(d.accessGranted),
      isDataTransformed: booleanDraft(d.isDataTransformed),
      portalStudyUrl: String(d.portalStudyUrl || ''),
      datahubReadmeUrl: String(d.datahubReadmeUrl || ''),
      rejectionReason: String(d.rejectionReason || ''),
    });
    setEditingOverview(true);
    if (!curationTeam) void loadCurationTeam();
  };

  const openVolunteerDialog = () => {
    const volunteerData = volunteersQuery.data?.data;
    const mine = volunteerData?.myVolunteer;
    const currentUser = volunteerData?.currentUser;
    setVolunteerError(null);
    setVolunteerDraft({
      name: mine?.name || currentUser?.name || '',
      email: mine?.email || currentUser?.email || currentUserEmail || '',
      designation: mine?.designation || '',
      currentWork: mine?.currentWork || '',
      publicNameConsent: false,
    });
    setVolunteerDialogOpen(true);
  };

  useEffect(() => {
    if (!volunteerDialogOpen || !volunteersQuery.data?.data) return;
    const volunteerData = volunteersQuery.data.data;
    const mine = volunteerData.myVolunteer;
    const currentUser = volunteerData.currentUser;
    setVolunteerDraft(current => ({
      ...current,
      name: current.name || mine?.name || currentUser?.name || '',
      email: current.email || mine?.email || currentUser?.email || currentUserEmail || '',
      designation: current.designation || mine?.designation || '',
      currentWork: current.currentWork || mine?.currentWork || '',
    }));
  }, [currentUserEmail, volunteerDialogOpen, volunteersQuery.data]);

  useEffect(() => {
    if (!requestedOverviewAction ||
        handledOverviewActionRef.current === requestedOverviewAction.requestId) {
      return;
    }

    handledOverviewActionRef.current = requestedOverviewAction.requestId;
    if (requestedOverviewAction.type === 'assign-curator') {
      openOverviewEditor();
    } else {
      openVolunteerDialog();
    }
    // The request id makes this effect one-shot; dialog builders intentionally
    // use the latest query data without becoming render-triggering dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedOverviewAction, volunteersQuery.data]);

  const saveOverview = async () => {
    if (!d.submissionId) return;
    setSavingOverview(true);
    setOverviewError(null);

    const common = {
      leadCuratorId: overviewDraft.leadCuratorId || null,
      portalStudyUrl: overviewDraft.portalStudyUrl,
      datahubReadmeUrl: overviewDraft.datahubReadmeUrl,
      rejectionReason: overviewDraft.rejectionReason,
    };
    const updates = isSuggest
      ? {
          ...common,
          paperTitle: overviewDraft.title,
          pmid: overviewDraft.reference,
          journal: overviewDraft.journal,
          authors: overviewDraft.authors,
          publicationYear: overviewDraft.publicationYear,
          isLeadAuthor: draftBoolean(overviewDraft.isLeadAuthor),
        }
      : {
          ...common,
          studyName: overviewDraft.title,
          description: overviewDraft.description,
          associatedPaper: overviewDraft.reference,
          linkToData: overviewDraft.linkToData,
          referenceGenome: overviewDraft.referenceGenome,
          dataTypes: overviewDraft.dataTypes.split(',').map(value => value.trim()).filter(Boolean),
          accessGranted: draftBoolean(overviewDraft.accessGranted),
          isDataTransformed: draftBoolean(overviewDraft.isDataTransformed),
        };

    try {
      const response = await updateSubmissionOverview(d.submissionId, updates);
      const updated = response.data.submission;
      onOverviewUpdated?.(d.submissionId, {
        title: updated.submissionType === 'suggest-paper'
          ? updated.paperTitle
          : updated.studyName,
        paperTitle: updated.paperTitle,
        studyName: updated.studyName,
        pmid: updated.pmid,
        journal: updated.journal,
        authors: updated.authors,
        publicationYear: updated.publicationYear,
        isLeadAuthor: updated.isLeadAuthor,
        studyDescription: updated.description,
        associatedPaper: updated.associatedPaper,
        curatedDataLink: updated.linkToData,
        referenceGenome: updated.referenceGenome,
        dataTypes: Array.isArray(updated.dataTypes) ? updated.dataTypes.join(', ') : updated.dataTypes,
        accessGranted: updated.accessGranted,
        isDataTransformed: updated.isDataTransformed,
        portalStudyUrl: updated.portalStudyUrl,
        datahubReadmeUrl: updated.datahubReadmeUrl,
        rejectionReason: updated.rejectionReason,
        leadCuratorId: updated.leadCuratorId,
        leadCuratorName: updated.leadCuratorName,
      });
      await queryClient.invalidateQueries({ queryKey: volunteerQueryKey });
      setEditingOverview(false);
      onRequestedOverviewActionHandled?.();
      toast.success('Submission overview updated.');
    } catch (error) {
      console.error('Failed to update submission overview:', error);
      const message = error instanceof Error && error.message
        ? error.message
        : 'Failed to update submission overview.';
      setOverviewError(message);
      toast.error(message);
    } finally {
      setSavingOverview(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteSubmission(d.submissionId);
      onDeleted?.(d.submissionId);
    } catch (error) {
      console.error('Failed to delete submission:', error);
      const message = error instanceof Error && error.message
        ? error.message
        : 'Failed to delete submission.';
      setDeleteError(message);
      toast.error(message);
      setDeleting(false);
    }
  };

  return (
    <TooltipProvider>
      <div className="rounded-lg border border-gray-200 bg-white p-3 sm:p-5">
        <div className="w-full">

        {/* Superseded banner — shown when a data submission has been made for the same study */}
        {d.supersededBy && (
          <SupersededBanner
            dataSubmissionId={d.supersededBy}
            supersededAt={d.supersededAt}
            targetSubmission={submissionIndex?.get(d.supersededBy)}
          />
        )}

        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="max-w-4xl break-words text-lg font-semibold leading-tight tracking-tight text-slate-900 sm:text-xl">
              {displayTitle}
            </h3>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {SHOW_CURATION_ACTIVITY_TAB && d.submissionId && (
              <Link
                to={`/study/${d.submissionId}`}
                className="inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-md border border-gray-200 bg-white px-3 text-xs font-semibold text-blue-600 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-800"
              >
                Open full record <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            )}
            {isSuperUser && d.submissionId && (
              <details className="relative">
                <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-600 hover:bg-gray-50">
                  <MoreHorizontal className="h-4 w-4" /> Actions
                </summary>
                <div className="absolute right-0 z-30 mt-1 min-w-[180px] rounded-lg border border-gray-200 bg-white p-1 shadow-lg">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.currentTarget.closest('details')?.removeAttribute('open');
                      openOverviewEditor();
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    <Pencil className="h-3.5 w-3.5" /> Edit overview
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.currentTarget.closest('details')?.removeAttribute('open');
                      setDeleteError(null);
                      setConfirmDelete(true);
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-medium text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete submission
                  </button>
                </div>
              </details>
            )}
          </div>
        </header>

        {confirmDelete && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs font-medium text-red-700">Delete this submission permanently?</span>
              <button
                type="button"
                disabled={deleting}
                onClick={handleDelete}
                className="rounded-md bg-red-600 px-2.5 py-1 text-xs text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : 'Yes, delete'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmDelete(false);
                  setDeleteError(null);
                }}
                className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
            {deleteError && <p role="alert" className="mt-2 text-xs text-red-600">{deleteError}</p>}
          </div>
        )}

        <Dialog
          open={editingOverview}
          onOpenChange={(open) => {
            if (!savingOverview) {
              setEditingOverview(open);
              if (!open) onRequestedOverviewActionHandled?.();
            }
          }}
        >
          <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit submission overview</DialogTitle>
              <DialogDescription>
                Update the metadata displayed in the tracker and add an optional cBioPortal study link.
              </DialogDescription>
            </DialogHeader>

            <form
              className="space-y-5"
              onSubmit={(event) => {
                event.preventDefault();
                void saveOverview();
              }}
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="space-y-1.5 text-xs font-medium text-gray-600 sm:col-span-2">
                  <span>{isSuggest ? 'Paper title' : 'Study name'}</span>
                  <Input
                    value={overviewDraft.title}
                    onChange={event => setOverviewDraft(current => ({ ...current, title: event.target.value }))}
                    maxLength={500}
                  />
                </label>
                <label className="space-y-1.5 text-xs font-medium text-gray-600 sm:col-span-2">
                  <span>cBioPortal study link</span>
                  <Input
                    type="url"
                    placeholder="https://www.cbioportal.org/study/summary?id=..."
                    value={overviewDraft.portalStudyUrl}
                    onChange={event => setOverviewDraft(current => ({ ...current, portalStudyUrl: event.target.value }))}
                    maxLength={2000}
                  />
                </label>
                <label className="space-y-1.5 text-xs font-medium text-gray-600 sm:col-span-2">
                  <span>Curation &amp; transformation notes link</span>
                  <Input
                    type="url"
                    placeholder="https://github.com/cBioPortal/datahub/blob/master/.../README.md"
                    value={overviewDraft.datahubReadmeUrl}
                    onChange={event => setOverviewDraft(current => ({ ...current, datahubReadmeUrl: event.target.value }))}
                    maxLength={2000}
                  />
                </label>
                <label className="space-y-1.5 text-xs font-medium text-gray-600 sm:col-span-2">
                  <span>Rejection reason</span>
                  <textarea
                    placeholder="If the submission is rejected, explain why. Shown to the submitter on the tracker."
                    value={overviewDraft.rejectionReason}
                    onChange={event => setOverviewDraft(current => ({ ...current, rejectionReason: event.target.value }))}
                    maxLength={2000}
                    rows={3}
                    className="flex min-h-[80px] w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </label>
                <label className="space-y-1.5 text-xs font-medium text-gray-600 sm:col-span-2">
                  <span>Lead Curator</span>
                  <select
                    value={overviewDraft.leadCuratorId}
                    disabled={loadingCurationTeam}
                    onChange={event => setOverviewDraft(current => ({ ...current, leadCuratorId: event.target.value }))}
                    className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
                  >
                    <option value="">{loadingCurationTeam ? 'Loading curation team…' : 'Unassigned'}</option>
                    {overviewDraft.leadCuratorId &&
                      !curationTeam?.some(member => member.id === overviewDraft.leadCuratorId) && (
                        <option value={overviewDraft.leadCuratorId}>
                          {d.leadCuratorName || 'Current assignment'}
                        </option>
                      )}
                    {curationTeam?.map(member => (
                      <option key={member.id} value={member.id}>
                        {member.name || member.email}{member.name ? ` (${member.email})` : ''}
                      </option>
                    ))}
                  </select>
                  {curationTeamError && (
                    <span className="flex items-center gap-2 font-normal text-red-600">
                      {curationTeamError}
                      <button type="button" onClick={() => void loadCurationTeam()} className="underline">
                        Try again
                      </button>
                    </span>
                  )}
                </label>

                <label className="space-y-1.5 text-xs font-medium text-gray-600">
                  <span>PMID / URL</span>
                  <Input
                    value={overviewDraft.reference}
                    onChange={event => setOverviewDraft(current => ({ ...current, reference: event.target.value }))}
                    maxLength={500}
                  />
                </label>

                {isSuggest ? (
                  <>
                    <label className="space-y-1.5 text-xs font-medium text-gray-600">
                      <span>Journal / source</span>
                      <Input
                        value={overviewDraft.journal}
                        onChange={event => setOverviewDraft(current => ({ ...current, journal: event.target.value }))}
                        maxLength={500}
                      />
                    </label>
                    <label className="space-y-1.5 text-xs font-medium text-gray-600 sm:col-span-2">
                      <span>Authors</span>
                      <Input
                        value={overviewDraft.authors}
                        onChange={event => setOverviewDraft(current => ({ ...current, authors: event.target.value }))}
                        maxLength={2000}
                      />
                    </label>
                    <label className="space-y-1.5 text-xs font-medium text-gray-600">
                      <span>Publication year</span>
                      <Input
                        inputMode="numeric"
                        value={overviewDraft.publicationYear}
                        onChange={event => setOverviewDraft(current => ({ ...current, publicationYear: event.target.value }))}
                        maxLength={4}
                      />
                    </label>
                    <label className="space-y-1.5 text-xs font-medium text-gray-600">
                      <span>Lead author</span>
                      <select
                        value={overviewDraft.isLeadAuthor}
                        onChange={event => setOverviewDraft(current => ({ ...current, isLeadAuthor: event.target.value }))}
                        className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">Not specified</option>
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                      </select>
                    </label>
                  </>
                ) : (
                  <>
                    <label className="space-y-1.5 text-xs font-medium text-gray-600">
                      <span>Link to data</span>
                      <Input
                        value={overviewDraft.linkToData}
                        onChange={event => setOverviewDraft(current => ({ ...current, linkToData: event.target.value }))}
                        maxLength={2000}
                      />
                    </label>
                    <label className="space-y-1.5 text-xs font-medium text-gray-600">
                      <span>Reference genome</span>
                      <Input
                        value={overviewDraft.referenceGenome}
                        onChange={event => setOverviewDraft(current => ({ ...current, referenceGenome: event.target.value }))}
                        maxLength={200}
                      />
                    </label>
                    <label className="space-y-1.5 text-xs font-medium text-gray-600">
                      <span>Data types</span>
                      <Input
                        placeholder="Mutation, CNA, clinical"
                        value={overviewDraft.dataTypes}
                        onChange={event => setOverviewDraft(current => ({ ...current, dataTypes: event.target.value }))}
                      />
                    </label>
                    <label className="space-y-1.5 text-xs font-medium text-gray-600">
                      <span>Curation access</span>
                      <select
                        value={overviewDraft.accessGranted}
                        onChange={event => setOverviewDraft(current => ({ ...current, accessGranted: event.target.value }))}
                        className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">Not specified</option>
                        <option value="true">Granted</option>
                        <option value="false">Not granted</option>
                      </select>
                    </label>
                    <label className="space-y-1.5 text-xs font-medium text-gray-600">
                      <span>Data transformed</span>
                      <select
                        value={overviewDraft.isDataTransformed}
                        onChange={event => setOverviewDraft(current => ({ ...current, isDataTransformed: event.target.value }))}
                        className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">Not specified</option>
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                      </select>
                    </label>
                    <label className="space-y-1.5 text-xs font-medium text-gray-600 sm:col-span-2">
                      <span>Description</span>
                      <Textarea
                        value={overviewDraft.description}
                        onChange={event => setOverviewDraft(current => ({ ...current, description: event.target.value }))}
                        maxLength={5000}
                      />
                    </label>
                  </>
                )}
              </div>

              {overviewError && <p role="alert" className="text-xs text-red-600">{overviewError}</p>}

              <DialogFooter>
                <button
                  type="button"
                  disabled={savingOverview}
                  onClick={() => {
                    setEditingOverview(false);
                    onRequestedOverviewActionHandled?.();
                  }}
                  className="rounded-md border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingOverview}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {savingOverview && <Loader2 className="h-4 w-4 animate-spin" />}
                  {savingOverview ? 'Saving…' : 'Save overview'}
                </button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog
          open={volunteerDialogOpen}
          onOpenChange={(open) => {
            if (!registerVolunteerMutation.isPending) {
              setVolunteerDialogOpen(open);
              if (!open) onRequestedOverviewActionHandled?.();
            }
          }}
        >
          <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Interested in helping curate this study?</DialogTitle>
              <DialogDescription>
                Help make cancer research data in cBioPortal more accessible.
              </DialogDescription>
            </DialogHeader>

            <div className="group flex items-center gap-3 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 transition-colors hover:border-orange-300 hover:bg-orange-100/70">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-orange-700 shadow-sm transition-transform duration-200 group-hover:scale-110 group-hover:-rotate-6">
                <UserPlus className="h-4 w-4" />
              </div>
              <div className="space-y-0.5">
                <p className="text-sm font-semibold text-gray-900">We'd love your help! 👋</p>
                <p className="text-xs leading-relaxed text-gray-600">
                  Tell us about yourself, and we'll get back to you.
                </p>
              </div>
            </div>

            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                registerVolunteerMutation.mutate();
              }}
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block space-y-1.5 text-xs font-semibold text-gray-700">
                  <span>Name</span>
                  <Input
                    required
                    className="font-normal"
                    value={volunteerDraft.name}
                    onChange={event => setVolunteerDraft(current => ({ ...current, name: event.target.value }))}
                    maxLength={200}
                  />
                </label>
                <label className="block space-y-1.5 text-xs font-semibold text-gray-700">
                  <span>Email</span>
                  <Input
                    required
                    type="email"
                    className="font-normal"
                    value={volunteerDraft.email}
                    onChange={event => setVolunteerDraft(current => ({ ...current, email: event.target.value }))}
                    maxLength={320}
                  />
                </label>
              </div>
              <label className="block space-y-1.5 text-xs font-semibold text-gray-700">
                <span>Which best describes you?</span>
                <select
                  required
                  value={volunteerDraft.designation}
                  onChange={event => setVolunteerDraft(current => ({ ...current, designation: event.target.value }))}
                  className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-normal focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select one</option>
                  {VOLUNTEER_DESIGNATIONS.map(designation => (
                    <option key={designation} value={designation}>{designation}</option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1.5 text-xs font-semibold text-gray-700">
                <span>What's your background?</span>
                <Textarea
                  required
                  className="font-normal"
                  placeholder="e.g. PhD student in cancer genomics, working with RNA-seq data"
                  value={volunteerDraft.currentWork}
                  onChange={event => setVolunteerDraft(current => ({ ...current, currentWork: event.target.value }))}
                  maxLength={VOLUNTEER_BACKGROUND_LIMIT}
                />
                <span className={`block text-right text-[11px] font-normal ${volunteerDraft.currentWork.length >= VOLUNTEER_BACKGROUND_LIMIT - 50 ? 'text-orange-600' : 'text-gray-400'}`}>
                  {volunteerDraft.currentWork.length}/{VOLUNTEER_BACKGROUND_LIMIT}
                </span>
              </label>
              <label className="flex items-start gap-2 text-xs text-gray-600">
                <input
                  required
                  type="checkbox"
                  checked={volunteerDraft.publicNameConsent}
                  onChange={event => setVolunteerDraft(current => ({ ...current, publicNameConsent: event.target.checked }))}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300"
                />
                <span>I understand this is an application. If accepted, my name will be shown publicly as the Community Curator; my other details stay private.</span>
              </label>

              {volunteerError && <p role="alert" className="text-xs text-red-600">{volunteerError}</p>}

              <DialogFooter>
                <button
                  type="button"
                  disabled={registerVolunteerMutation.isPending}
                  onClick={() => {
                    setVolunteerDialogOpen(false);
                    onRequestedOverviewActionHandled?.();
                  }}
                  className="rounded-md border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={registerVolunteerMutation.isPending}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {registerVolunteerMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  {registerVolunteerMutation.isPending ? 'Submitting…' : 'Submit interest'}
                </button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <Tabs
          value={panelTab}
          onValueChange={(value) => {
            const next = value as 'details' | 'record' | 'questions';
            setLocalPanelTab(next);
            onPanelTabChange?.(next);
            if (next === 'questions') setQuestionsActivated(true);
          }}
        >
          <TabsList className="flex h-auto w-full justify-start gap-1 overflow-x-auto overflow-y-hidden rounded-none border-b border-gray-200 bg-transparent p-0 mb-4">
            <TabsTrigger
              value="details"
              className="shrink-0 rounded-none border-b-2 border-transparent bg-transparent px-2 py-2 text-xs font-semibold text-gray-500 shadow-none hover:text-gray-700 data-[state=active]:border-blue-600 data-[state=active]:bg-transparent data-[state=active]:text-gray-900 data-[state=active]:shadow-none sm:px-3 sm:text-[13px]"
            >
              Overview
            </TabsTrigger>
            {SHOW_CURATION_ACTIVITY_TAB && (
              <TabsTrigger
                value="record"
                className="shrink-0 rounded-none border-b-2 border-transparent bg-transparent px-2 py-2 text-xs font-semibold text-gray-500 shadow-none hover:text-gray-700 data-[state=active]:border-blue-600 data-[state=active]:bg-transparent data-[state=active]:text-gray-900 data-[state=active]:shadow-none sm:px-3 sm:text-[13px]"
              >
                Curation &amp; Activity
              </TabsTrigger>
            )}
            <TabsTrigger
              value="questions"
              onPointerEnter={prefetchQuestions}
              onFocus={prefetchQuestions}
              onTouchStart={prefetchQuestions}
              className="shrink-0 rounded-none border-b-2 border-transparent bg-transparent px-2 py-2 text-xs font-semibold text-gray-500 shadow-none hover:text-gray-700 data-[state=active]:border-blue-600 data-[state=active]:bg-transparent data-[state=active]:text-gray-900 data-[state=active]:shadow-none sm:px-3 sm:text-[13px]"
            >
              <span>Questions ({questionCount ?? 0})</span>
              {needsResponseCount > 0 && (
                <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                  {needsResponseCount} {needsResponseCount === 1 ? 'needs' : 'need'} response
                </span>
              )}
            </TabsTrigger>
          </TabsList>

        <TabsContent value="details" className="mt-0">
          <div className="space-y-4">
            <section className="grid grid-cols-1 divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-200 bg-white sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              <div className="px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Submitted</p>
                <p className="mt-1 text-sm font-semibold text-gray-800">
                  {formatSubmissionDate(d.createdAt) || 'Not available'}
                </p>
              </div>
              <div className="px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Current stage</p>
                <span className={`mt-1 inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ${statusTone}`}>
                  {mappedStatus}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setLocalPanelTab('questions');
                  onPanelTabChange?.('questions');
                  setQuestionsActivated(true);
                }}
                className="px-4 py-3 text-left hover:bg-gray-50"
              >
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Questions</p>
                <div className="mt-1 flex items-center gap-2 text-sm font-semibold text-gray-800">
                  <span>{questionCount ?? 0}</span>
                  {needsResponseCount > 0 && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                      {needsResponseCount === 1 ? 'Needs response' : `${needsResponseCount} need response`}
                    </span>
                  )}
                </div>
              </button>
            </section>

            <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
              <div className="min-w-0 space-y-4">
              {isSuggest && (
                <Section title="Study information">
                  <Field label="PMID / URL" value={referenceValue} />
                  <Field label="Journal / source" value={d.journal} />
                  <Field label="Authors" value={d.authors} />
                  <Field label="Publication year" value={d.publicationYear} />
                  <Field label="Study title" value={d.title || d.paperTitle} />
                  <Field label="Lead author" value={yesNoValue(d.isLeadAuthor)} />
                  <Field label="Willing to help curate" value={yesNoValue(d.wantsToHelpCurate)} />
                </Section>
              )}

              {isData && (
                <Section title="Dataset information">
                  <Field label="Study name" value={d.studyName} />
                  <Field label="Description" value={d.studyDescription} />
                  <Field label="PMID / URL" value={referenceValue} />
                  <Field label="Link to data" value={d.curatedDataLink} />
                  <Field label="Curation access" value={d.accessGranted ? 'Granted' : undefined} />
                  <Field label="Data transformed" value={d.isDataTransformed === true ? 'Yes' : d.isDataTransformed === false ? 'No' : undefined} />
                  <Field label="Reference genome" value={d.referenceGenome} />
                  <Field label="Sharing" value={d.sharingPreference} />
                  {d.sharingPreference === 'private' && <Field label="Private emails" value={d.privateAccessEmails} />}
                </Section>
              )}

              {(d.dataTypes || d.notes) && (
                <Section title="Additional information">
                  <Field label="Data types" value={d.dataTypes} />
                  <Field label="Comments" value={d.notes} />
                </Section>
              )}

              {(isSuperUser || isSubmitter) && (
                <Section title="Contact">
                  <Field label="Name" value={d.author} />
                  <Field label="Email" value={d.email} />
                  {d.canContactEmail === false && <Field label="Alternative email" value={d.alternativeEmail} />}
                </Section>
              )}
              </div>

              <div className="min-w-0 space-y-4">
              <Section title="Curation">
                <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5">
                  <span className="text-xs font-medium text-gray-500">Lead Curator</span>
                  <span className={`truncate text-sm font-semibold ${
                    d.leadCuratorName ? 'text-gray-800' : 'text-gray-400'
                  }`}>
                    {d.leadCuratorName || 'Unassigned'}
                  </span>
                </div>

                {volunteerStudy && <div className="border-t border-gray-200 pt-2.5">
                  {(() => {
                    const hasCompleted = volunteerData?.volunteers.some(volunteer => volunteer.status === 'completed');
                    const hasAccepted = volunteerData?.volunteers.some(volunteer => volunteer.status === 'accepted');
                    // The "Interested in helping?" prompt is only meaningful when a
                    // button or sign-in message actually renders below it — otherwise
                    // it's a heading with nothing under it.
                    const hasOpenPrompt = !!volunteerData && (
                      myVolunteer?.status === 'pending' ||
                      myVolunteer?.status === 'accepted' ||
                      myVolunteer?.status === 'completed' ||
                      myVolunteer?.status === 'declined' ||
                      (volunteerData.signupOpen && volunteerData.canVolunteer) ||
                      (volunteerData.signupOpen && !volunteerData.isAuthenticated)
                    );
                    const showHeader = volunteerData?.isCurator || hasCompleted || hasAccepted || hasOpenPrompt;
                    if (!showHeader) return null;
                    return (
                      <div className="mb-2 flex items-center gap-2">
                        <Users className="h-4 w-4 text-gray-500" />
                        <span className="text-xs font-semibold text-gray-700">
                          {volunteerData?.isCurator
                            ? 'Expressions of interest'
                            : hasCompleted
                              ? 'Community Contributor'
                              : hasAccepted
                                ? 'Community Curator'
                                : 'Interested in helping?'}
                          {volunteerData?.isCurator ? ` (${volunteerData.volunteerCount})` : ''}
                        </span>
                      </div>
                    );
                  })()}

                  {volunteersQuery.isPending && (
                    <p className="flex items-center gap-2 text-xs text-gray-400">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading interest…
                    </p>
                  )}
                  {volunteersQuery.isError && (
                    <p className="text-xs text-red-600">
                      Could not load expressions of interest.{' '}
                      <button type="button" onClick={() => void volunteersQuery.refetch()} className="underline">
                        Try again
                      </button>
                    </p>
                  )}

                  {volunteerData && (
                    <div className="space-y-3">
                      {volunteerData.isCurator ? (
                        volunteerData.volunteers.length > 0 ? (
                          <div className="space-y-2">
                            {volunteerData.volunteers.map((volunteer, index) => (
                              <div
                                key={volunteer.id || `${volunteer.name}-${index}`}
                                className={`rounded-lg border px-3 py-2 text-xs ${
                                  volunteer.status === 'withdrawn'
                                    ? 'border-gray-200 bg-gray-100 text-gray-500'
                                    : volunteer.status === 'accepted' || volunteer.status === 'completed'
                                      ? 'border-green-200 bg-green-50 text-gray-700'
                                      : volunteer.status === 'declined'
                                        ? 'border-red-200 bg-red-50 text-gray-700'
                                        : 'border-orange-200 bg-orange-50/70 text-gray-700'
                                }`}
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="font-semibold">{volunteer.name}</span>
                                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                                    volunteer.status === 'accepted' || volunteer.status === 'completed'
                                      ? 'bg-green-100 text-green-800'
                                      : volunteer.status === 'declined'
                                        ? 'bg-red-100 text-red-800'
                                        : volunteer.status === 'withdrawn'
                                          ? 'bg-gray-200 text-gray-600'
                                          : 'bg-orange-100 text-orange-800'
                                  }`}>
                                    {volunteer.status === 'accepted'
                                      ? 'Assigned'
                                      : volunteer.status === 'completed'
                                        ? 'Completed'
                                      : volunteer.status || 'pending'}
                                  </span>
                                </div>
                                <div className="mt-1 space-y-0.5">
                                  {volunteer.email && (
                                    <a href={`mailto:${volunteer.email}`} className="block text-blue-600 underline">
                                      {volunteer.email}
                                    </a>
                                  )}
                                  {volunteer.designation && <p>{volunteer.designation}</p>}
                                  {volunteer.currentWork && <p className="text-gray-600">{volunteer.currentWork}</p>}
                                  {volunteer.reviewRequestedAt && (
                                    <p className="mt-2 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 font-semibold text-blue-800">
                                      Ready for review since {formatSubmissionDate(volunteer.reviewRequestedAt)}
                                    </p>
                                  )}
                                </div>
                                {volunteer.id &&
                                  volunteer.status !== 'withdrawn' &&
                                  volunteer.status !== 'completed' && (
                                  <div className="mt-2 flex flex-wrap gap-1.5">
                                    {(volunteer.status === 'accepted'
                                      ? (['pending', 'accepted', 'completed', 'declined'] as const)
                                      : (['pending', 'accepted', 'declined'] as const)
                                    ).filter(status =>
                                      status !== 'completed' || !!volunteer.reviewRequestedAt
                                    ).map(status => (
                                      <button
                                        key={status}
                                        type="button"
                                        disabled={
                                          reviewInterestMutation.isPending ||
                                          volunteer.status === status
                                        }
                                        onClick={() => reviewInterestMutation.mutate({
                                          volunteerId: volunteer.id!,
                                          status,
                                        })}
                                        className={`rounded-md border px-2 py-1 text-[10px] font-semibold capitalize disabled:cursor-default ${
                                          volunteer.status === status
                                            ? 'border-gray-300 bg-gray-200 text-gray-500'
                                            : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50'
                                        }`}
                                      >
                                        {status === 'accepted'
                                          ? 'Accept & assign'
                                          : status === 'completed'
                                            ? 'Mark complete'
                                            : status}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-gray-400">No expressions of interest yet.</p>
                        )
                      ) : volunteerData.volunteers.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {volunteerData.volunteers.map((volunteer, index) => (
                            <span
                              key={`${volunteer.name}-${index}`}
                              className="rounded-full border border-green-200 bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-800"
                            >
                              {volunteer.name}
                              {volunteer.status === 'completed' ? ' · Contributor' : ''}
                            </span>
                          ))}
                        </div>
                      ) : null}

                      {!volunteerData.isCurator && (
                        myVolunteer?.status === 'pending' ||
                        myVolunteer?.status === 'accepted' ||
                        myVolunteer?.status === 'completed' ? (
                          <div className={`rounded-lg border px-3 py-2 ${
                            myVolunteer.status === 'accepted' || myVolunteer.status === 'completed'
                              ? 'border-green-200 bg-green-50'
                              : 'border-orange-200 bg-orange-50'
                          }`}>
                            <p className={`text-xs font-semibold ${
                              myVolunteer.status === 'accepted' || myVolunteer.status === 'completed'
                                ? 'text-green-800'
                                : 'text-orange-800'
                            }`}>
                              {myVolunteer.status === 'completed'
                                ? 'Your completed curation is credited on this study.'
                                : myVolunteer.status === 'accepted'
                                  ? myVolunteer.reviewRequestedAt
                                    ? 'Your curated data is awaiting review by the curation team.'
                                    : 'You are assigned as the Community Curator.'
                                  : 'Your interest is pending review.'}
                            </p>
                            {myVolunteer.reviewFeedback && !myVolunteer.reviewRequestedAt && (
                              <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
                                Changes requested: {myVolunteer.reviewFeedback}
                              </p>
                            )}
                            {myVolunteer.status === 'accepted' && (
                              myVolunteer.reviewRequestedAt ? (
                                <Link
                                  to={`/study/${d.submissionId}`}
                                  className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-[#2C5EBE] hover:text-[#1A3B6D]"
                                >
                                  <FileCheck2 className="h-3.5 w-3.5" /> View submitted data
                                </Link>
                              ) : (
                                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                                  <Link
                                    to={`/study/${d.submissionId}`}
                                    className="inline-flex items-center gap-1.5 rounded-md bg-[#2C5EBE] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1A3B6D]"
                                  >
                                    <FileCheck2 className="h-3.5 w-3.5" />
                                    {myVolunteer.reviewFeedback ? 'Resubmit curated data' : 'Submit curated data'}
                                  </Link>
                                  <span className="text-xs text-green-800">Finished curating? Hand your files to the curation team.</span>
                                </div>
                              )
                            )}
                            {myVolunteer.status !== 'completed' &&
                              !myVolunteer.reviewRequestedAt &&
                              (!confirmWithdrawVolunteer ? (
                              <button
                                type="button"
                                onClick={() => setConfirmWithdrawVolunteer(true)}
                                className="mt-1 text-xs text-gray-500 underline hover:text-gray-700"
                              >
                                Withdraw interest
                              </button>
                            ) : (
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <span className="text-xs text-gray-600">Withdraw your interest?</span>
                                <button
                                  type="button"
                                  disabled={withdrawVolunteerMutation.isPending}
                                  onClick={() => withdrawVolunteerMutation.mutate()}
                                  className="rounded bg-gray-800 px-2 py-1 text-xs text-white disabled:opacity-50"
                                >
                                  {withdrawVolunteerMutation.isPending ? 'Withdrawing…' : 'Yes'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmWithdrawVolunteer(false)}
                                  className="text-xs text-gray-500 underline"
                                >
                                  Cancel
                                </button>
                              </div>
                            ))}
                            {withdrawVolunteerMutation.isError && (
                              <p role="alert" className="mt-1 text-xs text-red-600">
                                Could not withdraw your expression of interest.
                              </p>
                            )}
                          </div>
                        ) : myVolunteer?.status === 'declined' ? (
                          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                            <p className="text-xs font-semibold text-red-800">
                              Your application was not selected for this study.
                            </p>
                          </div>
                        ) : volunteerData.signupOpen && volunteerData.canVolunteer ? (
                          <button
                            type="button"
                            onClick={openVolunteerDialog}
                            className="inline-flex items-center gap-2 rounded-full border border-orange-200 bg-orange-50 px-3 py-2 text-xs font-semibold text-orange-800 hover:bg-orange-100"
                          >
                            <UserPlus className="h-4 w-4" /> I'm interested in curating this study
                          </button>
                        ) : volunteerData.signupOpen && !volunteerData.isAuthenticated ? (
                          <p className="text-xs text-gray-500">Sign in to express interest in curating this study.</p>
                        ) : null
                      )}
                    </div>
                  )}
                </div>}
              </Section>
              </div>

            </div>

            <section className="rounded-xl border border-gray-200 bg-slate-50/70 p-4 sm:p-6">
              <div className="mb-5">
                <div>
                  <h3 className="text-sm font-semibold text-gray-800">Submission progress</h3>
                  {rejectionReason ? (
                    <div className="mt-2 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-red-700">
                          Rejection reason
                        </p>
                        <p className="mt-0.5 text-xs leading-relaxed text-red-900">
                          {rejectionReason}
                        </p>
                      </div>
                    </div>
                  ) : stepDescriptions[mappedStatus] ? (
                    <p className="mt-1 text-xs text-gray-500">
                      {stepDescriptions[mappedStatus]}
                      {mappedStatus === 'Released' && d.portalStudyUrl && (
                        <>
                          {' '}
                          <a
                            href={d.portalStudyUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-semibold text-blue-600 underline hover:text-blue-800"
                          >
                            View the study <ExternalLink className="h-3 w-3" />
                          </a>
                        </>
                      )}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="relative w-full">
                <div className="absolute left-5 right-5 top-[19px] hidden h-0.5 rounded-full bg-gray-200 sm:block">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      isRejected ? 'bg-red-500' : mappedStatus === 'Released' ? 'bg-green-500' : 'bg-blue-500'
                    }`}
                    style={{
                      width: currentStepIndex >= 0 ? `${(currentStepIndex / (flowSteps.length - 1)) * 100}%` : '0%',
                    }}
                  />
                </div>
                <div className="absolute bottom-5 left-[19px] top-5 w-0.5 rounded-full bg-gray-200 sm:hidden">
                  <div
                    className={`w-full rounded-full transition-all duration-500 ${
                      isRejected ? 'bg-red-500' : mappedStatus === 'Released' ? 'bg-green-500' : 'bg-blue-500'
                    }`}
                    style={{
                      height: currentStepIndex >= 0 ? `${(currentStepIndex / (flowSteps.length - 1)) * 100}%` : '0%',
                    }}
                  />
                </div>

                <div className="relative flex flex-col gap-4 sm:flex-row sm:justify-between sm:gap-0">
                  {flowSteps.map((step, index) => {
                    const status = getStepStatus(index);
                    const tooltipProps = getTooltipProps(index, flowSteps.length);
                    const stageDate = formatSubmissionDate(d.stageTimestamps?.[step]);

                    return (
                      <div key={step} className="flex flex-row items-start sm:flex-col sm:items-center">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div
                              className={`relative z-10 flex h-10 w-10 shrink-0 cursor-help items-center justify-center rounded-full border-4 border-white shadow-sm transition-all duration-300 ${getStepColor(status, step)}`}
                            >
                              {getStepIcon(index, status, step)}
                            </div>
                          </TooltipTrigger>
                          <TooltipContent
                            side={tooltipProps.side}
                            align={tooltipProps.align}
                            className="z-50 max-w-[280px] text-center"
                          >
                            <div className="whitespace-normal break-words leading-relaxed">
                              {stepDescriptions[step]}
                            </div>
                          </TooltipContent>
                        </Tooltip>

                        <div className="ml-3 mt-1 max-w-none px-1 text-left sm:ml-0 sm:mt-2.5 sm:max-w-[120px] sm:text-center">
                          <div className={`text-left text-xs leading-tight sm:text-center ${
                            status === 'current' ? 'font-semibold' : 'font-medium'
                          } ${
                            status === 'current'
                              ? step === 'Rejected'
                                ? 'text-red-600'
                                : step === 'Released'
                                  ? 'text-green-600'
                                  : 'text-blue-600'
                              : status === 'completed'
                                ? 'text-green-600'
                                : 'text-gray-500'
                          }`}>
                            {formatStepLabel(step)}
                          </div>
                          {stageDate && (status === 'completed' || status === 'current') && (
                            <div className="text-left text-[10px] text-gray-400 sm:text-center">
                              {stageDate}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {d.datahubReadmeUrl && (
                <p className="mt-4 text-xs text-gray-500">
                  For details on how this study's data was curated and transformed, see the{' '}
                  <a
                    href={d.datahubReadmeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-semibold text-blue-600 underline hover:text-blue-800"
                  >
                    Curation &amp; Transformation Notes <ExternalLink className="h-3 w-3" />
                  </a>.
                </p>
              )}
            </section>
          </div>
        </TabsContent>

        {SHOW_CURATION_ACTIVITY_TAB && (
          <TabsContent value="record" className="mt-0">
            {d.submissionId && (
              <CurationRecord submissionId={d.submissionId} showPermalink={false} />
            )}
          </TabsContent>
        )}

        {/* Mounted as soon as the panel opens, and hidden rather than unmounted
            when another tab is showing. The point is the count: a question is
            worth knowing about before you think to go looking for it, and a tab
            that only admits to holding one after you click it is no signal at
            all. Hiding also means switching tabs never refetches. */}
        <TabsContent
          value="questions"
          forceMount
          className={panelTab === 'questions' ? 'mt-0' : 'hidden'}
        >
          {d.submissionId && questionsActivated && (
            <Questions submissionId={d.submissionId} onCountsChange={handleQuestionCountsChange} />
          )}
        </TabsContent>
        </Tabs>

        </div>
    </div>
    </TooltipProvider>
  );
};

// ─── Superseded banner ───────────────────────────────────────────────────────

const SupersededBanner: React.FC<{
  dataSubmissionId: string;
  supersededAt?: string | null;
  targetSubmission?: Submission;
}> = ({ dataSubmissionId, supersededAt, targetSubmission }) => {
  const shortId = dataSubmissionId.replace(/^submission_/, '').slice(0, 8);
  const fmt = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  const targetId = targetSubmission?.submissionId || targetSubmission?.id;
  const targetTab = targetSubmission?.publicationType === 'preprint'
    ? 'submitted-data'
    : 'suggested-papers';

  return (
    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-3">
      <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
      <div className="text-xs text-amber-800">
        <span className="font-semibold">A data submission for this study has been submitted</span>
        {supersededAt && <span className="text-amber-600 ml-1">({fmt(supersededAt)})</span>}
        {targetId ? (
          <span>
            {' — '}
            <Link
              to={`/track-status?tab=${targetTab}&submission=${encodeURIComponent(targetId)}`}
              className="underline font-medium hover:text-amber-900"
            >
              View data submission
            </Link>
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


const fmt = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
