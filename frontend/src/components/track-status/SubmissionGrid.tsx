
import { AgGridReact } from "ag-grid-react";

// The ag-grid stylesheets live with the component that needs them, not with the
// page, so they are part of this lazily loaded chunk rather than the route's.
// Together with the library they are the bulk of /track-status's payload, and
// nothing above the grid — heading, tabs, search — depends on either.
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-alpine.css";
import { ColDef, ColGroupDef, CellClickedEvent, GridApi, IRowNode } from "ag-grid-community";
import { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Submission } from "@/types/submission";
import { SubmissionFlowTracker, SubmissionPanelTab } from "./SubmissionFlowTracker";

/**
 * Width of the Status column, sized to the widest pill this grid will actually
 * render.
 *
 * The column was pinned at 320px, which is wider than every label needs and left
 * a large empty gap before the next column. Status labels vary a lot — "In Portal"
 * against "Awaiting Submitter's Response" — so the text is measured rather than
 * estimated per character.
 */
const PILL_FONT =
  '600 12px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

let measureCtx: CanvasRenderingContext2D | null | undefined;
const widthCache = new Map<string, number>();

const textWidth = (text: string, font = PILL_FONT): number => {
  const cacheKey = `${font}:${text}`;
  const cached = widthCache.get(cacheKey);
  if (cached !== undefined) return cached;
  if (measureCtx === undefined) {
    measureCtx = document.createElement("canvas").getContext("2d");
  }
  if (measureCtx) measureCtx.font = font;
  // Fall back to a per-character estimate where canvas is unavailable.
  const w = measureCtx ? measureCtx.measureText(text).width : text.length * 7;
  widthCache.set(cacheKey, w);
  return w;
};

// Everything around the label: cell padding (12+12), the renderer's inner
// padding (12), and the pill's own padding (12+12).
const STATUS_CHROME = 60;
// The assign-status chevron and its gap, rendered for super users only.
const STATUS_CHEVRON = 24;
// Slack against sub-pixel rounding, so the label can never sit flush to the edge.
const STATUS_SLACK = 3;
// Keeps the "Status" header and its sort control legible on narrow labels.
const STATUS_MIN_WIDTH = 128;

const statusColumnWidth = (rows: Submission[], isSuperUser: boolean) => {
  return rows.reduce((widest, row) => {
    const statusWidth =
      Math.ceil(textWidth(row.status || "")) +
      STATUS_CHROME +
      STATUS_SLACK +
      (isSuperUser ? STATUS_CHEVRON : 0);
    return Math.max(widest, statusWidth);
  }, STATUS_MIN_WIDTH);
};

interface SubmissionGridProps {
  rowData: Submission[];
  columnDefs: (ColDef | ColGroupDef)[];
  selectedSubmissionId?: string | null;
  onSelectedSubmissionChange?: (submissionId: string | null) => void;
  submissionIndex?: ReadonlyMap<string, Submission>;
  selectedPanelTab?: SubmissionPanelTab;
  onSelectedPanelTabChange?: (tab: SubmissionPanelTab) => void;
  resetPageKey?: string;
  onRowSelected?: (submission: Submission) => void;
  onQuestionCountsChange?: (
    submissionId: string,
    total: number,
    needsResponse: number,
    latestActivityAt: string | null,
  ) => void;
  onOverviewUpdated?: (submissionId: string, updates: Partial<Submission>) => void;
  onStatusChanged?: (submissionId: string, newStatus: string, stageTimestamps?: Record<string, string>) => void;
  onDeleted?: (submissionId: string) => void;
  trackType?: 'suggested-papers' | 'submitted-data';
  isSuperUser?: boolean;
  canAssignCurator?: boolean;
  currentUserEmail?: string;
  currentUserId?: string;
  curationActionRequest?: {
    submissionId: string;
    type: 'volunteer' | 'assign-curator';
    requestId: number;
  } | null;
  onCurationAction?: (submission: Submission) => void;
  onCurationActionHandled?: () => void;
  onStudyUpvote?: (submission: Submission) => void;
}

type DetailRow = Submission & {
  __detailRow: true;
  __detailRowId: string;
  trackType: 'suggested-papers' | 'submitted-data';
};

const isDetailRow = (row: Submission | DetailRow | undefined): row is DetailRow =>
  !!row && '__detailRow' in row && row.__detailRow === true;

const rowId = (row: Submission) => String(row.submissionId || row.id);

const INITIAL_DETAIL_ROW_HEIGHT = 480;

const InlineDetailRenderer = (params: any) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const submission = params.data as DetailRow;
  const isLastVisible = params.context.isLastVisibleSubmission(rowId(submission));

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;

    const resize = () => {
      const height = Math.ceil(content.getBoundingClientRect().height) + (isLastVisible ? 0 : 6);
      if (height > 0 && params.node.rowHeight !== height) {
        params.node.setRowHeight(height);
        // Recalculate row positions only. Calling redrawRows here remounts the
        // detail renderer and resets its selected tab.
        params.api.onRowHeightChanged();
      }
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(content);
    return () => observer.disconnect();
  }, [params.api, params.node]);

  return (
    <div
      ref={contentRef}
      className={`submission-detail-panel w-full border-t-2 border-blue-400 rounded-b-lg bg-white ${
        isLastVisible ? 'submission-detail-panel-last' : ''
      }`}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <SubmissionFlowTracker
        key={submission.submissionId || submission.id}
        currentStatus={submission.status}
        trackType={submission.trackType}
        data={submission}
        isSuperUser={params.context.isSuperUser}
        currentUserEmail={params.context.currentUserEmail}
        currentUserId={params.context.currentUserId}
        submissionIndex={params.context.submissionIndex}
        activePanelTab={params.context.selectedPanelTab}
        onPanelTabChange={params.context.onSelectedPanelTabChange}
        onQuestionCountsChange={params.context.onQuestionCountsChange}
        onOverviewUpdated={params.context.onOverviewUpdated}
        onDeleted={params.context.onDeleted}
        requestedOverviewAction={
          params.context.curationActionRequest?.submissionId === rowId(submission)
            ? params.context.curationActionRequest
            : undefined
        }
        onRequestedOverviewActionHandled={params.context.onCurationActionHandled}
      />
    </div>
  );
};

export const SubmissionGrid = ({ rowData, columnDefs, selectedSubmissionId = null, onSelectedSubmissionChange, submissionIndex, selectedPanelTab = 'details', onSelectedPanelTabChange, resetPageKey = '', onRowSelected, onQuestionCountsChange, onOverviewUpdated, onStatusChanged, onDeleted, trackType = 'suggested-papers', isSuperUser = false, canAssignCurator = isSuperUser, currentUserEmail = '', currentUserId = '', curationActionRequest = null, onCurationAction, onCurationActionHandled, onStudyUpvote }: SubmissionGridProps) => {
  const [currentPage, setCurrentPage] = useState(0);
  const [totalRows, setTotalRows] = useState(rowData.length);
  const [paginationPageSize, setPaginationPageSize] = useState(10);
  const gridApiRef = useRef<GridApi | null>(null);
  const currentPageRef = useRef(0);
  const visibleIdsRef = useRef(new Set(rowData.slice(0, 10).map(rowId)));
  const lastVisibleIdRef = useRef<string | null>(rowData.length ? rowId(rowData[Math.min(9, rowData.length - 1)]) : null);
  const applyingPaginationRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const previousResetPageKeyRef = useRef(resetPageKey);

  const sizedColumnDefs = useMemo(() => {
    const width = statusColumnWidth(rowData.slice(0, paginationPageSize), isSuperUser);
    return columnDefs.map(col =>
      "field" in col && col.field === "status"
        ? { ...col, width, minWidth: STATUS_MIN_WIDTH, maxWidth: 520 }
        : col);
  }, [columnDefs, isSuperUser, paginationPageSize, rowData]);

  const defaultColDef: ColDef = {
    resizable: true,
    sortable: true,
    filter: true,
    minWidth: 100,
    suppressSizeToFit: true,
    cellClass: 'cell-wrap-ellipsis',
    cellStyle: {
      display: 'flex',
      alignItems: 'center',
      padding: '8px 12px'
    }
  };

  const selectedId = selectedSubmissionId;
  const selectedRow = useMemo(
    () => rowData.find(row => rowId(row) === selectedId) ?? null,
    [rowData, selectedId],
  );

  const preparedRowData = useMemo<(Submission | DetailRow)[]>(() => {
    const rows: (Submission | DetailRow)[] = [];

    rowData.forEach(row => {
      const prepared = { ...row, trackType };
      rows.push(prepared);
      if (rowId(row) === String(selectedId)) {
        rows.push({
          ...prepared,
          __detailRow: true,
          __detailRowId: `${rowId(row)}-detail`,
        });
      }
    });

    return rows;
  }, [rowData, selectedId, trackType]);

  const applyCustomPagination = useCallback((api: GridApi, requestedPage = currentPageRef.current) => {
    if (applyingPaginationRef.current) return;
    applyingPaginationRef.current = true;

    const submissionNodes: IRowNode[] = [];
    const allNodes: IRowNode[] = [];
    api.forEachNodeAfterFilterAndSort(node => {
      allNodes.push(node);
      if (!isDetailRow(node.data)) submissionNodes.push(node);
    });

    const pageCount = Math.max(1, Math.ceil(submissionNodes.length / paginationPageSize));
    const page = Math.min(Math.max(requestedPage, 0), pageCount - 1);
    const start = page * paginationPageSize;
    const visibleSubmissionNodes = submissionNodes.slice(start, start + paginationPageSize);
    const visibleIds = new Set(visibleSubmissionNodes.map(node => rowId(node.data)));
    visibleIdsRef.current = visibleIds;
    lastVisibleIdRef.current = Array.from(visibleIds).at(-1) ?? null;
    currentPageRef.current = page;

    allNodes.forEach(node => {
      const data = node.data as Submission | DetailRow;
      const visible = visibleIds.has(rowId(data));
      node.setRowHeight(
        visible
          ? (isDetailRow(data) ? (node.rowHeight || INITIAL_DETAIL_ROW_HEIGHT) : 60)
          : 0,
      );
    });

    setCurrentPage(page);
    setTotalRows(submissionNodes.length);
    const statusWidth = statusColumnWidth(
      visibleSubmissionNodes.map(node => node.data as Submission),
      isSuperUser,
    );
    if (api.getColumn('status')?.getActualWidth() !== statusWidth) {
      api.setColumnWidths([{ key: 'status', newWidth: statusWidth }]);
    }
    api.onRowHeightChanged();
    applyingPaginationRef.current = false;
  }, [isSuperUser, paginationPageSize]);

  useEffect(() => {
    if (gridApiRef.current) applyCustomPagination(gridApiRef.current);
  }, [preparedRowData, applyCustomPagination]);

  useEffect(() => {
    if (previousResetPageKeyRef.current === resetPageKey) return;
    previousResetPageKeyRef.current = resetPageKey;
    currentPageRef.current = 0;
    setCurrentPage(0);
    if (gridApiRef.current) applyCustomPagination(gridApiRef.current, 0);
  }, [applyCustomPagination, resetPageKey]);

  useEffect(() => {
    gridApiRef.current?.refreshCells({
      columns: ['submissionId'],
      force: true,
    });
  }, [selectedId]);

  useEffect(() => {
    gridApiRef.current?.refreshCells({
      columns: ['status', 'leadCuratorName'],
      force: true,
    });
  }, [rowData]);

  useEffect(() => {
    if (!selectedRow) return;
    const frame = requestAnimationFrame(() => {
      containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedRow]);

  const handleStatusChangedWithPanel = (submissionId: string, newStatus: string, stageTimestamps?: Record<string, string>) => {
    onStatusChanged?.(submissionId, newStatus, stageTimestamps);
  };

  const handleCellClicked = (event: CellClickedEvent) => {
    if (event.colDef.field !== 'submissionId') return;
    const clicked = event.data as Submission;
    const clickedId = clicked?.submissionId || clicked?.id;

    if (selectedId) {
      const openDetail = event.api.getRowNode(`${selectedId}-detail`);
      if (openDetail) {
        openDetail.setRowHeight(0);
        event.api.onRowHeightChanged();
      }
    }

    if (clickedId === selectedId) {
      // Toggle off
      onSelectedSubmissionChange?.(null);
    } else {
      onSelectedPanelTabChange?.('details');
      onSelectedSubmissionChange?.(String(clickedId));
    }

    if (onRowSelected) onRowSelected(clicked);
  };

  return (
    <div ref={containerRef} className="w-full">
      <div className="ag-theme-alpine w-full">
        <style>{`
          .cell-wrap-ellipsis {
            display: flex !important;
            align-items: center !important;
            white-space: nowrap !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
            max-width: 100% !important;
          }
          .cell-wrap-ellipsis > div {
            max-width: 100% !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
            white-space: nowrap !important;
          }
          /* Status pills are sized to fit, so they must never be truncated.
             overflow stays visible so the assign-status dropdown can escape
             the cell instead of being clipped by it. */
          .cell-status, .cell-status > div {
            display: flex !important;
            align-items: center !important;
            white-space: nowrap !important;
            overflow: visible !important;
            text-overflow: clip !important;
            max-width: none !important;
          }
          .ag-cell {
            display: flex !important;
            align-items: center !important;
            padding: 8px 12px !important;
          }
          .ag-cell-wrapper { width: 100% !important; max-width: 100% !important; overflow: hidden !important; }
          .ag-cell-value { width: 100% !important; max-width: 100% !important; overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; }
          .ag-header-cell-label { display: flex; align-items: center; }
          .ag-row-selected { background-color: #e3f2fd !important; }
          .ag-center-cols-viewport { padding-bottom: 0 !important; }
          .ag-header-container { min-width: 100% !important; }
          .ag-header-cell { overflow: visible !important; }
          .ag-header-cell-text { white-space: nowrap !important; overflow: visible !important; text-overflow: clip !important; }
          .ag-cell span, .ag-cell div, .ag-cell a { max-width: 100% !important; overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; }
          .ag-row-highlighted { background-color: #eff6ff !important; border-left: 3px solid #3b82f6 !important; }
          .ag-detail-row {
            background-color: #f1f5f9 !important;
            border-bottom: 0 !important;
          }
          .ag-detail-row-last { background-color: white !important; }
          .submission-detail-panel {
            border-bottom: 1px solid #cbd5e1 !important;
            min-width: 0 !important;
          }
          .submission-detail-panel-last { border-bottom: 0 !important; }
          .submission-detail-panel p,
          .submission-detail-panel li,
          .submission-detail-panel dd,
          .submission-detail-panel .break-words,
          .submission-detail-panel .break-all {
            max-width: 100% !important;
            overflow: visible !important;
            text-overflow: clip !important;
            white-space: normal !important;
            overflow-wrap: anywhere !important;
          }
          .submission-detail-panel .curation-readme-content,
          .submission-detail-panel .curation-note-content {
            max-width: 100% !important;
          }
          /* Custom pagination hides off-page rows by giving them zero height.
             The grid's general overflow rule is visible for status menus, so
             explicitly suppress content from those collapsed rows. */
          .ag-row[style*="height: 0px"] {
            visibility: hidden !important;
            overflow: hidden !important;
            border: 0 !important;
            pointer-events: none !important;
          }
          .ag-cell[col-id="status"] { overflow: visible !important; z-index: 10; }
          .ag-row {
            overflow: visible !important;
            transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1) !important;
          }
          .ag-center-cols-container { overflow: visible !important; }
          .ag-body-viewport { overflow-x: auto !important; overflow-y: hidden !important; }
          .ag-body-horizontal-scroll { display: none !important; }
          .ag-body-vertical-scroll,
          .ag-body-vertical-scroll-viewport {
            display: none !important;
          }
          @media (prefers-reduced-motion: reduce) {
            .ag-row { transition: none !important; }
          }
          @media (max-width: 639px) {
            .submission-detail-panel {
              position: sticky;
              left: 0;
              width: calc(100vw - 3.5rem) !important;
            }
          }
        `}</style>

        <AgGridReact
          rowData={preparedRowData}
          columnDefs={sizedColumnDefs}
          defaultColDef={defaultColDef}
          pagination={false}
          rowSelection="single"
          suppressRowClickSelection={true}
          isRowSelectable={(node) => !isDetailRow(node.data)}
          enableCellTextSelection={true}
          animateRows={true}
          domLayout="autoHeight"
          className="w-full rounded-md overflow-hidden"
          rowHeight={60}
          getRowId={(params) => {
            const row = params.data as Submission | DetailRow;
            return isDetailRow(row) ? row.__detailRowId : rowId(row);
          }}
          isFullWidthRow={(params) => isDetailRow(params.rowNode.data)}
          fullWidthCellRenderer={InlineDetailRenderer}
          getRowHeight={(params) => {
            const row = params.data as Submission | DetailRow;
            if (!visibleIdsRef.current.has(rowId(row))) return 0;
            return isDetailRow(row) ? INITIAL_DETAIL_ROW_HEIGHT : 60;
          }}
          embedFullWidthRows={true}
          onCellClicked={handleCellClicked}
          onGridReady={(params) => {
            gridApiRef.current = params.api;
            applyCustomPagination(params.api);
          }}
          onModelUpdated={(params) => applyCustomPagination(params.api)}
          suppressColumnVirtualisation={true}
          suppressAutoSize={true}
          skipHeaderOnAutoSize={true}
          context={{
            trackType,
            isSuperUser,
            canAssignCurator,
            currentUserEmail,
            currentUserId,
            submissionIndex,
            selectedPanelTab,
            onSelectedPanelTabChange,
            onQuestionCountsChange,
            onOverviewUpdated,
            curationActionRequest,
            onCurationAction,
            onCurationActionHandled,
            onStudyUpvote,
            selectedSubmissionId: selectedId,
            onStatusChanged: handleStatusChangedWithPanel,
            isLastVisibleSubmission: (id: string) => id === lastVisibleIdRef.current,
            onDeleted: (id: string) => {
              onSelectedSubmissionChange?.(null);
              onDeleted?.(id);
            },
          }}
          getRowClass={(params) => {
            const data = params.data as Submission | DetailRow;
            if (isDetailRow(data)) {
              return rowId(data) === lastVisibleIdRef.current
                ? 'ag-detail-row ag-detail-row-last'
                : 'ag-detail-row';
            }
            const currentRowId = params.data?.submissionId || params.data?.id;
            return currentRowId === selectedId ? 'ag-row-highlighted' : '';
          }}
          postSortRows={(params) => {
            const detailIndex = params.nodes.findIndex(node => isDetailRow(node.data));
            if (detailIndex < 0) return;

            const [detailNode] = params.nodes.splice(detailIndex, 1);
            const parentId = rowId(detailNode.data);
            const parentIndex = params.nodes.findIndex(node =>
              !isDetailRow(node.data) && rowId(node.data) === parentId);
            params.nodes.splice(parentIndex + 1, 0, detailNode);
          }}
        />
      </div>

      <div className="flex min-h-[48px] flex-wrap items-center justify-center gap-x-3 gap-y-2 border border-t-0 border-gray-300 bg-white px-2 py-2 text-xs text-gray-800 sm:justify-end sm:gap-x-7 sm:px-5 sm:text-[13px]">
        <label className="flex items-center gap-2">
          <span>Page Size:</span>
          <select
            value={paginationPageSize}
            onChange={(event) => {
              onSelectedSubmissionChange?.(null);
              currentPageRef.current = 0;
              setPaginationPageSize(Number(event.target.value));
            }}
            className="h-7 min-w-[62px] rounded border border-gray-300 bg-white px-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          >
            {[10, 20, 50].map(size => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>
        </label>

        <span className="font-medium">
          {totalRows === 0
            ? '0 of 0'
            : `${currentPage * paginationPageSize + 1} to ${Math.min((currentPage + 1) * paginationPageSize, totalRows)} of ${totalRows}`}
        </span>

        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="First page"
            title="First page"
            disabled={currentPage === 0}
            onClick={() => {
              onSelectedSubmissionChange?.(null);
              const api = gridApiRef.current;
              if (api) applyCustomPagination(api, 0);
            }}
            className="rounded p-1 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ChevronsLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Previous page"
            title="Previous page"
            disabled={currentPage === 0}
            onClick={() => {
              onSelectedSubmissionChange?.(null);
              const api = gridApiRef.current;
              if (api) applyCustomPagination(api, currentPage - 1);
            }}
            className="rounded p-1 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          <span className="min-w-[76px] text-center font-medium">
            Page {currentPage + 1} of {Math.max(1, Math.ceil(totalRows / paginationPageSize))}
          </span>

          <button
            type="button"
            aria-label="Next page"
            title="Next page"
            disabled={currentPage >= Math.ceil(totalRows / paginationPageSize) - 1}
            onClick={() => {
              onSelectedSubmissionChange?.(null);
              const api = gridApiRef.current;
              if (api) applyCustomPagination(api, currentPage + 1);
            }}
            className="rounded p-1 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Last page"
            title="Last page"
            disabled={currentPage >= Math.ceil(totalRows / paginationPageSize) - 1}
            onClick={() => {
              onSelectedSubmissionChange?.(null);
              const api = gridApiRef.current;
              if (api) applyCustomPagination(api, Math.ceil(totalRows / paginationPageSize) - 1);
            }}
            className="rounded p-1 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ChevronsRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
