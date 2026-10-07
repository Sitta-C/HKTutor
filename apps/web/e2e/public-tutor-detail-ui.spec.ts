import { expect, test } from '@playwright/test';

import type { PublicAvailabilitySlot, PublicTutorDetail } from '@/lib/api/types';
import type { Page } from '@playwright/test';

// Preview fixtures only; every API request is intercepted, including auth and destination pages.
const detail: PublicTutorDetail = {
  tutor: {
    tutorId: 'tutor-anna',
    displayName: 'Teacher Anna',
    bio: 'Learn mathematics step by step.\nAsk questions and practise at your own pace.',
    experienceYears: 5,
    verificationStatus: 'VERIFIED',
    ratingAverage: 4.8,
    reviewCount: 24,
  },
  listings: [
    {
      listingId: 'course/math',
      subject: 'Mathematics',
      grade: 'Upper secondary',
      pricePerHour: 450.5,
      description: 'Build a strong foundation with progressively challenging practice.',
    },
    {
      listingId: 'course/physics',
      subject: 'Physics',
      grade: 'Upper secondary',
      pricePerHour: 500,
      description: 'Understand the ideas before using formulas, with everyday examples.',
    },
  ],
};
const slots: PublicAvailabilitySlot[] = [
  { id: 'slot/8a', startAtUtc: '2026-10-08T09:00:00Z', endAtUtc: '2026-10-08T10:00:00Z' },
  { id: 'slot/8b', startAtUtc: '2026-10-08T11:00:00Z', endAtUtc: '2026-10-08T12:30:00Z' },
  { id: 'slot/overnight', startAtUtc: '2026-10-09T16:00:00Z', endAtUtc: '2026-10-09T18:00:00Z' },
];

async function mockDetail(
  page: Page,
  options: {
    role?: 'STUDENT' | 'TUTOR' | 'ADMIN';
    language?: 'th' | 'en';
    data?: PublicTutorDetail;
    availability?: PublicAvailabilitySlot[];
    gate?: Promise<void>;
    status?: number;
  } = {},
) {
  const calls: URL[] = [];
  const unexpected: string[] = [];
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install({ time: new Date('2026-10-07T00:00:00Z') });
  await page.clock.setFixedTime(new Date('2026-10-07T00:00:00Z'));
  await page.addInitScript(
    (language) => localStorage.setItem('hktutor-language', language),
    options.language ?? 'en',
  );
  if (options.role) {
    await page
      .context()
      .addCookies([
        { name: 'hktutor_refresh', value: 'detail-preview-session', url: 'http://localhost:3000' },
      ]);
  }
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    if (path === '/auth/refresh') {
      return route.fulfill(
        options.role
          ? {
              json: {
                accessToken: 'detail-preview-token',
                user: {
                  id: 'detail-viewer',
                  email: 'viewer@example.test',
                  displayName: 'Nan',
                  role: options.role,
                },
              },
            }
          : { status: 401, json: { message: 'Unauthorized' } },
      );
    }
    if (path === '/profiles/me') {
      return route.fulfill({
        json: {
          role: options.role,
          consentCurrent: true,
          profileComplete: true,
          policyVersion: '2026-01',
          profile:
            options.role === 'TUTOR'
              ? {
                  displayName: 'Viewer tutor',
                  bio: 'A tutor preview.',
                  experienceYears: 2,
                  ratingAverage: null,
                  reviewCount: 0,
                  verificationStatus: 'VERIFIED',
                }
              : {
                  firstName: 'Nan',
                  lastName: 'Dee',
                  nickname: 'Nan',
                  school: 'Example school',
                  gradeLevel: 'Grade 10',
                  phone: '0812345678',
                },
        },
      });
    }
    if (path === '/tutors/tutor-anna' || path === '/tutors/tutor-anna/availability') {
      calls.push(url);
      await options.gate;
      if (options.status && path === '/tutors/tutor-anna') {
        return route.fulfill({ status: options.status, json: { message: 'Preview error' } });
      }
      return route.fulfill({
        json: path.endsWith('/availability')
          ? (options.availability ?? slots)
          : (options.data ?? detail),
      });
    }
    // Navigation assertions do not submit a booking; quotes and unrelated pages stay isolated.
    if (path.startsWith('/bookings')) {
      return route.fulfill({ status: 404, json: { message: 'Preview destination' } });
    }
    unexpected.push(`${route.request().method()} ${path}`);
    return route.fulfill({ status: 500, json: { message: 'Unexpected preview request' } });
  });
  return { calls, unexpected };
}

async function noOverflow(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
  const main = page.locator('main');
  expect(await main.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
}

for (const language of ['th', 'en'] as const) {
  for (const student of [false, true]) {
    test(`${language} ${student ? 'student' : 'guest'} preserves requested course, local day index and booking path`, async ({
      page,
    }, testInfo) => {
      const { calls, unexpected } = await mockDetail(page, {
        language,
        ...(student ? { role: 'STUDENT' } : {}),
      });
      await page.goto('/tutors/tutor-anna?listingId=course%2Fphysics');
      const main = page.locator('main');
      await expect(main.getByRole('heading', { name: 'Teacher Anna', exact: true })).toBeVisible();
      await expect(main).toContainText('4.8');
      await expect(main).toContainText('24');
      await expect(main).toContainText(language === 'th' ? '5 ปี' : '5 years');
      const mobileSidebar = page.getByRole('button', {
        name: language === 'th' ? 'เปิดแถบข้าง' : 'Open sidebar',
        exact: true,
      });
      const hasMobileSidebar = await mobileSidebar.isVisible();
      if (hasMobileSidebar) {
        await mobileSidebar.click();
      }
      await expect(page.locator('aside a[href="/dashboard/bookings"]')).toContainText('—');
      if (hasMobileSidebar) {
        await page.keyboard.press('Escape');
        await expect(mobileSidebar).toBeVisible();
      }
      const physics = main.getByRole('button', {
        name: /^(Choose this course|เลือกคอร์สนี้): Physics/,
      });
      const math = main.getByRole('button', {
        name: /^(Choose this course|เลือกคอร์สนี้): Mathematics/,
      });
      await expect(physics).toHaveAttribute('aria-pressed', 'true');
      // Development Strict Mode replays the original mount effect; local choices must not fetch.
      const initialRequests = calls.length;
      expect(initialRequests).toBeGreaterThanOrEqual(2);
      await math.focus();
      await page.keyboard.press('Enter');
      await expect(math).toHaveAttribute('aria-pressed', 'true');
      await expect(math).toBeFocused();
      const choose =
        language === 'th'
          ? student
            ? 'เลือกเวลานี้'
            : 'เข้าสู่ระบบเพื่อเลือกเวลานี้'
          : student
            ? 'Choose this time'
            : 'Sign in to choose this time';
      await expect(main.getByRole('button', { name: new RegExp(`^${choose} ·`) })).toHaveCount(3);
      const index = main.getByRole('group', {
        name: language === 'th' ? 'วันที่มีเวลาว่าง' : 'Dates with available times',
      });
      await index.getByRole('button').nth(2).focus();
      await page.keyboard.press('Enter');
      await expect(main.getByRole('button', { name: new RegExp(`^${choose} ·`) })).toHaveCount(1);
      await expect(main).toContainText('23:00');
      const range = main.getByRole('group', {
        name:
          language === 'th'
            ? '9 ต.ค. 2569 · 23:00 → 10 ต.ค. 2569 · 01:00'
            : '9 Oct 2026 · 23:00 → 10 Oct 2026 · 01:00',
      });
      await expect(range).toContainText(language === 'th' ? 'เริ่ม' : 'Start');
      await expect(range).toContainText(language === 'th' ? 'จบ' : 'End');
      await expect(range).toContainText(language === 'th' ? '9 ต.ค. 2569' : '9 Oct 2026');
      await expect(range).toContainText(language === 'th' ? '10 ต.ค. 2569' : '10 Oct 2026');
      await expect(range.locator('time')).toHaveText(['23:00', '01:00']);
      await index.getByRole('button').first().click();
      await expect(main.getByRole('button', { name: new RegExp(`^${choose} ·`) })).toHaveCount(3);
      expect(calls).toHaveLength(initialRequests);
      const availability = calls.find((url) => url.pathname.endsWith('/availability'));
      expect(availability?.searchParams.size).toBe(2);
      expect(availability?.searchParams.get('from')).toBe('2026-10-07T00:00:00.000Z');
      expect(availability?.searchParams.get('to')).toBe('2026-11-06T00:00:00.000Z');
      expect(unexpected).toEqual([]);
      await noOverflow(page);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: testInfo.outputPath(`detail-${language}-${student ? 'student' : 'guest'}.png`),
        fullPage: true,
      });
      await main
        .getByRole('button', { name: new RegExp(`^${choose} ·`) })
        .first()
        .click();
      const bookingPath = '/dashboard/bookings/new?listingId=course%2Fmath&slotId=slot%2F8a';
      await expect(page).toHaveURL(
        student
          ? new RegExp('/dashboard/bookings/new\\?listingId=course%2Fmath&slotId=slot%2F8a')
          : 'http://localhost:3000/?returnTo=' + encodeURIComponent(bookingPath),
      );
    });
  }
}

for (const language of ['th', 'en'] as const) {
  for (const multiDay of [false, true]) {
    test(`${language} ${multiDay ? 'multi-day' : 'single-day'} midnight uses tutor labels and books one whole slot`, async ({
      page,
    }, testInfo) => {
      await mockDetail(page, {
        language,
        role: 'STUDENT',
        availability: [
          {
            id: 'slot/midnight',
            startAtUtc: '2026-10-09T16:00:00Z',
            endAtUtc: multiDay ? '2026-10-11T17:00:00Z' : '2026-10-09T17:00:00Z',
          },
        ],
      });
      await page.goto('/tutors/tutor-anna?listingId=course%2Fphysics');
      const main = page.locator('main');
      const choose = language === 'th' ? 'เลือกเวลานี้' : 'Choose this time';
      const action = main.getByRole('button', { name: new RegExp(`^${choose} ·`) });
      await expect(action).toHaveCount(1);
      await expect(action).toHaveAttribute('aria-label', /00:00$/);
      if (multiDay) {
        const range = main.getByRole('group', { name: /23:00 → .*00:00$/ });
        await expect(range.locator('time')).toHaveText(['23:00', '24:00']);
        await expect(range).toContainText(language === 'th' ? '11 ต.ค. 2569' : '11 Oct 2026');
        await expect(range).toContainText(language === 'th' ? 'จบ' : 'End');
      } else {
        await expect(main).toContainText('23:00–24:00');
      }
      await expect(
        main
          .getByRole('group', {
            name: language === 'th' ? 'วันที่มีเวลาว่าง' : 'Dates with available times',
          })
          .getByRole('button'),
      ).toHaveCount(2);
      await noOverflow(page);
      await page.screenshot({
        path: testInfo.outputPath(
          `detail-${language}-${multiDay ? 'multi-day' : 'single-day'}-midnight.png`,
        ),
        fullPage: true,
      });
      await action.click();
      await expect(page).toHaveURL(
        /\/dashboard\/bookings\/new\?listingId=course%2Fphysics&slotId=slot%2Fmidnight$/,
      );
    });
  }
}

for (const query of ['', '?listingId=missing']) {
  test(`fallback selection ${query || 'without listingId'}`, async ({ page }) => {
    await mockDetail(page);
    await page.goto('/tutors/tutor-anna' + query);
    await expect(
      page.getByRole('button', { name: /^Choose this course: Mathematics/ }),
    ).toHaveAttribute('aria-pressed', 'true');
  });
}

test('conflict recovery and null rating use actual metadata', async ({ page }, testInfo) => {
  await mockDetail(page, {
    data: { ...detail, tutor: { ...detail.tutor, ratingAverage: null, reviewCount: 0 } },
  });
  await page.goto('/tutors/tutor-anna?listingId=course%2Fphysics&conflict=1');
  await expect(page.locator('main').getByRole('alert')).toContainText(
    'That time is no longer available',
  );
  await expect(page.locator('main')).toContainText('New tutor');
  await expect(page.locator('main')).toContainText('0 reviews');
  await expect(page.getByRole('button', { name: /^Choose this course: Physics/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await noOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath('detail-conflict-null-rating.png'),
    fullPage: true,
  });
});

for (const role of ['TUTOR', 'ADMIN'] as const) {
  test(`${role} cannot choose a time`, async ({ page }) => {
    await mockDetail(page, { role });
    await page.goto('/tutors/tutor-anna');
    const actions = page
      .locator('main')
      .getByRole('button', { name: /^Student account required ·/ });
    await expect(actions).toHaveCount(3);
    for (const action of await actions.all()) {
      await expect(action).toBeDisabled();
    }
  });
}

for (const empty of ['listings', 'slots'] as const) {
  test(`successful empty ${empty}`, async ({ page }, testInfo) => {
    await mockDetail(page, {
      ...(empty === 'listings' ? { data: { ...detail, listings: [] } } : { availability: [] }),
    });
    await page.goto('/tutors/tutor-anna');
    if (empty === 'listings') {
      await expect(page.getByText('No published courses are available right now.')).toBeVisible();
      await expect(page.locator('main')).toContainText('0 courses');
      for (const action of await page
        .getByRole('button', { name: /^Sign in to choose this time ·/ })
        .all()) {
        await expect(action).toBeDisabled();
      }
    } else {
      await expect(page.getByText('No future open times are available right now.')).toBeVisible();
      await expect(page.getByRole('group', { name: 'Dates with available times' })).toHaveCount(0);
    }
    await noOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`detail-empty-${empty}.png`),
      fullPage: true,
    });
  });
}

for (const status of [500, 404]) {
  test(`content loading retains shell before ${status}`, async ({ page }, testInfo) => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await mockDetail(page, { gate, status });
    try {
      await page.goto('/tutors/tutor-anna');
      await expect(page.locator('header')).toBeVisible();
      await expect(page.locator('[data-loading-region]')).toBeVisible();
      await expect(page.getByText('0 courses')).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath('detail-loading.png'), fullPage: true });
      release();
      await expect(page.locator('main').getByRole('alert')).toContainText(
        status === 404
          ? 'This tutor is not publicly available.'
          : 'We could not load this tutor right now.',
      );
      await expect(
        page.locator('main').getByRole('link', { name: 'Back to tutor search' }),
      ).toHaveAttribute('href', '/tutors');
      await expect(page.getByText('0 courses')).toHaveCount(0);
      await noOverflow(page);
      await page.screenshot({
        path: testInfo.outputPath(`detail-error-${status}.png`),
        fullPage: true,
      });
    } finally {
      release();
    }
  });
}

test('long public text and many loaded days fit without trimming content', async ({
  page,
}, testInfo) => {
  const data = {
    ...detail,
    tutor: {
      ...detail.tutor,
      displayName: 'MathematicsAndScienceTutorWithAVeryLongUnbrokenName',
      bio: detail.tutor.bio.repeat(8),
    },
    listings: detail.listings.map((listing) => ({
      ...listing,
      subject: 'AdvancedMathematicsAndScientificReasoning',
      grade: 'UniversityEntrancePreparation',
      description: listing.description.repeat(8),
    })),
  };
  await mockDetail(page, {
    data,
    availability: Array.from({ length: 30 }, (_, index) => ({
      id: `day-${index}`,
      startAtUtc: new Date(Date.UTC(2026, 9, 7 + index, 9)).toISOString(),
      endAtUtc: new Date(Date.UTC(2026, 9, 7 + index, 10)).toISOString(),
    })),
  });
  await page.goto('/tutors/tutor-anna');
  await expect(
    page.getByRole('group', { name: 'Dates with available times' }).getByRole('button'),
  ).toHaveCount(31);
  await expect(
    page.getByRole('heading', { name: data.tutor.displayName, exact: true }),
  ).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('detail-long-text.png'), fullPage: true });
});
