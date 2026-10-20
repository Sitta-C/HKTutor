import { expect, test } from '@playwright/test';

import type { ConversationMessage, ConversationSummary } from '@/lib/api/types';
import type { Page } from '@playwright/test';

// Isolated browser fixtures: all API requests are intercepted; no private data or real sends.
async function mockInbox(
  page: Page,
  options: {
    role?: 'STUDENT' | 'TUTOR' | 'ADMIN';
    guest?: boolean;
    complete?: boolean;
    status?: number;
    language?: 'th' | 'en';
    empty?: boolean;
    shortHistory?: boolean;
    brokenHistory?: boolean;
    messageCount?: number;
  } = {},
) {
  const role = options.role ?? 'STUDENT';
  const owner = role === 'TUTOR' ? 'tutor' : 'student';
  const summary = (index: number): ConversationSummary => ({
    conversationId: `pair-${index}`,
    createdAt: '2026-10-08T03:00:00.000Z',
    otherParticipant: {
      userId: `other-${index}`,
      displayName: `${role === 'TUTOR' ? 'Mint' : 'Teacher Praew'} ${index}`,
    },
    unreadCount: index === 0 ? 2 : 0,
    lastMessage: {
      messageId: 'm-61',
      senderId: 'other',
      text: 'A question before booking',
      sentAt: '2026-10-08T04:01:00.000Z',
    },
  });
  const items = Array.from({ length: 25 }, (_, index) => summary(index));
  let messages: ConversationMessage[] = Array.from(
    { length: options.messageCount ?? 62 },
    (_, index) => ({
      messageId: `m-${index}`,
      conversationId: 'pair-0',
      senderId: index % 2 ? owner : 'other',
      text: `History ${index}: review concepts and plan the lesson.`,
      sentAt: new Date(Date.UTC(2026, 9, 8, 3, index)).toISOString(),
      readAt: null,
    }),
  );
  if (options.shortHistory) {
    messages = [
      {
        messageId: 'short-1',
        conversationId: 'pair-0',
        senderId: owner,
        text: 'สวัสดีครับ',
        sentAt: '2026-10-08T03:00:00.000Z',
        readAt: null,
      },
      {
        messageId: 'short-2',
        conversationId: 'pair-0',
        senderId: owner,
        text: 'อยากสอบถามเรื่องคอร์ส',
        sentAt: '2026-10-08T03:01:00.000Z',
        readAt: null,
      },
      {
        messageId: 'short-3',
        conversationId: 'pair-0',
        senderId: 'other',
        text: 'สอบถามได้เลยค่ะ',
        sentAt: '2026-10-08T03:02:00.000Z',
        readAt: null,
      },
    ];
  }
  const calls: {
    method: string;
    path: string;
    body: unknown;
    after: string | null;
    before?: string | null;
    from?: string | null;
    latest?: boolean;
    at?: number;
  }[] = [];
  const unexpected: string[] = [];
  let unreadOverride: number | null = null;
  let unreadFailure = false;
  let unreadRequests = 0;
  let unreadGate: Promise<void> | undefined;
  let sendGate: Promise<void> | undefined;
  let listGate: Promise<void> | undefined;
  let sendFailure = false;
  let historyStatus = options.status ?? 200;
  let brokenHistory = options.brokenHistory ?? false;
  let readStatus = 200;
  let historyGate: Promise<void> | undefined;
  await page.addInitScript(
    (language) => localStorage.setItem('hktutor-language', language),
    options.language ?? 'en',
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  if (!options.guest) {
    await page
      .context()
      .addCookies([
        { name: 'hktutor_refresh', value: 'chat-fixture', url: 'http://localhost:3000' },
      ]);
  }
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1', '');
    const method = request.method();
    if (path === '/conversations/unread-count') {
      unreadRequests += 1;
      const unreadCount =
        unreadOverride ??
        (options.empty ? 0 : items.reduce((total, item) => total + item.unreadCount, 0));
      await unreadGate;
      return route.fulfill({
        status: unreadFailure ? 503 : 200,
        json: unreadFailure ? { message: 'Unavailable' } : { unreadCount },
      });
    }
    if (path === '/auth/refresh') {
      return route.fulfill({
        status: options.guest ? 401 : 200,
        json: options.guest
          ? { message: 'No session' }
          : {
              accessToken: 'fixture-token',
              user: { id: owner, role, email: 'chat@example.test', displayName: 'Mint' },
            },
      });
    }
    if (path === '/profiles/me') {
      return route.fulfill({
        json: {
          role,
          profileComplete: options.complete ?? true,
          consentCurrent: true,
          profile:
            role === 'STUDENT'
              ? {
                  nickname: 'Mint',
                  firstName: 'Mint',
                  lastName: 'Fixture',
                  school: 'School',
                  gradeLevel: 'Grade 10',
                  phone: '0812345678',
                }
              : {
                  displayName: 'Teacher',
                  bio: 'Teaching',
                  experienceYears: 3,
                  phone: '0812345678',
                  verificationStatus: 'VERIFIED',
                },
        },
      });
    }
    if (path === '/notifications') {
      return route.fulfill({ json: { items: [], unreadCount: 0, nextCursor: null } });
    }
    if (path === '/profiles/me/avatar') {
      return route.fulfill({ json: { avatar: null } });
    }
    if (path === '/bookings/me') {
      return route.fulfill({ json: { items: [], total: 0 } });
    }
    if (path === '/conversations' && method === 'GET') {
      calls.push({ method, path, body: null, after: url.searchParams.get('cursor') });
      const result = {
        items: options.empty
          ? []
          : url.searchParams.has('cursor')
            ? items.slice(20)
            : items.slice(0, 20),
        nextCursor: !options.empty && !url.searchParams.has('cursor') ? 'next' : null,
      };
      result.items = result.items.map((item) => structuredClone(item));
      await listGate;
      return route.fulfill({
        json: result,
      });
    }
    if (path === '/conversations' && method === 'POST') {
      calls.push({ method, path, body: request.postDataJSON(), after: null });
      return route.fulfill({
        status: 200,
        json: {
          conversationId: 'pair-0',
          participants: [
            { userId: owner, role },
            { userId: 'other-0', role: 'TUTOR' },
          ],
          createdAt: items[0]?.createdAt,
        },
      });
    }
    if (/^\/conversations\/pair-\d+\/read$/.test(path)) {
      const payload = request.postDataJSON() as { upToMessageId: string };
      calls.push({ method, path, body: payload, after: null, at: Date.now() });
      if (readStatus !== 200) {
        return route.fulfill({ status: readStatus, json: { message: 'Private read detail' } });
      }
      const boundary = messages.find((message) => message.messageId === payload.upToMessageId);
      let updatedCount = 0;
      const readAt = '2026-10-11T05:00:00.000Z';
      messages = messages.map((message) => {
        if (
          boundary &&
          message.conversationId === boundary.conversationId &&
          message.senderId !== owner &&
          !message.readAt &&
          message.sentAt <= boundary.sentAt
        ) {
          updatedCount++;
          return { ...message, readAt };
        }
        return message;
      });
      const conversation = items.find((item) => item.conversationId === boundary?.conversationId);
      if (conversation && boundary) {
        conversation.unreadCount = messages.filter(
          (message) =>
            message.conversationId === boundary.conversationId &&
            message.senderId !== owner &&
            !message.readAt,
        ).length;
      }
      return route.fulfill({ json: { updatedCount, readAt: updatedCount ? readAt : null } });
    }
    if (/^\/conversations\/pair-\d+\/messages$/.test(path)) {
      const after = url.searchParams.get('afterMessageId');
      const before = url.searchParams.get('beforeMessageId');
      const from = url.searchParams.get('fromMessageId');
      const latest = url.searchParams.get('latest') === 'true';
      calls.push({
        method,
        path,
        body: method === 'POST' ? request.postDataJSON() : null,
        after,
        before,
        from,
        latest,
        at: Date.now(),
      });
      if (method === 'POST') {
        await sendGate;
        if (sendFailure) {
          return route.abort('failed');
        }
        const payload = request.postDataJSON() as { text: string };
        const sent: ConversationMessage = {
          messageId: 'sent',
          conversationId: path.split('/')[2] ?? '',
          senderId: owner,
          text: payload.text,
          sentAt: '2026-10-08T05:00:00.000Z',
          readAt: null,
        };
        messages.push(sent);
        const index = items.findIndex((item) => item.conversationId === sent.conversationId);
        const conversation = items[index];
        if (conversation) {
          items.splice(index, 1);
          items.unshift({ ...conversation, lastMessage: sent });
        }
        return route.fulfill({ status: 201, json: sent });
      }
      if (historyStatus !== 200) {
        return route.fulfill({ status: historyStatus, json: { message: 'Private server detail' } });
      }
      await historyGate;
      if (brokenHistory) {
        return route.fulfill({
          json: { items: [], hasMore: true, nextAfterMessageId: 'new-but-empty' },
        });
      }
      const history = messages
        .filter((message) => message.conversationId === path.split('/')[2])
        .sort((a, b) => a.sentAt.localeCompare(b.sentAt) || a.messageId.localeCompare(b.messageId));
      const pageSize = Number(url.searchParams.get('pageSize') ?? 20);
      const backward = latest || before !== null;
      const end = before ? history.findIndex((item) => item.messageId === before) : history.length;
      const offset = backward
        ? Math.max(0, end - pageSize)
        : from
          ? history.findIndex((item) => item.messageId === from)
          : after
            ? history.findIndex((item) => item.messageId === after) + 1
            : 0;
      const result = history.slice(offset, backward ? end : offset + pageSize);
      const hasMore = backward ? offset > 0 : offset + result.length < history.length;
      return route.fulfill({
        json: {
          items: result,
          nextAfterMessageId: result.at(-1)?.messageId ?? after,
          hasMore,
          ...(backward ? { nextBeforeMessageId: hasMore ? result[0]?.messageId : null } : {}),
        },
      });
    }
    if (path === '/auth/logout') {
      return route.fulfill({ status: 204 });
    }
    if (path === '/tutors/other-0') {
      return route.fulfill({
        json: {
          tutor: {
            tutorId: 'other-0',
            displayName: 'Teacher Praew 0',
            experienceYears: 3,
            bio: 'Math',
            ratingAverage: null,
            reviewCount: 0,
            verificationStatus: 'VERIFIED',
          },
          listings: [],
        },
      });
    }
    if (path === '/tutors/other-0/availability') {
      return route.fulfill({ json: [] });
    }
    unexpected.push(`${method} ${path}`);
    return route.fulfill({ status: 404, json: { message: 'Unexpected fixture request' } });
  });
  return {
    calls,
    unexpected,
    unreadRequests: () => unreadRequests,
    unreadTotal: (total: number | null) => {
      unreadOverride = total;
    },
    failUnread: (fail: boolean) => {
      unreadFailure = fail;
    },
    gateUnread: (gate: Promise<void> | undefined) => {
      unreadGate = gate;
    },
    gateHistory: (gate: Promise<void> | undefined) => {
      historyGate = gate;
    },
    readStatus: (status: number) => {
      readStatus = status;
    },
    readOwn: () => {
      messages = messages.map((message) =>
        message.senderId === owner ? { ...message, readAt: '2026-10-11T05:00:00.000Z' } : message,
      );
    },
    failSending: () => {
      sendFailure = true;
    },
    gateSend: (gate: Promise<void>) => {
      sendGate = gate;
    },
    gateList: (gate: Promise<void>) => {
      listGate = gate;
    },
    historyStatus: (status: number) => {
      historyStatus = status;
    },
    breakHistory: (broken: boolean) => {
      brokenHistory = broken;
    },
    incoming: (text = 'New incoming while reading') => {
      messages = [
        ...messages,
        {
          messageId: 'incoming',
          conversationId: 'pair-0',
          senderId: 'other',
          text,
          sentAt: '2026-10-08T04:30:00.000Z',
          readAt: null,
        },
      ];
      const conversation = items.find((item) => item.conversationId === 'pair-0');
      if (conversation) {
        conversation.unreadCount += 1;
      }
    },
  };
}

async function openFirst(page: Page) {
  await page.goto('/dashboard/messages');
  await page.getByRole('button', { name: /Teacher Praew 0|Mint 0/ }).click();
  await expect(page.getByText('History 61:', { exact: false })).toBeVisible();
}

async function noOverflow(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
  expect(
    await page.locator('main').evaluate((main) => main.scrollWidth - main.clientWidth),
  ).toBeLessThanOrEqual(1);
}

async function pauseChatClock(page: Page) {
  await page.clock.install({ time: new Date('2026-10-11T08:00:00.000Z') });
  await page.clock.pauseAt(new Date('2026-10-11T08:00:01.000Z'));
}

test('loads a 35-message history in two pages and preserves the visible reading anchor', async ({
  page,
}) => {
  const fixture = await mockInbox(page, { messageCount: 35 });
  await page.goto('/dashboard/messages');
  await page.getByRole('button', { name: /Teacher Praew 0/ }).click();
  await expect(page.getByRole('textbox', { name: 'Your message' })).toBeEnabled();
  const transcript = page.getByRole('region', { name: 'Conversation history', exact: true });
  await expect(transcript.locator('[data-message-id]')).toHaveCount(20);
  await expect(transcript.getByText('History 0:', { exact: false })).toHaveCount(0);
  expect(
    fixture.calls.filter((call) => call.path.endsWith('/messages')).every((call) => call.latest),
  ).toBe(true);
  await transcript.evaluate((element) => {
    element.scrollTop = 0;
  });
  const anchor = transcript.locator('[data-message-id="m-15"]');
  const before = (await anchor.boundingBox())?.y ?? 0;
  await page.getByRole('button', { name: 'Load earlier messages' }).click();
  await expect(transcript.locator('[data-message-id]')).toHaveCount(35);
  await expect(page.getByRole('button', { name: 'Load earlier messages' })).toHaveCount(0);
  await expect
    .poll(async () => Math.abs(((await anchor.boundingBox())?.y ?? 0) - before))
    .toBeLessThanOrEqual(2);
  const ids = await transcript
    .locator('[data-message-id]')
    .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-message-id')));
  expect(ids).toEqual(Array.from({ length: 35 }, (_, index) => `m-${index}`));
  expect(fixture.calls.filter((call) => call.before).map((call) => call.before)).toEqual(['m-15']);
  await transcript.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(transcript.getByText('Beginning of conversation', { exact: true })).toBeVisible();
  await noOverflow(page);
  expect(fixture.unexpected).toEqual([]);
});

test('polls every four seconds, updates sent/read from the server and stops when closed', async ({
  page,
}) => {
  await pauseChatClock(page);
  const fixture = await mockInbox(page, { shortHistory: true });
  await page.goto('/dashboard/messages');
  await page.getByRole('button', { name: /Teacher Praew 0/ }).click();
  const input = page.getByRole('textbox', { name: 'Your message' });
  await expect(input).toBeEnabled();
  await expect
    .poll(() => fixture.calls.filter((call) => call.path.endsWith('/read')).length)
    .toBe(1);
  const historyReads = () =>
    fixture.calls.filter((call) => call.method === 'GET' && call.path.endsWith('/messages'));
  const initial = historyReads().length;
  fixture.incoming();
  await page.clock.runFor(3999);
  expect(historyReads()).toHaveLength(initial);
  await page.clock.runFor(1);
  await expect.poll(() => historyReads().length).toBe(initial + 1);
  const transcript = page.getByRole('region', { name: 'Conversation history', exact: true });
  await expect(transcript.getByText('New incoming while reading', { exact: true })).toHaveCount(1);
  await input.fill('Question for a tutor');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const sent = transcript.locator('[data-message-id="sent"]');
  await expect(sent).toContainText('Sent');
  fixture.readOwn();
  await page.clock.runFor(4000);
  await expect(sent).toContainText('Read');
  await expect(transcript.getByText('Question for a tutor', { exact: true })).toHaveCount(1);
  expect(
    fixture.calls
      .filter((call) => call.path.endsWith('/read'))
      .every((call) => (call.body as { upToMessageId: string }).upToMessageId !== 'sent'),
  ).toBe(true);
  await page.getByRole('button', { name: 'Back to conversations' }).click();
  const closed = historyReads().length;
  const readCommands = fixture.calls.filter((call) => call.path.endsWith('/read')).length;
  await page.clock.runFor(12000);
  expect(historyReads()).toHaveLength(closed);
  expect(fixture.calls.filter((call) => call.path.endsWith('/read'))).toHaveLength(readCommands);
  expect(fixture.unexpected).toEqual([]);
});

test('pauses in a hidden tab and never overlaps a stalled polling request', async ({ page }) => {
  await pauseChatClock(page);
  const fixture = await mockInbox(page, { shortHistory: true });
  await page.goto('/dashboard/messages');
  await page.getByRole('button', { name: /Teacher Praew 0/ }).click();
  await expect(page.getByRole('textbox', { name: 'Your message' })).toBeEnabled();
  await expect
    .poll(() => fixture.calls.filter((call) => call.path.endsWith('/read')).length)
    .toBe(1);
  const reads = () =>
    fixture.calls.filter((call) => call.method === 'GET' && call.path.endsWith('/messages')).length;
  const initial = reads();
  let release = () => {};
  fixture.gateHistory(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  await page.clock.runFor(4000);
  await expect.poll(reads).toBe(initial + 1);
  await page.clock.runFor(12000);
  expect(reads()).toBe(initial + 1);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(12000);
  expect(reads()).toBe(initial + 1);
  release();
  fixture.gateHistory(undefined);
  await page.evaluate(() => {
    Reflect.deleteProperty(document, 'hidden');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(reads).toBe(initial + 2);
  expect(fixture.unexpected).toEqual([]);
});

test('refetches server unread counts when a stale inbox request overlaps a read acknowledgement', async ({
  page,
}) => {
  await pauseChatClock(page);
  const fixture = await mockInbox(page, { shortHistory: true });
  await page.goto('/dashboard/messages');
  await page.getByRole('button', { name: /Teacher Praew 0/ }).click();
  await expect(page.getByRole('textbox', { name: 'Your message' })).toBeEnabled();
  await expect
    .poll(() => fixture.calls.filter((call) => call.path.endsWith('/read')).length)
    .toBe(1);
  const refresh = page.getByRole('button', { name: 'Refresh messages', exact: true });
  await expect(refresh).toBeEnabled();
  const listReads = () =>
    fixture.calls.filter((call) => call.path === '/conversations' && call.method === 'GET').length;
  const before = listReads();
  let release = () => {};
  fixture.gateList(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  fixture.incoming();
  await refresh.click();
  await expect.poll(listReads).toBe(before + 1);
  await expect
    .poll(() => fixture.calls.filter((call) => call.path.endsWith('/read')).length)
    .toBe(2);
  release();
  await expect.poll(listReads).toBe(before + 2);
  await page.getByRole('button', { name: 'Back to conversations' }).click();
  await expect(
    page.getByRole('button', { name: /Teacher Praew 0/ }).getByLabel(/unread messages/),
  ).toHaveCount(0);
  expect(fixture.unexpected).toEqual([]);
});

test('retains drafts/history on load-more and read-receipt failures and retries safely', async ({
  page,
}) => {
  await pauseChatClock(page);
  const fixture = await mockInbox(page);
  fixture.readStatus(503);
  await openFirst(page);
  const input = page.getByRole('textbox', { name: 'Your message' });
  await input.fill('Preserve this draft');
  await expect(page.locator('form').getByRole('alert')).toContainText(
    'Could not update read status',
  );
  fixture.historyStatus(503);
  const transcript = page.getByRole('region', { name: 'Conversation history', exact: true });
  await transcript.evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.getByRole('button', { name: 'Load earlier messages' }).click();
  await expect(transcript.getByRole('alert')).toContainText('Could not load messages');
  await expect(input).toHaveValue('Preserve this draft');
  await expect(transcript.locator('[data-message-id]')).toHaveCount(20);
  fixture.historyStatus(200);
  await page.getByRole('button', { name: 'Load earlier messages' }).click();
  await expect(transcript.locator('[data-message-id]')).toHaveCount(40);
  fixture.readStatus(200);
  await page.getByRole('button', { name: /Back to latest messages/ }).click();
  await page.clock.runFor(4000);
  await expect(page.locator('form').getByRole('alert')).toHaveCount(0);
  await expect(input).toHaveValue('Preserve this draft');
  expect(
    fixture.calls.filter((call) => call.method === 'POST' && call.path.endsWith('/messages')),
  ).toHaveLength(0);
  expect(fixture.unexpected).toEqual([]);
});

test('keeps drafts, reading position and index position across conversations; works at 320px', async ({
  page,
}, testInfo) => {
  if (testInfo.project.name === 'mobile-chromium') {
    await page.setViewportSize({ width: 320, height: 760 });
  }
  const fixture = await mockInbox(page);
  await openFirst(page);
  const transcript = page.getByRole('region', { name: 'Conversation history', exact: true });
  const composer = page.getByRole('textbox', { name: 'Your message' });
  await composer.fill('Draft for Praew\n😀');
  await transcript.evaluate((element) => {
    element.scrollTop = 180;
  });
  await expect(page.getByRole('button', { name: /Back to latest messages/ })).toBeVisible();
  const composerY = (await composer.boundingBox())?.y;
  await page.getByRole('button', { name: 'Back to conversations' }).click();
  await page.getByRole('button', { name: /Teacher Praew 1\b/ }).click();
  await expect(page.getByRole('textbox', { name: 'Your message' })).toHaveValue('');
  await page.getByRole('textbox', { name: 'Your message' }).fill('Separate draft');
  await page.getByRole('button', { name: 'Back to conversations' }).click();
  await page.getByRole('button', { name: /Teacher Praew 0.*Temporary draft/ }).click();
  await expect(composer).toHaveValue('Draft for Praew\n😀');
  await expect.poll(() => transcript.evaluate((element) => element.scrollTop)).toBe(180);
  expect((await composer.boundingBox())?.y).toBe(composerY);
  await noOverflow(page);
  expect(fixture.calls.some((call) => call.path.endsWith('/read'))).toBe(true);
  expect(fixture.unexpected).toEqual([]);
  await page.screenshot({
    path: `/private/tmp/hktutor-chat-${testInfo.project.name}.png`,
    fullPage: true,
  });
});

test('preserves a reader while refreshing, then jumps only on request', async ({ page }) => {
  const fixture = await mockInbox(page);
  await openFirst(page);
  const transcript = page.getByRole('region', { name: 'Conversation history', exact: true });
  await transcript.evaluate((element) => {
    element.scrollTop = 180;
  });
  await expect(page.getByRole('button', { name: /Back to latest messages/ })).toBeVisible();
  fixture.incoming();
  await page
    .locator('section[aria-labelledby="conversation-name"]')
    .getByRole('button', { name: 'Refresh messages', exact: true })
    .click();
  await expect(page.getByRole('button', { name: /1 new messages/ })).toBeVisible();
  expect(await transcript.evaluate((element) => element.scrollTop)).toBe(180);
  await page.getByRole('button', { name: /1 new messages/ }).click();
  await expect(page.getByText('New incoming while reading')).toBeVisible();
  await expect(page.getByRole('button', { name: /new messages/ })).toHaveCount(0);
  expect(fixture.unexpected).toEqual([]);
});

test('sends once, trims text, keeps the GET cursor and deduplicates the sent response', async ({
  page,
}) => {
  const fixture = await mockInbox(page);
  await openFirst(page);
  let release = () => {};
  fixture.gateSend(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  await page.getByRole('textbox', { name: 'Your message' }).fill('  Question\n😀  ');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sending…', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Back to conversations' })).toBeDisabled();
  fixture.incoming();
  release();
  await expect(page.getByRole('textbox', { name: 'Your message' })).toHaveValue('');
  await expect(
    page
      .getByRole('region', { name: 'Conversation history' })
      .getByText('Question\n😀', { exact: true }),
  ).toHaveCount(1);
  await page
    .locator('section[aria-labelledby="conversation-name"]')
    .getByRole('button', { name: 'Refresh messages', exact: true })
    .click();
  await expect(page.getByText('New incoming while reading')).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Conversation history' })
      .getByText('Question\n😀', { exact: true }),
  ).toHaveCount(1);
  const sends = fixture.calls.filter(
    (call) => call.method === 'POST' && call.path.endsWith('/messages'),
  );
  expect(sends).toHaveLength(1);
  expect(sends[0]?.body).toEqual({ text: 'Question\n😀' });
  expect(
    fixture.calls.filter((call) => call.method === 'GET' && call.path.endsWith('/messages')).at(-1)
      ?.from,
  ).toBe('m-43');
});

test('keeps ambiguous-send drafts, rejects blank/over-limit input and treats message text as text', async ({
  page,
}) => {
  const fixture = await mockInbox(page);
  await openFirst(page);
  const composer = page.getByRole('textbox', { name: 'Your message' });
  const send = page.getByRole('button', { name: 'Send', exact: true });
  await composer.fill('  \n ');
  await expect(send).toBeDisabled();
  await composer.fill('😀'.repeat(2001));
  await expect(send).toBeDisabled();
  await composer.fill('<img src=x onerror=alert(1)>');
  fixture.failSending();
  await send.click();
  await expect(page.locator('form').getByRole('alert')).toContainText('Could not confirm sending');
  await expect(composer).toHaveValue('<img src=x onerror=alert(1)>');
  expect(
    fixture.calls.filter((call) => call.method === 'POST' && call.path.endsWith('/messages')),
  ).toHaveLength(1);
  await page.waitForTimeout(250);
  expect(
    fixture.calls.filter((call) => call.method === 'POST' && call.path.endsWith('/messages')),
  ).toHaveLength(1);
});

for (const role of ['STUDENT', 'TUTOR'] as const) {
  test(`${role} can open message links while HTML stays text and long links wrap`, async ({
    page,
  }) => {
    const language = role === 'STUDENT' ? 'th' : 'en';
    const fixture = await mockInbox(page, { role, language });
    await page.context().route('https://example.test/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<title>Lesson link fixture</title><p>Lesson document</p>',
      }),
    );
    await openFirst(page);
    const incoming =
      'ดูเอกสาร (https://example.test/lesson_(math)?unit=1&level=2),\nwww.example.test/home. javascript:alert(1) <img src=x onerror=alert(1)>';
    fixture.incoming(incoming);
    await page
      .getByRole('button', {
        name: language === 'th' ? 'รีเฟรชข้อความ' : 'Refresh messages',
        exact: true,
      })
      .click();
    const transcript = page.getByRole('region', {
      name: language === 'th' ? 'ประวัติข้อความ' : 'Conversation history',
      exact: true,
    });
    const received = transcript.locator('[data-message-history] p').filter({ hasText: 'ดูเอกสาร' });
    await expect(received).toHaveText(incoming);
    await expect(received.getByRole('link')).toHaveCount(2);
    const lesson = received.getByRole('link').first();
    await expect(lesson).toHaveAttribute(
      'href',
      'https://example.test/lesson_(math)?unit=1&level=2',
    );
    await expect(lesson).toHaveAttribute('target', '_blank');
    await expect(lesson).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(lesson).toHaveAccessibleName(
      language === 'th' ? /เปิดลิงก์ในแท็บใหม่/ : /Open link in a new tab/,
    );
    await expect(received.getByRole('link').last()).toHaveAttribute(
      'href',
      'https://www.example.test/home',
    );
    await expect(received.locator('img, script')).toHaveCount(0);
    await expect(lesson).toHaveCSS('text-decoration-line', 'underline');
    await lesson.focus();
    await expect(lesson).toBeFocused();
    const [opened] = await Promise.all([page.waitForEvent('popup'), lesson.press('Enter')]);
    await expect(opened).toHaveTitle('Lesson link fixture');
    expect(await opened.evaluate(() => window.opener === null)).toBe(true);
    await opened.close();
    await expect(page).toHaveURL(/\/dashboard\/messages$/);
    const longLink = `http://example.test/${'lesson-notes/'.repeat(35)}?lang=th#read`;
    await page
      .getByRole('textbox', { name: language === 'th' ? 'ข้อความของคุณ' : 'Your message' })
      .fill(longLink);
    await page
      .getByRole('button', { name: language === 'th' ? 'ส่งข้อความ' : 'Send', exact: true })
      .click();
    const sentLink = transcript.getByRole('link', {
      name: new RegExp('^http://example.test/lesson-notes'),
    });
    await expect(sentLink).toHaveAttribute('href', longLink);
    await expect(sentLink).toBeInViewport({ ratio: 1 });
    await noOverflow(page);
    expect(fixture.unexpected).toEqual([]);
  });
}

for (const status of [403, 404]) {
  test(`handles ${status} without exposing details and can recover`, async ({ page }) => {
    const fixture = await mockInbox(page, { status });
    await page.goto('/dashboard/messages');
    await page.getByRole('button', { name: /Teacher Praew 0/ }).click();
    await expect(page.locator('main').getByRole('alert')).toContainText(
      status === 403 ? 'do not have access' : 'no longer available',
    );
    await expect(page.getByRole('textbox', { name: 'Your message' })).toBeDisabled();
    await expect(page.getByText('Private server detail')).toHaveCount(0);
    await page.locator('form').dispatchEvent('submit');
    expect(fixture.calls.filter((call) => call.method === 'POST')).toHaveLength(0);
    fixture.historyStatus(200);
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByText('History 61:', { exact: false })).toBeVisible();
  });
}

for (const language of ['th', 'en'] as const) {
  test(`${language} stops malformed history, recovers and retains cached messages and drafts`, async ({
    page,
  }) => {
    const fixture = await mockInbox(page, { language, brokenHistory: true });
    await page.goto('/dashboard/messages');
    await page.getByRole('button', { name: /Teacher Praew 0/ }).click();
    const input = page.getByRole('textbox', {
      name: language === 'th' ? 'ข้อความของคุณ' : 'Your message',
    });
    const thread = page.locator('section[aria-labelledby="conversation-name"]');
    const alert = thread.getByRole('alert');
    await expect(alert).toContainText(
      language === 'th' ? 'โหลดข้อความไม่สำเร็จ' : 'Could not load messages',
    );
    await expect(input).toBeDisabled();
    await expect(page.getByText('History 0:', { exact: false })).toHaveCount(0);
    const initialReads = fixture.calls.filter(
      (call) => call.method === 'GET' && call.path.endsWith('/messages'),
    );
    // Strict Mode may cancel/restart the initial read; neither may follow the invalid cursor.
    expect(initialReads.length).toBeGreaterThan(0);
    expect(initialReads.every((call) => call.after === null)).toBe(true);
    fixture.breakHistory(false);
    await thread
      .getByRole('button', { name: language === 'th' ? 'ลองอีกครั้ง' : 'Try again' })
      .click();
    await expect(page.getByText('History 61:', { exact: false })).toBeVisible();
    await input.fill('Retain this draft during failed refresh');
    const before = fixture.calls.filter(
      (call) => call.method === 'GET' && call.path.endsWith('/messages'),
    ).length;
    fixture.breakHistory(true);
    await thread
      .getByRole('button', {
        name: language === 'th' ? 'รีเฟรชข้อความ' : 'Refresh messages',
        exact: true,
      })
      .click();
    await expect(alert).toBeVisible();
    await expect(input).toHaveValue('Retain this draft during failed refresh');
    await expect(page.getByText('History 61:', { exact: false })).toHaveCount(1);
    expect(
      fixture.calls.filter((call) => call.method === 'GET' && call.path.endsWith('/messages')),
    ).toHaveLength(before + 1);
    fixture.breakHistory(false);
    await thread
      .getByRole('button', { name: language === 'th' ? 'ลองอีกครั้ง' : 'Try again' })
      .click();
    await expect(alert).toHaveCount(0);
    await expect(input).toHaveValue('Retain this draft during failed refresh');
    expect(
      fixture.calls
        .filter((call) => call.method === 'GET' && call.path.endsWith('/messages'))
        .at(-1)?.from,
    ).toBe('m-43');
    expect(
      fixture.calls.filter((call) => call.method === 'POST' && call.path.endsWith('/messages')),
    ).toHaveLength(0);
    expect(fixture.unexpected).toEqual([]);
    await noOverflow(page);
  });
}

test('opens a canonical tutor conversation without a booking and uses Thai copy', async ({
  page,
}) => {
  const fixture = await mockInbox(page, { language: 'th' });
  await page.goto('/dashboard/messages?tutorId=other-0');
  await expect(page.getByRole('textbox', { name: 'ข้อความของคุณ' })).toBeVisible();
  await expect(page).toHaveURL(/\/dashboard\/messages$/);
  expect(
    fixture.calls
      .filter((call) => call.method === 'POST' && call.path === '/conversations')
      .every((call) => JSON.stringify(call.body) === JSON.stringify({ tutorId: 'other-0' })),
  ).toBe(true);
  expect(
    fixture.calls.filter((call) => call.method === 'POST' && call.path.includes('booking')),
  ).toHaveLength(0);
  await noOverflow(page);
});

test('tutors reply from their own inbox and an empty inbox does not invent students', async ({
  page,
}) => {
  const fixture = await mockInbox(page, { role: 'TUTOR', empty: true });
  await page.goto('/dashboard/messages');
  await expect(
    page.getByText('Conversations appear here when a student contacts you.'),
  ).toBeVisible();
  expect(fixture.calls.filter((call) => call.method === 'POST')).toHaveLength(0);
  await noOverflow(page);
});

for (const state of ['guest', 'admin', 'incomplete'] as const) {
  test(`does not request chat data for ${state}`, async ({ page }) => {
    const fixture = await mockInbox(page, {
      guest: state === 'guest',
      role: state === 'admin' ? 'ADMIN' : 'STUDENT',
      complete: state !== 'incomplete',
    });
    await page.goto('/dashboard/messages?tutorId=other-0');
    await expect(page).toHaveURL(
      state === 'guest'
        ? /\/?returnTo=/
        : state === 'admin'
          ? /\/dashboard$/
          : /\/onboarding\/profile\?returnTo=/,
    );
    expect(fixture.calls).toEqual([]);
  });
}

test('restores index scroll/focus and appends the next inbox page without losing drafts', async ({
  page,
}) => {
  const fixture = await mockInbox(page);
  await page.goto('/dashboard/messages');
  const index = page.locator('[data-conversation-index-scroll]');
  await expect(page.getByRole('button', { name: /Teacher Praew 5/ })).toHaveCount(1);
  await index.evaluate((element) => {
    element.scrollTop = 400;
  });
  const contact = page.getByRole('button', { name: /Teacher Praew 5/ });
  const position = await index.evaluate((element) => element.scrollTop);
  await contact.click();
  await page.getByRole('textbox', { name: 'Your message' }).fill('Keep this draft');
  await page.getByRole('button', { name: 'Back to conversations' }).click();
  await expect(contact).toBeFocused();
  expect(await index.evaluate((element) => element.scrollTop)).toBe(position);
  await page.getByRole('button', { name: 'More conversations' }).click();
  await expect(page.getByRole('button', { name: /Teacher Praew 24/ })).toHaveCount(1);
  await page.getByRole('button', { name: /Teacher Praew 5.*Temporary draft/ }).click();
  await expect(page.getByRole('textbox', { name: 'Your message' })).toHaveValue('Keep this draft');
  expect(fixture.unexpected).toEqual([]);
});

test('opens chat through the tutor profile CTA without requiring a course or slot', async ({
  page,
}) => {
  const fixture = await mockInbox(page);
  await page.goto('/tutors/other-0');
  await page.getByRole('link', { name: 'Ask the tutor' }).click();
  await expect(page.getByRole('textbox', { name: 'Your message' })).toBeVisible();
  expect(
    fixture.calls.filter((call) => call.method === 'POST' && call.path === '/conversations'),
  ).toHaveLength(1);
  expect(fixture.unexpected).toEqual([]);
});

test('promotes a sent conversation immediately and restores visible contact focus', async ({
  page,
}) => {
  const fixture = await mockInbox(page);
  await page.goto('/dashboard/messages');
  await page.getByRole('button', { name: 'More conversations' }).click();
  const contact = page.getByRole('button', { name: /Teacher Praew 24/ });
  await contact.click();
  const composer = page.getByRole('textbox', { name: 'Your message' });
  await expect(composer).toBeEnabled();
  const listReads = fixture.calls.filter((call) => call.path === '/conversations').length;
  await composer.fill('New activity in an older conversation');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(composer).toHaveValue('');
  const contacts = page.locator('[data-conversation-index-scroll] li button');
  await expect(contacts.first()).toContainText('Teacher Praew 24');
  await expect(contacts.first()).toContainText('New activity in an older conversation');
  await expect(contacts).toHaveCount(25);
  await page.getByRole('button', { name: 'Back to conversations' }).click();
  await expect(contact).toBeFocused();
  await expect(contact).toBeInViewport({ ratio: 1 });
  expect(fixture.calls.filter((call) => call.path === '/conversations')).toHaveLength(listReads);
  expect(fixture.unexpected).toEqual([]);
});

test('refresh retains loaded inbox pages, an older selected contact and its draft', async ({
  page,
}) => {
  const fixture = await mockInbox(page);
  await page.goto('/dashboard/messages');
  await page.getByRole('button', { name: 'More conversations' }).click();
  const contact = page.getByRole('button', { name: /Teacher Praew 24/ });
  await contact.click();
  const composer = page.getByRole('textbox', { name: 'Your message' });
  await expect(composer).toBeEnabled();
  const listReads = fixture.calls.filter((call) => call.path === '/conversations').length;
  await composer.fill('Draft for the older contact');
  const refresh = page.getByRole('button', { name: 'Refresh messages', exact: true });
  await refresh.click();
  await expect
    .poll(() => fixture.calls.filter((call) => call.path === '/conversations').length)
    .toBe(listReads + 2);
  await expect(refresh).toBeEnabled();
  await expect(composer).toHaveValue('Draft for the older contact');
  await page.getByRole('button', { name: 'Back to conversations' }).click();
  await expect(contact).toBeFocused();
  await expect(page.locator('[data-conversation-index-scroll] li button')).toHaveCount(25);
  const refreshInbox = page.getByRole('button', { name: 'Refresh conversations', exact: true });
  await refreshInbox.click();
  await expect
    .poll(() => fixture.calls.filter((call) => call.path === '/conversations').length)
    .toBe(listReads + 4);
  await expect(refreshInbox).toBeEnabled();
  await contact.click();
  await expect(composer).toHaveValue('Draft for the older contact');
  expect(fixture.unexpected).toEqual([]);
});

test('a stale inbox refresh cannot discard an acknowledged send or its contact', async ({
  page,
}) => {
  const fixture = await mockInbox(page);
  await page.goto('/dashboard/messages');
  await page.getByRole('button', { name: 'More conversations' }).click();
  await page.getByRole('button', { name: /Teacher Praew 24/ }).click();
  const composer = page.getByRole('textbox', { name: 'Your message' });
  await expect(composer).toBeEnabled();
  const listReads = fixture.calls.filter((call) => call.path === '/conversations').length;
  let release = () => {};
  fixture.gateList(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  await page.getByRole('button', { name: 'Refresh messages', exact: true }).click();
  await expect
    .poll(() => fixture.calls.filter((call) => call.path === '/conversations').length)
    .toBe(listReads + 1);
  await composer.fill('Confirmed while the old list was still loading');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(composer).toHaveValue('');
  release();
  await expect
    .poll(() => fixture.calls.filter((call) => call.path === '/conversations').length)
    .toBe(listReads + 2);
  await page.getByRole('button', { name: 'Back to conversations' }).click();
  await expect(
    page.getByRole('button', { name: 'Refresh conversations', exact: true }),
  ).toBeEnabled();
  const contacts = page.locator('[data-conversation-index-scroll] li button');
  await expect(contacts).toHaveCount(25);
  await expect(contacts.first()).toContainText('Teacher Praew 24');
  await expect(contacts.first()).toContainText('Confirmed while the old list was still loading');
  expect(fixture.unexpected).toEqual([]);
});

test('lets a tutor reply while preserving the student nickname boundary', async ({ page }) => {
  const fixture = await mockInbox(page, { role: 'TUTOR' });
  await openFirst(page);
  await expect(page.getByRole('heading', { name: 'Mint 0', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Your message' }).fill('We can start with algebra.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(
    page
      .getByRole('region', { name: 'Conversation history' })
      .getByText('We can start with algebra.'),
  ).toBeVisible();
  expect(
    fixture.calls.filter((call) => call.method === 'POST' && call.path === '/conversations'),
  ).toHaveLength(0);
  expect(fixture.unexpected).toEqual([]);
});

for (const language of ['th', 'en'] as const) {
  test(`${language} short conversations stay compact and keep composer inside the viewport`, async ({
    page,
  }, testInfo) => {
    if (testInfo.project.name === 'mobile-chromium') {
      await page.setViewportSize({ width: 320, height: 760 });
    }
    if (testInfo.project.name === 'chromium') {
      await page.setViewportSize({ width: 1920, height: 1080 });
    }
    const fixture = await mockInbox(page, { language, shortHistory: true });
    await page.goto('/dashboard/messages');
    await page.getByRole('button', { name: /Teacher Praew 0/ }).click();
    const input = page.getByRole('textbox', {
      name: language === 'th' ? 'ข้อความของคุณ' : 'Your message',
    });
    await expect(input).toBeEnabled();
    await expect(
      page.getByRole('button', { name: language === 'th' ? 'รีเฟรชข้อความ' : 'Refresh messages' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /Refresh|รีเฟรช/ })).toHaveCount(1);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const form = page.locator('form');
    const send = form.getByRole('button', {
      name: language === 'th' ? 'ส่งข้อความ' : 'Send',
      exact: true,
    });
    const inputBounds = await input.boundingBox();
    const sendBounds = await send.boundingBox();
    expect(inputBounds).not.toBeNull();
    expect(sendBounds).not.toBeNull();
    if (inputBounds && sendBounds) {
      expect(sendBounds.x).toBeGreaterThan(inputBounds.x + inputBounds.width);
      expect(Math.abs(sendBounds.y - inputBounds.y)).toBeLessThanOrEqual(2);
    }
    const pageHeading = page.getByRole('heading', {
      name: language === 'th' ? 'ข้อความของคุณ' : 'Your messages',
      exact: true,
    });
    const eyebrow = pageHeading.locator('..').locator('p');
    const content = await page.locator('main').boundingBox();
    expect((await eyebrow.boundingBox())?.y).toBeGreaterThanOrEqual((content?.y ?? 0) + 16);
    expect((await form.boundingBox())?.height).toBeLessThanOrEqual(110);
    const bounds = await form.boundingBox();
    expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeLessThanOrEqual(
      (page.viewportSize()?.height ?? 0) - 20,
    );
    await expect(page.locator('#chat-limit')).toBeHidden();
    const history = page.locator('[data-message-history]');
    expect((await history.boundingBox())?.width).toBeLessThanOrEqual(832);
    if (testInfo.project.name === 'chromium') {
      expect(
        (await page.locator('#conversation-index-heading').boundingBox())?.height,
      ).toBeLessThan(30);
    }
    await page.screenshot({
      path: testInfo.outputPath(`margin-inbox-${language}.png`),
      fullPage: true,
    });
    await page.locator('main').screenshot({
      path: testInfo.outputPath(`margin-inbox-main-${language}.png`),
    });
    await input.fill('ข้อความหลายบรรทัด\n'.repeat(15));
    await expect(page.locator('#chat-limit')).toBeVisible();
    await expect(page.locator('#chat-limit')).toContainText(
      language === 'th'
        ? 'ร่างหายเมื่อออกจากหน้านี้หรือโหลดใหม่'
        : 'Draft clears if you leave or reload this page',
    );
    expect((await input.boundingBox())?.height).toBeLessThanOrEqual(112);
    const viewport = page.viewportSize();
    if (viewport) {
      await page.setViewportSize({ ...viewport, height: viewport.height - 120 });
    }
    await expect
      .poll(async () => {
        const resized = await form.boundingBox();
        return (resized?.y ?? 0) + (resized?.height ?? 0);
      })
      .toBeLessThanOrEqual((page.viewportSize()?.height ?? 0) - 20);
    await expect(page.getByText('สอบถามได้เลยค่ะ', { exact: true })).toBeInViewport({ ratio: 1 });
    await noOverflow(page);
    expect(fixture.unexpected).toEqual([]);
    await page.reload();
    await page.getByRole('button', { name: /Teacher Praew 0/ }).click();
    await expect(input).toHaveValue('');
  });
}

const unreadNavBadge = (page: Page) => page.locator('[data-unread-message-count]');

async function openMessageSidebar(page: Page): Promise<void> {
  if ((page.viewportSize()?.width ?? 1440) < 1024) {
    await page.getByRole('button', { name: /Open sidebar|เปิดแถบข้าง/, exact: true }).click();
  }
}

for (const role of ['STUDENT', 'TUTOR'] as const) {
  for (const language of ['en', 'th'] as const) {
    test(`${role} ${language}: sidebar shows the server total beyond loaded inbox pages`, async ({
      page,
    }, testInfo) => {
      const fixture = await mockInbox(page, { role, language });
      fixture.unreadTotal(137);
      await page.goto('/dashboard/messages');
      await openMessageSidebar(page);
      await expect(unreadNavBadge(page)).toHaveText('137');
      await expect(unreadNavBadge(page)).toHaveAttribute(
        'aria-label',
        language === 'en' ? 'Unread messages: 137' : 'ข้อความที่ยังไม่อ่าน: 137',
      );
      expect(
        fixture.calls.filter((call) => call.path === '/conversations' && call.after !== null),
      ).toEqual([]);
      await noOverflow(page);
      await page.screenshot({
        path: testInfo.outputPath(`sidebar-unread-${role}-${language}.png`),
        fullPage: true,
      });
      expect(fixture.unexpected).toEqual([]);
    });
  }

  test(`${role}: sidebar count changes only after successful read acknowledgement`, async ({
    page,
  }) => {
    const fixture = await mockInbox(page, { role, messageCount: 4 });
    fixture.readStatus(500);
    await page.goto('/dashboard/messages');
    await expect(unreadNavBadge(page)).toHaveText('2');
    await page.getByRole('button', { name: /Teacher Praew 0|Mint 0/ }).click();
    await expect(
      page.getByText('Could not update read status. We will try again while this chat is open.'),
    ).toBeVisible();
    await expect(unreadNavBadge(page)).toHaveText('2');
    fixture.readStatus(200);
    await page.getByRole('button', { name: 'Refresh messages', exact: true }).click();
    await expect(unreadNavBadge(page)).toHaveCount(0);
    await expect(page.locator('#dashboard-sidebar a[href="/dashboard/messages"]')).toHaveAttribute(
      'aria-label',
      'Messages, Unread messages: 0',
    );
    expect(fixture.unexpected).toEqual([]);
  });
}

test('sidebar unread polling pauses in hidden tabs and recovers from errors without inventing zero', async ({
  page,
}) => {
  await pauseChatClock(page);
  const fixture = await mockInbox(page);
  fixture.unreadTotal(137);
  await page.goto('/dashboard/messages');
  await openMessageSidebar(page);
  await expect(unreadNavBadge(page)).toHaveText('137');
  fixture.failUnread(true);
  await page.clock.runFor(15_100);
  await expect(unreadNavBadge(page)).toHaveText('—');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const requests = fixture.unreadRequests();
  await page.clock.runFor(45_000);
  expect(fixture.unreadRequests()).toBe(requests);
  fixture.failUnread(false);
  fixture.unreadTotal(5);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(unreadNavBadge(page)).toHaveText('5');
  fixture.unreadTotal(0);
  await page.clock.runFor(15_100);
  await expect(unreadNavBadge(page)).toHaveCount(0);
});

test('a late unread response cannot restore the count after a newer refresh', async ({ page }) => {
  const fixture = await mockInbox(page);
  fixture.unreadTotal(137);
  await page.goto('/dashboard/messages');
  await openMessageSidebar(page);
  await expect(unreadNavBadge(page)).toHaveText('137');
  let release = () => {};
  fixture.gateUnread(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  const before = fixture.unreadRequests();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => fixture.unreadRequests()).toBeGreaterThan(before);
  fixture.unreadTotal(0);
  fixture.gateUnread(undefined);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(unreadNavBadge(page)).toHaveCount(0);
  release();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  await expect(unreadNavBadge(page)).toHaveCount(0);
});

test('collapsed desktop sidebar retains an accessible unread badge', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const fixture = await mockInbox(page);
  fixture.unreadTotal(137);
  await page.goto('/dashboard/messages');
  await expect(unreadNavBadge(page)).toHaveText('137');
  await page
    .locator('#dashboard-sidebar')
    .getByRole('button', { name: 'Close sidebar', exact: true })
    .click();
  await expect(unreadNavBadge(page)).toBeVisible();
  await expect(unreadNavBadge(page)).toHaveText('99+');
  await expect(page.locator('#dashboard-sidebar a[href="/dashboard/messages"]')).toHaveAttribute(
    'aria-label',
    'Messages, Unread messages: 137',
  );
  await noOverflow(page);
});
