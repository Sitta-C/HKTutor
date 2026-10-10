import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearAccessToken, setAccessToken } from '@/lib/api/client';
import {
  CONVERSATION_HISTORY_MAX_PAGES,
  CONVERSATION_HISTORY_TIMEOUT_MS,
  getConversations,
  loadConversationMessages,
  openTutorConversation,
  sendConversationMessage,
} from '@/lib/api/conversations';
import { ApiError, ConversationHistoryLoadError } from '@/lib/api/error';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('participant-only conversation client', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    fetchMock.mockReset();
    setAccessToken('test-token');
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    clearAccessToken();
    vi.unstubAllGlobals();
  });

  it('opens by canonical tutor identity and preserves the existing authentication flow', async () => {
    fetchMock.mockResolvedValueOnce(response({ conversationId: 'pair' }, 201));
    await openTutorConversation('tutor');
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.body).toBe(JSON.stringify({ tutorId: 'tutor' }));
    expect(init?.credentials).toBe('include');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-token');
  });

  it('encodes opaque list cursors and path segments', async () => {
    fetchMock.mockImplementation(async () =>
      response({ items: [], hasMore: false, nextAfterMessageId: null }),
    );
    await getConversations('opaque+/=');
    await loadConversationMessages('pair/one', null, new AbortController().signal);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/v1/conversations?limit=20&cursor=opaque%2B%2F%3D',
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      '/api/v1/conversations/pair%2Fone/messages?pageSize=50',
    );
  });

  it('follows forward cursors through all pages and retains a cursor on an empty refresh', async () => {
    fetchMock
      .mockResolvedValueOnce(
        response({ items: [{ messageId: 'one' }], hasMore: true, nextAfterMessageId: 'one' }),
      )
      .mockResolvedValueOnce(
        response({ items: [{ messageId: 'two' }], hasMore: false, nextAfterMessageId: 'two' }),
      )
      .mockResolvedValueOnce(response({ items: [], hasMore: false, nextAfterMessageId: 'two' }));
    const controller = new AbortController();
    expect(await loadConversationMessages('pair', null, controller.signal)).toEqual({
      items: [{ messageId: 'one' }, { messageId: 'two' }],
      cursor: 'two',
    });
    expect(fetchMock.mock.calls[1]?.[0]).toContain('afterMessageId=one');
    expect(await loadConversationMessages('pair', 'two', controller.signal)).toEqual({
      items: [],
      cursor: 'two',
    });
  });

  it('stops a repeated cursor and aborts before issuing another request', async () => {
    fetchMock.mockResolvedValue(response({ items: [], hasMore: true, nextAfterMessageId: 'same' }));
    await expect(
      loadConversationMessages('pair', 'same', new AbortController().signal),
    ).rejects.toThrow('did not advance');
    expect(fetchMock).toHaveBeenCalledOnce();
    fetchMock.mockClear();
    const controller = new AbortController();
    controller.abort();
    await expect(loadConversationMessages('pair', null, controller.signal)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not automatically retry an ambiguous send failure or server rejection', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Network lost'));
    await expect(sendConversationMessage('pair', '  question\n😀  ')).rejects.toThrow(
      'Network lost',
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ text: 'question\n😀' }));
    fetchMock.mockResolvedValueOnce(response({ message: 'Not a participant' }, 403));
    await expect(sendConversationMessage('pair', 'question')).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops a cursor cycle before asking for another page', async () => {
    for (const cursor of ['one', 'two', 'one']) {
      fetchMock.mockResolvedValueOnce(
        response({ items: [{ messageId: cursor }], hasMore: true, nextAfterMessageId: cursor }),
      );
    }
    await expect(
      loadConversationMessages('pair', null, new AbortController().signal),
    ).rejects.toThrow('did not advance');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([
    { items: [{ messageId: 'one' }], hasMore: true, nextAfterMessageId: null },
    { items: [{ messageId: 'one' }], hasMore: true, nextAfterMessageId: '' },
    { items: [], hasMore: true, nextAfterMessageId: 'new-cursor' },
    { items: [{ messageId: 'one' }], hasMore: true, nextAfterMessageId: 'different-message' },
    { items: [], nextAfterMessageId: null },
  ])('rejects malformed or non-progressing pages without another request: %j', async (page) => {
    fetchMock.mockResolvedValueOnce(response(page));
    await expect(
      loadConversationMessages('pair', null, new AbortController().signal),
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('bounds an endless sequence of unique cursors without returning partial history', async () => {
    fetchMock.mockImplementation(async () => {
      const page = fetchMock.mock.calls.length;
      if (page > CONVERSATION_HISTORY_MAX_PAGES + 1) {
        throw new Error('Test detected unbounded history requests');
      }
      return response({
        items: [{ messageId: `m-${page}` }],
        hasMore: true,
        nextAfterMessageId: `m-${page}`,
      });
    });
    await expect(
      loadConversationMessages('pair', null, new AbortController().signal),
    ).rejects.toMatchObject({ name: 'ConversationHistoryLoadError', reason: 'limit' });
    expect(fetchMock).toHaveBeenCalledTimes(CONVERSATION_HISTORY_MAX_PAGES);
  });

  it('allows history that finishes exactly on the last permitted page', async () => {
    fetchMock.mockImplementation(async () => {
      const page = fetchMock.mock.calls.length;
      return response({
        items: [{ messageId: `m-${page}` }],
        hasMore: page < CONVERSATION_HISTORY_MAX_PAGES,
        nextAfterMessageId: `m-${page}`,
      });
    });
    const result = await loadConversationMessages('pair', null, new AbortController().signal);
    expect(result.items).toHaveLength(CONVERSATION_HISTORY_MAX_PAGES);
    expect(result.cursor).toBe(`m-${CONVERSATION_HISTORY_MAX_PAGES}`);
  });

  it('times out even if a pending request ignores abort, and never follows its late response', async () => {
    vi.useFakeTimers();
    let finish: ((value: Response) => void) | undefined;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = loadConversationMessages('pair', null, new AbortController().signal);
    const rejected = expect(pending).rejects.toMatchObject({
      name: 'ConversationHistoryLoadError',
      reason: 'timeout',
    });
    await vi.advanceTimersByTimeAsync(CONVERSATION_HISTORY_TIMEOUT_MS);
    await rejected;
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    finish?.(
      response({ items: [{ messageId: 'late' }], hasMore: true, nextAfterMessageId: 'late' }),
    );
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('applies one deadline to the whole load rather than resetting it for each page', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_url, init) => {
      const signal = init?.signal;
      if (!signal) {
        throw new Error('Expected a cancellable history request');
      }
      const messageId = `m-${fetchMock.mock.calls.length}`;
      return new Promise<Response>((resolve, reject) => {
        const onAbort = () => {
          clearTimeout(timer);
          reject(signal.reason);
        };
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', onAbort);
          resolve(
            response({ items: [{ messageId }], hasMore: true, nextAfterMessageId: messageId }),
          );
        }, 35_000);
        signal.addEventListener('abort', onAbort, { once: true });
      });
    });
    const pending = loadConversationMessages('pair', null, new AbortController().signal);
    const rejected = expect(pending).rejects.toBeInstanceOf(ConversationHistoryLoadError);
    await vi.advanceTimersByTimeAsync(CONVERSATION_HISTORY_TIMEOUT_MS);
    await rejected;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('settles caller cancellation during a pending request and cleans its deadline', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}));
    const controller = new AbortController();
    const pending = loadConversationMessages('pair', 'cached', controller.signal);
    const rejected = expect(pending).rejects.toThrow('Left conversation');
    controller.abort(new Error('Left conversation'));
    await rejected;
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('cleans the deadline after success or a server error', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(
      response({ items: [], hasMore: false, nextAfterMessageId: null }),
    );
    expect(await loadConversationMessages('pair', 'cached', new AbortController().signal)).toEqual({
      items: [],
      cursor: 'cached',
    });
    expect(vi.getTimerCount()).toBe(0);
    fetchMock.mockResolvedValueOnce(response({ message: 'Unavailable' }, 503));
    await expect(
      loadConversationMessages('pair', 'cached', new AbortController().signal),
    ).rejects.toMatchObject({ status: 503 });
    expect(vi.getTimerCount()).toBe(0);
  });
});
