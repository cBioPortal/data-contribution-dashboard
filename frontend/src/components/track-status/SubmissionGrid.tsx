
import { AgGridReact } from "ag-grid-react";
import { ColDef, ColGroupDef, CellClickedEvent } from "ag-grid-community";
import { useState, useRef, useEffect, useMemo } from "react";
import { Submission } from "@/types/submission";
import { SubmissionFlowTracker } from "./SubmissionFlowTracker";

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

const textWidth = (text: string): number => {
  const cached = widthCache.get(text);
  if (cached !== undefined) return cached;
  if (measureCtx === undefined) {
    measureCtx = document.createElement("canvas").getContext("2d");
    if (measureCtx) measureCtx.font = PILL_FONT;
  }
  // Fall back to a per-character estimate where canvas is unavailable.
  const w = measureCtx ? measureCtx.measureText(text).width : text.length * 7;
  widthCache.set(text, w);
  return w;
};

// Everything around the label: cell padding (12+12), the renderer's inner
// padding (12), the pill's own padding (12+12), the "n/7" step badge and the
// gaps between them. See StatusCellWithAssign in GridConfig.
const STATUS_CHROME = 92;
// The assign-status chevron, rendered for super users only.
const STATUS_CHEVRON = 19;
// Slack against sub-pixel rounding, so the label can never sit flush to the edge.
const STATUS_SLACK = 8;
// Keeps the "Status" header and its sort control legible on narrow labels.
const STATUS_MIN_WIDTH = 140;

interface SubmissionGridProps {
  rowData: Submission[];
  columnDefs: (ColDef | ColGroupDef)[];
  onRowSelected?: (submission: Submission) => void;
  onStatusChanged?: (submissionId: string, newStatus: string) => void;
  onDeleted?: (submissionId: string) => void;
  trackType?: 'suggested-papers' | 'submitted-data';
  isSuperUser?: boolean;
  currentUserEmail?: string;
  currentUserId?: string;
}

export const SubmissionGrid = ({ rowData, columnDefs, onRowSelected, onStatusChanged, onDeleted, trackType = 'suggested-papers', isSuperUser = false, currentUserEmail = '', currentUserId = '' }: SubmissionGridProps) => {
  const [selectedRow, setSelectedRow] = useState<Submission | null>(null);
  const currentPageRef = useRef<number>(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const paginationPageSize = 10;

  // Widest status present in this grid's data. Tracked as the label itself so the
  // memo below only recomputes when the widest one actually changes, rather than
  // on every keystroke of the search box.
  const widestStatus = useMemo(
    () => (rowData || []).reduce(
      (widest, row) => (textWidth(row?.status || "") > textWidth(widest) ? row.status : widest),
      ""),
    [rowData]);

  const sizedColumnDefs = useMemo(() => {
    if (!widestStatus) return columnDefs;
    const width = Math.max(
      STATUS_MIN_WIDTH,
      Math.ceil(textWidth(widestStatus)) + STATUS_CHROME + STATUS_SLACK + (isSuperUser ? STATUS_CHEVRON : 0));
    return columnDefs.map(col =>
      "field" in col && col.field === "status"
        // minWidth has to come down too: the column def sets 300, which would
        // otherwise clamp the measured width straight back up.
        ? { ...col, width, minWidth: Math.min(STATUS_MIN_WIDTH, width) }
        : col);
  }, [columnDefs, widestStatus, isSuperUser]);

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

  const preparedRowData = rowData.map(row => ({ ...row, trackType }));

  const selectedId = selectedRow?.submissionId || selectedRow?.id;

  // When a status is assigned, update selectedRow immediately so the progress panel reflects it
  const handleStatusChangedWithPanel = (submissionId: string, newStatus: string) => {
    if (selectedRow && (selectedRow.submissionId === submissionId || selectedRow.id === submissionId)) {
      setSelectedRow(prev => prev ? { ...prev, status: newStatus } : null);
    }
    onStatusChanged?.(submissionId, newStatus);
  };

  const handleCellClicked = (event: CellClickedEvent) => {
    if (event.colDef.field !== 'submissionId') return;
    const clicked = event.data as Submission;
    const clickedId = clicked?.submissionId || clicked?.id;

    if (clickedId === selectedId) {
      // Toggle off
      setSelectedRow(null);
    } else {
      setSelectedRow(clicked);
      // Scroll panel into view after render
      setTimeout(() => {
        panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 50);
    }

    if (onRowSelected) onRowSelected(clicked);
  };

  return (
    <div className="w-full">
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
          .ag-center-cols-viewport { padding-bottom: 20px !important; }
          .ag-header-container { min-width: 100% !important; }
          .ag-header-cell { overflow: visible !important; }
          .ag-header-cell-text { white-space: nowrap !important; overflow: visible !important; text-overflow: clip !important; }
          .ag-cell span, .ag-cell div, .ag-cell a { max-width: 100% !important; overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; }
          .ag-row-highlighted { background-color: #eff6ff !important; border-left: 3px solid #3b82f6 !important; }
          .ag-cell[col-id="status"] { overflow: visible !important; z-index: 10; }
          .ag-row { overflow: visible !important; }
          .ag-center-cols-container { overflow: visible !important; }
          .ag-body-viewport { overflow-x: auto !important; overflow-y: auto !important; }
        `}</style>

        <AgGridReact
          rowData={preparedRowData}
          columnDefs={sizedColumnDefs}
          defaultColDef={defaultColDef}
          pagination={true}
          paginationPageSize={paginationPageSize}
          rowSelection="single"
          enableCellTextSelection={true}
          animateRows={true}
          domLayout="autoHeight"
          className="w-full rounded-md overflow-hidden"
          rowHeight={60}
          onCellClicked={handleCellClicked}
          suppressColumnVirtualisation={true}
          suppressAutoSize={true}
          skipHeaderOnAutoSize={true}
          context={{ trackType, isSuperUser, onStatusChanged: handleStatusChangedWithPanel }}
          getRowClass={(params) => {
            const rowId = params.data?.submissionId || params.data?.id;
            return rowId === selectedId ? 'ag-row-highlighted' : '';
          }}
          onPaginationChanged={(params) => {
            const newPage = params.api?.paginationGetCurrentPage?.() ?? 0;
            if (newPage !== currentPageRef.current) {
              currentPageRef.current = newPage;
              setSelectedRow(null);
            }
          }}
        />
      </div>

      {/* Detail panel — below grid, no row count inflation */}
      {selectedRow && (
        <div ref={panelRef} className="mt-0 border-t-2 border-blue-400 rounded-b-lg bg-white shadow-sm">
          <SubmissionFlowTracker
            currentStatus={selectedRow.status}
            trackType={trackType}
            data={selectedRow}
            isSuperUser={isSuperUser}
            currentUserEmail={currentUserEmail}
            currentUserId={currentUserId}
            onDeleted={(id) => {
              setSelectedRow(null);
              onDeleted?.(id);
            }}
          />
        </div>
      )}
    </div>
  );
};
