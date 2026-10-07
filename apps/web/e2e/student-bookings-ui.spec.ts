import { expect, test } from '@playwright/test';

import type { BookingDetail, BookingStatus } from '@/lib/api/types';
import type { Page } from '@playwright/test';

// Preview fixtures only. Every API call is intercepted; no real booking is read or written.
const base: BookingDetail = {
  id: 'preview/booking',
  status: 'PENDING',
  tutor: { tutorId: 'preview-tutor', displayName: 'Teacher Praew', verificationStatus: 'VERIFIED' },
  listing: {
    id: 'preview-listing',
    subjectId: 'math',
    subjectName: 'Mathematics',
    gradeLevelId: 'grade-10',
    gradeLevelName: 'Grade 10',
    pricePerHour: '999.00', // Current course rate deliberately differs from the persisted amounts.
    description: 'Review concepts and work through questions step by step.',
  },
  slot: {
    id: 'preview-slot',
    startAtUtc: '2026-10-12T03:00:00Z',
    endAtUtc: '2026-10-12T04:30:00Z',
  },
  subtotalAmount: '735.00',
  discountAmount: '5.00',
  netAmount: '730.00',
  currency: 'THB',
  createdAt: '2026-10-07T07:20:00Z',
  updatedAt: '2026-10-07T07:20:00Z',
};
const detailPath = '/dashboard/bookings/preview%2Fbooking';
const statuses: BookingStatus[] = ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELED', 'EXPIRED'];

async function mockBookings(
  page: Page,
  options: {
    language?: 'th' | 'en';
    detail?: BookingDetail;
    listStatus?: number;
    detailStatus?: number;
    empty?: boolean;
    listGate?: Promise<void>;
    detailGate?: Promise<void>;
    alternateGate?: Promise<void>;
  } = {},
) {
  const reads: URL[] = [];
  const unexpected: string[] = [];
  const detail = options.detail ?? base;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(
    (language) => localStorage.setItem('hktutor-language', language),
    options.language ?? 'en',
  );
  await page
    .context()
    .addCookies([
      { name: 'hktutor_refresh', value: 'bookings-preview', url: 'http://localhost:3000' },
    ]);
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1', '');
    if (path === '/auth/refresh') {
      return route.fulfill({
        json: {
          accessToken: 'preview-token',
          user: {
            id: 'preview-student',
            email: 'student@example.test',
            role: 'STUDENT',
            displayName: 'Mint',
          },
        },
      });
    }
    if (path === '/profiles/me') {
      return route.fulfill({
        json: {
          role: 'STUDENT',
          consentCurrent: true,
          policyVersion: '2026-01',
          profileComplete: true,
          profile: {
            firstName: 'Mint',
            lastName: 'Preview',
            nickname: 'Mint',
            school: 'Preview school',
            gradeLevel: 'Grade 10',
            phone: '0812345678',
          },
        },
      });
    }
    if (path === '/profiles/me/avatar') return route.fulfill({ json: { avatar: null } });
    if (path === '/bookings/me') {
      reads.push(url);
      await options.listGate;
      if (options.listStatus)
        return route.fulfill({ status: options.listStatus, json: { message: 'Preview error' } });
      const status = url.searchParams.get('status');
      // Deliberately unsorted lesson dates; the UI must keep this API order.
      const all = Array.from({ length: 13 }, (_, i) => ({
        ...detail,
        id: i === 0 ? detail.id : `preview-${i}`,
        status: statuses[i % statuses.length],
        tutor: { ...detail.tutor, displayName: `${detail.tutor.displayName} ${i}` },
        slot: {
          ...detail.slot,
          startAtUtc: i === 1 ? '2026-10-02T03:00:00Z' : detail.slot.startAtUtc,
        },
      }));
      const items = options.empty ? [] : all.filter((item) => !status || item.status === status);
      const offset = (Number(url.searchParams.get('page')) - 1) * 10;
      return route.fulfill({
        json: { items: items.slice(offset, offset + 10), total: items.length },
      });
    }
    if (path.startsWith('/bookings/me/')) {
      reads.push(url);
      if (path.endsWith('/alternate')) {
        await options.alternateGate;
        return route.fulfill({
          json: {
            ...detail,
            id: 'alternate',
            tutor: { ...detail.tutor, displayName: 'Alternate tutor' },
          },
        });
      }
      await options.detailGate;
      return route.fulfill({
        status: options.detailStatus ?? 200,
        json: options.detailStatus ? { message: 'Preview error' } : detail,
      });
    }
    unexpected.push(`${request.method()} ${path}`);
    return route.fulfill({ status: 404, json: { message: 'Unexpected preview request' } });
  });
  return { reads, unexpected };
}

async function noOverflow(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
  expect(
    await page.locator('main').evaluate((main) =>
      Array.from(
        main.querySelectorAll<HTMLElement>(
          'section, article, button, a, dl, [data-booking-summary]',
        ),
      )
        .filter(
          (element) => element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 2,
        )
        .map((element) => element.textContent),
    ),
  ).toEqual([]);
}

for (const language of ['en', 'th'] as const) {
  for (const width of [320, 768, 1440]) {
    test(`${language} Margin Index list/detail with long cross-day content at ${width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1100 });
      const detail = {
        ...base,
        tutor: {
          ...base.tutor,
          displayName: 'TeacherPraewPimchanokWattanapipatkul — ครูแพรว พิมพ์ชนก วัฒนพิพัฒนกุล',
        },
        listing: {
          ...base.listing,
          subjectName:
            'FurtherMathematicsFunctionsAndEquations — คณิตศาสตร์เพิ่มเติม ฟังก์ชันและสมการ',
          gradeLevelName: 'UniversityEntrancePreparation — เตรียมสอบเข้ามหาวิทยาลัย',
          description: base.listing.description.repeat(4),
        },
        slot: {
          ...base.slot,
          startAtUtc: '2026-12-31T16:30:00Z',
          endAtUtc: '2026-12-31T18:00:00Z',
        },
      };
      const calls = await mockBookings(page, { language, detail });
      await page.goto('/dashboard/bookings');
      await expect(page.locator('[data-booking-row]')).toHaveCount(10);
      const rowTag = page.locator('[data-booking-row]').first().locator('[data-booking-status]');
      await expect(rowTag).toHaveCSS('border-radius', '4px');
      await expect(rowTag.locator('svg')).toHaveAttribute('aria-hidden', 'true');
      await expect(page.locator('main')).toContainText(
        language === 'th' ? 'รอติวเตอร์ยืนยัน' : 'Awaiting tutor confirmation',
      );
      await expect(page.locator('[data-booking-row]').first()).toContainText('23:30');
      await expect(page.locator('[data-booking-row]').first()).toContainText(
        language === 'th' ? '2570' : '2027',
      );
      const filters = page.getByRole('group', {
        name: language === 'th' ? 'สถานะ' : 'Status',
        exact: true,
      });
      const boxes = await filters
        .getByRole('button')
        .evaluateAll((elements) => elements.map((el) => el.getBoundingClientRect().toJSON()));
      if (width === 320) {
        expect(boxes[0]?.y).toBe(boxes[1]?.y);
        expect(boxes[2]?.y).toBeGreaterThan(boxes[0]?.y ?? 0);
      } else {
        expect(boxes[1]?.y).toBeGreaterThan(boxes[0]?.y ?? 0);
      }
      for (const box of boxes) expect(box.height).toBeGreaterThanOrEqual(44);
      await filters.getByRole('button').first().focus();
      await expect(filters.getByRole('button').first()).toHaveCSS('outline-style', 'solid');
      const pagination = page.getByRole('navigation', {
        name: language === 'th' ? 'หน้ารายการจอง' : 'Booking pages',
      });
      const pageCount = pagination.getByText(language === 'th' ? 'หน้า 1 จาก 2' : 'Page 1 of 2', {
        exact: true,
      });
      await expect(pageCount).toBeVisible();
      const previous = pagination.getByRole('button', {
        name: language === 'th' ? 'ก่อนหน้า' : 'Previous',
        exact: true,
      });
      const next = pagination.getByRole('button', {
        name: language === 'th' ? 'ถัดไป' : 'Next',
        exact: true,
      });
      await expect(previous).toBeDisabled();
      await expect(next).toBeEnabled();
      await expect(next).toHaveCSS('border-left-style', 'dashed');
      await next.focus();
      await expect(next).toHaveCSS('outline-style', 'solid');
      const ticketBoxes = await pagination
        .getByRole('button')
        .evaluateAll((elements) => elements.map((el) => el.getBoundingClientRect().toJSON()));
      expect(ticketBoxes[0]?.right).toBe(ticketBoxes[1]?.left);
      expect(ticketBoxes[0]?.top).toBe(ticketBoxes[1]?.top);
      for (const box of ticketBoxes) expect(box.height).toBeGreaterThanOrEqual(48);
      const countBox = await pageCount.evaluate((el) => el.getBoundingClientRect().toJSON());
      const paperWidth = await pagination.evaluate(
        (el) => el.parentElement?.parentElement?.clientWidth ?? 0,
      );
      if (paperWidth > 450) {
        expect(countBox.right).toBeLessThan(ticketBoxes[0]?.left ?? 0);
        expect(countBox.top).toBeGreaterThan(ticketBoxes[0]?.top ?? 0);
      } else {
        expect(countBox.bottom).toBeLessThan(ticketBoxes[0]?.top ?? 0);
      }
      await noOverflow(page);
      await pagination.screenshot({
        path: testInfo.outputPath(`bookings-pagination-${language}-${width}.png`),
      });
      await page.screenshot({
        path: testInfo.outputPath(`bookings-list-${language}-${width}.png`),
        fullPage: true,
      });
      const link = page.locator('[data-booking-row]').first().getByRole('link');
      await expect(link).toHaveAttribute('href', detailPath);
      await link.focus();
      await expect(link).toHaveCSS('outline-style', 'solid');
      await page.keyboard.press('Enter');
      await expect(page.locator('[data-booking-summary]')).toBeVisible();
      await expect(page.locator('main [data-booking-status]')).toHaveCSS('border-radius', '4px');
      await expect(page.locator('main')).toContainText('735.00 THB');
      await expect(page.locator('main')).toContainText('5.00 THB');
      await expect(page.locator('main')).toContainText('730.00');
      await expect(page.locator('main')).not.toContainText('999.00');
      await expect(page.locator('[data-booking-summary] time')).toHaveCount(2);
      await expect(page.locator('[data-booking-summary]')).toContainText(
        language === 'th' ? '2570' : '2027',
      );
      await expect(
        page.getByRole('link', {
          name: language === 'th' ? 'กลับไปการจองของฉัน' : 'Back to my bookings',
          exact: true,
        }),
      ).toHaveAttribute('href', '/dashboard/bookings');
      await noOverflow(page);
      await page.screenshot({
        path: testInfo.outputPath(`bookings-detail-${language}-${width}.png`),
        fullPage: true,
      });
      expect(calls.unexpected).toEqual([]);
      expect(
        calls.reads
          .filter((url) => url.pathname === '/api/v1/bookings/me')
          .every((url) => url.searchParams.toString() === 'page=1&pageSize=10'),
      ).toBe(true);
    });
  }
}

test('server pagination/status filters preserve page size, order and reset to page one', async ({
  page,
}) => {
  const calls = await mockBookings(page);
  await page.goto('/dashboard/bookings');
  await expect(page.locator('[data-booking-row]')).toHaveCount(10);
  await expect(page.locator('[data-booking-row]').first()).toContainText('Teacher Praew 0');
  await expect(page.locator('[data-booking-row]').nth(1)).toContainText('Teacher Praew 1');
  const pagination = page.getByRole('navigation', { name: 'Booking pages' });
  await expect(pagination.getByRole('button', { name: 'Previous', exact: true })).toBeDisabled();
  await pagination.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('[data-booking-row]')).toHaveCount(3);
  await expect(page.locator('[data-booking-row]').first()).toContainText('Teacher Praew 10');
  await expect(pagination.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  await expect(pagination.getByText('Page 2 of 2', { exact: true })).toBeVisible();
  await pagination.getByRole('button', { name: 'Previous', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-booking-row]')).toHaveCount(10);
  await expect(pagination.getByText('Page 1 of 2', { exact: true })).toBeVisible();
  const labels = [
    'All',
    'Awaiting tutor confirmation',
    'Confirmed',
    'Completed',
    'Canceled',
    'Expired',
  ];
  const filters = page.getByRole('group', { name: 'Status', exact: true });
  for (const [index, label] of labels.entries()) {
    await filters.getByRole('button', { name: label, exact: true }).click();
    await expect(page.locator('[data-booking-count]')).toContainText(
      index === 0 ? '13 bookings' : index < 4 ? '3 bookings' : '2 bookings',
    );
    expect(calls.reads.at(-1)?.searchParams.get('page')).toBe('1');
    expect(calls.reads.at(-1)?.searchParams.get('pageSize')).toBe('10');
    expect(calls.reads.at(-1)?.searchParams.get('status')).toBe(
      index === 0 ? null : statuses[index - 1],
    );
  }
  expect(calls.unexpected).toEqual([]);
});

for (const outcome of ['empty', 'error'] as const) {
  test(`list loading keeps shell/count unavailable before ${outcome}; retry keeps the selected filter`, async ({
    page,
  }) => {
    let release = () => {};
    const listGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const options: { listGate: Promise<void>; empty: boolean; listStatus?: number } = {
      listGate,
      empty: outcome === 'empty',
    };
    if (outcome === 'error') options.listStatus = 500;
    const calls = await mockBookings(page, options);
    await page.goto('/dashboard/bookings');
    await expect(page.locator('header')).toBeVisible();
    await expect(page.locator('[data-booking-count]')).toHaveText('Booking count unavailable');
    await expect(
      page.locator('#dashboard-sidebar a[href="/dashboard/bookings"]'),
    ).not.toContainText('0');
    await expect(page.locator('main').getByRole('status')).toBeVisible();
    await expect(page.getByText('No bookings yet', { exact: true })).toHaveCount(0);
    release();
    if (outcome === 'empty') {
      await expect(page.locator('[data-booking-count]')).toContainText('0 bookings');
      await expect(page.getByText('No bookings yet', { exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Browse tutors', exact: true })).toHaveAttribute(
        'href',
        '/tutors',
      );
    } else {
      await expect(page.locator('main').getByRole('alert')).toBeVisible();
      await expect(page.locator('[data-booking-count]')).toHaveText('Booking count unavailable');
      delete options.listStatus;
      await page.getByRole('button', { name: 'Try again', exact: true }).click();
      await expect(page.locator('[data-booking-row]')).toHaveCount(10);
      await page
        .getByRole('group', { name: 'Status', exact: true })
        .getByRole('button', { name: 'Confirmed', exact: true })
        .click();
      await expect(page.locator('[data-booking-row]')).toHaveCount(3);
      expect(calls.reads.at(-1)?.searchParams.get('status')).toBe('CONFIRMED');
    }
    expect(calls.unexpected).toEqual([]);
  });
}

for (const status of [403, 404, 500]) {
  test(`detail ${status} keeps its resource error and back link without amounts`, async ({
    page,
  }) => {
    const calls = await mockBookings(page, { detailStatus: status });
    await page.goto(detailPath);
    await expect(page.locator('main').getByRole('alert')).toBeVisible();
    await expect(page.locator('[data-booking-summary]')).toHaveCount(0);
    await expect(
      page.getByRole('link', { name: 'Back to my bookings', exact: true }),
    ).toHaveAttribute('href', '/dashboard/bookings');
    await expect(
      page.locator('#dashboard-sidebar a[href="/dashboard/bookings"]'),
    ).not.toContainText('0');
    expect(calls.reads.every((url) => url.pathname.startsWith('/api/v1/bookings/me/'))).toBe(true);
    expect(calls.unexpected).toEqual([]);
  });
}

for (const route of ['/dashboard/bookings', detailPath]) {
  test(`unauthorized ${route} preserves session expiry`, async ({ page }) => {
    await mockBookings(page, { listStatus: 401, detailStatus: 401 });
    await page.goto(route);
    await expect(page).toHaveURL('http://localhost:3000/');
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  });
}

for (const status of statuses) {
  test(`detail ${status} uses the actual business status and persisted amounts`, async ({
    page,
  }) => {
    await mockBookings(page, {
      detail: {
        ...base,
        status,
        tutor: { tutorId: base.tutor.tutorId, displayName: base.tutor.displayName },
      },
    });
    await page.goto(detailPath);
    await expect(page.locator('[data-booking-summary]')).toBeVisible();
    await expect(page.locator('main')).toContainText(
      status === 'PENDING'
        ? 'Awaiting tutor confirmation'
        : status[0] + status.slice(1).toLowerCase(),
    );
    await expect(page.locator('main')).toContainText('Verification information unavailable');
    await expect(page.locator('main')).toContainText('730.00');
    await expect(page.locator('main')).not.toContainText('999.00');
    await expect(page.locator('main')).not.toContainText('paid');
    if (status !== 'PENDING')
      await expect(page.locator('main')).not.toContainText('Wait for the tutor');
  });
}

test('detail loading and resource changes hide the previous booking; midnight remains 24:00', async ({
  page,
}) => {
  let release = () => {};
  const detailGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let releaseAlternate = () => {};
  const alternateGate = new Promise<void>((resolve) => {
    releaseAlternate = resolve;
  });
  const detail = {
    ...base,
    slot: { ...base.slot, startAtUtc: '2026-10-12T16:00:00Z', endAtUtc: '2026-10-12T17:00:00Z' },
  };
  const calls = await mockBookings(page, { detail, detailGate, alternateGate });
  await page.goto(detailPath);
  await expect(page.locator('header')).toBeVisible();
  await expect(page.locator('main').getByRole('status')).toBeVisible();
  await expect(page.locator('[data-booking-summary]')).toHaveCount(0);
  release();
  await expect(page.locator('[data-booking-summary]')).toContainText('23:00–24:00');
  await expect(
    page.getByRole('group', { name: '12 Oct 2026 · 23:00 → 13 Oct 2026 · 00:00', exact: true }),
  ).toBeVisible();
  // A new detail resource also keeps its summary unavailable until its own response arrives.
  await page.goto('/dashboard/bookings/alternate');
  await expect(page.locator('main').getByRole('status')).toBeVisible();
  await expect(page.locator('[data-booking-summary]')).toHaveCount(0);
  releaseAlternate();
  await expect(page.locator('[data-booking-summary]')).toContainText('Alternate tutor');
  expect(calls.unexpected).toEqual([]);
});

test('switching filters back during a load keeps counts unavailable and ignores an older response', async ({
  page,
}) => {
  const options: { listGate?: Promise<void> } = {};
  await mockBookings(page, options);
  await page.goto('/dashboard/bookings');
  await expect(page.locator('[data-booking-row]')).toHaveCount(10);
  let releasePending = () => {};
  options.listGate = new Promise<void>((resolve) => {
    releasePending = resolve;
  });
  const filters = page.getByRole('group', { name: 'Status', exact: true });
  await filters.getByRole('button', { name: 'Awaiting tutor confirmation', exact: true }).click();
  await expect(page.locator('[data-booking-count]')).toHaveText('Booking count unavailable');
  let releaseAll = () => {};
  options.listGate = new Promise<void>((resolve) => {
    releaseAll = resolve;
  });
  await filters.getByRole('button', { name: 'All', exact: true }).click();
  await expect(page.locator('[data-booking-row]')).toHaveCount(0);
  await expect(page.locator('[data-booking-count]')).toHaveText('Booking count unavailable');
  releasePending();
  await expect(page.locator('[data-booking-count]')).toHaveText('Booking count unavailable');
  releaseAll();
  await expect(page.locator('[data-booking-row]')).toHaveCount(10);
  await expect(page.locator('[data-booking-count]')).toHaveText('13 bookings · All');
});

for (const language of ['en', 'th'] as const) {
  for (const width of [320, 768, 1440]) {
    test(`${language} loading/error/empty/not-found states fit ${width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1100 });
      let release = () => {};
      const options: {
        language: 'en' | 'th';
        listGate: Promise<void>;
        listStatus?: number;
        detailStatus: number;
        empty: boolean;
      } = {
        language,
        listGate: new Promise<void>((resolve) => {
          release = resolve;
        }),
        listStatus: 500,
        detailStatus: 404,
        empty: true,
      };
      await mockBookings(page, options);
      await page.goto('/dashboard/bookings');
      const count = page.locator('[data-booking-count]');
      await expect(count).toHaveText(
        language === 'th' ? 'ยังไม่ทราบจำนวนรายการจอง' : 'Booking count unavailable',
      );
      await expect(page.locator('main').getByRole('status')).toBeVisible();
      await noOverflow(page);
      release();
      await expect(page.locator('main').getByRole('alert')).toBeVisible();
      await noOverflow(page);
      delete options.listStatus;
      await page
        .getByRole('button', { name: language === 'th' ? 'ลองใหม่' : 'Try again', exact: true })
        .click();
      await expect(count).toContainText(language === 'th' ? '0 รายการ' : '0 bookings');
      await noOverflow(page);
      await page
        .getByRole('group', { name: language === 'th' ? 'สถานะ' : 'Status', exact: true })
        .getByRole('button', { name: language === 'th' ? 'ยืนยันแล้ว' : 'Confirmed', exact: true })
        .click();
      await expect(
        page.getByRole('heading', {
          name: language === 'th' ? 'ไม่มีรายการจองในสถานะนี้' : 'No bookings in this view',
          exact: true,
        }),
      ).toBeVisible();
      await noOverflow(page);
      await page.goto(detailPath);
      await expect(page.locator('main').getByRole('alert')).toBeVisible();
      await expect(page.locator('[data-booking-summary]')).toHaveCount(0);
      await noOverflow(page);
      await page.screenshot({
        path: testInfo.outputPath(`bookings-notfound-${language}-${width}.png`),
        fullPage: true,
      });
    });
  }
}
