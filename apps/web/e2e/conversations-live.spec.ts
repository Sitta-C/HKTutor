import { expect, test } from '@playwright/test';

import type {
  APIRequestContext,
  BrowserContext,
  Page,
  Request,
  WebSocketRoute,
} from '@playwright/test';

const ORIGIN = 'http://127.0.0.1:3102';
const PRIMARY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FOREIGN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const MISSING = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const PASSWORD = 'Chat-fixture-Only-2026!';

function socketEvent(frame: string): string | null {
  const match = /^42\/chat,\d*(\[.*)$/.exec(frame);
  if (!match?.[1]) return null;
  const payload: unknown = JSON.parse(match[1]);
  return Array.isArray(payload) && typeof payload[0] === 'string' ? payload[0] : null;
}

test.describe.serial('S3-T03: real browser sessions, Nest API, Socket.IO and PostgreSQL', () => {
  let student: BrowserContext;
  let tutor: BrowserContext;
  let studentPage: Page;
  let tutorPage: Page;
  let writer: APIRequestContext;
  let reader: APIRequestContext;
  let writerToken = '';
  let readerToken = '';
  let socketBlocked = false;
  let historyBlocked = false;
  let releaseHistoryOnJoin = false;
  let holdCreated = false;
  let studentCreated = 0;
  let tutorCreated = 0;
  let studentJoins = 0;
  let studentHistoryReads = 0;
  let studentRefreshes = 0;
  const links = new Set<{ client: WebSocketRoute; server: WebSocketRoute }>();
  const held: { client: WebSocketRoute; frame: string | Buffer }[] = [];
  const forwardPages: { from: string | null; after: string | null; more: boolean }[] = [];
  const pendingHistory = new Set<Request>();

  async function login(request: APIRequestContext, email: string): Promise<string> {
    const response = await request.post(`${ORIGIN}/api/v1/auth/login`, {
      data: { email, password: PASSWORD },
    });
    expect(response.status()).toBe(200);
    const body: unknown = await response.json();
    if (
      typeof body !== 'object' ||
      body === null ||
      !('accessToken' in body) ||
      typeof body.accessToken !== 'string'
    ) {
      throw new Error('Synthetic login did not return a credential');
    }
    return body.accessToken;
  }

  async function api(actor: 'writer' | 'reader', path: string, text?: string) {
    const context = actor === 'writer' ? writer : reader;
    let token = actor === 'writer' ? writerToken : readerToken;
    const send = () =>
      context.fetch(`${ORIGIN}/api/v1${path}`, {
        method: text === undefined ? 'GET' : 'POST',
        headers: { Authorization: `Bearer ${token}` },
        ...(text === undefined ? {} : { data: { text } }),
      });
    let response = await send();
    if (response.status() === 401) {
      const refreshed = await context.post(`${ORIGIN}/api/v1/auth/refresh`);
      expect(refreshed.status()).toBe(200);
      const body: unknown = await refreshed.json();
      if (
        typeof body !== 'object' ||
        body === null ||
        !('accessToken' in body) ||
        typeof body.accessToken !== 'string'
      ) {
        throw new Error('Synthetic refresh did not return a credential');
      }
      token = body.accessToken;
      if (actor === 'writer') writerToken = token;
      else readerToken = token;
      response = await send();
    }
    return response;
  }

  async function open(page: Page, contact: string): Promise<void> {
    await page.goto('/dashboard/messages');
    await page.getByRole('button', { name: new RegExp(contact) }).click();
    await expect(page.getByRole('textbox', { name: 'Your message' })).toBeEnabled();
    await expect(page.getByRole('status').filter({ hasText: /^Chat connected$/ })).toHaveCount(1);
  }

  test.beforeAll(async ({ browser, playwright }) => {
    student = await browser.newContext({ baseURL: ORIGIN });
    tutor = await browser.newContext({ baseURL: ORIGIN });
    for (const context of [student, tutor]) {
      await context.addInitScript(() => localStorage.setItem('hktutor-language', 'en'));
    }
    await student.route('**/api/v1/conversations/*/messages**', (route) => {
      if (historyBlocked && route.request().method() === 'GET') return route.abort();
      return route.continue();
    });
    // Forward real frames unchanged. Outages and reordering happen only in this test network.
    await student.routeWebSocket('**/api/v1/socket.io/**', (client) => {
      if (socketBlocked) {
        client.close();
        return;
      }
      const server = client.connectToServer();
      const link = { client, server };
      links.add(link);
      client.onMessage((frame) => server.send(frame));
      server.onMessage((frame) => {
        const text = typeof frame === 'string' ? frame : frame.toString();
        if (/^43\/chat,\d+\[\{"ok":true/.test(text)) {
          studentJoins += 1;
          if (releaseHistoryOnJoin) {
            historyBlocked = false;
            releaseHistoryOnJoin = false;
          }
        }
        if (socketEvent(text) === 'message_created') {
          studentCreated += 1;
          if (holdCreated) {
            held.push({ client, frame });
            return;
          }
        }
        client.send(frame);
      });
      client.onClose(() => {
        links.delete(link);
        server.close();
      });
      server.onClose(() => {
        links.delete(link);
        client.close();
      });
    });
    await login(student.request, 'student@s3-chat.invalid');
    await login(tutor.request, 'tutor@s3-chat.invalid');
    writer = await playwright.request.newContext();
    reader = await playwright.request.newContext();
    writerToken = await login(writer, 'tutor@s3-chat.invalid');
    readerToken = await login(reader, 'student@s3-chat.invalid');
    studentPage = await student.newPage();
    tutorPage = await tutor.newPage();
    tutorPage.on('websocket', (socket) =>
      socket.on('framereceived', ({ payload }) => {
        const frame = typeof payload === 'string' ? payload : payload.toString();
        if (socketEvent(frame) === 'message_created') tutorCreated += 1;
      }),
    );
    studentPage.on('request', (request) => {
      if (/\/conversations\/[^/]+\/(messages|read)/.test(request.url())) {
        pendingHistory.add(request);
      }
      if (request.method() === 'GET' && /\/conversations\/[^/]+\/messages/.test(request.url()))
        studentHistoryReads += 1;
      if (request.method() === 'POST' && request.url().endsWith('/api/v1/auth/refresh'))
        studentRefreshes += 1;
    });
    studentPage.on('requestfinished', (request) => pendingHistory.delete(request));
    studentPage.on('requestfailed', (request) => pendingHistory.delete(request));
    studentPage.on('response', async (response) => {
      const url = new URL(response.url());
      if (
        !response.ok() ||
        response.request().method() !== 'GET' ||
        !url.pathname.endsWith('/messages') ||
        (!url.searchParams.has('fromMessageId') && !url.searchParams.has('afterMessageId'))
      )
        return;
      const body: unknown = await response.json().catch(() => null);
      if (
        typeof body === 'object' &&
        body !== null &&
        'hasMore' in body &&
        typeof body.hasMore === 'boolean'
      ) {
        forwardPages.push({
          from: url.searchParams.get('fromMessageId'),
          after: url.searchParams.get('afterMessageId'),
          more: body.hasMore,
        });
      }
    });
  });

  test.afterAll(async () => {
    await Promise.allSettled([
      student?.close(),
      tutor?.close(),
      writer?.dispose(),
      reader?.dispose(),
    ]);
  });

  test('two independent sessions deliver committed messages/read receipts without sender echo', async () => {
    await open(studentPage, 'Browser Tutor');
    await open(tutorPage, 'Browser Student');
    const sentBefore = studentCreated;
    const receivedBefore = tutorCreated;
    await studentPage.getByRole('textbox', { name: 'Your message' }).fill('Live student message');
    await studentPage.getByRole('button', { name: 'Send', exact: true }).click();
    const studentRow = studentPage
      .locator('[data-message-id]')
      .filter({ hasText: 'Live student message' });
    await expect(studentRow).toHaveCount(1);
    await expect(
      tutorPage.locator('[data-message-id]').filter({ hasText: 'Live student message' }),
    ).toHaveCount(1);
    await expect(studentRow).toContainText('Read');
    expect(studentCreated).toBe(sentBefore);
    expect(tutorCreated).toBe(receivedBefore + 1);
    const forbidden = await api('reader', `/conversations/${FOREIGN}/messages?latest=true`);
    const missing = await api('reader', `/conversations/${MISSING}/messages?latest=true`);
    expect(forbidden.status()).toBe(403);
    expect(missing.status()).toBe(404);
    await expect(studentPage.getByRole('button', { name: /Refresh/ })).toHaveCount(0);
  });

  test('rejoins then drains more than one missed history page from the retained cursor', async () => {
    const before = studentJoins;
    socketBlocked = true;
    historyBlocked = true;
    for (const link of links) {
      link.client.close();
      link.server.close();
    }
    await expect(
      studentPage
        .getByRole('status')
        .filter({ hasText: /Reconnecting chat|backup message updates/ }),
    ).toHaveCount(1);
    for (let index = 0; index < 65; index += 1) {
      const response = await api(
        'writer',
        `/conversations/${PRIMARY}/messages`,
        `Missed live ${index}`,
      );
      expect(response.status()).toBe(201);
    }
    await expect(
      studentPage.locator('[data-message-id]').filter({ hasText: /^Missed live / }),
    ).toHaveCount(0);
    const pageBoundary = forwardPages.length;
    releaseHistoryOnJoin = true;
    socketBlocked = false;
    await expect.poll(() => studentJoins, { timeout: 15000 }).toBeGreaterThan(before);
    await expect(
      studentPage.locator('[data-message-id]').filter({ hasText: /^Missed live / }),
    ).toHaveCount(65, { timeout: 10000 });
    const pages = forwardPages.slice(pageBoundary);
    expect(pages.some((page) => page.more)).toBe(true);
    expect(pages.some((page) => !page.more)).toBe(true);
    const ids = await studentPage
      .locator('[data-message-id]')
      .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-message-id')));
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('deduplicates and orders replayed real events while healthy sockets stop history polling', async () => {
    await expect(
      studentPage.getByRole('status').filter({ hasText: /^Chat connected$/ }),
    ).toHaveCount(1);
    holdCreated = true;
    await api('writer', `/conversations/${PRIMARY}/messages`, 'Reordered live first');
    await api('writer', `/conversations/${PRIMARY}/messages`, 'Reordered live second');
    await expect.poll(() => held.length).toBe(2);
    holdCreated = false;
    for (const index of [1, 0, 1]) {
      const item = held[index];
      if (item) item.client.send(item.frame);
    }
    held.length = 0;
    await expect(
      studentPage.locator('[data-message-id]').filter({ hasText: 'Reordered live first' }),
    ).toHaveCount(1);
    await expect(
      studentPage.locator('[data-message-id]').filter({ hasText: 'Reordered live second' }),
    ).toHaveCount(1);
    await expect
      .poll(() =>
        studentPage
          .locator('[data-message-id]')
          .evaluateAll((rows) =>
            rows.slice(-2).map((row) => (row.textContent?.includes('first') ? 'first' : 'second')),
          ),
      )
      .toEqual(['first', 'second']);
    // Wait for persisted read acknowledgement and queued duplicate-event reconciliation, rather
    // than mistaking that in-flight follow-up GET for a healthy-state polling tick.
    for (const label of ['Reordered live first', 'Reordered live second']) {
      await expect(tutorPage.locator('[data-message-id]').filter({ hasText: label })).toContainText(
        'Read',
      );
    }
    await expect.poll(() => pendingHistory.size).toBe(0);
    const before = studentHistoryReads;
    await studentPage.waitForTimeout(4500);
    expect(studentHistoryReads).toBe(before);
  });

  test('refreshes a genuinely expired JWT and rejoins using the rotated credential', async () => {
    const refreshes = studentRefreshes;
    const joins = studentJoins;
    await expect.poll(() => studentRefreshes, { timeout: 25000 }).toBeGreaterThan(refreshes);
    await expect.poll(() => studentJoins).toBeGreaterThan(joins);
    await expect(
      studentPage.getByRole('status').filter({ hasText: /^Chat connected$/ }),
    ).toHaveCount(1);
    await api('writer', `/conversations/${PRIMARY}/messages`, 'After real JWT expiry');
    await expect(
      studentPage.locator('[data-message-id]').filter({ hasText: 'After real JWT expiry' }),
    ).toHaveCount(1);
  });

  test('falls back during socket outage, pauses hidden tabs, preserves drafts and leaves old rooms', async () => {
    socketBlocked = true;
    for (const link of links) {
      link.client.close();
      link.server.close();
    }
    await api('writer', `/conversations/${PRIMARY}/messages`, 'Delivered by REST fallback');
    await expect(
      studentPage.locator('[data-message-id]').filter({ hasText: 'Delivered by REST fallback' }),
    ).toHaveCount(1);
    await studentPage.getByRole('textbox', { name: 'Your message' }).fill('Preserved live draft');
    const transcript = studentPage.getByRole('region', {
      name: 'Conversation history',
      exact: true,
    });
    await transcript.evaluate((element) => {
      element.scrollTop = 100;
    });
    await studentPage.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const hiddenReads = studentHistoryReads;
    await api('writer', `/conversations/${PRIMARY}/messages`, 'Arrived while hidden');
    await studentPage.waitForTimeout(4500);
    expect(studentHistoryReads).toBe(hiddenReads);
    socketBlocked = false;
    await studentPage.evaluate(() => {
      Reflect.deleteProperty(document, 'hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(
      studentPage.locator('[data-message-id]').filter({ hasText: 'Arrived while hidden' }),
    ).toHaveCount(1);
    await expect(studentPage.getByRole('textbox', { name: 'Your message' })).toHaveValue(
      'Preserved live draft',
    );
    await expect.poll(() => transcript.evaluate((element) => element.scrollTop)).toBe(100);
    await studentPage.getByRole('button', { name: 'Back to conversations' }).click();
    await studentPage.getByRole('button', { name: /Second Tutor/ }).click();
    await expect(
      studentPage.getByRole('status').filter({ hasText: /^Chat connected$/ }),
    ).toHaveCount(1);
    const created = studentCreated;
    await api('writer', `/conversations/${PRIMARY}/messages`, 'Old room after switch');
    await studentPage.waitForTimeout(350);
    expect(studentCreated).toBe(created);
    await expect(studentPage.getByText('Old room after switch', { exact: true })).toHaveCount(0);
    await studentPage.getByRole('button', { name: 'Back to conversations' }).click();
    const closedReads = studentHistoryReads;
    await studentPage.waitForTimeout(4500);
    expect(studentHistoryReads).toBe(closedReads);
    await studentPage.getByRole('button', { name: /Browser Tutor/ }).click();
    await expect(
      studentPage.getByRole('status').filter({ hasText: /^Chat connected$/ }),
    ).toHaveCount(1);
    await studentPage.getByRole('button', { name: 'Sign out' }).click();
    await expect(studentPage).toHaveURL(`${ORIGIN}/`);
    await expect.poll(() => links.size).toBe(0);
  });
});
