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
  let messages: ConversationMessage[] = Array.from({ length: 62 }, (_, index) => ({
    messageId: `m-${index}`,
    conversationId: 'pair-0',
    senderId: index % 2 ? owner : 'other',
    text: `History ${index}: review concepts and plan the lesson.`,
    sentAt: new Date(Date.UTC(2026, 9, 8, 3, index)).toISOString(),
    readAt: null,
  }));
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
  const calls: { method: string; path: string; body: unknown; after: string | null }[] = [];
  const unexpected: string[] = [];
  let sendGate: Promise<void> | undefined;
  let listGate: Promise<void> | undefined;
  let sendFailure = false;
  let historyStatus = options.status ?? 200;
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
    if (path === '/profiles/me/avatar') {
      return route.fulfill({ json: { avatar: null } });
    }
    if (path === '/bookings/me') {
      return route.fulfill({ json: { items: [], total: 0 } });
    }
    if (path === '/conversations' && method === 'GET') {
      calls.push({ method, path, body: null, after: null });
      const result = {
        items: options.empty
          ? []
          : url.searchParams.has('cursor')
            ? items.slice(20)
            : items.slice(0, 20),
        nextCursor: !options.empty && !url.searchParams.has('cursor') ? 'next' : null,
      };
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
    if (/^\/conversations\/pair-\d+\/messages$/.test(path)) {
      const after = url.searchParams.get('afterMessageId');
      calls.push({ method, path, body: method === 'POST' ? request.postDataJSON() : null, after });
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
      const history = messages.filter((message) => message.conversationId === path.split('/')[2]);
      const offset = after ? history.findIndex((item) => item.messageId === after) + 1 : 0;
      const result = history.slice(offset, offset + 50);
      return route.fulfill({
        json: {
          items: result,
          nextAfterMessageId: result.at(-1)?.messageId ?? after,
          hasMore: offset + result.length < history.length,
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
  expect(fixture.calls.filter((call) => call.path.endsWith('/read'))).toHaveLength(0);
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
      ?.after,
  ).toBe('m-61');
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
  expect(fixture.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  await page.waitForTimeout(250);
  expect(fixture.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
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
