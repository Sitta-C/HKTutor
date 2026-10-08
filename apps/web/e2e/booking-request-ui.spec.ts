import { expect, test } from '@playwright/test';

import type { BookingQuote, BookingResponse, BookingStatus } from '@/lib/api/types';
import type { Page } from '@playwright/test';

// Preview data only. All API traffic is intercepted; no booking reaches a real backend.
const quote: BookingQuote = {
  tutor: { tutorId: 'tutor/preview', displayName: 'Teacher Praew', verificationStatus: 'VERIFIED' },
  listing: {
    id: 'course/preview',
    subjectId: 'math',
    subjectName: 'Mathematics',
    gradeLevelId: 'grade-10',
    gradeLevelName: 'Grade 10',
    pricePerHour: '500.00',
    description:
      'Build confidence with functions and equations.\nWork through questions step by step.',
  },
  slot: {
    id: 'slot/preview',
    startAtUtc: '2026-10-12T03:00:00Z',
    endAtUtc: '2026-10-12T04:30:00Z',
  },
  subtotalAmount: '750.00',
  discountAmount: '0.00',
  netAmount: '750.00',
  currency: 'THB',
};
const created: BookingResponse = {
  id: 'booking/preview',
  listingId: quote.listing.id,
  slotId: quote.slot.id,
  status: 'PENDING',
  subtotalAmount: '735.00',
  discountAmount: '5.00',
  netAmount: '730.00',
  currency: 'THB',
  createdAt: '2026-10-07T07:20:00Z',
};
const requestPath = '/dashboard/bookings/new?listingId=course%2Fpreview&slotId=slot%2Fpreview';

async function mockRequest(
  page: Page,
  options: {
    language?: 'th' | 'en';
    quote?: BookingQuote;
    quoteStatus?: number;
    submitStatus?: number;
    status?: BookingStatus;
    quoteGate?: Promise<void>;
    submitGate?: Promise<void>;
  } = {},
) {
  const reads: URL[] = [];
  const writes: unknown[] = [];
  const unexpected: string[] = [];
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(
    (language) => localStorage.setItem('hktutor-language', language),
    options.language ?? 'en',
  );
  await page
    .context()
    .addCookies([
      { name: 'hktutor_refresh', value: 'booking-preview', url: 'http://localhost:3000' },
    ]);
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1', '');
    if (path === '/auth/refresh')
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
    if (path === '/profiles/me')
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
    if (path === '/profiles/me/avatar') return route.fulfill({ json: { avatar: null } });
    if (path === '/bookings/me') return route.fulfill({ json: { items: [], total: 5 } });
    if (path === '/bookings/quote') {
      reads.push(url);
      await options.quoteGate;
      return route.fulfill({
        status: options.quoteStatus ?? 200,
        json: options.quoteStatus ? { message: 'Preview error' } : (options.quote ?? quote),
      });
    }
    if (path === '/bookings' && request.method() === 'POST') {
      writes.push(request.postDataJSON());
      await options.submitGate;
      return route.fulfill({
        status: options.submitStatus ?? 201,
        json: options.submitStatus
          ? { message: 'Preview error' }
          : { ...created, status: options.status ?? 'PENDING' },
      });
    }
    if (path === '/bookings/me/booking%2Fpreview' || path === '/bookings/me/booking%252Fpreview')
      return route.fulfill({ json: { ...quote, ...created, updatedAt: created.createdAt } });
    unexpected.push(`${request.method()} ${path}`);
    return route.fulfill({ status: 404, json: { message: 'Unexpected preview request' } });
  });
  return { reads, writes, unexpected };
}

async function expectNoOverflow(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(1);
  const overflow = await page.locator('main').evaluate((main) =>
    Array.from(main.querySelectorAll<HTMLElement>('section, button, a, [data-booking-summary]'))
      .filter((el) => el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 2)
      .map((el) => el.textContent),
  );
  expect(overflow).toEqual([]);
}

test('quote loading retains the shell and does not show a zero amount', async ({
  page,
}, testInfo) => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const calls = await mockRequest(page, { quoteGate: gate });
  await page.goto(requestPath);
  await expect(page.locator('header')).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Loading the course, time and amount');
  await expect(page.locator('[data-booking-summary]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send lesson request' })).toHaveCount(0);
  release();
  await expect(page.getByText('Verified tutor', { exact: true })).toBeVisible();
  await expect(page.locator('header a[href="/tutors"]')).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath('booking-request-actions.png'),
    fullPage: true,
  });
  expect(calls.reads).toHaveLength(2); // Existing quote effect runs twice under development StrictMode.
  expect(Array.from(calls.reads[0]?.searchParams.keys() ?? []).sort()).toEqual([
    'listingId',
    'slotId',
  ]);
  expect(calls.writes).toHaveLength(0);
  expect(calls.unexpected).toEqual([]);
});

for (const language of ['en', 'th'] as const) {
  for (const width of [320, 768, 1440]) {
    test(`${language} docket has readable long content at ${width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1100 });
      const longQuote = {
        ...quote,
        tutor: {
          ...quote.tutor,
          displayName: 'Teacher Praew Pimchanok Wattanapipatkul — ครูแพรว พิมพ์ชนก วัฒนพิพัฒนกุล',
        },
        listing: {
          ...quote.listing,
          subjectName: 'Further Mathematics — คณิตศาสตร์เพิ่มเติม: ฟังก์ชัน สมการ และโจทย์ประยุกต์',
          description: quote.listing.description.repeat(4),
        },
        slot: {
          ...quote.slot,
          startAtUtc: '2026-12-31T16:30:00Z',
          endAtUtc: '2026-12-31T18:00:00Z',
        },
      };
      const calls = await mockRequest(page, { language, quote: longQuote });
      await page.goto(requestPath);
      await expect(
        page.getByRole('button', {
          name: language === 'th' ? 'ส่งคำขอเรียน' : 'Send lesson request',
        }),
      ).toBeVisible();
      await expect(page.locator('[data-booking-summary]')).toContainText('23:30');
      await expect(page.locator('[data-booking-summary]')).toContainText(
        language === 'th' ? '2570' : '2027',
      );
      await expectNoOverflow(page);
      await page
        .getByRole('link', { name: language === 'th' ? 'ย้อนกลับ' : 'Back', exact: true })
        .focus();
      expect(
        await page.evaluate(() => getComputedStyle(document.activeElement as Element).outlineStyle),
      ).toBe('solid');
      const summary = page.locator('[data-booking-summary]');
      const children = await summary
        .locator(':scope > div')
        .evaluateAll((elements) => elements.map((el) => el.getBoundingClientRect().toJSON()));
      if (width === 320) expect(children[1]?.y).toBeGreaterThan(children[0]?.y ?? 0);
      if (width === 1440) expect(children[1]?.x).toBeGreaterThan(children[0]?.x ?? 0);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: testInfo.outputPath(`booking-request-${language}-${width}.png`),
        fullPage: true,
      });
      expect(calls.reads).toHaveLength(2);
      expect(calls.unexpected).toEqual([]);
    });
  }
}

test('submit gate sends only one mutation and success uses created amounts and pending status', async ({
  page,
}) => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const calls = await mockRequest(page, { submitGate: gate });
  await page.goto(requestPath);
  const send = page.getByRole('button', { name: 'Send lesson request' });
  await expect(send).toBeVisible();
  await send.evaluate((button) => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });
  await expect(page.getByRole('button', { name: 'Sending request…' })).toBeDisabled();
  await expect.poll(() => calls.writes.length).toBe(1);
  expect(calls.writes).toEqual([{ listingId: quote.listing.id, slotId: quote.slot.id }]);
  release();
  await expect(page.getByRole('heading', { name: 'Lesson request sent' })).toBeVisible();
  await expect(page.locator('main').getByRole('status')).toContainText(
    'Awaiting tutor confirmation',
  );
  await expect(page.locator('[data-notebook-toast="success"]')).toHaveText('Lesson request sent');
  await expect(page.locator('main')).toContainText('730.00');
  await expect(page.locator('main')).toContainText('735.00 THB');
  await expect(page.locator('main')).toContainText('5.00 THB');
  await expect(page.locator('main')).not.toContainText('750.00');
  await expect(page.getByRole('button', { name: 'Send lesson request' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Back to my bookings' })).toHaveAttribute(
    'href',
    '/dashboard/bookings',
  );
  await page.getByRole('button', { name: 'View booking details' }).click();
  await expect(page).toHaveURL(/\/dashboard\/bookings\/booking%2Fpreview$/);
  expect(calls.writes).toHaveLength(1);
  expect(calls.unexpected).toEqual([]);
});

for (const language of ['en', 'th'] as const) {
  for (const width of [320, 768, 1440]) {
    test(`${language} loading, submitting, conflict and success fit ${width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      let releaseQuote = () => {};
      let releaseSubmit = () => {};
      const quoteGate = new Promise<void>((resolve) => {
        releaseQuote = resolve;
      });
      const submitGate = new Promise<void>((resolve) => {
        releaseSubmit = resolve;
      });
      const scenario: {
        language: 'th' | 'en';
        quoteGate: Promise<void>;
        submitGate: Promise<void>;
        submitStatus?: number;
      } = { language, quoteGate, submitGate, submitStatus: 409 };
      const calls = await mockRequest(page, scenario);
      await page.goto(requestPath);
      await expect(page.locator('main').getByRole('status')).toBeVisible();
      await expectNoOverflow(page);
      await expect(
        page.locator('#dashboard-sidebar a[href="/dashboard/bookings"]'),
      ).not.toContainText('0');
      releaseQuote();
      const sendName = language === 'th' ? 'ส่งคำขอเรียน' : 'Send lesson request';
      await page.getByRole('button', { name: sendName }).click();
      await expect(
        page.getByRole('button', {
          name: language === 'th' ? 'กำลังส่งคำขอ…' : 'Sending request…',
        }),
      ).toBeDisabled();
      await expectNoOverflow(page);
      releaseSubmit();
      await expect(page.locator('main').getByRole('alert')).toContainText(
        language === 'th' ? 'ช่วงเวลานี้ไม่ว่างแล้ว' : 'This time is no longer available',
      );
      await expectNoOverflow(page);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: testInfo.outputPath(`booking-conflict-${language}-${width}.png`),
        fullPage: true,
      });
      delete scenario.submitStatus;
      await page.getByRole('button', { name: sendName }).click();
      await expect(page.locator('main').getByRole('status')).toContainText(
        language === 'th' ? 'รอติวเตอร์ยืนยัน' : 'Awaiting tutor confirmation',
      );
      await expectNoOverflow(page);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: testInfo.outputPath(`booking-success-${language}-${width}.png`),
        fullPage: true,
      });
      expect(calls.writes).toHaveLength(2); // One failed attempt and one explicit retry.
      expect(calls.unexpected).toEqual([]);
    });
  }
}

test('selectionKey hides the previous quote while the new selection loads', async ({ page }) => {
  await mockRequest(page);
  await page.goto(requestPath);
  await expect(page.getByText('Verified tutor', { exact: true })).toBeVisible();
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/bookings/quote?*slotId=another-slot', async (route) => {
    await gate;
    await route.fulfill({
      json: { ...quote, slot: { ...quote.slot, id: 'another-slot' }, netAmount: '620.00' },
    });
  });
  await page.evaluate(() =>
    window.history.pushState(
      null,
      '',
      '/dashboard/bookings/new?listingId=course%2Fpreview&slotId=another-slot',
    ),
  );
  await expect(page.locator('main').getByRole('status')).toContainText('Loading');
  await expect(page.locator('[data-booking-summary]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send lesson request' })).toHaveCount(0);
  release();
  await expect(page.locator('main')).toContainText('620.00');
});

for (const status of ['CONFIRMED', 'COMPLETED', 'CANCELED', 'EXPIRED'] as const) {
  test(`submitted response preserves ${status} without awaiting confirmation copy`, async ({
    page,
  }) => {
    await mockRequest(page, { status });
    await page.goto(requestPath);
    await page.getByRole('button', { name: 'Send lesson request' }).click();
    await expect(page.locator('main').getByRole('status')).toContainText(
      status[0] + status.slice(1).toLowerCase(),
    );
    await expect(page.locator('main')).not.toContainText('awaiting the tutor');
    await expect(page.locator('main')).not.toContainText('paid');
  });
}

for (const status of [500, 409, 401]) {
  test(`submit ${status} keeps review and its original recovery`, async ({ page }) => {
    const calls = await mockRequest(page, { submitStatus: status });
    await page.goto(requestPath);
    await page.getByRole('button', { name: 'Send lesson request' }).click();
    if (status === 401) {
      // Existing authenticatedFetch retries after refresh, then expires the session on another 401.
      await expect(page).toHaveURL('http://localhost:3000/');
      await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
      await expect(page.locator('[data-notebook-toast="error"]')).toHaveCount(1);
      expect(calls.writes).toHaveLength(2);
      return;
    }
    await expect(page.locator('main').getByRole('alert')).toBeVisible();
    await expect(page.locator('[data-notebook-toast="error"]')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Send lesson request' })).toBeEnabled();
    await expect(page.getByRole('link', { name: 'Back', exact: true })).toHaveAttribute(
      'href',
      '/tutors/tutor%2Fpreview?listingId=course%2Fpreview',
    );
    if (status === 409)
      await expect(page.getByRole('link', { name: 'Choose another time' })).toHaveAttribute(
        'href',
        '/tutors/tutor%2Fpreview?listingId=course%2Fpreview&conflict=1',
      );
    expect(calls.writes).toHaveLength(1);
    await expectNoOverflow(page);
  });
}

for (const status of [400, 401, 403, 404, 409, 500]) {
  test(`quote ${status} retains error recovery and hides review amounts`, async ({ page }) => {
    const calls = await mockRequest(page, { quoteStatus: status });
    await page.goto(requestPath);
    if (status === 401) {
      await expect(page).toHaveURL('http://localhost:3000/');
      await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
      expect(calls.writes).toHaveLength(0);
      return;
    }
    await expect(page.locator('main').getByRole('alert')).toBeVisible();
    await expect(page.locator('[data-booking-summary]')).toHaveCount(0);
    await expect(
      page.getByRole('link', { name: 'Find another tutor', exact: true }),
    ).toHaveAttribute('href', '/tutors');
    expect(calls.writes).toHaveLength(0);
  });
}

test('missing selection does not quote or submit and absent verification is unavailable', async ({
  page,
}) => {
  const calls = await mockRequest(page, {
    quote: {
      ...quote,
      tutor: { tutorId: quote.tutor.tutorId, displayName: quote.tutor.displayName },
    },
  });
  await page.goto('/dashboard/bookings/new');
  await expect(page.locator('main').getByRole('alert')).toContainText('invalid');
  expect(calls.reads).toHaveLength(0);
  await page.goto(requestPath);
  await expect(page.getByText('Verification information unavailable')).toBeVisible();
  await expect(page.getByText('Verified tutor', { exact: true })).toHaveCount(0);
  expect(calls.writes).toHaveLength(0);
});
