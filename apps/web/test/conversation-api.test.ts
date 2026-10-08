import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearAccessToken, setAccessToken } from '@/lib/api/client';
import {
  getConversations,
  loadConversationMessages,
  openTutorConversation,
  sendConversationMessage,
} from '@/lib/api/conversations';
import { ApiError } from '@/lib/api/error';

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
});
