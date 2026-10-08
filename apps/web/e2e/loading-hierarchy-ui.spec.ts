import { expect, test } from '@playwright/test';

import { notebookLoadingPalette } from '@/components/ui/notebook-loading-palette';

import type { NotebookLoadingKind } from '@/components/ui/notebook-loading-palette';
import type { Page } from '@playwright/test';

function requestGate() {
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { pending, release: () => release() };
}

async function expectShellVisible(page: Page) {
  if ((page.viewportSize()?.width ?? 1440) < 1024) {
    await expect(page.locator('button[aria-controls="dashboard-sidebar"]').first()).toBeVisible();
  } else {
    await expect(page.locator('#dashboard-sidebar')).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function mockAccount(
  page: Page,
  options: {
    role?: 'STUDENT' | 'TUTOR';
    authGate?: Promise<void>;
    dataGate?: Promise<void>;
    failData?: boolean;
  } = {},
) {
  const role = options.role ?? 'TUTOR';
  const student = {
    firstName: 'Nan',
    lastName: 'Dee',
    nickname: 'Nan',
    school: 'Example school',
    gradeLevel: 'Grade 10',
    phone: '0812345678',
  };
  const tutor = {
    firstName: 'Anan',
    lastName: 'Dee',
    nickname: 'Anan',
    displayName: 'Anan',
    bio: 'Mathematics tutor',
    experienceYears: 5,
    verificationStatus: 'VERIFIED',
    ratingAverage: null,
    reviewCount: 0,
  };
  await page
    .context()
    .addCookies([
      { name: 'hktutor_refresh', value: 'loading-ui-session', url: 'http://localhost:3000' },
    ]);
  await page.addInitScript(() => localStorage.setItem('hktutor-language', 'en'));
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    if (path === '/auth/refresh') {
      await options.authGate;
      await route.fulfill({
        json: {
          accessToken: 'loading-ui-token',
          user: { id: 'loading-ui', email: 'loading@example.test', role, displayName: 'Anan' },
        },
      });
    } else if (path === '/profiles/me') {
      await route.fulfill({
        json: {
          role,
          consentCurrent: true,
          profileComplete: true,
          policyVersion: '2026-01',
          profile: role === 'STUDENT' ? student : tutor,
        },
      });
    } else {
      await options.dataGate;
      await route.fulfill({
        status: options.failData ? 500 : 200,
        json: {
          items: [],
          total: 0,
          page: 1,
          pageSize: 100,
          totalPages: 0,
        },
      });
    }
  });
}

const sessionRoutes: Array<{ route: string; kind: NotebookLoadingKind; student?: boolean }> = [
  { route: '/dashboard', kind: 'dashboardSession' },
  { route: '/dashboard/profile', kind: 'profileEdit' },
  { route: '/onboarding/profile', kind: 'profileOnboarding' },
  { route: '/dashboard/availability', kind: 'availabilitySession' },
  { route: '/dashboard/listings', kind: 'listingsSession' },
  { route: '/dashboard/listings/new', kind: 'listingCreate' },
  { route: '/dashboard/listings/loading-example/edit', kind: 'listingEdit' },
  { route: '/dashboard/bookings', kind: 'bookingsSession', student: true },
  { route: '/dashboard/bookings/loading-example', kind: 'bookingDetailSession', student: true },
  { route: '/dashboard/bookings/new', kind: 'bookingConfirmSession', student: true },
  { route: '/tutors', kind: 'tutorSearchSession' },
  { route: '/tutors/loading-example', kind: 'tutorDetailSession' },
];

for (const item of sessionRoutes) {
  test(`${item.route} uses its reserved loading color`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const auth = requestGate();
    await mockAccount(page, { role: item.student ? 'STUDENT' : 'TUTOR', authGate: auth.pending });
    try {
      await page.goto(item.route);
      const loading = page.locator(`[data-loading-kind="${item.kind}"]`);
      await expect(loading).toBeVisible();
      const status = loading.getByRole('status');
      await expect(status).not.toBeEmpty();
      const hex = notebookLoadingPalette[item.kind].background;
      const rgb = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
      await expect(status).toHaveCSS('background-color', `rgb(${rgb.join(', ')})`);
      await expect(status.locator('[aria-hidden="true"]').last()).toHaveCSS(
        'animation-name',
        'none',
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    } finally {
      auth.release();
    }
  });
}

for (const role of ['STUDENT', 'TUTOR'] as const) {
  test(`${role} dashboard waits for data before displaying counts`, async ({ page }) => {
    const data = requestGate();
    await mockAccount(page, { role, dataGate: data.pending });
    try {
      await page.goto('/dashboard');
      await expect(
        page.locator(
          `[data-loading-kind="${role === 'STUDENT' ? 'studentDashboard' : 'tutorDashboard'}"]`,
        ),
      ).toBeVisible();
      await expectShellVisible(page);
      const studentSummary = page.getByRole('region', { name: 'Booking overview', exact: true });
      if (role === 'STUDENT') await expect(studentSummary).toHaveCount(0);
      data.release();
      await expect(page.locator('[data-loading-kind]')).toHaveCount(0);
      if (role === 'STUDENT') await expect(studentSummary).toBeVisible();
    } finally {
      data.release();
    }
  });
}

test('student dashboard errors do not display empty counts', async ({ page }) => {
  await mockAccount(page, { role: 'STUDENT', failData: true });
  await page.goto('/dashboard');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('[data-loading-kind]')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Booking overview', exact: true })).toHaveCount(0);
});

for (const route of [
  '/dashboard/listings',
  '/dashboard/availability',
  '/dashboard/bookings',
  '/dashboard/bookings/loading-example',
  '/dashboard/bookings/new?listingId=listing&slotId=slot',
  '/tutors',
  '/tutors/loading-example',
]) {
  test(`${route} keeps data loading within its region`, async ({ page }) => {
    const data = requestGate();
    await mockAccount(page, {
      role: route.includes('/bookings') ? 'STUDENT' : 'TUTOR',
      dataGate: data.pending,
    });
    try {
      await page.goto(route);
      await expect(page.locator('[data-loading-region]:visible').first()).toBeVisible();
      await expect(page.locator('[data-loading-kind]')).toHaveCount(0);
      await expectShellVisible(page);
    } finally {
      data.release();
    }
  });
}
