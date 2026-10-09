'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { conversationCopy } from '@/components/conversations/conversation-copy';
import { DashboardIcon } from '@/components/dashboard/dashboard-icon';
import { NotebookAction } from '@/components/ui/notebook-action';
import { NotebookLoadingRegion } from '@/components/ui/notebook-loading';
import { useNotebookToast } from '@/components/ui/notebook-toast';
import { loadConversationMessages, sendConversationMessage } from '@/lib/api/conversations';
import { splitMessageLinks } from '@/lib/conversation-links';
import {
  canSendMessage,
  conversationErrorKey,
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
  const [reloadKey, setReloadKey] = useState(0);
  const sendingRef = useRef(false);
  const active = useRef(true);
  const transcript = useRef<HTMLDivElement>(null);
  const header = useRef<HTMLHeadingElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [composing, setComposing] = useState(false);
  const restore = useRef(true);
  const requestPending = useRef(false);
  const name =
    conversation.otherParticipant.displayName ||
    (user.role === 'STUDENT' ? text.tutor : text.student);

  const commit = (next: ThreadMemory) => {
    memory.current = next;
    memories.set(id, next);
    setView(next);
  };

  useEffect(() => {
    active.current = true;
    header.current?.focus({ preventScroll: true });
    return () => {
      active.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    requestPending.current = true;
    const cached = memory.current;
    void loadConversationMessages(id, cached.cursor, controller.signal)
      .then((response) => {
        if (!current) {
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
          loaded: true,
          newCount: existing.atLatest ? 0 : existing.newCount + added,
        };
        memory.current = next;
        memories.set(id, next);
        setView(next);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (current) {
          setError(caught);
        }
      })
      .finally(() => {
        if (current) {
          setLoading(false);
          requestPending.current = false;
        }
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [id, memories, reloadKey, user.id]);

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
    if (restore.current) {
      element.scrollTop = memory.current.atLatest ? element.scrollHeight : memory.current.scrollTop;
      restore.current = false;
    } else if (memory.current.atLatest) {
      element.scrollTop = element.scrollHeight;
    }
  }, [view.items, view.loaded]);

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
    setLoading(true);
    setReloadKey((value) => value + 1);
    onRefreshInbox();
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
                <time dateTime={message.sentAt}>{formatBangkokTime(message.sentAt, language)}</time>
              </div>
            </div>
          </div>
        );
      }),
    [language, text.openLink, user.id, view.items],
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
            <span className={styles.manual}>{text.manual}</span>
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
        aria-busy={loading}
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
              if ( event.key === 'Enter' && !event.shiftKey ) {
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
      </form>
    </section>
  );
}
