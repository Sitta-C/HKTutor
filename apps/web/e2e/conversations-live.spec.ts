import { expect, test } from '@playwright/test';

import type {
  APIRequestContext,
  BrowserContext,
  Page,
  Request,
  TestInfo,
  WebSocketRoute,
} from '@playwright/test';

const ORIGIN = 'http://127.0.0.1:3102';
const PRIMARY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FOREIGN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const MISSING = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const PASSWORD = 'Chat-fixture-Only-2026!';

async function captureEvidence(page: Page, name: string, testInfo: TestInfo): Promise<void> {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

function socketEvent(frame: string): string | null {
  const match = /^42\/chat,\d*(\[.*)$/.exec(frame);
  if (!match?.[1]) return null;
  const payload: unknown = JSON.parse(match[1]);
  return Array.isArray(payload) && typeof payload[0] === 'string' ? payload[0] : null;
}

// Use the browser's real WebSocket transport for denied identities too. Never attach raw frames,
// handshake credentials or traces; only the rejection stage/code leaves this probe.
async function probeRoom(page: Page, token: string): Promise<unknown> {
  return page.evaluate(
    ({ accessToken, conversationId }) =>
      new Promise((resolve, reject) => {
        const socket = new WebSocket(
          `${location.origin.replace('http', 'ws')}/api/v1/socket.io/?EIO=4&transport=websocket`,
        );
        const finish = (result: unknown) => {
          clearTimeout(timeout);
          socket.close();
          resolve(result);
        };
        const timeout = setTimeout(() => {
          socket.close();
          reject(new Error('Browser authorization probe timed out'));
        }, 5000);
        socket.addEventListener('message', ({ data }: MessageEvent<unknown>) => {
          if (typeof data !== 'string') return;
          if (data.startsWith('0')) {
            socket.send(`40/chat,${JSON.stringify({ accessToken })}`);
          } else if (data.startsWith('40/chat,')) {
            socket.send(`42/chat,1${JSON.stringify(['conversation_join', { conversationId }])}`);
          } else if (data.startsWith('44/chat,')) {
            const error: unknown = JSON.parse(data.slice('44/chat,'.length));
            finish({ stage: 'connect', error });
          } else if (data.startsWith('43/chat,1')) {
            const reply: unknown = JSON.parse(data.slice('43/chat,1'.length));
            finish({ stage: 'join', reply });
          } else if (data === '2') {
            socket.send('3');
          }
        });
      }),
    { accessToken: token, conversationId: PRIMARY },
  );
}

test.describe.serial('S3-T04: real browser sessions, Nest API, Socket.IO and PostgreSQL', () => {
  let student: BrowserContext;
  let tutor: BrowserContext;
  let studentPage: Page;
  let tutorPage: Page;
  let writer: APIRequestContext;
  let reader: APIRequestContext;
  let writerToken = '';
  let readerToken = '';
  const refreshes = new Map<'writer' | 'reader', Promise<void>>();
  let socketBlocked = false;
  let historyBlocked = false;
  let releaseHistoryOnJoin = false;
  let holdCreated = false;
  let studentCreated = 0;
  let tutorCreated = 0;
  let studentReceipts = 0;
  let tutorReceipts = 0;
  let tutorOpenSockets = 0;
  let studentSends = 0;
  let studentJoins = 0;
  let studentHistoryReads = 0;
  let studentRefreshes = 0;
  const links = new Set<{ client: WebSocketRoute; server: WebSocketRoute }>();
  const held: { client: WebSocketRoute; frame: string | Buffer }[] = [];
  const forwardPages: { from: string | null; after: string | null; more: boolean }[] = [];
  const pendingHistory = new Set<Request>();

  async function login(request: APIRequestContext, email: string): Promise<string> {
    const send = () =>
      request.post(`${ORIGIN}/api/v1/auth/login`, {
        data: { email, password: PASSWORD },
      });
    let response = await send();
    if (response.status() === 429) {
      // Six independent synthetic sessions share loopback's five-logins/minute limit.
      // Honor the real guard instead of disabling it for this integration suite.
      const retryAfter = Number(response.headers()['retry-after']);
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(60);
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
      response = await send();
    }
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

  async function api(
    actor: 'writer' | 'reader',
    path: string,
    text?: string,
    clientMessageId?: string,
  ) {
    const context = actor === 'writer' ? writer : reader;
    let token = actor === 'writer' ? writerToken : readerToken;
    const send = () =>
      context.fetch(`${ORIGIN}/api/v1${path}`, {
        method: text === undefined ? 'GET' : 'POST',
        headers: { Authorization: `Bearer ${token}` },
        ...(text === undefined ? {} : { data: { text, clientMessageId } }),
      });
    let response = await send();
    if (response.status() === 401) {
      const currentToken = actor === 'writer' ? writerToken : readerToken;
      if (token === currentToken) {
        let pending = refreshes.get(actor);
        if (!pending) {
          pending = (async () => {
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
            if (actor === 'writer') writerToken = body.accessToken;
            else readerToken = body.accessToken;
          })().finally(() => refreshes.delete(actor));
          refreshes.set(actor, pending);
        }
        await pending;
      }
      token = actor === 'writer' ? writerToken : readerToken;
      response = await send();
    }
    return response;
  }

  async function open(page: Page, contact: string): Promise<void> {
    await page.goto('/dashboard/messages');
    await page.getByRole('button', { name: new RegExp(contact) }).click();
    await expect(page.getByRole('textbox', { name: 'Your message' })).toBeEnabled();
    await expect(page.locator('[data-connection-state="connected"]')).toHaveCount(1);
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
    await student.route('**/api/v1/socket.io/**', (route) =>
      socketBlocked ? route.abort() : route.continue(),
    );
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
        if (socketEvent(text) === 'messages_read') studentReceipts += 1;
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
    tutorPage.on('websocket', (socket) => {
      tutorOpenSockets += 1;
      socket.on('close', () => {
        tutorOpenSockets -= 1;
      });
      socket.on('framereceived', ({ payload }) => {
        const frame = typeof payload === 'string' ? payload : payload.toString();
        if (socketEvent(frame) === 'message_created') tutorCreated += 1;
        if (socketEvent(frame) === 'messages_read') tutorReceipts += 1;
      });
    });
    studentPage.on('request', (request) => {
      if (/\/conversations\/[^/]+\/(messages|read)/.test(request.url())) {
        pendingHistory.add(request);
      }
      if (request.method() === 'GET' && /\/conversations\/[^/]+\/messages/.test(request.url()))
        studentHistoryReads += 1;
      if (request.method() === 'POST' && request.url().endsWith('/api/v1/auth/refresh'))
        studentRefreshes += 1;
      if (
        request.method() === 'POST' &&
        request.url().endsWith(`/conversations/${PRIMARY}/messages`)
      )
        studentSends += 1;
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

  test('two independent sessions deliver committed messages/read receipts without sender echo', async ({}, testInfo) => {
    await open(studentPage, 'Browser Tutor');
    await open(tutorPage, 'Browser Student');
    const sentBefore = studentCreated;
    const receivedBefore = tutorCreated;
    const receiptsBefore = studentReceipts;
    const readerReceiptsBefore = tutorReceipts;
    const sendsBefore = studentSends;
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
    expect(studentSends).toBe(sendsBefore + 1);
    expect(studentReceipts).toBe(receiptsBefore + 1);
    expect(tutorReceipts).toBe(readerReceiptsBefore);
    const messageId = await studentRow.getAttribute('data-message-id');
    expect(messageId).toBeTruthy();
    await expect(tutorPage.locator(`[data-message-id="${messageId}"]`)).toHaveCount(1);
    const history = await api('reader', `/conversations/${PRIMARY}/messages?latest=true`);
    expect(history.status()).toBe(200);
    const persisted: unknown = await history.json();
    expect(persisted).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          messageId,
          text: 'Live student message',
          sentAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
          readAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
        }),
      ]),
    });
    for (const [role, page] of [
      ['student', studentPage],
      ['tutor', tutorPage],
    ] as const) {
      await captureEvidence(page, `${role}-delivery-read-receipt`, testInfo);
    }
    const forbidden = await api('reader', `/conversations/${FOREIGN}/messages?latest=true`);
    const missing = await api('reader', `/conversations/${MISSING}/messages?latest=true`);
    expect(forbidden.status()).toBe(403);
    expect(missing.status()).toBe(404);
    await expect(studentPage.getByRole('button', { name: /Refresh/ })).toHaveCount(0);
  });

  test('a third user and admin cannot join, read or write the persisted private conversation', async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    for (const email of ['other@s3-chat.invalid', 'admin@s3-chat.invalid']) {
      const context = await browser.newContext({ baseURL: ORIGIN });
      try {
        const token = await login(context.request, email);
        const page = await context.newPage();
        await page.goto('/');
        const probe = await probeRoom(page, token);
        if (email.startsWith('admin')) {
          expect(probe).toMatchObject({ stage: 'connect', error: { data: { code: 'FORBIDDEN' } } });
        } else {
          expect(probe).toMatchObject({
            stage: 'join',
            reply: [{ ok: false, error: { code: 'FORBIDDEN' } }],
          });
        }
        for (const [method, path, data] of [
          ['GET', 'messages?latest=true', undefined],
          ['POST', 'messages', { text: 'Unauthorized synthetic send' }],
          ['POST', 'read', {}],
        ] as const) {
          const response = await context.request.fetch(
            `${ORIGIN}/api/v1/conversations/${PRIMARY}/${path}`,
            {
              method,
              data,
              headers: { Authorization: `Bearer ${token}` },
            },
          );
          expect(response.status()).toBe(403);
          const body: unknown = await response.json();
          expect(body).not.toHaveProperty('text');
          expect(body).not.toHaveProperty('items');
          expect(body).not.toHaveProperty('otherParticipant');
        }
      } finally {
        await context.close();
      }
    }
    await expect(studentPage.getByText('Unauthorized synthetic send', { exact: true })).toHaveCount(
      0,
    );
    await expect(tutorPage.getByText('Unauthorized synthetic send', { exact: true })).toHaveCount(
      0,
    );
  });

  test('concurrent retries persist one message and publish one event', async () => {
    const before = studentCreated;
    const key = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const replies = await Promise.all(
      Array.from({ length: 3 }, () =>
        api('writer', `/conversations/${PRIMARY}/messages`, 'One concurrent intent', key),
      ),
    );
    for (const reply of replies) {
      expect(reply.status()).toBe(201);
    }
    const messages: unknown[] = await Promise.all(replies.map((reply) => reply.json()));
    const messageIds = messages.map((message) => {
      if (typeof message !== 'object' || message === null || !('messageId' in message)) {
        throw new Error('Missing persisted message ID');
      }
      return message.messageId;
    });
    expect(new Set(messageIds).size).toBe(1);
    await expect(
      studentPage.locator('[data-message-id]').filter({ hasText: 'One concurrent intent' }),
    ).toHaveCount(1);
    await expect.poll(() => studentCreated).toBe(before + 1);
    const conflict = await api(
      'writer',
      `/conversations/${PRIMARY}/messages`,
      'Different intent',
      key,
    );
    expect(conflict.status()).toBe(409);
  });

  test('rejoins then drains more than one missed history page from the retained cursor', async ({}, testInfo) => {
    const before = studentJoins;
    socketBlocked = true;
    historyBlocked = true;
    await student.setOffline(true);
    for (const link of links) {
      link.client.close();
      link.server.close();
    }
    await expect(
      studentPage.locator(
        '[data-connection-state="reconnecting"], [data-connection-state="fallback"]',
      ),
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
    await student.setOffline(false);
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
    await captureEvidence(studentPage, 'reconnected-multi-page-history', testInfo);
  });

  test('deduplicates and orders replayed real events while healthy sockets stop history polling', async () => {
    await expect(studentPage.locator('[data-connection-state="connected"]')).toHaveCount(1);
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
    // Start the quiet window immediately after real credential rotation so JWT expiry itself
    // cannot be mistaken for a fallback polling tick during this assertion.
    const refreshes = studentRefreshes;
    await expect.poll(() => studentRefreshes, { timeout: 25000 }).toBeGreaterThan(refreshes);
    await expect(studentPage.locator('[data-connection-state="connected"]')).toHaveCount(1);
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
    await expect(studentPage.locator('[data-connection-state="connected"]')).toHaveCount(1);
    await api('writer', `/conversations/${PRIMARY}/messages`, 'After real JWT expiry');
    await expect(
      studentPage.locator('[data-message-id]').filter({ hasText: 'After real JWT expiry' }),
    ).toHaveCount(1);
  });

  test('server logout revokes an open browser session without affecting another tutor session', async ({}, testInfo) => {
    const received = tutorCreated;
    const refreshed = await tutor.request.post(`${ORIGIN}/api/v1/auth/refresh`);
    expect(refreshed.status()).toBe(200);
    const credential: unknown = await refreshed.json();
    if (
      typeof credential !== 'object' ||
      credential === null ||
      !('accessToken' in credential) ||
      typeof credential.accessToken !== 'string'
    ) {
      throw new Error('Missing synthetic credential before revocation');
    }
    expect((await tutor.request.post(`${ORIGIN}/api/v1/auth/logout`)).status()).toBe(204);
    await expect(tutorPage).toHaveURL(/\/\?returnTo=/);
    await expect.poll(() => tutorOpenSockets).toBe(0);
    expect(await probeRoom(tutorPage, credential.accessToken)).toMatchObject({
      stage: 'connect',
      error: { data: { code: 'UNAUTHENTICATED' } },
    });
    const denied = await tutor.request.get(`${ORIGIN}/api/v1/conversations/${PRIMARY}/messages`, {
      headers: { Authorization: `Bearer ${credential.accessToken}` },
    });
    expect(denied.status()).toBe(401);
    const response = await api(
      'reader',
      `/conversations/${PRIMARY}/messages`,
      'After tutor revocation',
    );
    expect(response.status()).toBe(201);
    await expect.poll(() => pendingHistory.size).toBe(0);
    expect(tutorCreated).toBe(received);
    expect((await api('writer', `/conversations/${PRIMARY}/messages?latest=true`)).status()).toBe(
      200,
    );
    await captureEvidence(tutorPage, 'revoked-session-redirect', testInfo);
  });

  test('falls back during socket outage, pauses hidden tabs, preserves drafts and leaves old rooms', async ({}, testInfo) => {
    const socketDeliveries = studentCreated;
    socketBlocked = true;
    for (const link of links) {
      link.client.close();
      link.server.close();
    }
    await api('writer', `/conversations/${PRIMARY}/messages`, 'Delivered by REST fallback');
    await expect(
      studentPage.locator('[data-message-id]').filter({ hasText: 'Delivered by REST fallback' }),
    ).toHaveCount(1);
    expect(studentCreated).toBe(socketDeliveries);
    await expect(studentPage.locator('[data-connection-state="connected"]')).toHaveCount(0);
    await captureEvidence(studentPage, 'rest-only-delivery', testInfo);
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
    await expect(studentPage.locator('[data-connection-state="connected"]')).toHaveCount(1);
    const created = studentCreated;
    await api('writer', `/conversations/${PRIMARY}/messages`, 'Old room after switch');
    await studentPage.waitForTimeout(350);
    expect(studentCreated).toBe(created);
    await expect(studentPage.getByText('Old room after switch', { exact: true })).toHaveCount(0);
    await studentPage.getByRole('button', { name: 'Back to conversations' }).click();
    await expect.poll(() => links.size).toBe(0);
    await expect.poll(() => pendingHistory.size).toBe(0);
    const closedReads = studentHistoryReads;
    const closedJoins = studentJoins;
    await studentPage.waitForTimeout(4500);
    expect(studentHistoryReads).toBe(closedReads);
    expect(studentJoins).toBe(closedJoins);
    await studentPage.getByRole('button', { name: /Browser Tutor/ }).click();
    await expect(studentPage.locator('[data-connection-state="connected"]')).toHaveCount(1);
    await studentPage.getByRole('button', { name: 'Sign out' }).click();
    await expect(studentPage).toHaveURL(`${ORIGIN}/`);
    await expect.poll(() => links.size).toBe(0);
  });
});
