import { expect, test } from '@playwright/test';

import type { Page } from '@playwright/test';

// Isolated preview responses only; no real profile or booking is changed.
async function mockCount(page: Page, role: 'STUDENT' | 'TUTOR' | 'GUEST' = 'STUDENT') {
  const state = { total: 137, failure: false, requests: 0, signedIn: role !== 'GUEST' };
  await page.addInitScript(() => localStorage.setItem('hktutor-language', 'en'));
  if (state.signedIn)
    await page
      .context()
      .addCookies([
        { name: 'hktutor_refresh', value: 'count-preview', url: 'http://localhost:3000' },
      ]);
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    if (path === '/auth/refresh')
      return route.fulfill({
        status: state.signedIn ? 200 : 401,
        json: {
          accessToken: 'preview-token',
          user: {
            id: 'count-preview',
            email: 'preview@example.test',
            role,
            displayName: 'Mint',
          },
        },
      });
    if (path === '/profiles/me')
      return route.fulfill({
        json: {
          role,
          consentCurrent: true,
          profileComplete: true,
          policyVersion: '2026-09-30',
          profile:
            role === 'TUTOR'
              ? {
                  firstName: 'Tutor',
                  lastName: 'Preview',
                  nickname: 'Tutor',
                  displayName: 'Tutor',
                  bio: 'Preview teacher',
                  experienceYears: 5,
                  ratingAverage: null,
                  reviewCount: 0,
                  verificationStatus: 'VERIFIED',
                }
              : {
                  firstName: 'Mint',
                  lastName: 'Preview',
                  nickname: 'Mint',
                  school: 'Preview school',
                  gradeLevel: 'Grade 10',
                  phone: '0812345678',
                },
        },
      });
    if (path === '/profiles/me/avatar') return route.fulfill({ json: { avatar: null } });
    if (path === '/bookings/me') {
      if (url.searchParams.get('pageSize') === '1') {
        state.requests += 1;
        expect(Array.from(url.searchParams.keys()).sort()).toEqual(['page', 'pageSize']);
        return route.fulfill({
          status: state.failure ? 500 : 200,
          json: state.failure ? { message: 'Unavailable' } : { items: [], total: state.total },
        });
      }
      return route.fulfill({
        json: { items: [], total: url.searchParams.has('status') ? 2 : state.total },
      });
    }
    if (path === '/bookings/quote')
      return route.fulfill({
        json: {
          tutor: {
            tutorId: 'preview-tutor',
            displayName: 'Teacher',
            verificationStatus: 'VERIFIED',
          },
          listing: {
            id: 'course',
            subjectId: 'math',
            subjectName: 'Math',
            gradeLevelId: 'g10',
            gradeLevelName: 'Grade 10',
            pricePerHour: '500.00',
            description: 'Preview lesson',
          },
          slot: {
            id: 'slot',
            startAtUtc: '2026-10-12T03:00:00Z',
            endAtUtc: '2026-10-12T04:00:00Z',
          },
          subtotalAmount: '500.00',
          discountAmount: '0.00',
          netAmount: '500.00',
          currency: 'THB',
        },
      });
    if (path === '/bookings' && route.request().method() === 'POST') {
      state.total += 1;
      return route.fulfill({
        status: 201,
        json: {
          id: 'created',
          listingId: 'course',
          slotId: 'slot',
          status: 'PENDING',
          subtotalAmount: '500.00',
          discountAmount: '0.00',
          netAmount: '500.00',
          currency: 'THB',
          createdAt: '2026-10-08T00:00:00Z',
        },
      });
    }
    if (path === '/auth/logout') {
      state.signedIn = false;
      return route.fulfill({ status: 204 });
    }
    if (path === '/subjects' || path === '/grade-levels' || path === '/tutors')
      return route.fulfill({ json: { items: [], total: 0 } });
    return route.fulfill({ status: 404, json: { message: 'No preview response' } });
  });
  return state;
}

const badge = (page: Page) => page.locator('[data-booking-nav-count]');

for (const width of [1440, 320]) {
  test(`one total survives client navigation and status filtering at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const state = await mockCount(page);
    await page.goto('/dashboard/profile');
    if (width === 320) await page.getByRole('button', { name: 'Open sidebar' }).click();
    await expect(badge(page)).toHaveText('137');
    await page.locator('#dashboard-sidebar a[href="/dashboard/bookings"]').click();
    await expect(page).toHaveURL(/\/dashboard\/bookings$/);
    await page
      .getByRole('group', { name: 'Status', exact: true })
      .getByRole('button', { name: 'Confirmed', exact: true })
      .click();
    await expect(page.locator('[data-booking-count]')).toContainText('2 bookings');
    if (width === 320) await page.getByRole('button', { name: 'Open sidebar' }).click();
    await expect(badge(page)).toHaveText('137');
    await page.locator('#dashboard-sidebar a[href="/dashboard/profile"]').click();
    await expect(page).toHaveURL(/\/dashboard\/profile$/);
    if (width === 320) await page.getByRole('button', { name: 'Open sidebar' }).click();
    state.total = 138;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(badge(page)).toHaveText('138');
    expect(state.requests).toBeGreaterThanOrEqual(3);
  });
}

test('reads total beyond the dashboard item limit, and refreshes after successful creation', async ({
  page,
}) => {
  const state = await mockCount(page);
  await page.goto('/dashboard');
  await expect(badge(page)).toHaveText('137');
  await page.goto('/dashboard/bookings/new?listingId=course&slotId=slot');
  await expect(badge(page)).toHaveText('137');
  await page.getByRole('button', { name: 'Send lesson request', exact: true }).click();
  await expect(badge(page)).toHaveText('138');
  expect(state.total).toBe(138);
});

test('errors stay unavailable; a successful empty refresh displays zero', async ({ page }) => {
  const state = await mockCount(page);
  state.failure = true;
  await page.goto('/dashboard/profile');
  await expect(badge(page)).toHaveText('—');
  await expect(badge(page)).toHaveAttribute('aria-busy', 'false');
  state.failure = false;
  state.total = 0;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(badge(page)).toHaveText('0');
});

for (const role of ['GUEST', 'TUTOR'] as const) {
  test(`${role} never requests a student booking total`, async ({ page }) => {
    const state = await mockCount(page, role);
    await page.goto(role === 'GUEST' ? '/tutors' : '/dashboard/profile');
    await expect(page.locator('main')).toBeVisible();
    expect(state.requests).toBe(0);
  });
}
