
import { ColDef, ColGroupDef } from "ag-grid-community";
import { getStatusCellRenderer } from "@/types/submission";
import React from "react";
import { ChevronDown, ArrowUpDown, ThumbsUp } from "lucide-react";
import { toast } from "sonner";
import { updateSubmissionStatus } from "@/services/api";
import { formatSubmissionDate } from "@/utils/submissionDate";
import { isVolunteerSignupOpen } from "@/utils/curationEligibility";

type ColumnDef = ColDef | ColGroupDef;

// Custom header component with sort icon
const SortableHeader = (params: any) => {
  const onSortRequested = () => {
    params.progressSort();
  };

  return React.createElement('div', {
    className: 'flex items-center justify-between w-full gap-2 cursor-pointer',
    onClick: onSortRequested
  }, [
    React.createElement('span', { key: 'label' }, params.displayName),
    React.createElement(ArrowUpDown, { 
      key: 'icon',
      className: 'h-4 w-4 text-gray-400 flex-shrink-0'
    })
  ]);
};

const baseColumn: Partial<ColDef> = {
  sortable: true,
  filter: true,
  resizable: true,
  suppressSizeToFit: true,
  cellClass: 'cell-wrap-ellipsis',
  cellStyle: {
    display: 'flex',
    alignItems: 'center',
    padding: '8px 12px'
  },
  headerComponent: SortableHeader
};

// Generic cell renderer with ellipsis for all text content
const ellipsisRenderer = (params: any) => {
  return React.createElement('div', {
    className: 'w-full truncate',
    style: {
      textOverflow: 'ellipsis',
      overflow: 'hidden',
      whiteSpace: 'nowrap',
      maxWidth: '100%'
    },
    title: params.value
  }, params.value);
};

// Cell renderer for submission ID — strips "submission_" prefix, shows first 8 chars
const submissionIdRenderer = (params: any) => {
  const raw = params.value || '';
  const full = raw.replace(/^submission_/, '');
  const short = full.substring(0, 8);
  const expanded = params.context?.selectedSubmissionId === raw;

  return React.createElement('button', {
    type: 'button',
    className: 'flex items-center gap-1 cursor-pointer hover:text-blue-700 w-full text-left',
    style: { maxWidth: '100%' },
    title: `${expanded ? 'Collapse' : 'Expand'} details for submission ${full}`,
    'aria-label': `${expanded ? 'Collapse' : 'Expand'} details for submission ${full}`,
    'aria-expanded': expanded,
  }, [
    React.createElement('span', {
      key: 'id',
      className: 'font-mono text-blue-600 underline'
    }, short),
    React.createElement(ChevronDown, {
      key: 'arrow',
      className: `h-4 w-4 text-gray-500 flex-shrink-0 transition-transform duration-200 ${
        expanded ? 'rotate-180' : ''
      }`
    })
  ]);
};

const submissionDateRenderer = (params: any) => {
  const formatted = formatSubmissionDate(params.value) || '';
  return React.createElement('div', {
    className: 'w-full truncate',
    title: formatted
  }, formatted);
};

const idCol: ColumnDef = {
  field: 'submissionId',
  headerName: 'Submission ID',
  width: 160,
  minWidth: 160,
  maxWidth: 160,
  cellRenderer: submissionIdRenderer,
  suppressNavigable: false,
  ...baseColumn
};

// The labels a super user can assign: one per stage, plus the single rejection
// label. Mirrors ASSIGNABLE_STAGES in backend/src/utils/pipelineStages.js,
// which rejects anything else.
export const ASSIGNABLE_STATUSES = [
  { step: '1', value: 'Submitted' },
  { step: '2', value: 'Initial Review' },
  { step: '3', value: 'Approved for Curation' },
  { step: '4', value: 'Curation in Progress' },
  { step: '5', value: 'Final Review' },
  { step: '6', value: 'Preparing for Release' },
  { step: '7', value: 'Released' },
  { step: null, value: 'Rejected' },
];

// Backend status map
const BACKEND_MAP: Record<string, string> = {
  'Submitted': 'pending',
  'Initial Review': 'received',
  'Approved for Curation': 'received',
  'Curation in Progress': 'in-progress',
  'Final Review': 'in-review',
  'Preparing for Release': 'in-review',
  'Released': 'approved',
  'Rejected': 'not-curatable',
};

// Pill colors — matches statusColors in submission.tsx
const PILL_COLORS: Record<string, { bg: string; text: string }> = {
  'Submission':                    { bg: '#e5e7eb', text: '#374151' },
  'Submitted':                     { bg: '#e5e7eb', text: '#374151' },
  'Awaiting Review':               { bg: '#e5e7eb', text: '#374151' },
  'Received':                      { bg: '#e5e7eb', text: '#374151' },
  'Initial Review':                { bg: '#bae6fd', text: '#075985' },
  'Pending Review':                { bg: '#bae6fd', text: '#075985' },
  'Approved for Curation':         { bg: '#bbf7d0', text: '#14532d' },
  'Approved for Portal':           { bg: '#bbf7d0', text: '#14532d' },
  'Approved for Portal Curation':  { bg: '#bbf7d0', text: '#14532d' },
  'Curation in Progress':          { bg: '#fef08a', text: '#713f12' },
  'Clarification Needed':          { bg: '#fef08a', text: '#713f12' },
  'Changes Requested':             { bg: '#fef08a', text: '#713f12' },
  "Awaiting Submitter's Response": { bg: '#fef08a', text: '#713f12' },
  'In Progress':                   { bg: '#fef08a', text: '#713f12' },
  'Final Review':                  { bg: '#fed7aa', text: '#7c2d12' },
  'In Review':                     { bg: '#fed7aa', text: '#7c2d12' },
  'Under Review':                  { bg: '#fed7aa', text: '#7c2d12' },
  'Preparing for Release':         { bg: '#99f6e4', text: '#134e4a' },
  'Released':                      { bg: '#166534', text: '#f0fdf4' },
  'Rejected':                      { bg: '#fecaca', text: '#7f1d1d' },
  'Not Curatable':                 { bg: '#fecaca', text: '#7f1d1d' },
  'Missing Data':                  { bg: '#fecaca', text: '#7f1d1d' },
};

// Vanilla AG Grid cell renderer — works reliably without React hook issues
class StatusCellWithAssign {
  private params: any;
  private eGui!: HTMLDivElement;
  private currentStatus!: string;
  private dropdown: HTMLDivElement | null = null;
  private open = false;
  private assigning = false;

  init(params: any) {
    this.params = params;
    this.currentStatus = params.value;
    this.eGui = document.createElement('div');
    this.eGui.style.cssText = 'display:flex;align-items:center;width:100%;height:100%;position:relative;overflow:visible;';
    this.buildPill();
  }

  buildPill() {
    const isSuperUser = this.params.context?.isSuperUser;
    const status = this.currentStatus;
    const c = PILL_COLORS[status] || { bg: '#e5e7eb', text: '#374151' };

    this.eGui.innerHTML = `
      <div style="padding-left:12px;display:flex;align-items:center;gap:5px;width:100%;">
        <div style="background:${c.bg};color:${c.text};padding:13px 12px;border-radius:999px;font-size:12px;font-weight:600;line-height:1;white-space:nowrap;display:inline-flex;align-items:center;gap:4px;">
          <span>${status}</span>
        </div>
        ${isSuperUser ? `<button data-btn="chevron" ${this.assigning ? 'disabled' : ''} title="${this.assigning ? 'Updating status' : 'Assign status'}" style="flex-shrink:0;background:none;border:none;cursor:${this.assigning ? 'wait' : 'pointer'};padding:2px 3px;border-radius:4px;color:#9ca3af;font-size:13px;line-height:1;display:inline-flex;align-items:center;opacity:${this.assigning ? '0.5' : '1'};">${this.assigning ? '…' : '&#8964;'}</button>` : ''}
      </div>
    `;

    const btn = this.eGui.querySelector('[data-btn="chevron"]');
    if (btn) {
      btn.addEventListener('click', (e: Event) => {
        e.stopPropagation();
        e.preventDefault();
        if (this.open) {
          this.closeDropdown();
        } else {
          this.openDropdown();
        }
      });
    }

  }

  openDropdown() {
    if (this.open) return;
    this.open = true;

    const rect = this.eGui.getBoundingClientRect();
    const dd = document.createElement('div');
    dd.style.cssText = [
      'position:fixed',
      `left:${rect.left}px`,
      `top:${rect.bottom + 2}px`,
      'z-index:99999',
      'background:white',
      'border:1px solid #e5e7eb',
      'border-radius:8px',
      'box-shadow:0 8px 24px rgba(0,0,0,0.15)',
      'min-width:230px',
      'max-height:300px',
      'overflow-y:auto',
    ].join(';');
    document.body.appendChild(dd);
    this.dropdown = dd;

    ASSIGNABLE_STATUSES.forEach(({ step, value }) => {
      if (!step) {
        const divider = document.createElement('div');
        divider.style.cssText = 'margin:4px 0;border-top:1px solid #f3f4f6;';
        dd.appendChild(divider);
      }
      const item = document.createElement('button');
      const isCurrent = value === this.currentStatus;
      item.style.cssText = `width:100%;text-align:left;padding:6px 12px;font-size:13px;background:none;border:none;cursor:pointer;display:flex;align-items:center;gap:8px;color:${isCurrent ? '#2563eb' : '#374151'};font-weight:${isCurrent ? '600' : '400'};`;
      const stepEl = document.createElement('span');
      stepEl.style.cssText = 'width:14px;flex-shrink:0;font-size:11px;font-weight:600;color:#9ca3af;text-align:right;';
      stepEl.textContent = step || '';
      const labelEl = document.createElement('span');
      labelEl.textContent = value;
      item.append(stepEl, labelEl);
      item.addEventListener('mouseenter', () => { item.style.background = '#eff6ff'; item.style.color = '#1d4ed8'; });
      item.addEventListener('mouseleave', () => { item.style.background = 'none'; item.style.color = isCurrent ? '#2563eb' : '#374151'; });
      item.addEventListener('click', (e: Event) => { e.stopPropagation(); this.assign(value); });
      dd.appendChild(item);
    });
    dd.style.padding = '4px 0';

    // Close on outside click — use capture so it fires before anything else
    setTimeout(() => {
      document.addEventListener('click', this.onOutsideClick, true);
    }, 0);
  }

  closeDropdown() {
    if (this.dropdown) {
      this.dropdown.remove();
      this.dropdown = null;
    }
    this.open = false;
    document.removeEventListener('click', this.onOutsideClick, true);
  }

  onOutsideClick = (e: MouseEvent) => {
    if (!this.eGui.contains(e.target as Node)) {
      this.closeDropdown();
    }
  };

  async assign(newStatus: string) {
    this.closeDropdown();
    if (newStatus === this.currentStatus) return;
    const submissionId = this.params.data?.submissionId;
    if (!submissionId) return;
    this.assigning = true;
    this.buildPill();
    try {
      const response = await updateSubmissionStatus(submissionId, BACKEND_MAP[newStatus] || 'pending', newStatus);
      this.currentStatus = newStatus;
      this.params.setValue?.(newStatus);
      const stageTimestamps = response?.data?.submission?.stageTimestamps;
      this.params.context?.onStatusChanged?.(submissionId, newStatus, stageTimestamps);
    } catch (e) {
      console.error('Failed to update status:', e);
      toast.error(e instanceof Error && e.message ? e.message : 'Failed to update submission status.');
    } finally {
      this.assigning = false;
      this.buildPill();
    }
  }

  getGui() { return this.eGui; }

  refresh(params: any) {
    this.params = params;
    this.currentStatus = params.value;
    this.buildPill();
    return true;
  }

  destroy() {
    this.closeDropdown();
  }
}

const statusCol: ColumnDef = {
  field: 'status',
  headerName: 'Status',
  cellRenderer: StatusCellWithAssign,
  width: 320,
  minWidth: 300,
  maxWidth: 400,
  suppressNavigable: true,
  ...baseColumn,
  // After the spread: baseColumn's ellipsis class would clip the pill and the
  // assign-status dropdown. SubmissionGrid sizes this column to its content, so
  // there is nothing to truncate.
  cellClass: 'cell-status',
};

const curationRenderer = (params: any) => {
  const submission = params.data || {};
  const leadCuratorName = String(submission.leadCuratorName || '').trim();
  const volunteerEligible = isVolunteerSignupOpen(submission);
  const isSuperUser = params.context?.canAssignCurator;
  if (!isSuperUser && submission.hasVolunteered === true) {
    const status = submission.myVolunteerStatus;
    const display = status === 'accepted'
      ? { label: 'Assigned to you', classes: 'border-green-200 bg-green-50 text-green-800' }
      : status === 'completed'
        ? { label: 'Contribution complete', classes: 'border-blue-200 bg-blue-50 text-blue-800' }
        : status === 'declined'
          ? { label: 'Not selected', classes: 'border-red-200 bg-red-50 text-red-800' }
          : { label: 'You signed up', classes: 'border-sky-200 bg-sky-50 text-sky-800' };
    return React.createElement('span', {
      className: `whitespace-nowrap rounded-full border px-2.5 py-1.5 text-xs font-semibold ${display.classes}`,
    }, display.label);
  }

  if (!volunteerEligible || leadCuratorName) return null;

  if (isSuperUser) {
    return React.createElement('span', {
      className: 'rounded-full border border-orange-200 bg-orange-50 px-2.5 py-1.5 text-xs font-semibold text-orange-800',
    }, 'Open');
  }

  return React.createElement('div', {
    className: 'flex min-w-0 items-center gap-2',
  }, [
    React.createElement('button', {
      key: 'action',
      type: 'button',
      className: 'whitespace-nowrap rounded-full border border-orange-200 bg-orange-50 px-2.5 py-1.5 text-xs font-semibold text-orange-800 hover:bg-orange-100',
      onClick: (event: React.MouseEvent) => {
        event.stopPropagation();
        params.context?.onCurationAction?.(submission);
      },
    }, "I'm interested"),
  ]);
};

const curationCol: ColumnDef = {
  field: 'leadCuratorName',
  headerName: 'Join the Effort',
  width: 160,
  minWidth: 145,
  maxWidth: 180,
  sortable: true,
  filter: false,
  resizable: true,
  suppressSizeToFit: true,
  suppressNavigable: true,
  cellRenderer: curationRenderer,
  cellStyle: {
    display: 'flex',
    alignItems: 'center',
    padding: '8px 12px',
  },
  headerComponent: SortableHeader,
};

const upvoteRenderer = (params: any) => {
  const submission = params.data || {};
  if (submission.submissionType !== 'suggest-paper' || submission.publicationType !== 'published') {
    return null;
  }
  const hasUpvoted = submission.hasUpvoted === true;
  const count = Number(submission.upvoteCount) || 0;

  return React.createElement('button', {
    type: 'button',
    title: hasUpvoted ? 'You upvoted this study' : 'Upvote this study for inclusion in cBioPortal',
    'aria-label': hasUpvoted
      ? `You upvoted this study. ${count} total upvotes`
      : `Upvote this study. ${count} total upvotes`,
    'aria-pressed': hasUpvoted,
    disabled: hasUpvoted,
    className: `inline-flex min-w-[58px] items-center justify-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
      hasUpvoted
        ? 'cursor-default border-blue-700 bg-blue-700 text-white'
        : 'border-blue-200 bg-blue-50 text-blue-800 hover:border-blue-300 hover:bg-blue-100'
    }`,
    onClick: (event: React.MouseEvent) => {
      event.stopPropagation();
      params.context?.onStudyUpvote?.(submission);
    },
  }, [
    React.createElement(ThumbsUp, { key: 'icon', className: 'h-3.5 w-3.5' }),
    React.createElement('span', { key: 'count' }, count),
  ]);
};

const upvoteCol: ColumnDef = {
  field: 'upvoteCount',
  headerName: 'Upvote',
  width: 105,
  minWidth: 100,
  maxWidth: 120,
  filter: false,
  resizable: true,
  suppressSizeToFit: true,
  suppressNavigable: true,
  cellRenderer: upvoteRenderer,
  cellStyle: {
    display: 'flex',
    alignItems: 'center',
    padding: '8px 12px',
  },
  headerComponent: SortableHeader,
};

const pmidCol: ColumnDef = {
  field: 'pmid',
  headerName: 'PMID / URL',
  // Pre-publication submissions have no PMID/URL, so leave the cell blank.
  // Otherwise fall back to `associatedPaper` (the data form's "PMID or URL"
  // field), since data submissions store the identifier there — matching the
  // detail view.
  valueGetter: (params: any) => {
    if (params.data?.publicationType === 'preprint') return '';
    return params.data?.pmid || params.data?.associatedPaper || '';
  },
  width: 160,
  minWidth: 140,
  maxWidth: 200,
  cellRenderer: ellipsisRenderer,
  suppressNavigable: true,
  ...baseColumn
};

const nameCol: ColumnDef = {
  field: 'author',
  headerName: 'Submitted By',
  width: 150,
  minWidth: 130,
  maxWidth: 180,
  cellRenderer: ellipsisRenderer,
  suppressNavigable: true,
  ...baseColumn
};

const emailCol: ColumnDef = {
  field: 'email',
  headerName: 'Email',
  width: 200,
  minWidth: 180,
  maxWidth: 220,
  cellRenderer: ellipsisRenderer,
  suppressNavigable: true,
  ...baseColumn
};

const dateCol: ColumnDef = {
  field: 'createdAt',
  headerName: 'Submission Date',
  width: 160,
  minWidth: 150,
  maxWidth: 170,
  cellRenderer: submissionDateRenderer,
  suppressNavigable: true,
  ...baseColumn
};

// Source cell renderer — combines submissionType, publicationType, sharingPreference
const sourceRenderer = (params: any) => {
  const { submissionType, publicationType, sharingPreference } = params.data || {};
  const typeLabel = submissionType === 'suggest-paper' ? 'Study Suggestion' : 'Data Submission';
  let pubLabel = '';
  if (publicationType === 'published') {
    pubLabel = 'Published';
  } else if (publicationType === 'preprint') {
    pubLabel = sharingPreference === 'private' ? 'Pre-publication · Private' : 'Pre-publication · Public';
  }
  const typeColors: Record<string, string> = {
    'Study Suggestion': 'bg-purple-100 text-purple-800',
    'Data Submission':  'bg-blue-100 text-blue-800',
  };
  const pubColors: Record<string, string> = {
    'Published':                  'bg-green-100 text-green-800',
    'Pre-publication · Public':   'bg-yellow-100 text-yellow-800',
    'Pre-publication · Private':  'bg-orange-100 text-orange-800',
  };
  return React.createElement('div', {
    className: 'flex items-center gap-1.5 flex-wrap'
  }, [
    React.createElement('span', {
      key: 'type',
      className: `text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${typeColors[typeLabel] || 'bg-gray-100 text-gray-700'}`
    }, typeLabel),
    pubLabel && React.createElement('span', {
      key: 'pub',
      className: `text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${pubColors[pubLabel] || 'bg-gray-100 text-gray-700'}`
    }, pubLabel)
  ]);
};

const sourceCol: ColumnDef = {
  field: 'submissionType',
  headerName: 'Source',
  width: 260,
  minWidth: 240,
  maxWidth: 300,
  cellRenderer: sourceRenderer,
  suppressNavigable: true,
  ...baseColumn
};

// Study Suggestions: Submission ID, Status, PMID/URL, [Submitted By, Email — super users only], Title, Submission Date
export const usePaperColumnDefs = (isSuperUser: boolean = false): ColumnDef[] => [
  idCol,
  statusCol,
  pmidCol,
  // Submitter name + email are only exposed to super users
  ...(isSuperUser ? [nameCol, emailCol] : []),
  {
    field: 'title',
    headerName: 'Title',
    flex: 1,
    minWidth: 200,
    cellRenderer: ellipsisRenderer,
    suppressNavigable: true,
    ...baseColumn
  },
  dateCol,
  curationCol,
  upvoteCol
];

// Data Submissions: Submission ID, Status, PMID/URL, [Submitted By, Email — super users only], Study Name, Description, Submission Date
export const useDataColumnDefs = (isSuperUser: boolean = false): ColumnDef[] => [
  idCol,
  statusCol,
  pmidCol,
  // Submitter name + email are only exposed to super users
  ...(isSuperUser ? [nameCol, emailCol] : []),
  {
    field: 'studyName',
    headerName: 'Study Name',
    width: 180,
    minWidth: 160,
    maxWidth: 220,
    cellRenderer: ellipsisRenderer,
    suppressNavigable: true,
    ...baseColumn
  },
  {
    field: 'studyDescription',
    headerName: 'Description',
    flex: 1,
    minWidth: 180,
    cellRenderer: ellipsisRenderer,
    suppressNavigable: true,
    ...baseColumn
  },
  dateCol
];

// Pre-publication Data Submissions: same as Data Submissions but without the
// PMID/URL column (pre-publication submissions have no PMID/URL).
export const usePreprintDataColumnDefs = (isSuperUser: boolean = false): ColumnDef[] =>
  useDataColumnDefs(isSuperUser).filter(col => !('field' in col && col.field === 'pmid'));

// My Submissions: unified table with Source column, shared title field
export const useMySubmissionsColumnDefs = (isSuperUser: boolean = false): ColumnDef[] => [
  idCol,
  sourceCol,
  statusCol,
  pmidCol,
  // Submitter name + email are only exposed to super users
  ...(isSuperUser ? [nameCol, emailCol] : []),
  {
    field: 'title',
    headerName: 'Title / Study Name',
    flex: 1,
    minWidth: 200,
    cellRenderer: ellipsisRenderer,
    suppressNavigable: true,
    ...baseColumn
  },
  dateCol,
  curationCol,
  upvoteCol
];
