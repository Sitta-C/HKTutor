import { expect, test } from '@playwright/test';

import type { TutorReport } from '@/lib/api/types';
import type { Page, Route } from '@playwright/test';

const tutor = {
  id: 'report-tutor',
  email: 'report-tutor@example.test',
  role: 'TUTOR',
  displayName: 'Anan',
};
const student = {
  id: 'report-student',
  email: 'report-student@example.test',
  role: 'STUDENT',
  displayName: 'Nan',
};
const profile = {
  role: 'TUTOR',
  consentCurrent: true,
  profileComplete: true,
  policyVersion: '2026-01',
  profile: {
    firstName: 'Anan',
    lastName: 'Dee',
    nickname: 'Anan',
    displayName: 'Anan',
    bio: 'Mathematics tutor',
    experienceYears: 5,
    verificationStatus: 'VERIFIED',
    ratingAverage: null,
    reviewCount: 0,
  },
};
const report: TutorReport = {
  totalBookings: 12,
  statusCounts: { PENDING: 3, CONFIRMED: 1, COMPLETED: 6, CANCELED: 2, EXPIRED: 0 },
  revenue: { amount: '905.00', currency: 'THB' },
  completionRate: { completed: 6, finalized: 8, percent: 75 },
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function mockReport(
  page: Page,
  options: { failOnce?: boolean; role?: 'TUTOR' | 'STUDENT' } = {},
) {
  const user = options.role === 'STUDENT' ? student : tutor;
  let reportReads = 0;
  let reportFailure = Boolean(options.failOnce);
  await page
    .context()
    .addCookies([
      { name: 'hktutor_refresh', value: 'ui-test-session', url: 'http://localhost:3000' },
    ]);
  await page.addInitScript(() => window.localStorage.setItem('hktutor-language', 'en'));
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/auth/refresh') {
      return json(route, { accessToken: 'ui-test-token', user });
    }
    if (path === '/api/v1/profiles/me') {
      return json(
        route,
        options.role === 'STUDENT'
          ? {
              ...profile,
              role: 'STUDENT',
              profile: { firstName: 'Nan', lastName: 'Dee', nickname: 'Nan' },
            }
          : profile,
      );
    }
    if (path.endsWith('/conversations/unread-count')) return json(route, { unreadCount: 0 });
    if (path === '/api/v1/reports/tutor/me') {
      reportReads += 1;
      if (reportFailure) {
        return json(route, { message: 'Service unavailable' }, 503);
      }
      return json(route, report);
    }
    if (path === '/api/v1/bookings/student') return json(route, { items: [], total: 0 });
    return json(route, { message: `Unexpected request: ${path}` }, 500);
  });
  return {
    allowSuccess: () => {
      reportFailure = false;
    },
    reads: () => reportReads,
  };
}

test('private tutor report retries with keyboard focus and remains responsive', async ({
  page,
}) => {
  const request = await mockReport(page, { failOnce: true });
  await page.goto('/dashboard/reports');

  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await expect(page.locator('[data-tutor-report]').getByRole('alert')).toContainText(
    'We could not load your report.',
  );
  const retry = page.getByRole('button', { name: 'Try again' });
  await retry.focus();
  await expect(retry).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(retry).toBeFocused();
  request.allowSuccess();
  await page.keyboard.press('Enter');

  await expect(page.getByRole('heading', { name: 'All-time report' })).toBeFocused();
  await expect(page.getByText(/THB\s905\.00/, { exact: true })).toBeVisible();
  await expect(page.getByText('75%', { exact: true })).toBeVisible();
  await expect(page.getByRole('listitem')).toHaveCount(5);
  expect(request.reads()).toBeGreaterThanOrEqual(3);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(1);

  if ((page.viewportSize()?.width ?? 0) < 1024) {
    await page.getByRole('button', { name: 'Open sidebar' }).click();
  }
  const reportLink = page.getByRole('link', { name: 'Reports', exact: true });
  await expect(reportLink).toHaveAttribute('aria-current', 'page');
});

test('report route guard sends a student back to the dashboard without reading tutor data', async ({
  page,
}) => {
  const request = await mockReport(page, { role: 'STUDENT' });
  await page.goto('/dashboard/reports');
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(request.reads()).toBe(0);
});
