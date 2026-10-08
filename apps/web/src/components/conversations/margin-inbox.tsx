'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { conversationCopy } from '@/components/conversations/conversation-copy';
import { ConversationThread } from '@/components/conversations/conversation-thread';
import { DashboardIcon } from '@/components/dashboard/dashboard-icon';
import { NotebookHeading } from '@/components/ui/notebook';
import { notebookActionClass, NotebookActionContent } from '@/components/ui/notebook-action';
import { NotebookLoadingRegion } from '@/components/ui/notebook-loading';
import { getConversations, openTutorConversation } from '@/lib/api/conversations';
import { conversationErrorKey, mergeConversations } from '@/lib/conversation-model';
import { formatBangkokShortDate } from '@/lib/date-time';
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
  const list = useRef<HTMLDivElement>(null);
  const listPosition = useRef(0);
  const lastContact = useRef<HTMLButtonElement | null>(null);
  const listRequest = useRef(false);
  const mounted = useRef(true);
  const paginationAbort = useRef<AbortController | null>(null);
  const openRequest = useRef<{
    tutorId: string;
    request: Promise<OpenConversationResponse>;
  } | null>(null);

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
      // An existing pair may be beyond the first inbox page. Keep the server's identity/name.
      while (
        opened &&
        !all.some((item) => item.conversationId === opened.conversationId) &&
        page.nextCursor
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
      setItems(all);
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
    const controller = new AbortController();
    paginationAbort.current = controller;
    setLoading(true);
    try {
      const page = await getConversations(cursor, controller.signal);
      if (!mounted.current) {
        return;
      }
      setItems((current) => mergeConversations(current, page.items));
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
    });
  };
  const sent = (message: ConversationMessage) => {
    setItems((current) =>
      current.map((item) =>
        item.conversationId === message.conversationId ? { ...item, lastMessage: message } : item,
      ),
    );
  };

  return (
    <div className={styles.page} data-role={user.role}>
      <NotebookHeading eyebrow={text.eyebrow} title={text.title} />
      <p className={styles.intro}>{text.hint}</p>
      <div className={styles.container}>
        <div className={styles.workspace} data-thread-open={Boolean(selected)}>
          <section className={styles.index} aria-labelledby="conversation-index-heading">
            <div className={styles.indexHeading}>
              <h2 id="conversation-index-heading" className="font-note">
                {text.inbox}
              </h2>
              <button
                type="button"
                className={styles.quiet}
                disabled={loading || sending}
                onClick={() => {
                  setLoading(true);
                  setReloadKey((value) => value + 1);
                }}
              >
                {text.refresh}
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
                    onClick={() => {
                      setLoading(true);
                      setReloadKey((value) => value + 1);
                    }}
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
                          <strong>{name}</strong>
                          <span className={styles.preview}>
                            {drafts[item.conversationId]
                              ? text.draft
                              : (item.lastMessage?.text ?? text.noPreview)}
                          </span>
                          {item.lastMessage && (
                            <time dateTime={item.lastMessage.sentAt}>
                              {formatBangkokShortDate(item.lastMessage.sentAt, language)}
                            </time>
                          )}
                        </span>
                        {item.unreadCount > 0 && (
                          <span
                            className={styles.unread}
                            aria-label={text.unread.replace('{count}', String(item.unreadCount))}
                          >
                            {item.unreadCount}
                          </span>
                        )}
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
