import { expect, test } from '@playwright/test';

import { notificationCopy } from '@/components/notifications/notification-copy';

import type { InboxNotification } from '@/lib/api/types';
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

test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.project.name === 'mobile-chromium') {
    await page.setViewportSize({ width: 320, height: 800 });
  }
});

// Every API request is intercepted. No real account, booking or read receipt is changed.
async function setup(
  page: Page,
  options: { role?: 'STUDENT' | 'TUTOR'; language?: 'en' | 'th'; listGate?: Promise<void> } = {},
) {
  const role = options.role ?? 'STUDENT';
  const language = options.language ?? 'en';
  const text = notificationCopy[language];
  const state = {
    items: [
      notice('notice-one'),
      notice('notice-two', { eventType: 'BOOKING_CONFIRMED', readAt: READ_AT }),
      notice('notice-three', { bookingId: null, eventType: 'BOOKING_CANCELED' }),
      notice('notice-four', { eventType: 'RESCHEDULE_APPROVED' }),
    ],
    listFailure: 0,
    writeFailure: 0,
    moreFailure: 0,
    writeGate: undefined as Promise<void> | undefined,
    loseResponse: false,
    reads: [] as URL[],
    writes: [] as { path: string; method: string; body: string | null }[],
    unexpected: [] as string[],
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
      await options.listGate;
      const more = url.searchParams.has('cursor');
      const failure = state.listFailure || (more ? state.moreFailure : 0);
      return route.fulfill({
        status: failure || 200,
        json: failure
          ? { message: 'Rejected' }
          : {
              items: more ? state.items.slice(3) : state.items.slice(0, 3),
              nextCursor: !more && state.items.length > 3 ? 'opaque+/=cursor' : null,
              unreadCount: state.items.filter((item) => item.readAt === null).length,
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
        (item) => item.readAt === null && (all || path === `/notifications/${item.id}/read`),
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
    if (path.startsWith('/bookings/me/') || path.endsWith('/class-details')) {
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
      await expect(inbox.getByText(text.missingBooking)).toBeVisible();
      await expect(inbox.getByRole('listitem').nth(2).getByRole('link')).toHaveCount(0);
      await inbox.getByRole('button', { name: text.loadMore }).click();
      await expect(inbox.getByRole('listitem')).toHaveCount(4);
      expect(state.reads.at(-1)?.searchParams.get('cursor')).toBe('opaque+/=cursor');
      expect(state.reads.at(-1)?.searchParams.get('limit')).toBe('20');
      await expect(inbox.getByRole('button', { name: text.loadMore })).toHaveCount(0);
      await first.getByRole('button', { name: text.markRead, exact: true }).click();
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
  state.listFailure = 500;
  await bell.click();
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
  const gate = Promise.withResolvers<void>();
  state.writeGate = gate.promise;
  await inbox.getByRole('button', { name: text.markAll }).click();
  await expect(bell).toHaveAccessibleName(text.title);
  await expect(inbox.getByText(text.unread, { exact: true })).toHaveCount(0);
  await expect(inbox.getByRole('button', { name: text.refresh })).toBeDisabled();
  await expect(inbox.getByRole('button', { name: text.loadMore })).toBeDisabled();
  await expect(inbox.getByRole('link').first()).toHaveAttribute('aria-disabled', 'true');
  gate.resolve();
  await expect(inbox.getByRole('button', { name: text.refresh })).toBeEnabled();
  expect(state.writes).toEqual([{ path: '/notifications/read-all', method: 'POST', body: null }]);
  expect(state.items.every((item) => item.readAt === READ_AT)).toBe(true);
  await inbox.getByRole('button', { name: text.loadMore }).click();
  await expect(inbox.getByRole('listitem')).toHaveCount(4);
  await expect(inbox.getByText(text.unread, { exact: true })).toHaveCount(0);
});

for (const status of [403, 404, 409, 500]) {
  test(`mark-one ${status} rolls back item and badge, blocks navigation and requires refresh`, async ({
    page,
  }) => {
    const { state, bell, inbox, text } = await setup(page);
    await bell.click();
    await expect(inbox.getByRole('listitem')).toHaveCount(3);
    state.writeFailure = status;
    const first = inbox.getByRole('listitem').first();
    await first.getByRole('link').click();
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
  await expect(inbox.getByText(text.unread, { exact: true })).toHaveCount(2);
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
