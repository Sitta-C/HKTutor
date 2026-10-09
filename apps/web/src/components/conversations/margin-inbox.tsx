'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { conversationCopy } from '@/components/conversations/conversation-copy';
import { ConversationThread } from '@/components/conversations/conversation-thread';
import { DashboardIcon } from '@/components/dashboard/dashboard-icon';
import { NotebookHeading } from '@/components/ui/notebook';
import { notebookActionClass, NotebookActionContent } from '@/components/ui/notebook-action';
import { NotebookLoadingRegion } from '@/components/ui/notebook-loading';
import { getConversations, openTutorConversation } from '@/lib/api/conversations';
import {
  conversationErrorKey,
  mergeConversations,
  recordSentMessage,
} from '@/lib/conversation-model';
import {
  formatBangkokDateTime,
  formatBangkokShortDate,
  formatBangkokTime,
  getBangkokIsoDate,
  getBangkokToday,
} from '@/lib/date-time';
import { useLanguage } from '@/lib/i18n';

import styles from './margin-inbox.module.css';

import type { ThreadMemory } from '@/components/conversations/conversation-thread';
import type {
  AuthUser,
  ConversationSummary,
  ConversationMessage,
  OpenConversationResponse,
} from '@/lib/api/types';

export function MarginInbox({ user, tutorId }: { user: AuthUser; tutorId: string | null }) {
  const { language } = useLanguage();
  const text = conversationCopy[language];
  const router = useRouter();
  const [items, setItems] = useState<ConversationSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<ConversationSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [sending, setSending] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, boolean>>({});
  const [memories] = useState(() => new Map<string, ThreadMemory>());
  const page = useRef<HTMLDivElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listPosition = useRef(0);
  const lastContact = useRef<HTMLButtonElement | null>(null);
  const listRequest = useRef(false);
  const refreshTarget = useRef<{ count: number; conversationId: string | null }>({
    count: 0,
    conversationId: null,
  });
  const sentDuringListRequest = useRef<ConversationMessage[]>([]);
  const mounted = useRef(true);
  const paginationAbort = useRef<AbortController | null>(null);
  const openRequest = useRef<{
    tutorId: string;
    request: Promise<OpenConversationResponse>;
  } | null>(null);

  useEffect(() => {
    const root = page.current;
    const area = container.current;
    if (!root || !area) {
      return;
    }
    // Account for the actual shell/heading height, including translated text and sidebar resizing.
    const measure = () => {
      const top = area.getBoundingClientRect().top + window.scrollY;
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const available = Math.max(360, Math.min(760, viewportHeight - top - 24));
      area.style.setProperty('--chat-height', `${available}px`);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
    };
  }, []);

  const refreshInbox = useCallback(() => {
    if (listRequest.current || sending) {
      return;
    }
    refreshTarget.current = {
      count: items.length,
      conversationId: selected?.conversationId ?? null,
    };
    listRequest.current = true;
    setLoading(true);
    setReloadKey((value) => value + 1);
  }, [items.length, selected?.conversationId, sending]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      paginationAbort.current?.abort();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    let active = true;
    listRequest.current = true;
    sentDuringListRequest.current = [];
    const target = refreshTarget.current;
    const load = async () => {
      let opened: OpenConversationResponse | null = null;
      if (tutorId) {
        // Opening a pair is idempotent, but a Strict Mode remount should share its in-flight write.
        if (openRequest.current?.tutorId !== tutorId) {
          const entry = { tutorId, request: openTutorConversation(tutorId) };
          openRequest.current = entry;
          void entry.request.catch(() => {
            if (openRequest.current === entry) {
              openRequest.current = null;
            }
          });
        }
        opened = await openRequest.current.request;
      }
      signal.throwIfAborted();
      let page = await getConversations(undefined, signal);
      let all = page.items;
      const visited = new Set<string>();
      // Refetch the loaded range and selected contact, including pairs beyond the first page.
      while (
        page.nextCursor &&
        (all.length < target.count ||
          ((opened?.conversationId ?? target.conversationId) !== null &&
            !all.some(
              (item) => item.conversationId === (opened?.conversationId ?? target.conversationId),
            )))
      ) {
        if (visited.has(page.nextCursor)) {
          throw new Error('Inbox cursor did not advance');
        }
        visited.add(page.nextCursor);
        page = await getConversations(page.nextCursor, signal);
        all = mergeConversations(all, page.items);
      }
      if (!active) {
        return;
      }
      // A GET begun before sending may return an older preview/order after the send succeeds.
      const sentMessages = sentDuringListRequest.current;
      setItems((current) => {
        const missingSentContacts = current.filter(
          (item) =>
            sentMessages.some((message) => message.conversationId === item.conversationId) &&
            !all.some((incoming) => incoming.conversationId === item.conversationId),
        );
        return sentMessages.reduce(recordSentMessage, [...all, ...missingSentContacts]);
      });
      setCursor(page.nextCursor);
      if (opened) {
        const conversation = all.find((item) => item.conversationId === opened.conversationId);
        if (!conversation) {
          throw new Error('Opened conversation is unavailable');
        }
        setSelected(conversation);
        router.replace('/dashboard/messages', { scroll: false });
      }
      setError(null);
    };
    void load()
      .catch((caught: unknown) => {
        if (active) {
          setError(caught);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
          listRequest.current = false;
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [reloadKey, router, tutorId]);

  const loadMore = async () => {
    if (!cursor || listRequest.current) {
      return;
    }
    listRequest.current = true;
    sentDuringListRequest.current = [];
    const controller = new AbortController();
    paginationAbort.current = controller;
    setLoading(true);
    try {
      const page = await getConversations(cursor, controller.signal);
      if (!mounted.current) {
        return;
      }
      const sentMessages = sentDuringListRequest.current;
      setItems((current) =>
        sentMessages.reduce(recordSentMessage, mergeConversations(current, page.items)),
      );
      setCursor(page.nextCursor);
      setError(null);
    } catch (caught) {
      if (mounted.current) {
        setError(caught);
      }
    } finally {
      if (mounted.current) {
        setLoading(false);
        listRequest.current = false;
      }
    }
  };

  const showInbox = () => {
    setSelected(null);
    // Wait for single-pane CSS to expose the index before restoring its native scroll and focus.
    requestAnimationFrame(() => {
      if (list.current) {
        list.current.scrollTop = listPosition.current;
      }
      lastContact.current?.focus({ preventScroll: true });
      if (list.current && lastContact.current?.isConnected) {
        const bounds = list.current.getBoundingClientRect();
        const contact = lastContact.current.getBoundingClientRect();
        // A newly sent conversation moves to the top; keep restored keyboard focus visible.
        if (contact.top < bounds.top) {
          list.current.scrollTop += contact.top - bounds.top;
        } else if (contact.bottom > bounds.bottom) {
          list.current.scrollTop += contact.bottom - bounds.bottom;
        }
      }
    });
  };
  const sent = (message: ConversationMessage) => {
    if (listRequest.current) {
      sentDuringListRequest.current.push(message);
    }
    setItems((current) => recordSentMessage(current, message));
  };

  return (
    <div ref={page} className={styles.page} data-role={user.role}>
      <NotebookHeading className={styles.heading ?? ''} eyebrow={text.eyebrow} title={text.title} />
      <p className={styles.intro}>{text.hint}</p>
      <div ref={container} className={styles.container}>
        <div className={styles.workspace} data-thread-open={Boolean(selected)}>
          <section className={styles.index} aria-labelledby="conversation-index-heading">
            <div className={styles.indexHeading}>
              <h2 id="conversation-index-heading">{text.inbox}</h2>
              <button
                type="button"
                className={`${styles.quiet} ${styles.indexRefresh}`}
                aria-label={text.refreshInbox}
                title={text.refreshInbox}
                disabled={loading || sending}
                onClick={refreshInbox}
              >
                <DashboardIcon name="refresh" />
              </button>
            </div>
            <div
              ref={list}
              data-conversation-index-scroll
              className={styles.contacts}
              onScroll={() => {
                if (list.current) {
                  listPosition.current = list.current.scrollTop;
                }
              }}
            >
              {loading && items.length === 0 && (
                <div className={styles.state}>
                  <NotebookLoadingRegion label={text.loading} />
                </div>
              )}
              {error !== null && (
                <div className={styles.error} role="alert">
                  <p>{text[conversationErrorKey(error)]}</p>
                  <button
                    type="button"
                    disabled={loading}
                    className={styles.quiet}
                    onClick={refreshInbox}
                  >
                    {text.retry}
                  </button>
                </div>
              )}
              {!loading && error === null && items.length === 0 && (
                <div className={styles.state}>
                  <h3 className="font-note">{text.empty}</h3>
                  <p>{user.role === 'STUDENT' ? text.studentEmpty : text.tutorEmpty}</p>
                  {user.role === 'STUDENT' && (
                    <Link
                      href="/tutors"
                      className={notebookActionClass({ role: 'student', tone: 'secondary' })}
                    >
                      <NotebookActionContent>{text.browse}</NotebookActionContent>
                    </Link>
                  )}
                </div>
              )}
              <ul className={styles.contactList}>
                {items.map((item) => {
                  const name =
                    item.otherParticipant.displayName ||
                    (user.role === 'STUDENT' ? text.tutor : text.student);
                  return (
                    <li key={item.conversationId}>
                      <button
                        type="button"
                        className={styles.contact}
                        aria-pressed={selected?.conversationId === item.conversationId}
                        disabled={sending}
                        onClick={(event) => {
                          lastContact.current = event.currentTarget;
                          setSelected(item);
                        }}
                      >
                        <span className={styles.initial} aria-hidden="true">
                          {Array.from(name)[0]}
                        </span>
                        <span className={styles.contactBody}>
                          <span className={styles.contactTop}>
                            <strong title={name}>{name}</strong>
                            {item.lastMessage && (
                              <time
                                dateTime={item.lastMessage.sentAt}
                                title={formatBangkokDateTime(item.lastMessage.sentAt, language)}
                              >
                                {getBangkokIsoDate(item.lastMessage.sentAt) === getBangkokToday()
                                  ? formatBangkokTime(item.lastMessage.sentAt, language)
                                  : formatBangkokShortDate(item.lastMessage.sentAt, language)}
                              </time>
                            )}
                          </span>
                          <span className={styles.contactBottom}>
                            <span
                              className={styles.preview}
                              data-draft={drafts[item.conversationId] || undefined}
                            >
                              {drafts[item.conversationId]
                                ? text.draft
                                : (item.lastMessage?.text ?? text.noPreview)}
                            </span>
                            {item.unreadCount > 0 && (
                              <span
                                className={styles.unread}
                                aria-label={text.unread.replace(
                                  '{count}',
                                  String(item.unreadCount),
                                )}
                              >
                                {item.unreadCount}
                              </span>
                            )}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {cursor && (
                <button
                  type="button"
                  className={styles.more}
                  disabled={loading || sending}
                  onClick={() => {
                    void loadMore();
                  }}
                >
                  {loading ? text.loading : text.more}
                </button>
              )}
            </div>
          </section>
          {selected ? (
            <ConversationThread
              key={selected.conversationId}
              conversation={selected}
              user={user}
              memories={memories}
              onBack={showInbox}
              onSending={setSending}
              onSent={sent}
              onRefreshInbox={refreshInbox}
              onDraft={(hasDraft) =>
                setDrafts((current) => ({ ...current, [selected.conversationId]: hasDraft }))
              }
            />
          ) : (
            <section className={styles.selection}>
              <DashboardIcon name="messages" className="h-8 w-8" />
              <h2 className="font-note">{text.pick}</h2>
              <p>{text.pickHint}</p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
