import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Lock, Plus, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  CurationDeliverables as Deliverables,
  getCurationRecord,
  saveCurationReadme,
  addCurationNote,
  editCurationNote,
  deleteCurationNote,
} from '@/services/api';
import { logger } from '@/utils/logger';
import { Markdown } from '@/utils/markdown';
import { CurationDeliverables } from './CurationDeliverables';

/**
 * The curation record for one submission: a README and an activity log.
 *
 * Side by side, not tabbed. They are different kinds of thing — the README
 * describes the finished study and is edited in place; the log records what
 * happened, in order, and only grows — and showing one at a time makes them read
 * as alternatives rather than as a document and its provenance. The panel is the
 * full width of the grid, so there is room for both.
 *
 * The two are distinguished by type as well as position: the README is set in a
 * serif, the log in the interface sans. That is the cheapest possible way to say
 * "this half is a document, this half is a record of events".
 *
 * Fetched when a row expands rather than carried in the list payload: the
 * tracker lists 84 studies and none of its columns show any of this.
 */

const SECTIONS: { key: string; label: string; hint: string }[] = [
  { key: 'summary', label: 'Summary', hint: 'What this study is, for someone who will not read the paper.' },
  { key: 'sourceData', label: 'Source data', hint: 'Where the data came from, and what was received.' },
  { key: 'whatWasCurated', label: 'What was curated', hint: 'Sample counts, and what was excluded and why.' },
  { key: 'transformations', label: 'Transformations', hint: 'Reference genome, liftover, symbol mapping, thresholds.' },
  { key: 'curationDecisions', label: 'Curation decisions', hint: 'Judgement calls and the reasoning behind them.' },
  { key: 'caveats', label: 'Caveats', hint: 'What to be careful about when interpreting this study.' },
  { key: 'links', label: 'Links', hint: 'Paper, DataHub folder, accessions, related studies.' },
];

const NOTE_KINDS = [
  { key: 'note', label: 'Note' },
  { key: 'transformation', label: 'Transformation' },
  { key: 'decision', label: 'Decision' },
  { key: 'rejection', label: 'Rejection' },
];

interface CurationNote {
  id: string;
  stage: string | null;
  kind: string;
  visibility: 'public' | 'internal';
  body: string;
  authorEmail?: string | null;
  createdAt: string;
  editedAt: string | null;
  canEdit?: boolean;
}

interface Readme {
  sections: Record<string, string>;
  updatedAt: string;
  updatedBy: string | null;
}

interface ReviewState {
  volunteerId?: string;
  name: string;
  status: 'accepted' | 'completed';
  reviewRequestedAt: string | null;
  reviewFeedback: string | null;
  reviewFeedbackAt: string | null;
}

const fmtDay = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
};

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

/** Notes written before the log was anchored to stages. */
const UNANCHORED = 'Earlier notes';

/** Small caps eyebrow that names each half and says what kind of thing it is. */
const ColumnLabel: React.FC<{ title: string; aside: string }> = ({ title, aside }) => (
  <div className="flex items-baseline justify-between gap-3 pb-1.5 mb-4 border-b-2 border-gray-800">
    <h3 className="text-[11px] font-bold uppercase tracking-[0.1em] text-gray-800">{title}</h3>
    <span className="text-[11px] font-mono text-gray-400 whitespace-nowrap">{aside}</span>
  </div>
);

export const CurationRecord = ({
  submissionId,
  /** Hidden on the record's own page, where the link would point at itself. */
  showPermalink = true,
}: { submissionId: string; showPermalink?: boolean }) => {
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [readme, setReadme] = useState<Readme | null>(null);
  const [deliverables, setDeliverables] = useState<Deliverables | null>(null);
  const [reviewState, setReviewState] = useState<ReviewState | null>(null);
  const [notes, setNotes] = useState<CurationNote[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [canEditReadme, setCanEditReadme] = useState(false);
  const [canAddNotes, setCanAddNotes] = useState(false);
  const [canAddRejection, setCanAddRejection] = useState(false);
  const [canEditDeliverables, setCanEditDeliverables] = useState(false);
  const [canViewDeliverablesSection, setCanViewDeliverablesSection] = useState(false);
  const [canRequestReview, setCanRequestReview] = useState(false);
  const [canReviewCuration, setCanReviewCuration] = useState(false);
  const handleNotesChanged = useCallback((nextNotes: CurationNote[]) => {
    setNotes(nextNotes);
    void queryClient.invalidateQueries({
      queryKey: ['curation-record-rejection', submissionId],
    });
  }, [queryClient, submissionId]);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await getCurationRecord(submissionId);
      setReadme(res.data.readme ?? null);
      setDeliverables(res.data.deliverables ?? null);
      setReviewState(res.data.reviewState ?? null);
      setNotes(res.data.notes ?? []);
      setCanEdit(!!res.data.canEdit);
      setCanEditReadme(!!(res.data.permissions?.canEditReadme ?? res.data.canEdit));
      setCanAddNotes(!!(res.data.permissions?.canAddNotes ?? res.data.canEdit));
      setCanAddRejection(!!(res.data.permissions?.canAddRejection ?? res.data.canEdit));
      setCanEditDeliverables(!!(res.data.permissions?.canEditDeliverables ?? res.data.canEdit));
      setCanViewDeliverablesSection(!!res.data.permissions?.canViewDeliverablesSection);
      setCanRequestReview(!!res.data.permissions?.canRequestReview);
      setCanReviewCuration(!!res.data.permissions?.canReviewCuration);
    } catch (e: unknown) {
      logger.warn('Could not load curation record:', e instanceof Error ? e.message : e);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [submissionId]);

  const handleWorkflowChanged = useCallback(async () => {
    await load();
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['profile'] }),
      queryClient.invalidateQueries({ queryKey: ['community-contributions'] }),
      queryClient.invalidateQueries({ queryKey: ['curation-volunteers', submissionId] }),
    ]);
  }, [load, queryClient, submissionId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-xs text-gray-400 mt-6 pt-5 border-t border-gray-100">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading curation record…
      </p>
    );
  }

  if (failed) {
    return (
      <p className="mt-6 pt-5 border-t border-gray-100 text-xs text-gray-400">
        Couldn't load the curation record.{' '}
        <button type="button" onClick={() => void load()} className="underline hover:no-underline">Try again</button>
      </p>
    );
  }

  const nothingYet = !readme && !deliverables && !notes.length && !canEdit;
  if (nothingYet) {
    return (
      <p className="mt-6 pt-5 border-t border-gray-100 text-xs text-gray-400">
        The curation team has not published notes for this study yet.
      </p>
    );
  }

  return (
    <div className="mt-6 border-t border-gray-100 pt-5">
      {canViewDeliverablesSection && (
        <CurationDeliverables
          submissionId={submissionId}
          deliverables={deliverables}
          reviewState={reviewState}
          canEdit={canEditDeliverables}
          canRequestReview={canRequestReview}
          canReview={canReviewCuration}
          onChanged={handleWorkflowChanged}
        />
      )}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-9">
        <ReadmeColumn
          submissionId={submissionId}
          readme={readme}
          canEdit={canEditReadme}
          onSaved={setReadme}
        />
        <div className="lg:border-l lg:border-gray-100 lg:pl-9">
          <ActivityColumn
            submissionId={submissionId}
            notes={notes}
            canAddNotes={canAddNotes}
            canAddRejection={canAddRejection}
            onChanged={handleNotesChanged}
          />
          {showPermalink && (
            <Link
              to={`/study/${submissionId}`}
              className="mt-5 inline-flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800"
            >
              Open full record <ExternalLink className="h-3 w-3" />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── README: the document ────────────────────────────────────────────────────

const ReadmeColumn: React.FC<{
  submissionId: string;
  readme: Readme | null;
  canEdit: boolean;
  onSaved: (r: Readme) => void;
}> = ({ submissionId, readme, canEdit, onSaved }) => {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const sections = readme?.sections ?? {};
  const filled = SECTIONS.filter(s => sections[s.key]);
  const empty = SECTIONS.filter(s => !sections[s.key]);

  const save = async (key: string) => {
    setSaving(true);
    setSaveError(null);
    try {
      // Written whole: it is one document and the editor holds all of it, so
      // there is no partial state to reconcile.
      const res = await saveCurationReadme(submissionId, { ...sections, [key]: draft });
      onSaved(res.data.readme);
      setEditing(null);
      setDraft('');
    } catch (e: unknown) {
      logger.error('Could not save README:', e instanceof Error ? e.message : e);
      const message = errorMessage(e, 'Could not save this README section.');
      setSaveError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (key: string) => {
    setEditing(key);
    setDraft(sections[key] || '');
    setSaveError(null);
  };

  const editor = (key: string) => (
    <div>
      <textarea
        value={draft}
        onChange={e => {
          setDraft(e.target.value);
          setSaveError(null);
        }}
        rows={5}
        placeholder={SECTIONS.find(s => s.key === key)?.hint}
        className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:border-gray-500 resize-y"
      />
      <div className="flex items-center gap-2 mt-1.5">
        <button type="button" disabled={saving} onClick={() => void save(key)}
          className="text-xs px-3 py-1 rounded-md bg-gray-800 text-white hover:bg-gray-900 disabled:opacity-40">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={() => { setEditing(null); setDraft(''); }}
          className="text-xs px-3 py-1 rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50">
          Cancel
        </button>
      </div>
      {saveError && (
        <p role="alert" className="mt-1.5 text-xs text-red-600">{saveError}</p>
      )}
    </div>
  );

  return (
    <section>
      <ColumnLabel title="Curation README" aside="a document · edited" />

      {!filled.length && !canEdit && (
        <p className="text-sm text-gray-400 font-serif italic">Nothing documented yet.</p>
      )}

      <div className="space-y-5">
        {filled.map(section => (
          <div key={section.key}>
            <div className="flex items-baseline gap-2.5">
              <h4 className="font-serif text-[15px] font-semibold text-gray-900">{section.label}</h4>
              {canEdit && editing !== section.key && (
                <button type="button" onClick={() => startEdit(section.key)}
                  className="text-[11px] text-gray-400 hover:text-gray-600">Edit</button>
              )}
            </div>
            <div className="mt-1">
              {editing === section.key
                ? editor(section.key)
                : (
                  <Markdown
                    text={sections[section.key]}
                    className="curation-readme-content font-serif text-[14.5px] leading-relaxed text-gray-700 max-w-[62ch]"
                  />
                )}
            </div>
          </div>
        ))}
      </div>

      {/* Unwritten sections are listed once, compactly, rather than as seven
          empty headings that bury what has actually been written. */}
      {canEdit && empty.length > 0 && (
        <div className="mt-6 pt-4 border-t border-dashed border-gray-200">
          {editing && empty.some(s => s.key === editing) ? (
            <div>
              <h4 className="font-serif text-[15px] font-semibold text-gray-900 mb-1">
                {SECTIONS.find(s => s.key === editing)?.label}
              </h4>
              {editor(editing)}
            </div>
          ) : (
            <>
              <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold mb-2">
                Not documented yet
              </p>
              <div className="flex flex-wrap gap-1.5">
                {empty.map(section => (
                  <button
                    key={section.key}
                    type="button"
                    title={section.hint}
                    onClick={() => startEdit(section.key)}
                    className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border border-gray-200 text-gray-500 hover:border-gray-400 hover:text-gray-700"
                  >
                    <Plus className="h-3 w-3" />{section.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {readme?.updatedAt && (
        <p className="mt-5 pt-3 border-t border-gray-100 text-[11px] font-mono text-gray-400">
          Last updated {fmtDay(readme.updatedAt)}
        </p>
      )}
    </section>
  );
};

// ─── Activity: the log ───────────────────────────────────────────────────────

const ActivityColumn: React.FC<{
  submissionId: string;
  notes: CurationNote[];
  canAddNotes: boolean;
  canAddRejection: boolean;
  onChanged: (n: CurationNote[]) => void;
}> = ({ submissionId, notes, canAddNotes, canAddRejection, onChanged }) => {
  const [draft, setDraft] = useState('');
  const [kind, setKind] = useState('note');
  const [internal, setInternal] = useState(false);
  const [adding, setAdding] = useState(false);
  const [savingEditId, setSavingEditId] = useState<string | null>(null);
  const [retractingId, setRetractingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');

  // Grouped by the stage each note was written at, in arrival order — which is
  // stage order, since a note is stamped with wherever the submission was.
  const groups: { stage: string; notes: CurationNote[] }[] = [];
  for (const note of notes) {
    const stage = note.stage || UNANCHORED;
    const last = groups[groups.length - 1];
    if (last && last.stage === stage) last.notes.push(note);
    else groups.push({ stage, notes: [note] });
  }

  const add = async () => {
    if (!draft.trim()) return;
    setAdding(true);
    setActionError(null);
    try {
      const res = await addCurationNote(submissionId, {
        body: draft, kind, visibility: internal ? 'internal' : 'public',
      });
      onChanged([...notes, { ...res.data.note, canEdit: true }]);
      setDraft(''); setInternal(false); setKind('note');
    } catch (e: unknown) {
      logger.error('Could not add note:', e instanceof Error ? e.message : e);
      const message = errorMessage(e, 'Could not add the curation note.');
      setActionError(message);
      toast.error(message);
    } finally { setAdding(false); }
  };

  const saveEdit = async (id: string) => {
    setSavingEditId(id);
    setActionError(null);
    try {
      const res = await editCurationNote(submissionId, id, editDraft);
      onChanged(notes.map(n => (
        n.id === id ? { ...res.data.note, canEdit: n.canEdit } : n
      )));
      setEditingId(null);
    } catch (e: unknown) {
      logger.error('Could not edit note:', e instanceof Error ? e.message : e);
      const message = errorMessage(e, 'Could not save the curation note.');
      setActionError(message);
      toast.error(message);
    } finally { setSavingEditId(null); }
  };

  const retract = async (id: string) => {
    setRetractingId(id);
    setActionError(null);
    try {
      await deleteCurationNote(submissionId, id);
      onChanged(notes.filter(n => n.id !== id));
    } catch (e: unknown) {
      logger.error('Could not retract note:', e instanceof Error ? e.message : e);
      const message = errorMessage(e, 'Could not retract the curation note.');
      setActionError(message);
      toast.error(message);
    } finally { setRetractingId(null); }
  };

  return (
    <section>
      <ColumnLabel title="Activity" aside="a log · append-only" />

      {!notes.length && (
        <p className="text-sm text-gray-400 mb-4">Nothing recorded for this study yet.</p>
      )}

      {/* One continuous rail behind every group, with the stage nodes punched
          over it — rather than a spacer per group, which only connects if each
          flex child happens to stretch. Deliberately quiet: the horizontal
          stepper above is the status; this is a record of what was written at
          each stage, not a second progress indicator. */}
      <div className="relative pl-5">
        {groups.length > 1 && (
          <span aria-hidden="true" className="absolute left-[3px] top-2 bottom-3 w-px bg-gray-200" />
        )}

        {groups.map((group, gi) => (
          <div key={`${group.stage}-${gi}`} className="relative">
            <span
              aria-hidden="true"
              className="absolute -left-5 top-[6px] h-[7px] w-[7px] rounded-full bg-gray-300 ring-[3px] ring-white"
            />

            <div className={gi < groups.length - 1 ? 'pb-5' : ''}>
              <h4 className="text-[13px] font-semibold text-gray-700 leading-tight">{group.stage}</h4>

              <div className="mt-2 space-y-3">
                {group.notes.map(note => (
                  <div
                    key={note.id}
                    className={`${
                      note.visibility === 'internal'
                        ? 'border-l-2 border-dashed border-purple-300 pl-3'
                        : 'border-l-2 border-gray-200 pl-3'
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className={`text-[9px] font-bold uppercase tracking-[0.07em] px-1.5 py-px rounded ${
                        note.visibility === 'internal'
                          ? 'bg-purple-50 text-purple-700'
                          : note.kind === 'rejection'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-blue-50 text-blue-700'
                      }`}>
                        {note.visibility === 'internal' ? 'Internal' : note.kind}
                      </span>
                      <span className="text-[10px] font-mono text-gray-400">{fmtDay(note.createdAt)}</span>
                      {note.editedAt && <span className="text-[10px] text-gray-400">(edited)</span>}
                      {note.authorEmail && (
                        <span className="text-[10px] text-gray-400 truncate max-w-[16ch]">{note.authorEmail}</span>
                      )}
                    </div>

                    {editingId === note.id ? (
                      <div>
                        <textarea
                          value={editDraft}
                          onChange={e => {
                            setEditDraft(e.target.value);
                            setActionError(null);
                          }}
                          rows={3}
                          className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:border-gray-500 resize-y"
                        />
                        <div className="flex items-center gap-2 mt-1.5">
                          <button type="button" disabled={savingEditId === note.id} onClick={() => void saveEdit(note.id)}
                            className="text-xs px-3 py-1 rounded-md bg-gray-800 text-white hover:bg-gray-900 disabled:opacity-40">
                            {savingEditId === note.id ? 'Saving…' : 'Save'}
                          </button>
                          <button type="button" onClick={() => {
                            setEditingId(null);
                            setActionError(null);
                          }}
                            className="text-xs px-3 py-1 rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50">
                            Cancel
                          </button>
                        </div>
                        {actionError && editingId === note.id && (
                          <p role="alert" className="mt-1.5 text-xs text-red-600">{actionError}</p>
                        )}
                      </div>
                    ) : (
                      <>
                        <Markdown
                          text={note.body}
                          className="curation-note-content text-[13.5px] leading-relaxed text-gray-700 max-w-[58ch]"
                        />
                        {note.visibility === 'internal' && (
                          <p className="mt-1 text-[10px] text-purple-600 inline-flex items-center gap-1">
                            <Lock className="h-2.5 w-2.5" /> Hidden from the public tracker — assigned curators only
                          </p>
                        )}
                        {note.canEdit && (
                          <div className="flex items-center gap-3 mt-1.5">
                            <button type="button"
                              onClick={() => { setEditingId(note.id); setEditDraft(note.body); }}
                              className="text-[10px] text-gray-400 hover:text-gray-600">Edit</button>
                            <button type="button" disabled={retractingId === note.id} onClick={() => void retract(note.id)}
                              className="text-[10px] text-gray-400 hover:text-red-600 disabled:opacity-40">
                              {retractingId === note.id ? 'Retracting…' : 'Retract'}
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      {canAddNotes && (
        <div className="mt-5 border border-gray-200 rounded-lg bg-gray-50/70 p-3 space-y-2.5">
          <div className="flex flex-wrap gap-1.5">
            {NOTE_KINDS.filter(k => k.key !== 'rejection' || canAddRejection).map(k => (
              <button key={k.key} type="button" aria-pressed={kind === k.key}
                onClick={() => setKind(k.key)}
                className={`text-[11px] px-2.5 py-0.5 rounded-full border transition-colors ${
                  kind === k.key
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >{k.label}</button>
            ))}
          </div>

          <textarea
            value={draft}
            onChange={e => {
              setDraft(e.target.value);
              setActionError(null);
            }}
            rows={2}
            placeholder="Add a note — filed under the stage this submission is in now."
            className="w-full text-sm border border-gray-200 rounded-md px-3 py-2 bg-white focus:outline-none focus:border-gray-400 resize-y"
          />

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" aria-pressed={internal} onClick={() => setInternal(v => !v)}
              className={`text-[11px] px-2.5 py-0.5 rounded-full border inline-flex items-center gap-1 transition-colors ${
                internal
                  ? 'bg-purple-600 border-purple-600 text-white'
                  : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            ><Lock className="h-2.5 w-2.5" /> Internal only</button>
            <span className="text-[10px] text-gray-400">
              {internal ? 'Kept off the public tracker.' : 'Published with the study.'}
            </span>
            <button type="button" disabled={adding || !draft.trim()} onClick={() => void add()}
              className="ml-auto text-xs px-3 py-1 rounded-md bg-gray-800 text-white hover:bg-gray-900 disabled:opacity-40"
            >{adding ? 'Adding…' : 'Add note'}</button>
          </div>
          {actionError && !editingId && (
            <p role="alert" className="text-xs text-red-600">{actionError}</p>
          )}
        </div>
      )}
    </section>
  );
};

export default CurationRecord;
