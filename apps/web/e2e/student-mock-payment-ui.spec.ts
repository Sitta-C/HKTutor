import { expect, test } from '@playwright/test';

import type { BookingDetail, BookingStatus } from '@/lib/api/types';
import type { Page } from '@playwright/test';

const DETAIL_PATH = '/dashboard/bookings/mock-payment-booking';
const PAID_AT = '2026-10-14T12:52:00.000Z';
const BOOKING: BookingDetail = {
  id: 'mock-payment-booking',
  status: 'CONFIRMED',
  tutor: { tutorId: 'preview-tutor', displayName: 'Teacher Pim', verificationStatus: 'VERIFIED' },
  listing: {
    id: 'preview-listing',
    subjectId: 'math',
    subjectName: 'Mathematics',
    gradeLevelId: 'grade-10',
    gradeLevelName: 'Grade 10',
    pricePerHour: '999.00',
    description: 'Review functions and equations.',
  },
  slot: {
    id: 'preview-slot',
    startAtUtc: '2026-10-18T11:00:00Z',
    endAtUtc: '2026-10-18T12:30:00Z',
  },
  subtotalAmount: '735.00',
  discountAmount: '5.00',
  netAmount: '730.00',
  currency: 'THB',
  paymentStatus: 'UNPAID',
  paidAt: null,
  mockReference: null,
  createdAt: '2026-10-07T07:20:00Z',
  updatedAt: '2026-10-07T07:20:00Z',
};

// All API traffic is intercepted. These browser tests never create or pay a real booking.
async function mockPayments(
  page: Page,
  options: {
    language?: 'th' | 'en';
    status?: BookingStatus;
    paymentGate?: Promise<void>;
  } = {},
) {
  const state = {
    booking: { ...BOOKING, status: options.status ?? BOOKING.status },
    failure: null as { status: number; code: string } | null,
    loseResponse: false,
    failRefresh: false,
    payments: [] as unknown[],
    unexpected: [] as string[],
  };
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(
    (language) => localStorage.setItem('hktutor-language', language),
    options.language ?? 'en',
  );
  await page
    .context()
    .addCookies([
      { name: 'hktutor_refresh', value: 'mock-payment-preview', url: 'http://localhost:3000' },
    ]);
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
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
    if (path === '/bookings/mock-payment-booking/reschedule-requests/current') {
      return route.fulfill({ json: { request: null, targetSlot: null, allowedActions: [] } });
    }
    if (path === '/bookings/mock-payment-booking/class-details') {
      return route.fulfill({
        json: {
          bookingId: state.booking.id,
          status: state.booking.status,
          startAt: state.booking.slot.startAtUtc,
          endAt: state.booking.slot.endAtUtc,
          subject: {
            id: state.booking.listing.subjectId,
            name: state.booking.listing.subjectName,
          },
          meetingUrl: null,
          attendance: null,
          participants: {
            tutor: {
              id: state.booking.tutor.tutorId,
              detail: { displayName: state.booking.tutor.displayName },
            },
          },
        },
      });
    }
    if (path === '/bookings/me')
      return route.fulfill({ json: { items: [state.booking], total: 1 } });
    if (path === '/bookings/me/mock-payment-booking' && request.method() === 'GET') {
      return route.fulfill({
        status: state.failRefresh ? 500 : 200,
        json: state.failRefresh ? { message: 'Unavailable' } : state.booking,
      });
    }
    if (path === '/bookings/me/mock-payment-booking/mock-payment' && request.method() === 'POST') {
      const body: unknown = request.postDataJSON();
      state.payments.push(body);
      await options.paymentGate;
      if (state.failure)
        return route.fulfill({
          status: state.failure.status,
          json: { code: state.failure.code, message: 'Rejected' },
        });
      if (
        typeof body !== 'object' ||
        body === null ||
        !('reference' in body) ||
        typeof body.reference !== 'string'
      ) {
        throw new Error('Invalid mock-payment request');
      }
      state.booking = {
        ...state.booking,
        paymentStatus: 'PAID',
        paidAt: PAID_AT,
        mockReference: body.reference,
      };
      if (state.loseResponse) return route.abort('failed');
      return route.fulfill({
        json: {
          bookingId: state.booking.id,
          paymentStatus: state.booking.paymentStatus,
          amount: state.booking.netAmount,
          reference: state.booking.mockReference,
          paidAt: state.booking.paidAt,
        },
      });
    }
    state.unexpected.push(`${request.method()} ${path}`);
    return route.fulfill({ status: 404, json: { message: 'Unexpected preview request' } });
  });
  return state;
}

for (const language of ['th', 'en'] as const) {
  test(`${language}: pays once using server amounts and reads the receipt after reload and on the list`, async ({
    page,
  }) => {
    let release = () => {};
    const state = await mockPayments(page, {
      language,
      paymentGate: new Promise<void>((resolve) => {
        release = resolve;
      }),
    });
    await page.goto(DETAIL_PATH);
    const panel = page.getByRole('region', {
      name: language === 'th' ? 'ชำระเงินจำลอง' : 'Mock payment',
      exact: true,
    });
    const input = panel.getByRole('textbox');
    const submit = panel.getByRole('button', {
      name: language === 'th' ? 'บันทึกการชำระจำลอง' : 'Record mock payment',
      exact: true,
    });
    await input.fill('  เดโม-001  ');
    await submit.click();
    await expect(
      panel.getByRole('button', {
        name: language === 'th' ? 'กำลังบันทึก…' : 'Recording…',
        exact: true,
      }),
    ).toBeDisabled();
    await expect(input).toBeDisabled();
    await expect(
      panel.getByText(language === 'th' ? 'ยังไม่ชำระ' : 'Unpaid', { exact: true }),
    ).toBeVisible();
    await expect.poll(() => state.payments).toEqual([{ amount: '730.00', reference: 'เดโม-001' }]);
    release();
    await expect(
      panel.getByText(language === 'th' ? 'ชำระแล้ว' : 'Paid', { exact: true }),
    ).toBeVisible();
    await expect(panel).toContainText('730.00 THB');
    await expect(panel).toContainText('19:52');
    await expect(panel).toContainText(language === 'th' ? '2569' : '2026');
    await expect(input).toHaveCount(0);
    await page.reload();
    await expect(panel).toContainText('เดโม-001');
    await expect(panel.getByRole('textbox')).toHaveCount(0);
    await page
      .getByRole('link', {
        name: language === 'th' ? 'กลับไปการจองของฉัน' : 'Back to my bookings',
        exact: true,
      })
      .click();
    await expect(page.locator('[data-booking-row]')).toContainText(
      language === 'th' ? 'ชำระแล้ว' : 'Paid',
    );
    expect(state.payments).toHaveLength(1);
    expect(state.unexpected).toEqual([]);
  });
}

test('validates references locally and restores input focus after the server rejects a duplicate', async ({
  page,
}) => {
  const state = await mockPayments(page);
  await page.goto(DETAIL_PATH);
  const panel = page.getByRole('region', { name: 'Mock payment', exact: true });
  const input = panel.getByRole('textbox');
  const submit = panel.getByRole('button', { name: 'Record mock payment', exact: true });
  for (const blankReference of ['', '   ']) {
    await input.fill(blankReference);
    await submit.click();
    await expect(panel.getByRole('alert')).toHaveText('Enter a demo reference.');
    await expect(input).toBeFocused();
  }
  await input.fill('x'.repeat(65));
  await submit.click();
  await expect(panel.getByRole('alert')).toHaveText('Use single-line text of up to 64 characters.');
  expect(state.payments).toHaveLength(0);
  state.failure = { status: 409, code: 'MOCK_REFERENCE_TAKEN' };
  await input.fill('DEMO-USED');
  await submit.click();
  await expect(panel.getByRole('alert')).toContainText('already used');
  await expect(input).toBeEnabled();
  await expect(input).toBeFocused();
  await expect(panel.getByText('Unpaid', { exact: true })).toBeVisible();
  state.failure = null;
  await input.fill('DEMO-NEW');
  await submit.click();
  await expect(panel.getByText('Paid', { exact: true })).toBeVisible();
  expect(state.payments).toHaveLength(2);
});

for (const status of ['PENDING', 'CANCELED', 'COMPLETED', 'EXPIRED'] as const) {
  test(`${status} has no payment form`, async ({ page }) => {
    const state = await mockPayments(page, { status });
    await page.goto(DETAIL_PATH);
    const panel = page.getByRole('region', { name: 'Mock payment', exact: true });
    await expect(panel).toContainText(
      status === 'PENDING' ? 'Wait for tutor confirmation' : 'does not allow',
    );
    await expect(panel.getByRole('textbox')).toHaveCount(0);
    expect(state.payments).toHaveLength(0);
  });
}

for (const failure of [
  { status: 400, code: 'BOOKING_PAYMENT_AMOUNT_MISMATCH' },
  { status: 400, code: 'BOOKING_NOT_PAYABLE' },
  { status: 403, code: 'BOOKING_NOT_OWNED' },
  { status: 404, code: 'BOOKING_NOT_FOUND' },
  { status: 409, code: 'BOOKING_ALREADY_PAID' },
  { status: 409, code: 'BOOKING_NOT_PAYABLE' },
  { status: 409, code: 'BOOKING_PAYMENT_CONFLICT' },
]) {
  test(`${failure.status} ${failure.code} locks submission until a successful refresh`, async ({
    page,
  }) => {
    const state = await mockPayments(page);
    state.failure = failure;
    await page.goto(DETAIL_PATH);
    const panel = page.getByRole('region', { name: 'Mock payment', exact: true });
    const input = panel.getByRole('textbox');
    const submit = panel.getByRole('button', { name: 'Record mock payment', exact: true });
    await input.fill('DEMO-1');
    await submit.click();
    await expect(panel.getByRole('alert')).toBeVisible();
    if (failure.code === 'BOOKING_NOT_PAYABLE') {
      await expect(panel.getByRole('alert')).toHaveText(
        'The booking changed. Load the latest status.',
      );
    }
    await expect(panel.getByText('Unpaid', { exact: true })).toBeVisible();
    await expect(submit).toBeDisabled();
    await expect(input).toHaveValue('DEMO-1');
    state.failRefresh = true;
    await panel.getByRole('button', { name: 'Load latest status', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('Could not load');
    await expect(submit).toBeDisabled();
    state.failRefresh = false;
    state.booking = { ...state.booking, netAmount: '405.00' };
    await panel.getByRole('button', { name: 'Load latest status', exact: true }).click();
    await expect(submit).toBeEnabled();
    state.failure = null;
    await submit.click();
    await expect(panel.getByText('Paid', { exact: true })).toBeVisible();
    expect(state.payments).toEqual([
      { amount: '730.00', reference: 'DEMO-1' },
      { amount: '405.00', reference: 'DEMO-1' },
    ]);
  });
}

for (const latestStatus of ['PENDING', 'PAID'] as const) {
  test(`refreshing a ${latestStatus} conflict removes the payment form without a retry`, async ({
    page,
  }) => {
    const state = await mockPayments(page);
    state.failure = {
      status: latestStatus === 'PAID' ? 409 : 400,
      code: latestStatus === 'PAID' ? 'BOOKING_ALREADY_PAID' : 'BOOKING_NOT_PAYABLE',
    };
    await page.goto(DETAIL_PATH);
    const panel = page.getByRole('region', { name: 'Mock payment', exact: true });
    await panel.getByRole('textbox').fill('DEMO-STALE');
    await panel.getByRole('button', { name: 'Record mock payment', exact: true }).click();
    await expect(panel.getByRole('alert')).toBeVisible();
    await expect(panel.getByText('Unpaid', { exact: true })).toBeVisible();
    await expect(panel.getByRole('textbox')).toBeDisabled();
    state.booking =
      latestStatus === 'PAID'
        ? {
            ...state.booking,
            paymentStatus: 'PAID',
            mockReference: 'DEMO-OTHER-TAB',
            paidAt: PAID_AT,
          }
        : { ...state.booking, status: 'PENDING' };
    await panel.getByRole('button', { name: 'Load latest status', exact: true }).click();
    await expect(panel.getByRole('textbox')).toHaveCount(0);
    await expect(
      panel.getByRole('button', { name: 'Record mock payment', exact: true }),
    ).toHaveCount(0);
    await expect(panel).toContainText(
      latestStatus === 'PAID' ? 'DEMO-OTHER-TAB' : 'Wait for tutor confirmation',
    );
    await page.reload();
    await expect(panel).toContainText(
      latestStatus === 'PAID' ? 'DEMO-OTHER-TAB' : 'Wait for tutor confirmation',
    );
    expect(state.payments).toHaveLength(1);
    expect(state.unexpected).toEqual([]);
  });
}

test('a generic server validation error keeps the reference editable without retrying', async ({
  page,
}) => {
  const state = await mockPayments(page);
  state.failure = { status: 400, code: 'VALIDATION_FAILED' };
  await page.goto(DETAIL_PATH);
  const panel = page.getByRole('region', { name: 'Mock payment', exact: true });
  const input = panel.getByRole('textbox');
  const submit = panel.getByRole('button', { name: 'Record mock payment', exact: true });
  await input.fill('DEMO-VALIDATION');
  await submit.click();
  await expect(panel.getByRole('alert')).toHaveText(
    'Invalid payment details. Check the reference.',
  );
  await expect(input).toHaveValue('DEMO-VALIDATION');
  await expect(input).toBeEnabled();
  await expect(submit).toBeEnabled();
  await expect(panel.getByText('Unpaid', { exact: true })).toBeVisible();
  expect(state.payments).toHaveLength(1);
  expect(state.unexpected).toEqual([]);
});

test('a lost successful response requires a GET before retry and never resubmits automatically', async ({
  page,
}) => {
  const state = await mockPayments(page);
  state.loseResponse = true;
  await page.goto(DETAIL_PATH);
  const panel = page.getByRole('region', { name: 'Mock payment', exact: true });
  await panel.getByRole('textbox').fill('DEMO-LOST');
  await panel.getByRole('button', { name: 'Record mock payment', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('result is uncertain');
  await expect(
    panel.getByRole('button', { name: 'Record mock payment', exact: true }),
  ).toBeDisabled();
  await panel.getByRole('button', { name: 'Load latest status', exact: true }).click();
  await expect(panel.getByText('Paid', { exact: true })).toBeVisible();
  await expect(panel).toContainText('DEMO-LOST');
  expect(state.payments).toHaveLength(1);
});

for (const language of ['th', 'en'] as const) {
  for (const width of [320, 768, 1440]) {
    test(`${language} form and receipt fit ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1100 });
      await mockPayments(page, { language });
      await page.goto(DETAIL_PATH);
      const panel = page.getByRole('region', {
        name: language === 'th' ? 'ชำระเงินจำลอง' : 'Mock payment',
        exact: true,
      });
      const input = panel.getByRole('textbox');
      await input.fill('DEMO-' + 'x'.repeat(59));
      await input.focus();
      await expect(input).toHaveCSS('outline-style', 'solid');
      await page.keyboard.press('Tab');
      const submit = panel.getByRole('button', {
        name: language === 'th' ? 'บันทึกการชำระจำลอง' : 'Record mock payment',
        exact: true,
      });
      await expect(submit).toBeFocused();
      const bounds = await submit.boundingBox();
      expect(bounds?.height).toBeGreaterThanOrEqual(44);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(1);
      await page.screenshot({
        path: testInfo.outputPath(`payment-form-${language}-${width}.png`),
        fullPage: true,
      });
      await page.keyboard.press('Enter');
      await expect(panel.getByRole('textbox')).toHaveCount(0);
      await expect(panel).toContainText('DEMO-');
      expect(
        await panel.evaluate((element) => element.scrollWidth - element.clientWidth),
      ).toBeLessThanOrEqual(1);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(1);
      await page.screenshot({
        path: testInfo.outputPath(`payment-receipt-${language}-${width}.png`),
        fullPage: true,
      });
    });
  }
}
