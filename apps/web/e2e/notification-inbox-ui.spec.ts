import { expect, test } from '@playwright/test';

import { notificationCopy } from '@/components/notifications/notification-copy';
import { NOTIFICATION_POLL_INTERVAL_MS } from '@/components/notifications/use-notification-inbox';
import { NOTIFICATIONS_CHANGED_EVENT, notificationChannelName } from '@/lib/notification-events';

import type {
  BookingClassDetails,
  BookingDetail,
  InboxNotification,
  PromptPayPayment,
} from '@/lib/api/types';
import type { Page } from '@playwright/test';

const BOOKING_ID = '11111111-1111-4111-8111-111111111111';
const READ_AT = '2026-10-18T02:00:00.000Z';
const CREATED_AT = '2026-10-17T18:30:00.000Z';
const notice = (id: string, overrides: Partial<InboxNotification> = {}): InboxNotification => ({
  id,
  eventType: 'BOOKING_CREATED',
  title: 'New booking request',
  bookingId: BOOKING_ID,
  readAt: null,
  createdAt: CREATED_AT,
  ...overrides,
});

const CURRENT_BOOKING: BookingDetail = {
  id: BOOKING_ID,
  status: 'CONFIRMED',
  tutor: {
    tutorId: 'synthetic-tutor',
    displayName: 'Teacher Mint',
    verificationStatus: 'VERIFIED',
  },
  listing: {
    id: 'synthetic-listing',
    subjectId: 'math',
    subjectName: 'Mathematics',
    gradeLevelId: 'grade-10',
    gradeLevelName: 'Grade 10',
    pricePerHour: '450.00',
    description: 'Synthetic reminder QA lesson',
  },
  slot: {
    id: '22222222-2222-4222-8222-222222222222',
    startAtUtc: '2026-11-10T11:00:00.000Z',
    endAtUtc: '2026-11-10T12:00:00.000Z',
  },
  subtotalAmount: '450.00',
  discountAmount: '0.00',
  netAmount: '450.00',
  currency: 'THB',
  paymentStatus: 'UNPAID',
  paidAt: null,
  mockReference: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
};

test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.project.name === 'mobile-chromium') {
    await page.setViewportSize({ width: 320, height: 800 });
  }
});

// Every API request is intercepted. No real account, booking or read receipt is changed.
async function setup(
  page: Page,
  options: {
    role?: 'STUDENT' | 'TUTOR';
    language?: 'en' | 'th';
    listGate?: Promise<void>;
    items?: InboxNotification[];
    booking?: BookingDetail;
  } = {},
) {
  const role = options.role ?? 'STUDENT';
  const language = options.language ?? 'en';
  const text = notificationCopy[language];
  const state = {
    items: options.items ?? [
      notice('notice-one'),
      notice('notice-two', { eventType: 'BOOKING_CONFIRMED', readAt: READ_AT }),
      notice('notice-three', { bookingId: null, eventType: 'BOOKING_CANCELED' }),
      notice('notice-four', { eventType: 'RESCHEDULE_APPROVED' }),
    ],
    listFailure: 0,
    writeFailure: 0,
    moreFailure: 0,
    suppressedIds: new Set<string>(),
    readGate: undefined as Promise<void> | undefined,
    moreGate: undefined as Promise<void> | undefined,
    writeGate: undefined as Promise<void> | undefined,
    loseResponse: false,
    reads: [] as URL[],
    writes: [] as { path: string; method: string; body: string | null }[],
    unexpected: [] as string[],
    bookingReads: 0,
    paymentReads: 0,
    domainWrites: [] as string[],
  };
  await page.addInitScript((value) => localStorage.setItem('hktutor-language', value), language);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page
    .context()
    .addCookies([
      { name: 'hktutor_refresh', value: 'notification-preview', url: 'http://localhost:3000' },
    ]);
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1', '');
    if (path.startsWith('/bookings/') && request.method() !== 'GET') {
      state.domainWrites.push(`${request.method()} ${path}`);
    }
    if (path.endsWith('/conversations/unread-count')) {
      return route.fulfill({ json: { unreadCount: 0 } });
    }
    if (path === '/auth/refresh') {
      return route.fulfill({
        json: {
          accessToken: 'preview',
          user: { id: 'notification-user', role, email: 'user@example.test', displayName: 'Mint' },
        },
      });
    }
    if (path === '/profiles/me') {
      return route.fulfill({
        json: {
          role,
          consentCurrent: true,
          policyVersion: '2026-01',
          profileComplete: true,
          profile: {
            firstName: 'Mint',
            lastName: 'Preview',
            nickname: 'Mint',
            displayName: 'Teacher Mint',
            bio: 'Tutor',
            experienceYears: 5,
            verificationStatus: 'VERIFIED',
            school: 'Demo',
            gradeLevel: 'Grade 10',
            phone: '0812345678',
          },
        },
      });
    }
    if (path === '/profiles/me/avatar') {
      return route.fulfill({ json: { avatar: null } });
    }
    if (path === '/bookings/me' || path === '/bookings/tutor') {
      return route.fulfill({ json: { items: [], total: 0 } });
    }
    if (path === '/notifications' && request.method() === 'GET') {
      state.reads.push(url);
      await (state.readGate ?? options.listGate);
      const more = url.searchParams.has('cursor');
      if (more) await state.moreGate;
      const filtered = state.items.filter(
        (item) =>
          !state.suppressedIds.has(item.id) &&
          (url.searchParams.get('unreadOnly') !== 'true' || item.readAt === null),
      );
      const failure = state.listFailure || (more ? state.moreFailure : 0);
      return route.fulfill({
        status: failure || 200,
        json: failure
          ? { message: 'Rejected' }
          : {
              items: more ? filtered.slice(3) : filtered.slice(0, 3),
              nextCursor: !more && filtered.length > 3 ? 'opaque+/=cursor' : null,
              unreadCount: state.items.filter(
                (item) => item.readAt === null && !state.suppressedIds.has(item.id),
              ).length,
            },
      });
    }
    if (path.startsWith('/notifications/') && request.method() !== 'GET') {
      state.writes.push({ path, method: request.method(), body: request.postData() });
      await state.writeGate;
      if (state.writeFailure) {
        return route.fulfill({ status: state.writeFailure, json: { message: 'Rejected' } });
      }
      const all = path === '/notifications/read-all';
      const selected = state.items.filter(
        (item) =>
          item.readAt === null &&
          !state.suppressedIds.has(item.id) &&
          (all || path === `/notifications/${item.id}/read`),
      );
      for (const item of selected) {
        item.readAt = READ_AT;
      }
      if (state.loseResponse) {
        return route.abort('failed');
      }
      return route.fulfill({
        json: all
          ? {
              updatedCount: selected.length,
              readAt: selected.length ? READ_AT : null,
            }
          : { id: selected[0]?.id, readAt: READ_AT },
      });
    }
    if (options.booking && request.method() === 'GET') {
      const booking = options.booking;
      if (path === `/bookings/me/${BOOKING_ID}`) {
        state.bookingReads += 1;
        return route.fulfill({ json: booking });
      }
      if (path === `/bookings/me/${BOOKING_ID}/payments/current`) {
        state.paymentReads += 1;
        return route.fulfill({
          json: {
            bookingId: BOOKING_ID,
            paymentStatus: booking.paymentStatus,
            paymentPending: false,
            paidAt: booking.paidAt,
            reference: booking.mockReference,
            attempt: null,
          } satisfies PromptPayPayment,
        });
      }
      if (path === `/bookings/${BOOKING_ID}/reschedule-requests/current`) {
        return route.fulfill({ json: { request: null, targetSlot: null, allowedActions: [] } });
      }
      if (path === `/bookings/${BOOKING_ID}/class-details`) {
        return route.fulfill({
          json: {
            bookingId: BOOKING_ID,
            status: booking.status,
            paymentStatus: booking.paymentStatus,
            startAt: booking.slot.startAtUtc,
            endAt: booking.slot.endAtUtc,
            subject: { id: 'math', name: 'Mathematics' },
            meetingUrl: null,
            attendance: null,
            attendanceMarkedAt: null,
            participants: {
              tutor: { id: booking.tutor.tutorId, detail: { displayName: 'Teacher Mint' } },
              student: {
                id: 'notification-user',
                detail: { firstName: 'Mint', lastName: 'Preview', nickname: 'Mint' },
              },
            },
          } satisfies BookingClassDetails,
        });
      }
    }
    if (
      request.method() === 'GET' &&
      (path.startsWith('/bookings/me/') || path.endsWith('/class-details'))
    ) {
      return route.fulfill({ status: 404, json: { message: 'Booking no longer exists' } });
    }
    if (path === '/auth/logout') {
      return route.fulfill({ status: 204 });
    }
    state.unexpected.push(`${request.method()} ${path}`);
    return route.fulfill({ status: 500, json: { message: 'Unexpected preview request' } });
  });
  await page.goto('/dashboard/bookings');
  const bell = page.getByRole('button', { name: new RegExp(`^${text.title}`) });
  await expect(bell).toBeVisible();
  const inbox = page.getByRole('region', { name: text.title, exact: true });
  return { state, bell, inbox, text };
}

for (const language of ['en', 'th'] as const) {
  for (const role of ['STUDENT', 'TUTOR'] as const) {
    test(`${language} ${role}: visible states, Bangkok timestamp, pagination and persisted read`, async ({
      page,
    }, testInfo) => {
      const { state, bell, inbox, text } = await setup(page, { language, role });
      await expect(bell).toHaveAccessibleName(
        `${text.title}, ${text.unreadCount.replace('{count}', '3')}`,
      );
      await bell.click();
      await expect(inbox.getByRole('listitem')).toHaveCount(3);
      const first = inbox.getByRole('listitem').nth(0);
      await expect(first.getByText(text.unread, { exact: true })).toBeVisible();
      await expect(
        inbox.getByRole('listitem').nth(1).getByText(text.read, { exact: true }),
      ).toBeVisible();
      await expect(first.locator('time')).toHaveAttribute('datetime', CREATED_AT);
      await expect(first.locator('time')).toContainText('01:30');
      await expect(first.locator('time')).toContainText(
        language === 'en' ? '18 Oct 2026' : '18 ต.ค. 2569',
      );
      await expect(inbox.locator('details[open]')).toHaveCount(0);
      await expect(inbox.getByText(text.missingBooking)).toBeHidden();
      await inbox.getByRole('listitem').nth(2).locator('summary').click();
      await expect(inbox.getByText(text.missingBooking)).toBeVisible();
      await expect(inbox.getByRole('listitem').nth(2).getByRole('link')).toHaveCount(0);
      await inbox.getByRole('button', { name: text.loadMore }).click();
      await expect(inbox.getByRole('listitem')).toHaveCount(4);
      expect(state.reads.at(-1)?.searchParams.get('cursor')).toBe('opaque+/=cursor');
      expect(state.reads.at(-1)?.searchParams.get('limit')).toBe('20');
      await expect(inbox.getByRole('button', { name: text.loadMore })).toHaveCount(0);
      await first.locator('summary').click();
      await first.getByRole('button', { name: text.markRead, exact: true }).click();
      await expect(first.locator('summary')).toBeFocused();
      await expect(first.getByText(text.read, { exact: true })).toBeVisible();
      await expect(inbox.getByRole('button', { name: text.refresh })).toBeEnabled();
      expect(state.items[0]?.readAt).toBe(READ_AT);
      expect(state.writes).toEqual([
        { path: '/notifications/notice-one/read', method: 'PATCH', body: null },
      ]);
      await page.screenshot({
        path: testInfo.outputPath(`notifications-${role}-${language}.png`),
        fullPage: true,
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await inbox.getByRole('button', { name: text.close }).click();
      await expect(bell).toBeFocused();
      await bell.click();
      await expect(
        inbox.getByRole('listitem').nth(0).getByText(text.read, { exact: true }),
      ).toBeVisible();
      expect(state.unexpected).toEqual([]);
    });
  }
}

test('loading and empty states never claim fabricated unread notifications', async ({ page }) => {
  const gate = Promise.withResolvers<void>();
  const { state, bell, inbox, text } = await setup(page, { listGate: gate.promise });
  state.items = [];
  await bell.click();
  await expect(inbox.getByRole('status')).toHaveText(text.loading);
  await expect(inbox.getByText(text.empty, { exact: true })).toHaveCount(0);
  await expect(bell).toHaveAccessibleName(text.title);
  gate.resolve();
  await expect(inbox.getByText(text.empty, { exact: true })).toBeVisible();
  await expect(inbox.getByRole('button', { name: text.markAll })).toHaveCount(0);
  expect(state.writes).toEqual([]);
});

test('load failure and forbidden list do not become empty success; refresh recovers', async ({
  page,
}) => {
  const { state, bell, inbox, text } = await setup(page);
  await expect(bell).toHaveAccessibleName(
    `${text.title}, ${text.unreadCount.replace('{count}', '3')}`,
  );
  state.listFailure = 500;
  await bell.click();
  // Reopening keeps cached rows on a background error; an explicit refresh reports load failure.
  await expect(inbox.getByText(text.syncFailed, { exact: true })).toBeVisible();
  await expect(inbox.getByRole('listitem')).toHaveCount(3);
  await inbox.getByRole('button', { name: text.refresh }).click();
  await expect(inbox.getByRole('alert')).toHaveText(text.loadFailed);
  await expect(inbox.getByText(text.empty, { exact: true })).toHaveCount(0);
  state.listFailure = 403;
  await inbox.getByRole('button', { name: text.refresh }).click();
  await expect(inbox.getByRole('alert')).toHaveText(text.forbidden);
  await expect(inbox.getByRole('listitem')).toHaveCount(0);
  await expect(bell).toHaveAccessibleName(text.title);
  state.listFailure = 0;
  await inbox.getByRole('button', { name: text.refresh }).click();
  await expect(inbox.getByRole('listitem')).toHaveCount(3);
});

test('mark all is optimistic, locked during save, and includes unread on later pages', async ({
  page,
}) => {
  const { state, bell, inbox, text } = await setup(page);
  await bell.click();
  await expect(inbox.getByRole('listitem')).toHaveCount(3);
  await inbox.getByRole('listitem').first().locator('summary').click();
  const gate = Promise.withResolvers<void>();
  state.writeGate = gate.promise;
  await inbox.getByRole('button', { name: text.markAll }).click();
  await expect(bell).toHaveAccessibleName(text.title);
  await expect(inbox.getByRole('listitem').getByText(text.unread, { exact: true })).toHaveCount(0);
  await expect(inbox.getByRole('button', { name: text.refresh })).toBeDisabled();
  await expect(inbox.getByRole('button', { name: text.loadMore })).toBeDisabled();
  await expect(inbox.getByRole('link').first()).not.toHaveAttribute('aria-disabled', 'true');
  gate.resolve();
  await expect(inbox.getByRole('button', { name: text.refresh })).toBeEnabled();
  expect(state.writes).toEqual([{ path: '/notifications/read-all', method: 'POST', body: null }]);
  expect(state.items.every((item) => item.readAt === READ_AT)).toBe(true);
  await inbox.getByRole('button', { name: text.loadMore }).click();
  await expect(inbox.getByRole('listitem')).toHaveCount(4);
  await expect(inbox.getByRole('listitem').getByText(text.unread, { exact: true })).toHaveCount(0);
});

for (const status of [403, 404, 409, 500]) {
  test(`mark-one ${status} rolls back item and badge and requires refresh before another write`, async ({
    page,
  }) => {
    const { state, bell, inbox, text } = await setup(page);
    await bell.click();
    await expect(inbox.getByRole('listitem')).toHaveCount(3);
    state.writeFailure = status;
    const first = inbox.getByRole('listitem').first();
    await first.locator('summary').click();
    await first.getByRole('button', { name: text.markRead, exact: true }).click();
    await expect(inbox.getByRole('alert')).toHaveText(
      status === 403 ? text.forbidden : status === 404 ? text.missing : text.saveFailed,
    );
    await expect(first.getByText(text.unread, { exact: true })).toBeVisible();
    await expect(bell).toHaveAccessibleName(
      `${text.title}, ${text.unreadCount.replace('{count}', '3')}`,
    );
    await expect(first.getByRole('button', { name: text.markRead, exact: true })).toBeDisabled();
    await expect(page).toHaveURL(/\/dashboard\/bookings$/);
    expect(state.items[0]?.readAt).toBeNull();
    state.writeFailure = 0;
    await inbox.getByRole('button', { name: text.refresh }).click();
    await first.locator('summary').click();
    await expect(first.getByRole('button', { name: text.markRead, exact: true })).toBeEnabled();
    await first.getByRole('button', { name: text.markRead, exact: true }).click();
    await expect(first.getByText(text.read, { exact: true })).toBeVisible();
  });
}

test('mark-all failure restores every row and inbox-wide count', async ({ page }) => {
  const { state, bell, inbox, text } = await setup(page);
  await bell.click();
  await expect(inbox.getByRole('listitem')).toHaveCount(3);
  state.writeFailure = 500;
  await inbox.getByRole('button', { name: text.markAll }).click();
  await expect(inbox.getByRole('alert')).toHaveText(text.saveFailed);
  await expect(inbox.getByRole('listitem').getByText(text.unread, { exact: true })).toHaveCount(2);
  await expect(bell).toHaveAccessibleName(
    `${text.title}, ${text.unreadCount.replace('{count}', '3')}`,
  );
  await expect(inbox.getByRole('button', { name: text.markAll })).toBeDisabled();
  expect(state.items.filter((item) => item.readAt === null)).toHaveLength(3);
});

test('lost write response rolls back then reconciles the persisted receipt on refresh', async ({
  page,
}) => {
  const { state, bell, inbox, text } = await setup(page);
  await bell.click();
  await expect(inbox.getByRole('listitem')).toHaveCount(3);
  state.loseResponse = true;
  const first = inbox.getByRole('listitem').first();
  await first.locator('summary').click();
  await first.getByRole('button', { name: text.markRead, exact: true }).click();
  await expect(inbox.getByRole('alert')).toHaveText(text.saveFailed);
  await expect(first.getByText(text.unread, { exact: true })).toBeVisible();
  expect(state.items[0]?.readAt).toBe(READ_AT);
  await inbox.getByRole('button', { name: text.refresh }).click();
  await expect(first.getByText(text.read, { exact: true })).toBeVisible();
  expect(state.writes).toHaveLength(1);
});

test('pagination failure preserves existing rows and permits retry with the same cursor', async ({
  page,
}) => {
  const { state, bell, inbox, text } = await setup(page);
  await bell.click();
  await expect(inbox.getByRole('listitem')).toHaveCount(3);
  state.moreFailure = 500;
  await inbox.getByRole('button', { name: text.loadMore }).click();
  await expect(inbox.getByRole('alert')).toHaveText(text.loadFailed);
  await expect(inbox.getByRole('listitem')).toHaveCount(3);
  state.moreFailure = 0;
  await inbox.getByRole('button', { name: text.loadMore }).click();
  await expect(inbox.getByRole('listitem')).toHaveCount(4);
  expect(state.reads.slice(-2).map((url) => url.searchParams.get('cursor'))).toEqual([
    'opaque+/=cursor',
    'opaque+/=cursor',
  ]);
});

for (const role of ['STUDENT', 'TUTOR'] as const) {
  test(`${role}: booking link marks one read then opens the correct route, even for a deleted booking`, async ({
    page,
  }) => {
    const { state, bell, inbox } = await setup(page, { role });
    await bell.click();
    await inbox.getByRole('listitem').first().locator('summary').click();
    const link = inbox.getByRole('listitem').first().getByRole('link');
    await expect(link).toHaveAttribute('href', `/dashboard/bookings/${BOOKING_ID}`);
    await link.click();
    await expect(page).toHaveURL(`/dashboard/bookings/${BOOKING_ID}`);
    expect(state.writes).toHaveLength(1);
    expect(state.items[0]?.readAt).toBe(READ_AT);
    await expect(page.getByRole('alert').first()).toBeVisible();
    expect(state.unexpected).toEqual([]);
  });
}

test('keyboard operation, Escape focus return and outside dismissal remain available', async ({
  page,
}) => {
  const { bell, inbox, text } = await setup(page);
  await bell.focus();
  await bell.press('Enter');
  await expect(inbox.getByRole('button', { name: text.close })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(inbox).toHaveCount(0);
  await expect(bell).toBeFocused();
  await bell.press('Enter');
  await expect(inbox).toBeVisible();
  await page.mouse.click(1, 1);
  await expect(inbox).toHaveCount(0);
});

for (const language of ['en', 'th'] as const) {
  test(`${language}: unread filter uses the server query and removes read items accessibly`, async ({
    page,
  }, testInfo) => {
    const { state, bell, inbox, text } = await setup(page, { language });
    await bell.click();
    await inbox.getByRole('button', { name: text.loadMore }).click();
    await expect(inbox.getByRole('listitem')).toHaveCount(4);
    const unreadFilter = inbox.getByRole('button', { name: text.filterUnread, exact: true });
    await unreadFilter.click();
    await expect(unreadFilter).toHaveAttribute('aria-pressed', 'true');
    await expect(inbox.getByRole('listitem')).toHaveCount(3);
    expect(state.reads.at(-1)?.searchParams.get('unreadOnly')).toBe('true');
    expect(state.reads.at(-1)?.searchParams.has('cursor')).toBe(false);
    const first = inbox.getByRole('listitem').first();
    await first.locator('summary').click();
    await first.getByRole('button', { name: text.markRead, exact: true }).click();
    await expect(inbox.getByRole('listitem')).toHaveCount(2);
    await expect(unreadFilter).toBeFocused();
    await expect(bell).toHaveAccessibleName(
      `${text.title}, ${text.unreadCount.replace('{count}', '2')}`,
    );
    await expect(inbox.getByRole('button', { name: text.markAll })).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath(`notifications-unread-${language}.png`) });
    await inbox.getByRole('button', { name: text.markAll }).click();
    await expect(inbox.getByText(text.emptyUnread, { exact: true })).toBeVisible();
    await expect(inbox.getByRole('listitem')).toHaveCount(0);
    await inbox.getByRole('button', { name: text.filterAll, exact: true }).click();
    await expect(inbox.getByRole('listitem')).toHaveCount(3);
    expect(state.reads.at(-1)?.searchParams.get('unreadOnly')).toBe('false');
    await inbox.getByRole('button', { name: text.loadMore }).click();
    await expect(inbox.getByRole('listitem')).toHaveCount(4);
    await expect(inbox.getByRole('listitem').getByText(text.unread, { exact: true })).toHaveCount(
      0,
    );
  });
}

for (const status of [403, 404, 409, 500]) {
  test(`booking navigation remains available when marking read returns ${status}`, async ({
    page,
  }) => {
    const { state, bell, inbox } = await setup(page);
    await bell.click();
    state.writeFailure = status;
    await inbox.getByRole('listitem').first().locator('summary').click();
    await inbox.getByRole('listitem').first().getByRole('link').click();
    await expect(page).toHaveURL(`/dashboard/bookings/${BOOKING_ID}`);
    await expect.poll(() => state.writes.length).toBe(1);
    expect(state.items[0]?.readAt).toBeNull();
    expect(state.domainWrites).toEqual([]);
  });
}

test('a pending read receipt never delays opening the booking', async ({ page }) => {
  const { state, bell, inbox } = await setup(page);
  await bell.click();
  const gate = Promise.withResolvers<void>();
  state.writeGate = gate.promise;
  try {
    await inbox.getByRole('listitem').first().locator('summary').click();
    await inbox.getByRole('listitem').first().getByRole('link').click();
    await expect(page).toHaveURL(`/dashboard/bookings/${BOOKING_ID}`);
    expect(state.items[0]?.readAt).toBeNull();
  } finally {
    gate.resolve();
  }
});

test('own read invalidation refreshes once and preserves loaded history', async ({ page }) => {
  await page.clock.install();
  const { state, bell, inbox, text } = await setup(page);
  await bell.click();
  await inbox.getByRole('button', { name: text.loadMore }).click();
  await expect(inbox.getByRole('listitem')).toHaveCount(4);
  const before = state.reads.length;
  const first = inbox.getByRole('listitem').first();
  await first.locator('summary').click();
  await first.getByRole('button', { name: text.markRead, exact: true }).click();
  await expect(first.getByText(text.read, { exact: true })).toBeVisible();
  await expect.poll(() => state.reads.length).toBe(before + 1);
  await expect(inbox.getByRole('listitem')).toHaveCount(4);
  expect(state.writes).toHaveLength(1);
});

for (const signal of ['focus', 'visibilitychange'] as const) {
  test(`${signal} refresh preserves expanded loaded history`, async ({ page }) => {
    await page.clock.install();
    const { state, bell, inbox, text } = await setup(page);
    await bell.click();
    await inbox.getByRole('button', { name: text.loadMore }).click();
    await expect(inbox.getByRole('listitem')).toHaveCount(4);
    const last = inbox.getByRole('listitem').last();
    await last.locator('summary').click();
    state.items.unshift(notice('new-on-resume'));
    await page.evaluate((event) => {
      (event === 'focus' ? window : document).dispatchEvent(new Event(event));
    }, signal);
    await expect(inbox.getByRole('listitem')).toHaveCount(5);
    await expect(last.locator('details')).toHaveAttribute('open', '');
    expect(state.writes).toEqual([]);
  });
}

for (const status of [404, 409, 500]) {
  test(`a ${status} read failure recovers the closed bell on the next poll`, async ({ page }) => {
    await page.clock.install();
    const { state, bell, inbox, text } = await setup(page);
    await bell.click();
    await inbox.getByRole('button', { name: text.loadMore }).click();
    await expect(inbox.getByRole('listitem')).toHaveCount(4);
    state.writeFailure = status;
    const last = inbox.getByRole('listitem').last();
    await last.locator('summary').click();
    await last.getByRole('button', { name: text.markRead, exact: true }).click();
    await expect(inbox.getByRole('alert')).toHaveText(
      status === 404 ? text.missing : text.saveFailed,
    );
    await bell.click();
    state.writeFailure = 0;
    state.items.unshift(notice('after-save-error'));
    await page.clock.runFor(NOTIFICATION_POLL_INTERVAL_MS);
    await expect(bell).toHaveAccessibleName(
      `${text.title}, ${text.unreadCount.replace('{count}', '4')}`,
    );
    await bell.click();
    await expect(inbox.getByRole('listitem')).toHaveCount(5);
    await expect(inbox.getByRole('alert')).toHaveCount(0);
    expect(state.writes).toHaveLength(1);
    await inbox.getByRole('listitem').last().locator('summary').click();
    await expect(
      inbox.getByRole('listitem').last().getByRole('button', { name: text.markRead, exact: true }),
    ).toBeEnabled();
  });
}

test('a lost older receipt response reconciles automatically without repeating its write', async ({
  page,
}) => {
  await page.clock.install();
  const { state, bell, inbox, text } = await setup(page);
  await bell.click();
  await inbox.getByRole('button', { name: text.loadMore }).click();
  await expect(inbox.getByRole('listitem')).toHaveCount(4);
  state.loseResponse = true;
  const last = inbox.getByRole('listitem').last();
  await last.locator('summary').click();
  await last.getByRole('button', { name: text.markRead, exact: true }).click();
  await expect(inbox.getByRole('alert')).toHaveText(text.saveFailed);
  expect(state.items.at(-1)?.readAt).toBe(READ_AT);
  await page.clock.runFor(NOTIFICATION_POLL_INTERVAL_MS);
  await expect(inbox.getByRole('alert')).toHaveCount(0);
  await expect(inbox.getByRole('listitem')).toHaveCount(4);
  await expect(last.getByText(text.read, { exact: true })).toBeVisible();
  expect(state.writes).toHaveLength(1);
});

test('a forbidden receipt waits for explicit refresh instead of retrying in the background', async ({
  page,
}) => {
  await page.clock.install();
  const { state, bell, inbox, text } = await setup(page);
  await bell.click();
  state.writeFailure = 403;
  await inbox.getByRole('listitem').first().locator('summary').click();
  await inbox
    .getByRole('listitem')
    .first()
    .getByRole('button', { name: text.markRead, exact: true })
    .click();
  await expect(inbox.getByRole('alert')).toHaveText(text.forbidden);
  const before = state.reads.length;
  await page.clock.runFor(2 * NOTIFICATION_POLL_INTERVAL_MS);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  expect(state.reads).toHaveLength(before);
  state.writeFailure = 0;
  await inbox.getByRole('button', { name: text.refresh }).click();
  await expect(inbox.getByRole('alert')).toHaveCount(0);
});

test('navigation preserves the unread filter and loaded pages without an extra mount GET', async ({
  page,
}) => {
  const { state, bell, inbox, text } = await setup(page, {
    items: Array.from({ length: 6 }, (_, index) => notice(`history-${index}`)),
  });
  await bell.click();
  await inbox.getByRole('button', { name: text.filterUnread, exact: true }).click();
  await inbox.getByRole('button', { name: text.loadMore }).click();
  await expect(inbox.getByRole('listitem')).toHaveCount(6);
  const before = state.reads.length;
  const receipt = Promise.withResolvers<void>();
  state.writeGate = receipt.promise;
  try {
    await inbox.getByRole('listitem').first().locator('summary').click();
    await inbox.getByRole('listitem').first().getByRole('link').click();
    await expect(page).toHaveURL(`/dashboard/bookings/${BOOKING_ID}`);
    await expect(inbox).toHaveCount(0);
    expect(state.reads).toHaveLength(before);
    await bell.click();
    await expect(
      inbox.getByRole('button', { name: text.filterUnread, exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(inbox.getByRole('listitem')).toHaveCount(5);
  } finally {
    receipt.resolve();
  }
  await expect.poll(() => state.items[0]?.readAt).toBe(READ_AT);
  await expect(inbox.getByRole('listitem')).toHaveCount(5);
});

test('opening a booking cancels an older-page load and still saves the receipt', async ({
  page,
}) => {
  const { state, bell, inbox, text } = await setup(page);
  await bell.click();
  await inbox.getByRole('listitem').first().locator('summary').click();
  const older = Promise.withResolvers<void>();
  state.moreGate = older.promise;
  try {
    await inbox.getByRole('button', { name: text.loadMore }).click();
    await expect(inbox.getByRole('button', { name: text.loading, exact: true })).toBeDisabled();
    await inbox.getByRole('listitem').first().getByRole('link').click();
    await expect(page).toHaveURL(`/dashboard/bookings/${BOOKING_ID}`);
    await expect.poll(() => state.items[0]?.readAt).toBe(READ_AT);
    expect(state.writes).toHaveLength(1);
  } finally {
    state.moreGate = undefined;
    older.resolve();
  }
});

test('opening another booking queues its receipt behind a pending write across navigation', async ({
  page,
}) => {
  const { state, bell, inbox, text } = await setup(page, {
    items: [notice('first'), notice('second')],
  });
  await bell.click();
  const receipt = Promise.withResolvers<void>();
  state.writeGate = receipt.promise;
  try {
    await inbox.getByRole('listitem').first().locator('summary').click();
    await inbox
      .getByRole('listitem')
      .first()
      .getByRole('button', { name: text.markRead, exact: true })
      .click();
    const other = inbox.getByRole('listitem').nth(1);
    await other.locator('summary').click();
    await other.getByRole('link').click();
    await expect(page).toHaveURL(`/dashboard/bookings/${BOOKING_ID}`);
    expect(state.writes).toHaveLength(1);
  } finally {
    receipt.resolve();
  }
  await expect.poll(() => state.writes.length).toBe(2);
  await expect.poll(() => state.items.every((item) => item.readAt === READ_AT)).toBe(true);
  expect(state.writes.map(({ path }) => path)).toEqual([
    '/notifications/first/read',
    '/notifications/second/read',
  ]);
});

test('visible polling updates the closed bell and preserves expanded loaded history', async ({
  page,
}) => {
  await page.clock.install();
  const { state, bell, inbox, text } = await setup(page);
  await expect(bell).toHaveAccessibleName(
    `${text.title}, ${text.unreadCount.replace('{count}', '3')}`,
  );
  state.items.unshift(
    notice('new-arrival', {
      eventType: 'FUTURE_EVENT',
      title: 'New notification',
      createdAt: '2026-10-19T00:00:00.000Z',
    }),
  );
  await page.clock.runFor(NOTIFICATION_POLL_INTERVAL_MS);
  await expect(bell).toHaveAccessibleName(
    `${text.title}, ${text.unreadCount.replace('{count}', '4')}`,
  );
  await expect(inbox).toHaveCount(0);
  await bell.click();
  await inbox.getByRole('button', { name: text.loadMore }).click();
  await expect(inbox.getByRole('listitem')).toHaveCount(5);
  const old = inbox.getByRole('listitem').filter({ hasText: text.events.BOOKING_CREATED });
  await old.locator('summary').click();
  state.items.unshift(
    notice('next-arrival', {
      eventType: 'FUTURE_EVENT',
      title: 'Another notification',
      createdAt: '2026-10-20T00:00:00.000Z',
    }),
  );
  await page.clock.runFor(NOTIFICATION_POLL_INTERVAL_MS);
  await expect(inbox.getByRole('listitem')).toHaveCount(6);
  await expect(old.locator('details')).toHaveAttribute('open', '');
  expect(state.writes).toEqual([]);
});

test('hidden tabs pause notification polling and refresh immediately on return', async ({
  page,
}) => {
  await page.clock.install();
  const { state, bell, text } = await setup(page);
  await expect(bell).toHaveAccessibleName(
    `${text.title}, ${text.unreadCount.replace('{count}', '3')}`,
  );
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const before = state.reads.length;
  state.items.unshift(notice('while-hidden'));
  await page.clock.runFor(2 * NOTIFICATION_POLL_INTERVAL_MS);
  expect(state.reads).toHaveLength(before);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(bell).toHaveAccessibleName(
    `${text.title}, ${text.unreadCount.replace('{count}', '4')}`,
  );
});

for (const language of ['en', 'th'] as const) {
  test(`${language}: a 1H reminder replaces a loaded 24H reminder and updates the unread badge`, async ({
    page,
  }) => {
    await page.clock.install();
    const old = notice('old-24h', { eventType: 'PAYMENT_REMINDER_24H' });
    const { state, bell, inbox, text } = await setup(page, {
      language,
      items: [notice('recent'), notice('read', { readAt: READ_AT }), notice('another'), old],
    });
    await bell.click();
    await inbox.getByRole('button', { name: text.loadMore }).click();
    await expect(inbox.getByRole('listitem')).toHaveCount(4);
    await expect(inbox.getByText(text.events.PAYMENT_REMINDER_24H, { exact: true })).toBeVisible();
    state.items.unshift(notice('new-1h', { eventType: 'PAYMENT_REMINDER_1H' }));
    state.suppressedIds.add(old.id);
    await page.clock.runFor(NOTIFICATION_POLL_INTERVAL_MS);
    await expect(inbox.getByText(text.events.PAYMENT_REMINDER_24H, { exact: true })).toHaveCount(0);
    await expect(inbox.getByText(text.events.PAYMENT_REMINDER_1H, { exact: true })).toBeVisible();
    await expect(bell).toHaveAccessibleName(
      `${text.title}, ${text.unreadCount.replace('{count}', '3')}`,
    );
    const urgent = inbox.getByRole('listitem').first();
    await urgent.locator('summary').click();
    await urgent.getByRole('button', { name: text.markRead, exact: true }).click();
    await expect(urgent.getByText(text.read, { exact: true })).toBeVisible();
    await page.clock.runFor(NOTIFICATION_POLL_INTERVAL_MS);
    await expect(inbox.getByText(text.events.PAYMENT_REMINDER_24H, { exact: true })).toHaveCount(0);
    await expect(bell).toHaveAccessibleName(
      `${text.title}, ${text.unreadCount.replace('{count}', '2')}`,
    );
    expect(old.readAt).toBeNull();
    expect(state.items).toContain(old);
    await inbox.getByRole('button', { name: text.filterUnread, exact: true }).click();
    await expect(inbox.getByRole('listitem')).toHaveCount(2);
  });
}

test('a failed background refresh retains the inbox and recovers on the next tick', async ({
  page,
}) => {
  await page.clock.install();
  const { state, bell, inbox, text } = await setup(page);
  await bell.click();
  await expect(inbox.getByRole('listitem')).toHaveCount(3);
  state.listFailure = 500;
  await page.clock.runFor(NOTIFICATION_POLL_INTERVAL_MS);
  await expect(inbox.getByText(text.syncFailed, { exact: true })).toBeVisible();
  await expect(inbox.getByRole('listitem')).toHaveCount(3);
  state.listFailure = 0;
  state.items.unshift(notice('after-recovery'));
  await page.clock.runFor(NOTIFICATION_POLL_INTERVAL_MS);
  await expect(inbox.getByText(text.syncFailed, { exact: true })).toHaveCount(0);
  await expect(bell).toHaveAccessibleName(
    `${text.title}, ${text.unreadCount.replace('{count}', '4')}`,
  );
});

test('same-account tab invalidation reconciles receipts without another write', async ({
  page,
}) => {
  const { state, bell, inbox, text } = await setup(page);
  await bell.click();
  await inbox.getByRole('button', { name: text.loadMore }).click();
  await expect(inbox.getByRole('listitem')).toHaveCount(4);
  const first = state.items[0];
  if (!first) throw new Error('Missing notification fixture');
  first.readAt = READ_AT;
  await page.evaluate((name) => {
    const peer = new BroadcastChannel(name);
    peer.postMessage({ type: 'changed', sourceId: 'synthetic-peer-tab' });
    peer.close();
  }, notificationChannelName('notification-user'));
  await expect(
    inbox.getByRole('listitem').first().getByText(text.read, { exact: true }),
  ).toBeVisible();
  await expect(bell).toHaveAccessibleName(
    `${text.title}, ${text.unreadCount.replace('{count}', '2')}`,
  );
  expect(state.writes).toEqual([]);
  await expect(inbox.getByRole('listitem')).toHaveCount(4);
});

test('marking read takes priority over a pending background request', async ({ page }) => {
  const { state, bell, inbox, text } = await setup(page);
  await bell.click();
  await expect(inbox.getByRole('listitem')).toHaveCount(3);
  const gate = Promise.withResolvers<void>();
  state.readGate = gate.promise;
  const before = state.reads.length;
  await page.evaluate((name) => window.dispatchEvent(new Event(name)), NOTIFICATIONS_CHANGED_EVENT);
  await expect.poll(() => state.reads.length).toBeGreaterThan(before);
  try {
    const first = inbox.getByRole('listitem').first();
    await first.locator('summary').click();
    await first.getByRole('button', { name: text.markRead, exact: true }).click();
    await expect(first.getByText(text.read, { exact: true })).toBeVisible();
    expect(state.writes).toHaveLength(1);
  } finally {
    state.readGate = undefined;
    gate.resolve();
  }
  await expect(
    inbox.getByRole('listitem').first().getByText(text.read, { exact: true }),
  ).toBeVisible();
});

for (const language of ['en', 'th'] as const) {
  for (const recipient of ['student-unpaid', 'student-paid', 'tutor'] as const) {
    test(`${language} ${recipient}: minimal reminders expand one at a time without marking read`, async ({
      page,
    }, testInfo) => {
      // These are server-selected fixtures. The inbox never fetches payment state or filters history.
      const eventTypes = [
        ...(recipient === 'student-unpaid'
          ? (['PAYMENT_REMINDER_24H', 'PAYMENT_REMINDER_1H', 'PAYMENT_QR_READY'] as const)
          : (['CLASS_REMINDER_24H', 'CLASS_REMINDER_1H'] as const)),
      ] as const;
      const { state, bell, inbox, text } = await setup(page, {
        language,
        role: recipient === 'tutor' ? 'TUTOR' : 'STUDENT',
        items: eventTypes.map((eventType, index) =>
          notice(`reminder-${index}`, { eventType, title: 'Server fallback' }),
        ),
      });
      await bell.click();
      await expect(inbox.getByRole('listitem')).toHaveCount(Math.min(3, eventTypes.length));
      await expect(inbox.locator('details[open]')).toHaveCount(0);
      await expect(inbox.getByRole('link')).toHaveCount(0);
      await page.screenshot({
        path: testInfo.outputPath(`reminders-${recipient}-${language}-collapsed.png`),
        fullPage: true,
      });
      if (eventTypes.length > 3) {
        await inbox.getByRole('button', { name: text.loadMore }).click();
      }
      await expect(inbox.getByRole('listitem')).toHaveCount(eventTypes.length);
      for (const [index, eventType] of eventTypes.entries()) {
        const row = inbox.getByRole('listitem').nth(index);
        const summary = row.locator('summary');
        await expect(summary).toHaveAccessibleName(
          `${text.viewDetails}: ${text.events[eventType]}`,
        );
        await summary.focus();
        await summary.press('Enter');
        await expect(row.locator('details')).toHaveAttribute('open', '');
        await expect(inbox.locator('details[open]')).toHaveCount(1);
        await expect(row.getByText(text.reminderDetails[eventType], { exact: true })).toBeVisible();
        await expect(row.getByRole('link')).toHaveAttribute(
          'href',
          `/dashboard/bookings/${BOOKING_ID}`,
        );
        await expect(row.getByText(text.unread, { exact: true })).toBeVisible();
        expect(state.writes).toEqual([]);
      }
      await expect(bell).toHaveAccessibleName(
        `${text.title}, ${text.unreadCount.replace('{count}', String(eventTypes.length))}`,
      );
      await page.screenshot({
        path: testInfo.outputPath(`reminders-${recipient}-${language}-expanded.png`),
        fullPage: true,
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await inbox.getByRole('link').click();
      await expect(page).toHaveURL(`/dashboard/bookings/${BOOKING_ID}`);
      expect(state.writes).toEqual([
        {
          path: `/notifications/reminder-${eventTypes.length - 1}/read`,
          method: 'PATCH',
          body: null,
        },
      ]);
      expect(state.unexpected).toEqual([]);
    });
  }
}

test('older payment reminders remain readable, with event-time wording and future-event fallback', async ({
  page,
}) => {
  const longTitle = 'A future notification with a very long title '.repeat(10);
  const { state, bell, inbox, text } = await setup(page, {
    items: [
      notice('old-payment', { eventType: 'PAYMENT_REMINDER_1H', readAt: READ_AT }),
      notice('future-event', { eventType: 'FUTURE_EVENT', title: longTitle, bookingId: null }),
    ],
  });
  await bell.click();
  const oldPayment = inbox.getByRole('listitem').first();
  await oldPayment.locator('summary').click();
  await expect(oldPayment.getByText(text.reminderDetails.PAYMENT_REMINDER_1H)).toBeVisible();
  await expect(oldPayment.getByText(text.read, { exact: true })).toBeVisible();
  const future = inbox.getByRole('listitem').nth(1);
  await expect(future.locator('summary')).toContainText(longTitle);
  await future.locator('summary').click();
  await expect(future.getByText(text.detailsHint)).toBeVisible();
  await expect(future.getByText(text.missingBooking)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(state.writes).toEqual([]);
  expect(state.unexpected).toEqual([]);
});

for (const language of ['en', 'th'] as const) {
  for (const current of [
    'unpaid',
    'paid',
    'PENDING',
    'COMPLETED',
    'CANCELED',
    'EXPIRED',
    'missing',
  ] as const) {
    test(`${language}: old payment reminder opens current ${current} booking without an unsafe payment CTA`, async ({
      page,
    }) => {
      await page.clock.setFixedTime(new Date('2026-11-10T09:00:00.000Z'));
      const booking =
        current === 'missing'
          ? undefined
          : {
              ...CURRENT_BOOKING,
              status: current === 'paid' || current === 'unpaid' ? ('CONFIRMED' as const) : current,
              ...(current === 'paid'
                ? {
                    paymentStatus: 'PAID' as const,
                    paidAt: '2026-11-10T08:00:00.000Z',
                    mockReference: 'SYNTHETIC-PAID-REMINDER',
                  }
                : {}),
            };
      const { state, bell, inbox, text } = await setup(page, {
        language,
        ...(booking ? { booking } : {}),
        items: [notice('historical-payment', { eventType: 'PAYMENT_REMINDER_1H' })],
      });
      await bell.click();
      const row = inbox.getByRole('listitem');
      await row.locator('summary').click();
      await expect(row.getByText(text.events.PAYMENT_REMINDER_1H, { exact: true })).toBeVisible();
      await expect(
        row.getByText(text.reminderDetails.PAYMENT_REMINDER_1H, { exact: true }),
      ).toBeVisible();
      await expect(row.getByText(text.unread, { exact: true })).toBeVisible();
      const link = row.getByRole('link', {
        name: `${text.openBooking}: ${text.events.PAYMENT_REMINDER_1H}`,
      });
      await expect(link).toHaveText(text.openBooking);
      await expect(link).toHaveAttribute('href', `/dashboard/bookings/${BOOKING_ID}`);
      await expect(
        inbox.getByRole('button', { name: /Create test QR|สร้าง QR ทดสอบ/ }),
      ).toHaveCount(0);
      expect(state.bookingReads).toBe(0);
      expect(state.paymentReads).toBe(0);
      await row.getByRole('button', { name: text.markRead, exact: true }).click();
      await expect(row.getByText(text.read, { exact: true })).toBeVisible();
      await expect(bell).toHaveAccessibleName(text.title);
      await expect(row.getByRole('button', { name: text.markRead, exact: true })).toHaveCount(0);
      await link.click();
      await expect(page).toHaveURL(`/dashboard/bookings/${BOOKING_ID}`);
      const create = page.getByRole('button', {
        name: /Create test QR|สร้าง QR ทดสอบ/,
        exact: true,
      });
      if (current === 'missing') {
        await expect(page.getByRole('alert').first()).toBeVisible();
        await expect(create).toHaveCount(0);
      } else {
        const panel = page.getByRole('region', {
          name: language === 'en' ? 'Pay with PromptPay' : 'ชำระด้วย PromptPay',
        });
        await expect(panel).toBeVisible();
        await expect(panel).not.toContainText(
          language === 'en' ? 'Checking payment status…' : 'กำลังตรวจสถานะชำระเงิน…',
        );
        await expect(panel.getByRole('alert')).toHaveCount(0);
        expect(state.paymentReads).toBeGreaterThan(0);
        if (current === 'unpaid') {
          await expect(create).toBeEnabled();
        } else {
          await expect(create).toHaveCount(0);
        }
      }
      expect(state.writes).toEqual([
        { path: '/notifications/historical-payment/read', method: 'PATCH', body: null },
      ]);
      expect(state.domainWrites).toEqual([]);
      expect(state.unexpected).toEqual([]);
    });
  }
}
