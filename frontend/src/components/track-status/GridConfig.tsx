
import { ColDef, ColGroupDef } from "ag-grid-community";
import { getStatusCellRenderer } from "@/types/submission";
import React from "react";
import { ChevronDown, ArrowUpDown } from "lucide-react";
import { updateSubmissionStatus } from "@/services/api";

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
  return React.createElement('div', {
    className: 'flex items-center gap-1 cursor-pointer hover:text-blue-600 w-full',
    style: { maxWidth: '100%' },
    title: full
  }, [
    React.createElement('span', {
      key: 'id',
      className: 'font-mono text-blue-600 underline'
    }, short),
    React.createElement(ChevronDown, {
      key: 'arrow',
      className: 'h-4 w-4 text-gray-500 flex-shrink-0'
    })
  ]);
};

// Format date to EST 24hr clock
const dateESTRenderer = (params: any) => {
  if (!params.value) return React.createElement('div', {}, '');
  const date = new Date(params.value);
  const formatted = date.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }) + ' EST';
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

// All assignable labels grouped by step — used in the super-user dropdown
export const ASSIGNABLE_STATUSES = [
  { group: 'Step 1 — Submitted',             value: 'Submitted' },
  { group: 'Step 2 — Initial Review',         value: 'Initial Review' },
  { group: 'Step 3 — Approved for Portal',    value: 'Approved for Portal' },
  { group: 'Step 4 — Curation in Progress',   value: 'Curation in Progress' },
  { group: 'Step 4 — Curation in Progress',   value: 'Clarification Needed' },
  { group: 'Step 4 — Curation in Progress',   value: 'Changes Requested' },
  { group: "Step 4 — Curation in Progress",   value: "Awaiting Submitter's Response" },
  { group: 'Step 5 — Final Review',           value: 'Final Review' },
  { group: 'Step 6 — Preparing for Release',  value: 'Preparing for Release' },
  { group: 'Step 6 — Preparing for Release',  value: 'Import in Progress' },
  { group: 'Step 7 — Released',               value: 'Released' },
  { group: 'Step 7 — Released',               value: 'In Portal' },
  { group: 'Rejected',                        value: 'Not Curatable' },
  { group: 'Rejected',                        value: 'Missing Data' },
];

// Backend status map
const BACKEND_MAP: Record<string, string> = {
  'Submitted': 'pending',
  'Submission': 'pending',
  'Initial Review': 'received',
  'Approved for Portal': 'received',
  'Curation in Progress': 'in-progress',
  'Clarification Needed': 'in-progress',
  'Changes Requested': 'in-progress',
  "Awaiting Submitter's Response": 'in-progress',
  'Final Review': 'in-review',
  'Preparing for Release': 'in-review',
  'Import in Progress': 'in-review',
  'Released': 'approved',
  'In Portal': 'in-portal',
  'Not Curatable': 'not-curatable',
  'Missing Data': 'missing-data',
};

// Pill colors — matches statusColors in submission.tsx
const PILL_COLORS: Record<string, { bg: string; text: string }> = {
  'Submission':                    { bg: '#e5e7eb', text: '#374151' },
  'Submitted':                     { bg: '#e5e7eb', text: '#374151' },
  'Awaiting Review':               { bg: '#e5e7eb', text: '#374151' },
  'Received':                      { bg: '#e5e7eb', text: '#374151' },
  'Initial Review':                { bg: '#bae6fd', text: '#075985' },
  'Pending Review':                { bg: '#bae6fd', text: '#075985' },
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
  'Import in Progress':            { bg: '#99f6e4', text: '#134e4a' },
  'Released':                      { bg: '#166534', text: '#f0fdf4' },
  'In Portal':                     { bg: '#166534', text: '#f0fdf4' },
  'Not Curatable':                 { bg: '#fecaca', text: '#7f1d1d' },
  'Missing Data':                  { bg: '#fecaca', text: '#7f1d1d' },
};

// Step number logic — mirrors getStepNumber in submission.tsx
const NORMAL_FLOW = ['Submitted','Initial Review','Approved for Portal','Curation in Progress','Final Review','Preparing for Release','Released'];
const REJECTED_FLOW = ['Submitted','Initial Review','Not Curatable'];
const STATUS_MAP: Record<string, string> = {
  'Awaiting Review': 'Submitted', 'Submission': 'Submitted', 'Received': 'Submitted',
  'Clarification Needed': 'Curation in Progress', 'Changes Requested': 'Curation in Progress',
  "Awaiting Submitter's Response": 'Curation in Progress', 'Awaiting Submitters Response': 'Curation in Progress',
  'In Progress': 'Curation in Progress',
  'Import in Progress': 'Preparing for Release', 'Under Review': 'Final Review',
  'Approved for Portal Curation': 'Approved for Portal', 'In Portal': 'Released',
  'Pending Review': 'Initial Review', 'Missing Data': 'Not Curatable',
};

function getStepLabel(status: string): string {
  const isRejected = status === 'Not Curatable' || status === 'Missing Data';
  if (isRejected) {
    const idx = REJECTED_FLOW.indexOf('Not Curatable');
    return idx >= 0 ? `${idx + 1}/${REJECTED_FLOW.length}` : '';
  }
  const mapped = STATUS_MAP[status] || status;
  const idx = NORMAL_FLOW.indexOf(mapped);
  return idx >= 0 ? `${idx + 1}/${NORMAL_FLOW.length}` : '';
}

// Vanilla AG Grid cell renderer — works reliably without React hook issues
class StatusCellWithAssign {
  private params: any;
  private eGui!: HTMLDivElement;
  private currentStatus!: string;
  private dropdown: HTMLDivElement | null = null;
  private open = false;

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
    const stepLabel = getStepLabel(status);
    const stepBadge = stepLabel
      ? `<span style="font-size:10px;font-weight:700;background:rgba(255,255,255,0.45);border-radius:999px;padding:4px 5px;margin-right:2px;">${stepLabel}</span>`
      : '';

    this.eGui.innerHTML = `
      <div style="padding-left:12px;display:flex;align-items:center;gap:5px;width:100%;">
        <div style="background:${c.bg};color:${c.text};padding:11px 12px;border-radius:999px;font-size:12px;font-weight:600;line-height:1;white-space:nowrap;display:inline-flex;align-items:center;gap:4px;">
          ${stepBadge}<span>${status}</span>
        </div>
        ${isSuperUser ? `<button data-btn="chevron" title="Assign status" style="flex-shrink:0;background:none;border:none;cursor:pointer;padding:2px 3px;border-radius:4px;color:#9ca3af;font-size:13px;line-height:1;display:inline-flex;align-items:center;">&#8964;</button>` : ''}
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

    const grouped = ASSIGNABLE_STATUSES.reduce((acc: Record<string, string[]>, s) => {
      if (!acc[s.group]) acc[s.group] = [];
      acc[s.group].push(s.value);
      return acc;
    }, {});

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

    Object.entries(grouped).forEach(([group, statuses]) => {
      const header = document.createElement('div');
      header.style.cssText = 'padding:8px 12px 3px;font-size:10px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.05em;';
      header.textContent = group;
      dd.appendChild(header);

      statuses.forEach(s => {
        const item = document.createElement('button');
        const isCurrent = s === this.currentStatus;
        item.style.cssText = `width:100%;text-align:left;padding:5px 16px;font-size:13px;background:none;border:none;cursor:pointer;display:block;color:${isCurrent ? '#2563eb' : '#374151'};font-weight:${isCurrent ? '600' : '400'};`;
        item.textContent = s;
        item.addEventListener('mouseenter', () => { item.style.background = '#eff6ff'; item.style.color = '#1d4ed8'; });
        item.addEventListener('mouseleave', () => { item.style.background = 'none'; item.style.color = isCurrent ? '#2563eb' : '#374151'; });
        item.addEventListener('click', (e: Event) => { e.stopPropagation(); this.assign(s); });
        dd.appendChild(item);
      });
    });

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
    try {
      await updateSubmissionStatus(submissionId, BACKEND_MAP[newStatus] || 'pending', newStatus);
      this.currentStatus = newStatus;
      this.params.setValue?.(newStatus);
      this.params.context?.onStatusChanged?.(submissionId, newStatus);
      this.buildPill();
    } catch (e) {
      console.error('Failed to update status:', e);
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
  ...baseColumn
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
  width: 200,
  minWidth: 200,
  maxWidth: 200,
  cellRenderer: dateESTRenderer,
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
  dateCol
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
  useDataColumnDefs(isSuperUser).filter(col => col.field !== 'pmid');

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
  dateCol
];
