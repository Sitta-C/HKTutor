'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { conversationCopy } from '@/components/conversations/conversation-copy';
import { DashboardIcon } from '@/components/dashboard/dashboard-icon';
import { NotebookAction } from '@/components/ui/notebook-action';
import { NotebookLoadingRegion } from '@/components/ui/notebook-loading';
import { useNotebookToast } from '@/components/ui/notebook-toast';
import {
  CONVERSATION_POLL_INTERVAL_MS,
  loadConversationMessages,
  loadOlderConversationMessages,
  markConversationRead,
  sendConversationMessage,
} from '@/lib/api/conversations';
import { splitMessageLinks } from '@/lib/conversation-links';
import {
  canSendMessage,
  conversationErrorKey,
  conversationReceiptCursor,
  mergeMessages,
  messageLength,
} from '@/lib/conversation-model';
import { formatBangkokShortDate, formatBangkokTime, getBangkokIsoDate } from '@/lib/date-time';
import { useLanguage } from '@/lib/i18n';

import styles from './margin-inbox.module.css';

import type { AuthUser, ConversationMessage, ConversationSummary } from '@/lib/api/types';

export interface ThreadMemory {
  items: ConversationMessage[];
  cursor: string | null;
  olderCursor: string | null;
  readCursor: string | null;
  loaded: boolean;
  draft: string;
  scrollTop: number;
  atLatest: boolean;
  newCount: number;
}

export function ConversationThread({
  conversation,
  user,
  memories,
  onBack,
  onSending,
  onSent,
  onDraft,
  onRefreshInbox,
}: {
  conversation: ConversationSummary;
  user: AuthUser;
  memories: Map<string, ThreadMemory>;
  onBack: () => void;
  onSending: (pending: boolean) => void;
  onSent: (message: ConversationMessage) => void;
  onDraft: (hasDraft: boolean) => void;
  onRefreshInbox: () => void;
}) {
  const { language } = useLanguage();
  const text = conversationCopy[language];
  const toast = useNotebookToast();
  const id = conversation.conversationId;
  const [view, setView] = useState<ThreadMemory>(
    () =>
      memories.get(id) ?? {
        items: [],
        cursor: null,
        olderCursor: null,
        readCursor: null,
        loaded: false,
        draft: '',
        scrollTop: 0,
        atLatest: true,
        newCount: 0,
      },
  );
  const memory = useRef(view);
  const [loading, setLoading] = useState(!view.loaded);
  const [error, setError] = useState<unknown>(null);
  const [sendError, setSendError] = useState(false);
  const [sending, setSending] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<unknown>(null);
  const [readError, setReadError] = useState<unknown>(null);
  const sendingRef = useRef(false);
  const active = useRef(true);
  const transcript = useRef<HTMLDivElement>(null);
  const header = useRef<HTMLHeadingElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [composing, setComposing] = useState(false);
  const restore = useRef(true);
  const requestPending = useRef(false);
  const requestAbort = useRef<AbortController | null>(null);
  const requestRefresh = useRef<(() => void) | null>(null);
  const refreshInbox = useRef(onRefreshInbox);
  const prependPosition = useRef<{ height: number; top: number } | null>(null);
  const name =
    conversation.otherParticipant.displayName ||
    (user.role === 'STUDENT' ? text.tutor : text.student);

  const commit = (next: ThreadMemory) => {
    memory.current = next;
    memories.set(id, next);
    setView(next);
  };

  useEffect(() => {
    refreshInbox.current = onRefreshInbox;
  }, [onRefreshInbox]);

  useEffect(() => {
    active.current = true;
    header.current?.focus({ preventScroll: true });
    return () => {
      active.current = false;
    };
  }, []);

  useEffect(() => {
    let current = true;
    let terminal = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const synchronize = async (manual = false) => {
      if (
        !current ||
        requestPending.current ||
        sendingRef.current ||
        (!manual && (terminal || document.hidden))
      ) {
        return;
      }
      const controller = new AbortController();
      requestAbort.current = controller;
      requestPending.current = true;
      if (manual || !memory.current.loaded) {
        setLoading(true);
      }
      try {
        const cached = memory.current;
        const receiptCursor = conversationReceiptCursor(cached.items, cached.cursor, user.id);
        let olderCursor = cached.olderCursor;
        let response: { items: ConversationMessage[]; cursor: string | null };
        if (cached.loaded) {
          response = await loadConversationMessages(
            id,
            cached.cursor,
            controller.signal,
            receiptCursor,
          );
        } else {
          const page = await loadOlderConversationMessages(id, null, controller.signal);
          response = page;
          olderCursor = page.olderCursor;
        }
        if (!current || controller.signal.aborted) {
          return;
        }
        const existing = memory.current;
        const items = mergeMessages(existing.items, response.items);
        const knownIds = new Set(existing.items.map((message) => message.messageId));
        const added = items.filter(
          (message) => !knownIds.has(message.messageId) && message.senderId !== user.id,
        ).length;
        const next = {
          ...existing,
          items,
          cursor: response.cursor,
          olderCursor,
          loaded: true,
          newCount: existing.atLatest ? 0 : existing.newCount + added,
        };
        memory.current = next;
        memories.set(id, next);
        setView(next);
        setError(null);
        terminal = false;
        let inboxChanged = added > 0;
        const latestReceived = items.findLast((message) => message.senderId !== user.id);
        if (
          !document.hidden &&
          memory.current.atLatest &&
          latestReceived &&
          latestReceived.messageId !== memory.current.readCursor
        ) {
          try {
            const receipt = await markConversationRead(
              id,
              latestReceived.messageId,
              controller.signal,
            );
            if (!current || controller.signal.aborted) {
              return;
            }
            const acknowledged = memory.current;
            const receivedIndex = acknowledged.items.findIndex(
              (message) => message.messageId === latestReceived.messageId,
            );
            const readItems = acknowledged.items.map((message, index) =>
              index <= receivedIndex &&
              message.senderId !== user.id &&
              !message.readAt &&
              receipt.readAt
                ? { ...message, readAt: receipt.readAt }
                : message,
            );
            const nextRead = {
              ...acknowledged,
              items: readItems,
              readCursor: latestReceived.messageId,
            };
            memory.current = nextRead;
            memories.set(id, nextRead);
            setView(nextRead);
            setReadError(null);
            inboxChanged = true;
          } catch (caught: unknown) {
            if (current && !controller.signal.aborted) {
              setReadError(caught);
              if (['expired', 'forbidden', 'missing'].includes(conversationErrorKey(caught))) {
                terminal = true;
                setError(caught);
              }
            }
          }
        }
        if (inboxChanged && current && !controller.signal.aborted && !terminal) {
          refreshInbox.current();
        }
      } catch (caught: unknown) {
        if (current && !controller.signal.aborted) {
          setError(caught);
          terminal = ['expired', 'forbidden', 'missing', 'historyLimit'].includes(
            conversationErrorKey(caught),
          );
        }
      } finally {
        if (current) {
          setLoading(false);
          requestPending.current = false;
        }
      }
    };
    requestRefresh.current = () => {
      void synchronize(true);
    };
    const visibilityChanged = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      if (document.hidden) {
        requestAbort.current?.abort();
      } else {
        void synchronize();
        timer = setInterval(() => {
          void synchronize();
        }, CONVERSATION_POLL_INTERVAL_MS);
      }
    };
    visibilityChanged();
    document.addEventListener('visibilitychange', visibilityChanged);
    return () => {
      current = false;
      requestRefresh.current = null;
      requestAbort.current?.abort();
      requestPending.current = false;
      if (timer !== null) {
        clearInterval(timer);
      }
      document.removeEventListener('visibilitychange', visibilityChanged);
    };
  }, [id, memories, user.id]);

  useEffect(() => {
    const element = transcript.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver(() => {
      if (memory.current.loaded && memory.current.atLatest) {
        element.scrollTop = element.scrollHeight;
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const input = textarea.current;
    if (!input) {
      return;
    }
    input.style.height = 'auto';
    input.style.height = `${Math.min(112, Math.max(48, input.scrollHeight))}px`;
    if (memory.current.atLatest && transcript.current) {
      transcript.current.scrollTop = transcript.current.scrollHeight;
    }
  }, [view.draft]);

  useLayoutEffect(() => {
    const element = transcript.current;
    if (!element || !view.loaded) {
      return;
    }
    if (prependPosition.current) {
      const position = prependPosition.current;
      element.scrollTop = position.top + element.scrollHeight - position.height;
      prependPosition.current = null;
      const next = { ...memory.current, scrollTop: element.scrollTop };
      memory.current = next;
      memories.set(id, next);
    } else if (restore.current) {
      element.scrollTop = memory.current.atLatest ? element.scrollHeight : memory.current.scrollTop;
      restore.current = false;
    } else if (memory.current.atLatest) {
      element.scrollTop = element.scrollHeight;
    }
  }, [id, memories, view.items, view.loaded]);

  const jumpLatest = () => {
    if (transcript.current) {
      transcript.current.scrollTop = transcript.current.scrollHeight;
    }
    commit({
      ...memory.current,
      atLatest: true,
      newCount: 0,
      scrollTop: transcript.current?.scrollTop ?? 0,
    });
  };
  const refresh = () => {
    if (requestPending.current || sendingRef.current) {
      return;
    }
    requestRefresh.current?.();
    onRefreshInbox();
  };
  const loadOlder = async () => {
    const cursor = memory.current.olderCursor;
    if (!cursor || requestPending.current || sendingRef.current) {
      return;
    }
    const controller = new AbortController();
    requestAbort.current = controller;
    requestPending.current = true;
    setLoadingOlder(true);
    setOlderError(null);
    try {
      const response = await loadOlderConversationMessages(id, cursor, controller.signal);
      if (!active.current || controller.signal.aborted) {
        return;
      }
      const element = transcript.current;
      if (element) {
        prependPosition.current = { height: element.scrollHeight, top: element.scrollTop };
      }
      commit({
        ...memory.current,
        items: mergeMessages(memory.current.items, response.items),
        olderCursor: response.olderCursor,
        atLatest: false,
      });
    } catch (caught: unknown) {
      if (active.current && !controller.signal.aborted) {
        setOlderError(caught);
        if (['expired', 'forbidden', 'missing'].includes(conversationErrorKey(caught))) {
          setError(caught);
        }
      }
    } finally {
      if (active.current) {
        requestPending.current = false;
        setLoadingOlder(false);
      }
    }
  };
  const inaccessible =
    error !== null && ['expired', 'forbidden', 'missing'].includes(conversationErrorKey(error));
  const send = async () => {
    const draft = memory.current.draft;
    if (sendingRef.current || inaccessible || !memory.current.loaded || !canSendMessage(draft)) {
      return;
    }
    sendingRef.current = true;
    setSending(true);
    onSending(true);
    setSendError(false);
    try {
      const message = await sendConversationMessage(id, draft);
      if (!active.current) {
        return;
      }
      // Keep the GET cursor: advancing to this send could skip concurrent incoming messages.
      commit({
        ...memory.current,
        items: mergeMessages(memory.current.items, [message]),
        draft: '',
      });
      onDraft(false);
      onSent(message);
      toast.success(text.sent);
    } catch {
      if (active.current) {
        setSendError(true);
        toast.error(text.sendFailed);
      }
    } finally {
      sendingRef.current = false;
      if (active.current) {
        setSending(false);
        onSending(false);
      }
    }
  };

  // Typing a draft should not reformat/rebuild the entire loaded transcript.
  const messageHistory = useMemo(
    () =>
      view.items.map((message, index) => {
        const previous = view.items[index - 1];
        const showDate =
          !previous || getBangkokIsoDate(previous.sentAt) !== getBangkokIsoDate(message.sentAt);
        return (
          <div key={message.messageId}>
            {showDate && (
              <p className={styles.day}>{formatBangkokShortDate(message.sentAt, language)}</p>
            )}
            <div
              className={styles.messageRow}
              data-message-id={message.messageId}
              data-own={message.senderId === user.id}
              data-grouped={
                !showDate &&
                previous?.senderId === message.senderId &&
                new Date(message.sentAt).getTime() - new Date(previous.sentAt).getTime() <= 180000
              }
            >
              <div className={styles.bubble}>
                <p>
                  {splitMessageLinks(message.text).map((part) =>
                    part.href ? (
                      <a
                        key={part.start}
                        href={part.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`${part.text} (${text.openLink})`}
                        title={text.openLink}
                      >
                        {part.text}
                      </a>
                    ) : (
                      part.text
                    ),
                  )}
                </p>
                <div className={styles.messageMeta}>
                  <time dateTime={message.sentAt}>
                    {formatBangkokTime(message.sentAt, language)}
                  </time>
                  {message.senderId === user.id && (
                    <span className={styles.receipt} data-read={Boolean(message.readAt)}>
                      <span aria-hidden="true">{message.readAt ? '✓✓' : '✓'}</span>
                      {message.readAt ? text.readState : text.sentState}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      }),
    [language, text.openLink, text.readState, text.sentState, user.id, view.items],
  );

  return (
    <section className={styles.thread} aria-labelledby="conversation-name">
      <header className={styles.threadHeader}>
        <button
          type="button"
          className={styles.back}
          aria-label={text.back}
          onClick={onBack}
          disabled={sending}
        >
          <DashboardIcon name="arrow-left" />
        </button>
        <span className={styles.initial} aria-hidden="true">
          {Array.from(name)[0]}
        </span>
        <div className={styles.identity}>
          <h2 id="conversation-name" ref={header} tabIndex={-1} title={name}>
            {name}
          </h2>
          <p>
            <span>{user.role === 'STUDENT' ? text.tutor : text.student}</span>
            <span className={styles.updateHint} title={text.automatic}>
              {text.automatic}
            </span>
          </p>
        </div>
        <button
          type="button"
          className={`${styles.quiet} ${styles.threadRefresh}`}
          aria-label={text.refreshThread}
          title={loading ? text.refreshing : text.refreshThread}
          onClick={refresh}
          disabled={loading || sending}
        >
          <DashboardIcon name="refresh" />
          <span>{loading ? text.refreshing : text.refresh}</span>
        </button>
      </header>
      <div
        ref={transcript}
        className={styles.transcript}
        tabIndex={0}
        role="region"
        aria-label={text.history}
        aria-busy={loading || loadingOlder}
        onScroll={() => {
          const element = transcript.current;
          if (!element) {
            return;
          }
          const atLatest = element.scrollHeight - element.scrollTop - element.clientHeight < 40;
          const previous = memory.current;
          const next = {
            ...previous,
            scrollTop: element.scrollTop,
            atLatest,
            newCount: atLatest ? 0 : previous.newCount,
          };
          memory.current = next;
          memories.set(id, next);
          // Only render when proximity changes, rather than on every scroll frame.
          if (previous.atLatest !== atLatest || previous.newCount !== next.newCount) {
            setView(next);
          }
        }}
      >
        {loading && !view.loaded && (
          <div className={styles.state}>
            <NotebookLoadingRegion label={text.loading} />
          </div>
        )}
        {error !== null && (
          <div className={styles.error} role="alert">
            <p>{text[conversationErrorKey(error)]}</p>
            <button type="button" className={styles.quiet} onClick={refresh} disabled={loading}>
              {text.retry}
            </button>
          </div>
        )}
        {view.loaded && view.items.length === 0 && (
          <p className={styles.state}>{text.noMessages}</p>
        )}
        {view.loaded && view.items.length > 0 && (
          <div className={styles.olderHistory}>
            {view.olderCursor ? (
              <button
                type="button"
                className={styles.quiet}
                onClick={() => {
                  void loadOlder();
                }}
                disabled={loadingOlder || loading || sending || inaccessible}
              >
                {loadingOlder ? text.loadingOlder : text.loadOlder}
              </button>
            ) : (
              <p>{text.historyStart}</p>
            )}
            {olderError !== null && (
              <p className={styles.error} role="alert">
                {text[conversationErrorKey(olderError)]}
              </p>
            )}
          </div>
        )}
        <div className={styles.messageHistory} data-message-history>
          {messageHistory}
        </div>
      </div>
      <form
        className={styles.composer}
        data-expanded={composing || Boolean(view.draft) || sendError}
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        {!view.atLatest && (
          <button type="button" className={styles.latest} onClick={jumpLatest}>
            {view.newCount
              ? text.newMessages.replace('{count}', String(view.newCount))
              : text.latest}{' '}
            ↓
          </button>
        )}
        <div className={styles.composerHeading}>
          <label htmlFor="chat-message">{text.compose}</label>
          {view.draft && <span>{text.draft}</span>}
        </div>
        <div className={styles.composeRow}>
          <textarea
            ref={textarea}
            onFocus={() => setComposing(true)}
            onBlur={() => setComposing(false)}
            id="chat-message"
            rows={1}
            value={view.draft}
            placeholder={text.placeholder}
            aria-describedby="chat-limit chat-counter"
            aria-invalid={messageLength(view.draft) > 2000}
            disabled={!view.loaded || sending || inaccessible}
            onChange={(event) => {
              commit({ ...memory.current, draft: event.target.value });
              onDraft(Boolean(event.target.value));
              setSendError(false);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
          />
          <NotebookAction
            type="submit"
            aria-label={sending ? text.sending : text.send}
            role={user.role === 'STUDENT' ? 'student' : 'tutor'}
            icon={<DashboardIcon name="arrow-right" />}
            iconPosition="end"
            disabled={!view.loaded || !canSendMessage(view.draft) || sending || inaccessible}
          >
            {sending ? text.sending : text.sendLabel}
          </NotebookAction>
        </div>
        <div className={styles.composerFooter}>
          <p id="chat-limit">
            {messageLength(view.draft) > 2000
              ? text.tooLong
              : view.draft
                ? text.draftLimit
                : text.limit}
          </p>
          <span id="chat-counter" data-over-limit={messageLength(view.draft) > 2000}>
            {messageLength(view.draft)} / 2,000
          </span>
        </div>
        {sendError && (
          <p className={styles.sendError} role="alert">
            {text.sendFailed}
          </p>
        )}
        {readError !== null && !inaccessible && (
          <p className={styles.sendError} role="alert">
            {text.readFailed}
          </p>
        )}
      </form>
    </section>
  );
}
