import { expect, test } from '@playwright/test';

import type { BookingView } from '@/lib/api/types';
import type { Page } from '@playwright/test';

const now = new Date('2026-10-05T02:00:00Z');

function booking(
  id: string,
  tutorId: string,
  name: string,
  status: BookingView['status'],
  startAtUtc = '2026-10-06T03:00:00Z',
): BookingView {
  return {
    id,
    status,
    tutor: { tutorId, displayName: name, verificationStatus: 'VERIFIED' },
    listing: {
      id: 'listing-math',
      subjectId: 'math',
      subjectName: 'Mathematics',
      gradeLevelId: 'g10',
      gradeLevelName: 'Grade 10',
      pricePerHour: '450.00',
      description: 'Mathematics lessons',
    },
    slot: {
      id: `slot-${id}`,
      startAtUtc,
      endAtUtc: new Date(Date.parse(startAtUtc) + 3_600_000).toISOString(),
    },
    subtotalAmount: '450.00',
    discountAmount: '0.00',
    netAmount: '450.00',
    currency: 'THB',
    createdAt: '2026-10-01T00:00:00Z',
  };
}

async function mockDashboard(
  page: Page,
  items: BookingView[],
  options: { language?: 'en' | 'th'; gate?: Promise<void>; fail?: boolean } = {},
) {
  const calls: URL[] = [];
  await page.clock.setFixedTime(now);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page
    .context()
    .addCookies([
      { name: 'hktutor_refresh', value: 'student-ui-session', url: 'http://localhost:3000' },
    ]);
  await page.addInitScript(
    (language) => localStorage.setItem('hktutor-language', language),
    options.language ?? 'en',
  );
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    if (path === '/auth/refresh') {
      return route.fulfill({
        json: {
          accessToken: 'student-ui-token',
          user: {
            id: 'student-ui',
            email: 'student@example.test',
            role: 'STUDENT',
            displayName: 'Nan',
          },
        },
      });
    }
    if (path === '/profiles/me') {
      return route.fulfill({
        json: {
          role: 'STUDENT',
          consentCurrent: true,
          profileComplete: true,
          policyVersion: '2026-01',
          profile: {
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
    if (path === '/bookings/me') {
      calls.push(url);
      await options.gate;
      return route.fulfill({
        status: options.fail ? 500 : 200,
        json: options.fail ? { message: 'Service unavailable' } : { items, total: 999 },
      });
    }
    const detail = items.find((item) => path === `/bookings/me/${encodeURIComponent(item.id)}`);
    if (detail) {
      return route.fulfill({ json: { ...detail, updatedAt: detail.createdAt } });
    }
    return route.fulfill({ status: 500, json: { message: `Unexpected UI request: ${path}` } });
  });
  return calls;
}

async function expectResponsiveShell(page: Page) {
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
  if ((page.viewportSize()?.width ?? 0) < 1024) {
    await page.getByRole('button', { name: /^(Open sidebar|เปิดแถบข้าง)$/ }).click();
    await expect(page.locator('#dashboard-sidebar')).toBeVisible();
    await page
      .locator('#dashboard-sidebar')
      .getByRole('button', { name: /^(Close sidebar|ปิดแถบข้าง)$/ })
      .click();
  } else {
    await expect(page.locator('#dashboard-sidebar')).toBeVisible();
  }
}

test('earliest future pending booking remains next, with honest status and loaded-record counts', async ({
  page,
}) => {
  const calls = await mockDashboard(page, [
    booking('later', 'later', 'Later confirmed tutor', 'CONFIRMED', '2026-10-05T10:00:00Z'),
    booking('at-now', 'boundary', 'Already started tutor', 'CONFIRMED', now.toISOString()),
    booking('canceled', 'canceled', 'Canceled tutor', 'CANCELED', '2026-10-05T02:30:00Z'),
    booking('next', 'next', 'Pending tutor', 'PENDING', '2026-10-05T03:00:00Z'),
    booking('old-pending', 'old', 'Past tutor', 'PENDING', '2026-10-01T03:00:00Z'),
    booking('complete', 'completed', 'Completed tutor', 'COMPLETED', '2026-10-02T03:00:00Z'),
  ]);
  await page.goto('/dashboard');
  const next = page.getByRole('region', { name: 'Next booking', exact: true });
  await expect(next.getByRole('heading', { level: 3 })).toHaveText('Pending tutor');
  await expect(next.getByText('PENDING', { exact: true })).toBeVisible();
  await expect(next.getByText('This request is pending')).toBeVisible();
  await expect(next.getByText('Your booking is confirmed')).toHaveCount(0);
  await expect(next).toContainText('10:00 – 11:00');
  await expect(next).toContainText('5 Oct 2026');
  const summary = page.getByRole('region', { name: 'Booking overview', exact: true });
  await expect(summary.locator('dd')).toHaveText(['2', '2', '1']);
  await expect(summary).toContainText('up to 100 records');
  await expect(page.locator('input[type="search"]')).toHaveCount(0);
  await expect(page.locator('header a[href="/tutors"]')).toHaveCount(1);
  // Development effect replay and restoring a saved language may repeat the original load.
  expect(calls.length).toBeGreaterThan(0);
  for (const call of calls) {
    expect(call.searchParams.toString()).toBe('pageSize=100');
  }
  await expectResponsiveShell(page);
});

test('confirmed cross-midnight booking shows Bangkok date range and confirmation copy', async ({
  page,
}) => {
  await mockDashboard(page, [
    booking('overnight', 'overnight', 'Confirmed tutor', 'CONFIRMED', '2026-10-05T16:30:00Z'),
  ]);
  await page.goto('/dashboard');
  const next = page.getByRole('region', { name: 'Next booking', exact: true });
  await expect(next.getByText('CONFIRMED', { exact: true })).toBeVisible();
  await expect(next.getByText('Your booking is confirmed')).toBeVisible();
  await expect(next).toContainText('23:30 – 00:30');
  await expect(next).toContainText(/5\s*–\s*6 Oct 2026/);
  await expect(page.getByRole('navigation', { name: 'Tutor index pages' })).toHaveCount(0);
});

test('right sheet paginates loaded tutors with keyboard and preserves original booking links', async ({
  page,
}) => {
  const items = Array.from({ length: 11 }, (_, index) =>
    booking(
      `booking-${index}`,
      `tutor-${index}`,
      `Tutor ${String(index + 1).padStart(2, '0')}`,
      'CONFIRMED',
    ),
  );
  // The existing Map keeps first tutor order and the last booking for a repeated tutor.
  items.push(
    booking('latest/booking', 'tutor-0', 'Tutor 01 latest', 'COMPLETED', '2026-10-01T03:00:00Z'),
  );
  const calls = await mockDashboard(page, items);
  await page.goto('/dashboard');
  const index = page.getByRole('region', { name: 'Tutors from your bookings', exact: true });
  const pages = index.getByRole('navigation', { name: 'Tutor index pages' });
  const nextBooking = page.getByRole('region', { name: 'Next booking', exact: true });
  await expect(index.getByRole('listitem')).toHaveCount(4);
  await expect(index.getByRole('link').first()).toHaveAttribute(
    'href',
    '/dashboard/bookings/latest%2Fbooking',
  );
  await expect(pages).toContainText('1–4 / 11');
  await expect(pages.getByRole('button', { name: 'Previous', exact: true })).toBeDisabled();
  const initialCallCount = calls.length;
  const leftBefore = await nextBooking.innerText();
  const next = pages.getByRole('button', { name: 'Next', exact: true });
  await next.focus();
  await page.keyboard.press('Enter');
  await expect(pages).toContainText('Page 2 of 3');
  await expect(index.getByRole('link').first()).toContainText('Tutor 05');
  await expect(next).toBeFocused();
  await page.keyboard.press('Space');
  await expect(index.getByRole('listitem')).toHaveCount(3);
  await expect(pages).toContainText('9–11 / 11');
  await expect(next).toBeDisabled();
  expect(await nextBooking.innerText()).toBe(leftBefore);
  expect(calls).toHaveLength(initialCallCount);
  await pages.getByRole('button', { name: 'Previous', exact: true }).click();
  await pages.getByRole('button', { name: 'Previous', exact: true }).click();
  await expect(pages).toContainText('Page 1 of 3');
  const link = index.getByRole('link').first();
  await page.keyboard.press('Tab');
  await link.focus();
  await expect(link).toHaveCSS('outline-style', 'solid');
  await expect(link).toHaveCSS('transition-property', 'none');
  await expectResponsiveShell(page);
  await index.getByRole('link').nth(1).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/dashboard\/bookings\/booking-1$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tutor 02');
});

for (const fail of [false, true]) {
  test(`loading keeps shell and counts unavailable before ${fail ? 'error' : 'successful empty response'}`, async ({
    page,
  }) => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await mockDashboard(page, [], { gate, fail });
    try {
      await page.goto('/dashboard');
      await expect(page.locator('[data-loading-kind="studentDashboard"]')).toBeVisible();
      await expect(page.getByRole('region', { name: 'Booking overview', exact: true })).toHaveCount(
        0,
      );
      await expectResponsiveShell(page);
      if ((page.viewportSize()?.width ?? 0) < 1024) {
        await page.getByRole('button', { name: 'Open sidebar', exact: true }).click();
      }
      await expect(page.locator('#dashboard-sidebar a[href="/dashboard/bookings"]')).toContainText(
        '—',
      );
      if ((page.viewportSize()?.width ?? 0) < 1024) {
        await page
          .locator('#dashboard-sidebar')
          .getByRole('button', { name: 'Close sidebar', exact: true })
          .click();
      }
      release();
      await expect(page.locator('[data-loading-kind]')).toHaveCount(0);
      if (fail) {
        await expect(page.locator('main').getByRole('alert')).toContainText(
          'We could not load your dashboard summary.',
        );
        await expect(
          page.getByRole('region', { name: 'Booking overview', exact: true }),
        ).toHaveCount(0);
      } else {
        await expect(
          page.getByRole('region', { name: 'Booking overview', exact: true }).locator('dd'),
        ).toHaveText(['0', '0', '0']);
        await expect(page.getByText('No tutors in your loaded bookings.')).toBeVisible();
        await expect(page.getByRole('navigation', { name: 'Tutor index pages' })).toHaveCount(0);
      }
    } finally {
      release();
    }
  });
}

test('no next booking retains past pending and completed counts without a confirmation memo', async ({
  page,
}) => {
  await mockDashboard(page, [
    booking('past-pending', 'past', 'Past pending tutor', 'PENDING', '2026-10-01T03:00:00Z'),
    booking('completed', 'completed', 'Completed tutor', 'COMPLETED', '2026-10-02T03:00:00Z'),
  ]);
  await page.goto('/dashboard');
  await expect(page.getByText('No upcoming lessons scheduled.')).toBeVisible();
  await expect(page.getByText('Your booking is confirmed')).toHaveCount(0);
  await expect(
    page.getByRole('region', { name: 'Booking overview', exact: true }).locator('dd'),
  ).toHaveText(['0', '1', '1']);
  await expect(
    page
      .getByRole('region', { name: 'Tutors from your bookings', exact: true })
      .getByRole('listitem'),
  ).toHaveCount(2);
});

for (const language of ['en', 'th'] as const) {
  test(`${language} long tutor and subject names remain readable across notebook sheets`, async ({
    page,
  }, testInfo) => {
    const items = Array.from({ length: 11 }, (_, index) => ({
      ...booking(
        `long-${index}`,
        `tutor-${index}`,
        language === 'th'
          ? `ครู${index + 1} อาจารย์ผู้สอนคณิตศาสตร์และวิทยาศาสตร์เพื่อเตรียมสอบเข้ามหาวิทยาลัย`
          : `Tutor ${index + 1} MathematicsAndSciencePreparationWithAVeryLongUnbrokenDisplayName`,
        'PENDING',
      ),
      listing: {
        ...booking('base', 'base', 'Base', 'PENDING').listing,
        subjectName:
          language === 'th'
            ? 'คณิตศาสตร์ประยุกต์และวิทยาศาสตร์สำหรับการเตรียมสอบ'
            : 'AdvancedMathematicsAndScientificReasoning',
        gradeLevelName:
          language === 'th'
            ? 'ระดับมัธยมศึกษาตอนปลายเตรียมเข้ามหาวิทยาลัย'
            : 'UniversityEntrancePreparation',
      },
    }));
    await mockDashboard(page, items, { language });
    await page.goto('/dashboard');
    const index = page.getByRole('region', {
      name: language === 'th' ? 'ติวเตอร์จากการจอง' : 'Tutors from your bookings',
      exact: true,
    });
    await expect(index.getByRole('listitem')).toHaveCount(4);
    await expect(
      page.getByText(language === 'th' ? 'คำขอนี้ยังไม่ยืนยัน' : 'This request is pending'),
    ).toBeVisible();
    await expectResponsiveShell(page);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: testInfo.outputPath(`student-desk-spread-${language}-long.png`),
      fullPage: true,
      animations: 'disabled',
    });
  });
}
