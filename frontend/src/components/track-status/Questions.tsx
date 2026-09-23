import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Lock, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import {
  getQuestions,
  askQuestion,
  replyToQuestion,
  retractQuestionMessage,
} from '@/services/api';
import { Markdown } from '@/utils/markdown';
import { logger } from '@/utils/logger';

/**
 * Questions about a submission.
 *
 * Two conversations share this surface — a submitter asking the curation team
 * about their own submission, and anyone asking about a released study long
 * afterwards. They are the same shape, and separating them into two places would
 * mostly mean a submitter hunting for which of two inboxes the answer arrived
 * in. What keeps them apart is that every thread states who can read it, before
 * the reader gets to the words.
 *
 * The question is the thread's first message; there is no separate subject line,
 * because asking for one is friction that suppresses questions.
 */

interface QMessage {
  id: string;
  body: string;
  authorName: string | null;
  authorEmail?: string | null;
  authorId?: string | null;
  fromCurator: boolean;
  /** Computed server-side: author ids are not disclosed to non-curators. */
  isMine: boolean;
  createdAt: string;
  editedAt: string | null;
}

interface QThread {
  id: string;
  visibility: 'public' | 'private';
  isMine: boolean;
  askerName: string | null;
  askerEmail?: string | null;
  createdAt: string;
  messages: QMessage[];
}

interface QuestionsResponse {
  data: {
    threads: QThread[];
    canAsk: boolean;
    canAskPrivately: boolean;
    isCurator: boolean;
    needsResponseCount: number;
    latestQuestionActivityAt: string | null;
  };
}

export const QUESTIONS_STALE_TIME = 5 * 60 * 1000;
export const questionsQueryKey = (submissionId: string) =>
  ['submission-questions', submissionId] as const;

const fmtDay = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
};

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

const countNeedsResponse = (
  threads: QThread[],
  isCurator: boolean,
  canAskPrivately: boolean,
) => threads.filter((thread) => {
  const latest = thread.messages.at(-1);
  if (!latest) return false;
  if (isCurator) return !latest.fromCurator;
  return latest.fromCurator &&
    ((thread.visibility === 'private' && canAskPrivately) || thread.isMine);
}).length;

const latestQuestionActivityAt = (threads: QThread[]) => {
  let latest: string | null = null;
  threads.forEach((thread) => {
    thread.messages.forEach((message) => {
      if (!latest || new Date(message.createdAt) > new Date(latest)) {
        latest = message.createdAt;
      }
    });
  });
  return latest;
};

/**
 * Initials for the avatar.
 *
 * `CT` is reserved for the curation team and never derived from a name — an
 * account called "Curation Team" was otherwise given the same mark as an actual
 * curator, so a question could be dressed as an official answer just by how its
 * author had named themselves. Authority is stated by the server's
 * `fromCurator`, never inferred from what someone typed into a profile.
 */
const initials = (name: string | null, curator: boolean) => {
  if (curator) return 'CT';
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const mark = (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  // Never let a display name borrow the curation team's mark.
  return mark === 'CT' ? parts[0].slice(0, 2).toUpperCase() : mark;
};

export const Questions = ({
  submissionId,
  onCountsChange,
}: {
  submissionId: string;
  onCountsChange?: (counts: {
    total: number;
    needsResponse: number;
    latestActivityAt: string | null;
  }) => void;
}) => {
  const queryClient = useQueryClient();
  const queryKey = questionsQueryKey(submissionId);
  const [draft, setDraft] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  // Retracting is one click away from every message and cannot be undone from
  // the interface, so it asks first — and says plainly when withdrawing the
  // question will take the whole thread with it.
  const [confirmRetract, setConfirmRetract] = useState<string | null>(null);

  const questionsQuery = useQuery<QuestionsResponse>({
    queryKey,
    queryFn: () => getQuestions(submissionId),
    staleTime: QUESTIONS_STALE_TIME,
  });

  const threads = questionsQuery.data?.data.threads ?? [];
  const canAsk = !!questionsQuery.data?.data.canAsk;
  const canAskPrivately = !!questionsQuery.data?.data.canAskPrivately;
  const isCurator = !!questionsQuery.data?.data.isCurator;

  useEffect(() => {
    if (questionsQuery.data) {
      onCountsChange?.({
        total: threads.length,
        needsResponse: questionsQuery.data.data.needsResponseCount ?? 0,
        latestActivityAt: questionsQuery.data.data.latestQuestionActivityAt ?? null,
      });
    }
  }, [onCountsChange, questionsQuery.data, threads.length]);

  const updateThreads = (update: (threads: QThread[]) => QThread[]) => {
    queryClient.setQueryData<QuestionsResponse>(queryKey, current => {
      if (!current) return current;
      const nextThreads = update(current.data.threads);
      return {
        ...current,
        data: {
          ...current.data,
          threads: nextThreads,
          needsResponseCount: countNeedsResponse(
            nextThreads,
            current.data.isCurator,
            current.data.canAskPrivately,
          ),
          latestQuestionActivityAt: latestQuestionActivityAt(nextThreads),
        },
      };
    });
  };

  const askMutation = useMutation({
    mutationFn: (question: { body: string; visibility: 'public' | 'private' }) =>
      askQuestion(submissionId, question),
    onSuccess: (res) => {
      updateThreads(current => [res.data.thread, ...current]);
      setDraft('');
      setVisibility('public');
    },
    onError: (error: unknown) => {
      logger.error('Could not post question:', error instanceof Error ? error.message : error);
      toast.error(errorMessage(error, 'Could not post question.'));
    },
  });

  const replyMutation = useMutation({
    mutationFn: ({ threadId, body }: { threadId: string; body: string }) =>
      replyToQuestion(submissionId, threadId, body),
    onSuccess: (res, { threadId }) => {
      updateThreads(current => current.map(thread =>
        thread.id === threadId
          ? { ...thread, messages: [...thread.messages, res.data.message] }
          : thread));
      setReplyTo(null);
      setReplyDraft('');
    },
    onError: (error: unknown) => {
      logger.error('Could not post reply:', error instanceof Error ? error.message : error);
      toast.error(errorMessage(error, 'Could not post reply.'));
    },
  });

  const retractMutation = useMutation({
    mutationFn: ({ threadId, messageId }: { threadId: string; messageId: string }) =>
      retractQuestionMessage(submissionId, threadId, messageId),
    onSuccess: (_res, { threadId, messageId }) => {
      updateThreads(current => current
        .map(thread => thread.id === threadId
          ? { ...thread, messages: thread.messages.filter(message => message.id !== messageId) }
          : thread)
        .filter(thread => thread.messages.length));
      setConfirmRetract(null);
    },
    onError: (error: unknown) => {
      logger.error('Could not retract message:', error instanceof Error ? error.message : error);
      toast.error(errorMessage(error, 'Could not retract message.'));
    },
  });

  const ask = () => {
    if (!draft.trim()) return;
    askMutation.mutate({ body: draft, visibility });
  };

  const reply = (threadId: string) => {
    if (!replyDraft.trim()) return;
    replyMutation.mutate({ threadId, body: replyDraft });
  };

  const retract = (threadId: string, messageId: string) => {
    retractMutation.mutate({ threadId, messageId });
  };

  if (questionsQuery.isPending) {
    return (
      <p className="flex items-center gap-2 text-xs text-gray-400 py-4">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading questions…
      </p>
    );
  }

  if (questionsQuery.isError) {
    return (
      <p className="text-xs text-gray-400 py-4">
        Couldn't load questions.{' '}
        <button type="button" onClick={() => void questionsQuery.refetch()} className="underline hover:no-underline">Try again</button>
      </p>
    );
  }

  return (
    <div>
      {!threads.length && (
        <p className="text-sm text-gray-400 mb-4 flex items-center gap-2">
          <MessageSquare className="h-4 w-4" />
          No questions about this study yet.
        </p>
      )}

      <div className="space-y-4">
        {threads.map(thread => {
          const answered = thread.messages.some(m => m.fromCurator);
          const isPrivate = thread.visibility === 'private';

          return (
            <article
              key={thread.id}
              className={`rounded-lg border overflow-hidden ${isPrivate ? 'border-purple-200' : 'border-gray-200'}`}
            >
              <header className={`flex flex-wrap items-center gap-2 px-3.5 py-2 border-b ${
                isPrivate ? 'bg-purple-50/60 border-purple-100' : 'bg-gray-50 border-gray-100'
              }`}>
                <span className={`text-[9.5px] font-bold uppercase tracking-[0.07em] px-1.5 py-px rounded inline-flex items-center gap-1 ${
                  isPrivate ? 'bg-purple-100 text-purple-700' : 'bg-blue-50 text-blue-700'
                }`}>
                  {isPrivate && <Lock className="h-2.5 w-2.5" />}
                  {isPrivate ? 'Submitter & curation team' : 'Public'}
                </span>
                <span className={`text-[9.5px] font-bold uppercase tracking-[0.07em] px-1.5 py-px rounded ${
                  answered ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
                }`}>
                  {answered ? 'Answered' : 'Awaiting curation team'}
                </span>
                <span className="ml-auto text-[10px] font-mono text-gray-400 whitespace-nowrap">
                  {thread.messages.length} {thread.messages.length === 1 ? 'message' : 'messages'} · {fmtDay(thread.createdAt)}
                </span>
              </header>

              <div className="px-3.5 py-3 space-y-3.5">
                {thread.messages.map(m => (
                  <div key={m.id} className="grid grid-cols-[26px_minmax(0,1fr)] gap-2.5">
                    <span className={`h-[26px] w-[26px] rounded-full grid place-items-center text-[9.5px] font-bold ${
                      m.fromCurator
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-500 border border-gray-200'
                    }`}>
                      {initials(m.authorName, m.fromCurator)}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[11.5px] text-gray-400 mb-0.5">
                        <span className="font-semibold text-gray-700 text-xs">
                          {m.authorName || 'Anonymous'}
                        </span>
                        {/* The role is a claim only the server can make. */}
                        {m.fromCurator && (
                          <span className="ml-1.5 text-[9px] font-bold uppercase tracking-[0.06em] px-1.5 py-px rounded bg-blue-600 text-white align-middle">
                            Curation team
                          </span>
                        )}
                        {' · '}{fmtDay(m.createdAt)}
                        {m.editedAt && ' · edited'}
                        {m.authorEmail && <span className="ml-1.5 font-mono text-[10px]">{m.authorEmail}</span>}
                      </p>
                      <Markdown text={m.body} className="text-[13.5px] leading-relaxed text-gray-700 max-w-[70ch]" />
                      {(isCurator || m.isMine) && (
                        confirmRetract === m.id ? (
                          <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px]">
                            <span className="text-red-600 font-medium">
                              {thread.messages.length === 1
                                ? 'Withdraw this question? The thread goes with it.'
                                : 'Retract this message?'}
                            </span>
                            <button type="button" disabled={
                              retractMutation.isPending &&
                              retractMutation.variables?.messageId === m.id
                            }
                              onClick={() => retract(thread.id, m.id)}
                              className="px-2 py-0.5 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-40">
                              {retractMutation.isPending &&
                              retractMutation.variables?.messageId === m.id
                                ? 'Retracting…'
                                : 'Retract'}
                            </button>
                            <button type="button" onClick={() => setConfirmRetract(null)}
                              className="text-gray-500 hover:text-gray-700 underline">Keep it</button>
                            {retractMutation.isError &&
                              retractMutation.variables?.messageId === m.id && (
                                <span role="alert" className="basis-full text-red-600">
                                  {errorMessage(retractMutation.error, 'Could not retract message.')}
                                </span>
                              )}
                          </p>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmRetract(m.id)}
                            className="mt-1 text-[10px] text-gray-400 hover:text-red-600"
                          >Retract</button>
                        )
                      )}
                    </div>
                  </div>
                ))}

                {canAsk && (
                  replyTo === thread.id ? (
                    <div className="pl-[36px]">
                      <textarea
                        value={replyDraft}
                        onChange={e => {
                          setReplyDraft(e.target.value);
                          replyMutation.reset();
                        }}
                        rows={3}
                        placeholder="Write a reply…"
                        className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:border-gray-500 resize-y"
                      />
                      <div className="flex items-center gap-2 mt-1.5">
                        <button type="button" disabled={
                          (replyMutation.isPending &&
                            replyMutation.variables?.threadId === thread.id) ||
                          !replyDraft.trim()
                        }
                          onClick={() => reply(thread.id)}
                          className="text-xs px-3 py-1 rounded-md bg-gray-800 text-white hover:bg-gray-900 disabled:opacity-40">
                          {replyMutation.isPending &&
                          replyMutation.variables?.threadId === thread.id
                            ? 'Posting…'
                            : 'Reply'}
                        </button>
                        <button type="button" onClick={() => { setReplyTo(null); setReplyDraft(''); }}
                          className="text-xs px-3 py-1 rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50">
                          Cancel
                        </button>
                      </div>
                      {replyMutation.isError &&
                        replyMutation.variables?.threadId === thread.id && (
                          <p role="alert" className="mt-1.5 text-xs text-red-600">
                            {errorMessage(replyMutation.error, 'Could not post reply.')}
                          </p>
                        )}
                    </div>
                  ) : (
                    <button type="button" onClick={() => { setReplyTo(thread.id); setReplyDraft(''); }}
                      className="ml-[36px] text-xs text-blue-600 hover:text-blue-800">Reply</button>
                  )
                )}
              </div>
            </article>
          );
        })}
      </div>

      {canAsk ? (
        <div className="mt-5 border border-gray-200 rounded-lg bg-gray-50/70 p-3 space-y-2.5">
          <textarea
            value={draft}
            onChange={e => {
              setDraft(e.target.value);
              askMutation.reset();
            }}
            rows={3}
            placeholder="Ask the curation team about this study…"
            className="w-full text-sm border border-gray-200 rounded-md px-3 py-2 bg-white focus:outline-none focus:border-gray-400 resize-y"
          />
          <div className="flex flex-wrap items-center gap-2">
            {/* Only the submitter and the curation team get the choice. For
                everyone else a question is public by definition, so offering a
                control that would be refused would be a lie. */}
            {canAskPrivately && (
              <div className="inline-flex rounded-full border border-gray-200 overflow-hidden">
                {(['public', 'private'] as const).map(v => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={visibility === v}
                    onClick={() => setVisibility(v)}
                    className={`text-[11px] font-semibold px-3 py-0.5 transition-colors ${
                      visibility === v
                        ? (v === 'private' ? 'bg-purple-600 text-white' : 'bg-blue-600 text-white')
                        : 'bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >{v === 'public' ? 'Public' : 'Curation team only'}</button>
                ))}
              </div>
            )}
            <span className="text-[11px] text-gray-400">
              {visibility === 'private'
                ? 'Only you and the curation team will see this.'
                : 'Anyone who can see this study will be able to read your question and its answer.'}
            </span>
            <button type="button" disabled={askMutation.isPending || !draft.trim()} onClick={ask}
              className="ml-auto text-xs px-3 py-1 rounded-md bg-gray-800 text-white hover:bg-gray-900 disabled:opacity-40">
              {askMutation.isPending ? 'Posting…' : 'Post question'}
            </button>
          </div>
          {askMutation.isError && (
            <p role="alert" className="text-xs text-red-600">
              {errorMessage(askMutation.error, 'Could not post question.')}
            </p>
          )}
        </div>
      ) : (
        <p className="mt-5 text-xs text-gray-400">
          Sign in to ask the curation team a question about this study.
        </p>
      )}
    </div>
  );
};

export default Questions;
