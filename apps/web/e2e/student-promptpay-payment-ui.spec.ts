import { expect, test } from '@playwright/test';

import { bookingCouponCopy } from '@/components/bookings/booking-coupon-copy';
import { classDetailsCopy } from '@/components/bookings/class-details-copy';

import type { BookingDetail, BookingStatus, PromptPayPayment } from '@/lib/api/types';
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
    startAtUtc: '2099-10-18T11:00:00Z',
    endAtUtc: '2099-10-18T12:30:00Z',
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
    couponGate?: Promise<void>;
    paymentReadGate?: Promise<void>;
    paymentExpiresAt?: string;
    booking?: BookingDetail;
  } = {},
) {
  const state = {
    booking: {
      ...(options.booking ?? BOOKING),
      status: options.status ?? options.booking?.status ?? BOOKING.status,
    },
    failure: null as { status: number; code: string } | null,
    loseResponse: false,
    failRefresh: false,
    failPaymentRead: false,
    posts: 0,
    statusReads: 0,
    bookingReads: 0,
    couponRequests: [] as { method: string; body: unknown }[],
    couponFailure: null as { status: number; code: string } | null,
    loseCouponResponse: false,
    current: {
      bookingId: BOOKING.id,
      paymentStatus: 'UNPAID',
      paymentPending: false,
      paidAt: null,
      reference: null,
      attempt: null,
    } as PromptPayPayment,
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
  await page.route('https://api.omise.co/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><rect width="240" height="240" fill="white"/><path d="M20 20h60v60H20zM160 20h60v60h-60zM20 160h60v60H20zM120 100h40v80h-40z"/></svg>',
    }),
  );
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    if (path.endsWith('/conversations/unread-count')) {
      return route.fulfill({ json: { unreadCount: 0 } });
    }
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
    if (path === '/notifications')
      return route.fulfill({ json: { items: [], unreadCount: 0, nextCursor: null } });
    if (path === '/bookings/mock-payment-booking/reschedule-requests/current') {
      return route.fulfill({ json: { request: null, targetSlot: null, allowedActions: [] } });
    }
    if (path === '/bookings/mock-payment-booking/class-details') {
      return route.fulfill({
        json: {
          bookingId: state.booking.id,
          status: state.booking.status,
          paymentStatus: state.booking.paymentStatus,
          startAt: state.booking.slot.startAtUtc,
          endAt: state.booking.slot.endAtUtc,
          subject: {
            id: state.booking.listing.subjectId,
            name: state.booking.listing.subjectName,
          },
          meetingUrl:
            state.booking.paymentStatus === 'PAID' ? 'https://meet.example.test/paid-class' : null,
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
      state.bookingReads += 1;
      return route.fulfill({
        status: state.failRefresh ? 500 : 200,
        json: state.failRefresh ? { message: 'Unavailable' } : state.booking,
      });
    }
    if (path === '/bookings/me/mock-payment-booking/payments/current') {
      state.statusReads += 1;
      await options.paymentReadGate;
      return route.fulfill({
        status: state.failPaymentRead ? 503 : 200,
        json: state.failPaymentRead ? { message: 'Unavailable' } : state.current,
      });
    }
    if (path === '/bookings/me/mock-payment-booking/coupon') {
      state.couponRequests.push({ method: request.method(), body: request.postDataJSON() });
      await options.couponGate;
      if (state.couponFailure) {
        return route.fulfill({ status: state.couponFailure.status, json: state.couponFailure });
      }
      const remove = request.method() === 'DELETE';
      const full = request.postDataJSON()?.code === 'FULL100';
      state.booking = {
        ...state.booking,
        coupon: remove
          ? null
          : {
              id: 'coupon-preview',
              code: full ? 'FULL100' : 'WELCOME10',
              percent: full ? 100 : 10,
            },
        discountAmount: remove ? '0.00' : full ? '450.00' : '45.00',
        netAmount: remove ? '450.00' : full ? '0.00' : '405.00',
      };
      if (state.loseCouponResponse) {
        return route.abort('failed');
      }
      return route.fulfill({ json: { ...state.booking, bookingId: state.booking.id } });
    }
    if (path === '/bookings/me/mock-payment-booking/payments/promptpay') {
      state.posts += 1;
      await options.paymentGate;
      if (state.failure) {
        return route.fulfill({ status: state.failure.status, json: state.failure });
      }
      if (state.booking.netAmount === '0.00') {
        state.booking = {
          ...state.booking,
          paymentStatus: 'PAID',
          paymentPending: false,
          paidAt: PAID_AT,
          paymentReference: 'coupon:zero-receipt',
        };
        state.current = {
          ...state.current,
          paymentStatus: 'PAID',
          paymentPending: false,
          reference: 'coupon:zero-receipt',
          paidAt: PAID_AT,
          attempt: null,
        };
        return route.fulfill({ json: state.current });
      }
      state.booking = { ...state.booking, paymentPending: true };
      state.current = {
        ...state.current,
        paymentPending: true,
        attempt: {
          id: `attempt-${state.posts}`,
          status: state.loseResponse ? 'CREATING' : 'PENDING',
          amount: state.booking.netAmount,
          currency: 'THB',
          chargeId: state.loseResponse ? null : `chrg_test_example${state.posts}`,
          qrCodeUrl: state.loseResponse ? null : 'https://api.omise.co/test-qr.svg',
          expiresAt: options.paymentExpiresAt ?? new Date(Date.now() + 900_000).toISOString(),
          failureCode: null,
        },
      };
      if (state.loseResponse) {
        return route.abort('failed');
      }
      return route.fulfill({ json: state.current });
    }
    state.unexpected.push(`${request.method()} ${path}`);
    return route.fulfill({ status: 404, json: { message: 'Unexpected request' } });
  });
  return state;
}

for (const language of ['th', 'en'] as const) {
  test(`${language}: creates one QR, reconciles payment automatically and restores the receipt`, async ({
    page,
  }) => {
    const state = await mockPayments(page, { language });
    await page.goto(DETAIL_PATH);
    const classroom = page.getByRole('region', { name: classDetailsCopy[language].title });
    await expect(classroom).toContainText(classDetailsCopy[language].paymentRequired);
    await expect(classroom.getByRole('link')).toHaveCount(0);
    const panel = page.getByRole('region', {
      name: language === 'th' ? 'ชำระด้วย PromptPay' : 'Pay with PromptPay',
    });
    await expect(
      page.getByRole('button', {
        name: language === 'th' ? 'สร้าง QR ทดสอบ' : 'Create test QR',
        exact: true,
      }),
    ).toBeEnabled();
    await page
      .getByRole('button', {
        name: language === 'th' ? 'สร้าง QR ทดสอบ' : 'Create test QR',
        exact: true,
      })
      .click();
    await expect(
      page.getByRole('img', {
        name:
          language === 'th'
            ? 'QR PromptPay สำหรับการชำระเงินทดสอบ'
            : 'PromptPay QR for test payment',
      }),
    ).toBeVisible();
    expect(state.posts).toBe(1);
    await page.reload();
    await expect(
      page.getByRole('img', {
        name:
          language === 'th'
            ? 'QR PromptPay สำหรับการชำระเงินทดสอบ'
            : 'PromptPay QR for test payment',
      }),
    ).toBeVisible();
    expect(state.posts).toBe(1);
    state.current = {
      ...state.current,
      paymentPending: false,
      paymentStatus: 'PAID',
      reference: 'chrg_test_example1',
      paidAt: PAID_AT,
      attempt: state.current.attempt
        ? { ...state.current.attempt, status: 'SUCCESSFUL', qrCodeUrl: null }
        : null,
    };
    state.booking = {
      ...state.booking,
      paymentPending: false,
      paymentStatus: 'PAID',
      paymentReference: 'chrg_test_example1',
      paidAt: PAID_AT,
    };
    await expect(panel.getByText('chrg_test_example1', { exact: true })).toBeVisible({
      timeout: 12000,
    });
    await expect(page.getByRole('img', { name: /PromptPay QR|QR PromptPay/ })).toHaveCount(0);
    await expect(page.getByRole('timer')).toHaveCount(0);
    await expect(
      classroom.getByRole('link', { name: classDetailsCopy[language].join }),
    ).toHaveAttribute('href', 'https://meet.example.test/paid-class');
    await page.reload();
    await expect(page.getByText('chrg_test_example1', { exact: true })).toBeVisible();
    expect(state.posts).toBe(1);
    expect(state.unexpected).toEqual([]);
  });
}

test('failed payment permits a new attempt and QR fits a 320px screen', async ({ page }) => {
  const state = await mockPayments(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(DETAIL_PATH);
  await page.getByRole('button', { name: 'Create test QR', exact: true }).click();
  await expect(page.getByRole('img', { name: 'PromptPay QR for test payment' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: `/tmp/hktutor-promptpay-${test.info().project.name}.png`,
    fullPage: true,
  });
  state.current = {
    ...state.current,
    paymentPending: false,
    attempt: state.current.attempt
      ? { ...state.current.attempt, status: 'FAILED', qrCodeUrl: null }
      : null,
  };
  state.booking = { ...state.booking, paymentPending: false };
  await page.getByRole('button', { name: 'Check payment status', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Create another test QR', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Create another test QR', exact: true }).click();
  expect(state.posts).toBe(2);
});

test('a lost create response requires a status read and never creates another charge', async ({
  page,
}) => {
  const state = await mockPayments(page);
  state.loseResponse = true;
  await page.goto(DETAIL_PATH);
  await page.getByRole('button', { name: 'Create test QR', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Payment status is uncertain' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create test QR', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Check payment status', exact: true }).click();
  await expect(
    page.getByText('Checking this attempt with the provider.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /Create.*test QR/ })).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByText('Checking this attempt with the provider.', { exact: false }),
  ).toBeVisible();
  expect(state.posts).toBe(1);
});

test('status read errors block creation until a successful refresh', async ({ page }) => {
  const state = await mockPayments(page);
  state.failPaymentRead = true;
  await page.goto(DETAIL_PATH);
  await expect(page.getByRole('button', { name: 'Create test QR', exact: true })).toBeDisabled();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Payment status is uncertain' }),
  ).toBeVisible();
  state.failPaymentRead = false;
  await page.getByRole('button', { name: 'Check payment status', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Create test QR', exact: true })).toBeEnabled();
  expect(state.posts).toBe(0);
});

const COUPON_BOOKING: BookingDetail = {
  ...BOOKING,
  subtotalAmount: '450.00',
  discountAmount: '0.00',
  netAmount: '450.00',
  coupon: null,
};

for (const language of ['th', 'en'] as const) {
  test(`${language}: Receipt Strip applies and removes a persisted server-priced coupon`, async ({
    page,
  }) => {
    const state = await mockPayments(page, { language, booking: COUPON_BOOKING });
    const text = bookingCouponCopy[language];
    await page.goto(DETAIL_PATH);
    const strip = page.getByRole('region', { name: text.title });
    const input = strip.getByRole('textbox', { name: text.title });
    await expect(input).toBeEnabled();
    await input.fill('  welcome10  ');
    await strip.getByRole('button', { name: text.apply, exact: true }).click();
    await expect(strip.getByText('WELCOME10', { exact: true })).toBeVisible();
    await expect(strip.getByRole('button', { name: text.remove })).toBeEnabled();
    await expect(page.getByText('405.00', { exact: false })).toBeVisible();
    expect(state.couponRequests).toEqual([{ method: 'PUT', body: { code: 'WELCOME10' } }]);
    await page.reload();
    await expect(strip.getByText('WELCOME10', { exact: true })).toBeVisible();
    await strip
      .locator('..')
      .locator('..')
      .screenshot({
        path: `/tmp/hktutor-coupon-applied-${language}-${test.info().project.name}.png`,
      });
    await strip.getByRole('button', { name: text.remove }).click();
    await expect(input).toBeEnabled();
    await expect(input).toBeFocused();
    await expect(page.getByText('450.00', { exact: false }).last()).toBeVisible();
    expect(state.booking.netAmount).toBe('450.00');
    expect(state.couponRequests[1]).toEqual({ method: 'DELETE', body: null });
    expect(state.unexpected).toEqual([]);
    await page.setViewportSize({ width: 320, height: 800 });
    await expect(input).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: `/tmp/hktutor-coupon-${language}-${test.info().project.name}.png`,
      fullPage: true,
    });
  });
}

test('coupon validation and explicit domain errors preserve amounts and allow correction', async ({
  page,
}) => {
  const state = await mockPayments(page, { booking: COUPON_BOOKING });
  await page.goto(DETAIL_PATH);
  const strip = page.getByRole('region', { name: 'Discount code' });
  const input = strip.getByRole('textbox');
  await expect(input).toBeEnabled();
  await input.fill('ß10');
  await strip.getByRole('button', { name: 'Apply code' }).click();
  await expect(strip.getByRole('alert')).toHaveText(bookingCouponCopy.en.invalid);
  expect(state.couponRequests).toHaveLength(0);
  for (const [code, message] of [
    ['COUPON_EXPIRED', bookingCouponCopy.en.expired],
    ['COUPON_EXHAUSTED', bookingCouponCopy.en.exhausted],
    ['COUPON_ALREADY_USED', bookingCouponCopy.en.alreadyUsed],
  ] as const) {
    state.couponFailure = { status: 409, code };
    await input.fill('WELCOME10');
    await strip.getByRole('button', { name: 'Apply code' }).click();
    await expect(strip.getByRole('alert')).toHaveText(message);
    await expect(input).toBeEnabled();
    expect(state.booking.netAmount).toBe('450.00');
    await expect(page.getByRole('button', { name: 'Create test QR', exact: true })).toBeEnabled();
  }
});

test('coupon writes and QR creation cannot overlap', async ({ page }) => {
  let release: (() => void) | undefined;
  const couponGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const state = await mockPayments(page, { booking: COUPON_BOOKING, couponGate });
  await page.goto(DETAIL_PATH);
  await page.getByRole('textbox', { name: 'Discount code' }).fill('WELCOME10');
  const apply = page.getByRole('button', { name: 'Apply code', exact: true });
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect(page.getByRole('button', { name: 'Applying…', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Processing…', exact: true })).toBeDisabled();
  expect(state.posts).toBe(0);
  expect(state.couponRequests).toHaveLength(1);
  release?.();
  await expect(page.getByRole('button', { name: 'Remove coupon', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Create test QR', exact: true }).click();
  await expect(page.getByRole('img', { name: 'PromptPay QR for test payment' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove coupon', exact: true })).toBeDisabled();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Remove coupon', exact: true })).toBeDisabled();
  expect(state.posts).toBe(1);
  expect(state.current.attempt?.amount).toBe('405.00');
});

test('a lost apply response locks checkout until a read recovers the persisted coupon', async ({
  page,
}) => {
  const state = await mockPayments(page, { booking: COUPON_BOOKING });
  state.loseCouponResponse = true;
  await page.goto(DETAIL_PATH);
  const input = page.getByRole('textbox', { name: 'Discount code' });
  await expect(input).toBeEnabled();
  await input.fill('WELCOME10');
  await page.getByRole('button', { name: 'Apply code', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: bookingCouponCopy.en.uncertain }),
  ).toBeVisible();
  await expect(input).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Create test QR', exact: true })).toBeDisabled();
  expect(state.posts).toBe(0);
  await page.getByRole('button', { name: 'Check payment status', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove coupon', exact: true })).toBeEnabled();
  await expect(page.getByText('405.00', { exact: false })).toBeVisible();
  expect(state.couponRequests).toHaveLength(1);
});

test('100% coupon settles once without a QR and restores the zero-value receipt', async ({
  page,
}) => {
  const state = await mockPayments(page, { booking: COUPON_BOOKING });
  await page.goto(DETAIL_PATH);
  const input = page.getByRole('textbox', { name: 'Discount code' });
  await expect(input).toBeEnabled();
  await input.fill('FULL100');
  await page.getByRole('button', { name: 'Apply code', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm THB 0.00', exact: true }).click();
  await expect(page.getByText('coupon:zero-receipt', { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: 'PromptPay QR for test payment' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Remove coupon' })).toHaveCount(0);
  expect(state.posts).toBe(1);
  expect(state.booking.netAmount).toBe('0.00');
  await page.reload();
  await expect(page.getByText('coupon:zero-receipt', { exact: true })).toBeVisible();
  expect(state.posts).toBe(1);
});

test('a failed remove preserves the applied coupon and requires a status read', async ({
  page,
}) => {
  const state = await mockPayments(page, {
    booking: {
      ...COUPON_BOOKING,
      coupon: { id: 'coupon', code: 'WELCOME10', percent: 10 },
      netAmount: '405.00',
      discountAmount: '45.00',
    },
  });
  await page.goto(DETAIL_PATH);
  const remove = page.getByRole('button', { name: 'Remove coupon', exact: true });
  await expect(remove).toBeEnabled();
  state.couponFailure = { status: 500, code: 'INTERNAL_ERROR' };
  await remove.click();
  await expect(remove).toBeDisabled();
  await expect(page.getByText('WELCOME10', { exact: true })).toBeVisible();
  await expect(page.getByText('405.00', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create test QR', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Check payment status', exact: true }).click();
  await expect(remove).toBeEnabled();
  expect(state.posts).toBe(0);
});

test('a successful apply keeps its returned amounts when the follow-up read fails', async ({
  page,
}) => {
  const state = await mockPayments(page, { booking: COUPON_BOOKING });
  await page.goto(DETAIL_PATH);
  const input = page.getByRole('textbox', { name: 'Discount code' });
  await expect(input).toBeEnabled();
  state.failRefresh = true;
  await input.fill('WELCOME10');
  await page.getByRole('button', { name: 'Apply code', exact: true }).click();
  await expect(page.getByText('405.00', { exact: false })).toBeVisible();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Payment status is uncertain' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove coupon' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Create test QR', exact: true })).toBeDisabled();
  state.failRefresh = false;
  await page.getByRole('button', { name: 'Check payment status', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove coupon' })).toBeEnabled();
  expect(state.couponRequests).toHaveLength(1);
});

for (const [status, code, message] of [
  [403, 'BOOKING_NOT_OWNED', bookingCouponCopy.en.forbidden],
  [404, 'BOOKING_NOT_FOUND', bookingCouponCopy.en.missing],
  [409, 'PAYMENT_STATE_CONFLICT', bookingCouponCopy.en.conflict],
] as const) {
  test(`${code}: a rejected coupon change locks checkout and preserves amounts`, async ({
    page,
  }) => {
    const state = await mockPayments(page, { booking: COUPON_BOOKING });
    state.couponFailure = { status, code };
    await page.goto(DETAIL_PATH);
    const input = page.getByRole('textbox', { name: 'Discount code' });
    await expect(input).toBeEnabled();
    await input.fill('WELCOME10');
    await page.getByRole('button', { name: 'Apply code', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: message })).toBeVisible();
    await expect(input).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Create test QR', exact: true })).toBeDisabled();
    expect(state.booking.netAmount).toBe('450.00');
    expect(state.posts).toBe(0);
  });
}

for (const status of ['PENDING', 'CANCELED', 'COMPLETED'] as const) {
  test(`${status}: ineligible bookings never expose coupon editing`, async ({ page }) => {
    await mockPayments(page, { booking: COUPON_BOOKING, status });
    await page.goto(DETAIL_PATH);
    await expect(page.getByRole('heading', { name: 'Pay with PromptPay' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Discount code' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Apply code', exact: true })).toHaveCount(0);
  });
}

const APPLIED_COUPON_BOOKING: BookingDetail = {
  ...COUPON_BOOKING,
  coupon: { id: 'coupon-preview', code: 'WELCOME10', percent: 10 },
  discountAmount: '45.00',
  netAmount: '405.00',
};

for (const language of ['th', 'en'] as const) {
  test(`${language}: T28 coupon checkout recovers a lost charge and 503 into one discounted receipt`, async ({
    page,
  }) => {
    const state = await mockPayments(page, { booking: COUPON_BOOKING, language });
    const text = bookingCouponCopy[language];
    await page.goto(DETAIL_PATH);
    const input = page.getByRole('textbox', { name: text.title });
    await expect(input).toBeEnabled();
    await input.fill('welcome10');
    await page.getByRole('button', { name: text.apply, exact: true }).click();
    const remove = page.getByRole('button', { name: text.remove, exact: true });
    await expect(remove).toBeEnabled();
    state.loseResponse = true;
    await page
      .getByRole('button', {
        name: language === 'en' ? 'Create test QR' : 'สร้าง QR ทดสอบ',
        exact: true,
      })
      .click();
    const refresh = page.getByRole('button', {
      name: language === 'en' ? 'Check payment status' : 'ตรวจสถานะชำระเงิน',
      exact: true,
    });
    await expect(
      page.getByRole('alert').filter({
        hasText: language === 'en' ? 'Payment status is uncertain' : 'ยังยืนยันสถานะไม่ได้',
      }),
    ).toBeVisible();
    await expect(remove).toBeDisabled();
    expect(state.posts).toBe(1);
    expect(state.current.attempt?.amount).toBe('405.00');
    state.failPaymentRead = true;
    await refresh.click();
    await expect(
      page.getByRole('alert').filter({
        hasText: language === 'en' ? 'Payment status is uncertain' : 'ยังยืนยันสถานะไม่ได้',
      }),
    ).toBeVisible();
    await expect(remove).toBeDisabled();
    expect(state.booking.netAmount).toBe('405.00');
    state.failPaymentRead = false;
    await page.reload();
    await expect(
      page.getByText(
        language === 'en'
          ? 'Checking this attempt with the provider.'
          : 'กำลังตรวจสอบรายการกับผู้ให้บริการ',
        { exact: false },
      ),
    ).toBeVisible();
    await expect(remove).toBeDisabled();
    expect(state.posts).toBe(1);
    const reference = 'chrg_test_t28recovered';
    state.booking = {
      ...state.booking,
      paymentPending: false,
      paymentStatus: 'PAID',
      paidAt: PAID_AT,
      paymentReference: reference,
    };
    state.current = {
      ...state.current,
      paymentPending: false,
      paymentStatus: 'PAID',
      paidAt: PAID_AT,
      reference,
      attempt: state.current.attempt
        ? { ...state.current.attempt, status: 'SUCCESSFUL', chargeId: reference, qrCodeUrl: null }
        : null,
    };
    await refresh.click();
    await expect(page.getByText(reference, { exact: true })).toBeVisible();
    await expect(page.getByText('WELCOME10', { exact: true })).toBeVisible();
    await expect(page.getByRole('definition').filter({ hasText: '405.00' })).toBeVisible();
    await expect(remove).toHaveCount(0);
    await expect(page.getByRole('img', { name: /PromptPay QR|QR PromptPay/ })).toHaveCount(0);
    await page.reload();
    await expect(page.getByText(reference, { exact: true })).toBeVisible();
    expect(state.posts).toBe(1);
    expect(state.couponRequests).toEqual([{ method: 'PUT', body: { code: 'WELCOME10' } }]);
    expect(state.unexpected).toEqual([]);
    await page
      .getByRole('region', {
        name: language === 'en' ? 'Pay with PromptPay' : 'ชำระด้วย PromptPay',
        exact: true,
      })
      .locator('..')
      .screenshot({ path: test.info().outputPath('t28-discounted-receipt.png') });
  });
}

test('initial verification shows loading without telling the student to repair payment status', async ({
  page,
}) => {
  let release = () => {};
  const paymentReadGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await mockPayments(page, { booking: COUPON_BOOKING, paymentReadGate });
  await page.goto(DETAIL_PATH);
  const strip = page.getByRole('region', { name: 'Discount code' });
  await expect(strip.getByRole('textbox')).toBeDisabled();
  await expect(page.getByText('Checking payment status…', { exact: true })).toBeVisible();
  await expect(strip.getByText(bookingCouponCopy.en.checking)).toHaveCount(0);
  release();
  await expect(strip.getByRole('textbox')).toBeEnabled();
});

for (const status of [400, 409] as const) {
  test(`unmapped payment ${status} uses payment recovery rather than coupon-input instructions`, async ({
    page,
  }) => {
    const state = await mockPayments(page, { booking: COUPON_BOOKING });
    state.failure = {
      status,
      code: status === 400 ? 'VALIDATION_FAILED' : 'PAYMENT_STATE_CONFLICT',
    };
    await page.goto(DETAIL_PATH);
    await page.getByRole('button', { name: 'Create test QR', exact: true }).click();
    const payment = page.getByRole('region', { name: 'Pay with PromptPay', exact: true });
    await expect(payment.getByRole('alert')).toHaveText(
      'Payment status is uncertain. Check the status again before continuing.',
    );
    await expect(payment).not.toContainText(bookingCouponCopy.en.invalid);
    await expect(page.getByRole('button', { name: 'Create test QR', exact: true })).toBeDisabled();
    expect(state.posts).toBe(1);
  });
}

for (const language of ['th', 'en'] as const) {
  test(`${language}: payment coupon rejection survives refresh until the invalid coupon is removed`, async ({
    page,
  }) => {
    const text = bookingCouponCopy[language];
    const state = await mockPayments(page, { booking: APPLIED_COUPON_BOOKING, language });
    state.failure = { status: 409, code: 'COUPON_EXPIRED' };
    await page.goto(DETAIL_PATH);
    const pay = page.getByRole('button', {
      name: language === 'en' ? 'Create test QR' : 'สร้าง QR ทดสอบ',
      exact: true,
    });
    const remove = page.getByRole('button', { name: text.remove, exact: true });
    await expect(pay).toBeEnabled();
    await pay.click();
    const rejection = page.getByRole('alert').filter({ hasText: text.expired });
    await expect(rejection).toHaveText(`${text.expired} ${text.paymentRecovery}`);
    await expect(remove).toBeDisabled();
    await page
      .getByRole('button', {
        name: language === 'en' ? 'Check payment status' : 'ตรวจสถานะชำระเงิน',
        exact: true,
      })
      .click();
    await expect(remove).toBeEnabled();
    await expect(rejection).toBeVisible();
    await expect(pay).toBeDisabled();
    await remove.click();
    await expect(rejection).toHaveCount(0);
    await expect(pay).toBeEnabled();
    expect(state.posts).toBe(1);
  });
}

for (const source of ['booking', 'attempt'] as const) {
  test(`${source} pending evidence keeps polling even when current.paymentPending is false`, async ({
    page,
  }) => {
    const state = await mockPayments(page, { booking: APPLIED_COUPON_BOOKING });
    if (source === 'booking') {
      state.booking = { ...state.booking, paymentPending: true };
    } else {
      state.current.attempt = {
        id: 'uncertain',
        status: 'CREATING',
        amount: '405.00',
        currency: 'THB',
        chargeId: null,
        qrCodeUrl: null,
        expiresAt: null,
        failureCode: null,
      };
    }
    await page.goto(DETAIL_PATH);
    await expect(page.getByRole('button', { name: 'Remove coupon', exact: true })).toBeDisabled();
    await expect.poll(() => state.bookingReads).toBeGreaterThanOrEqual(2);
    await expect(page.getByText('Checking payment status…', { exact: true })).toHaveCount(0);
    const initialReads = state.statusReads;
    state.booking = { ...state.booking, paymentPending: false };
    state.current = { ...state.current, attempt: null };
    await expect.poll(() => state.statusReads, { timeout: 10_000 }).toBeGreaterThan(initialReads);
    await expect(page.getByRole('button', { name: 'Remove coupon', exact: true })).toBeEnabled();
  });
}

test('a failed post-remove read does not restore focus during a later manual refresh', async ({
  page,
}) => {
  const state = await mockPayments(page, { booking: APPLIED_COUPON_BOOKING });
  await page.goto(DETAIL_PATH);
  const remove = page.getByRole('button', { name: 'Remove coupon', exact: true });
  await expect(remove).toBeEnabled();
  state.failRefresh = true;
  await remove.click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Payment status is uncertain' }),
  ).toBeVisible();
  const refresh = page.getByRole('button', { name: 'Check payment status', exact: true });
  state.failRefresh = false;
  await refresh.click();
  await expect(page.getByRole('textbox', { name: 'Discount code' })).toBeEnabled();
  await expect(refresh).toBeFocused();
});

test('a remote coupon removal does not take focus from the status action', async ({ page }) => {
  const state = await mockPayments(page, { booking: APPLIED_COUPON_BOOKING });
  await page.goto(DETAIL_PATH);
  await expect(page.getByRole('button', { name: 'Remove coupon', exact: true })).toBeEnabled();
  state.booking = { ...COUPON_BOOKING };
  const refresh = page.getByRole('button', { name: 'Check payment status', exact: true });
  await refresh.click();
  await expect(page.getByRole('textbox', { name: 'Discount code' })).toBeEnabled();
  await expect(refresh).toBeFocused();
});

test('successful removal does not take focus after the student moves to another action', async ({
  page,
}) => {
  let release = () => {};
  const couponGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await mockPayments(page, { booking: APPLIED_COUPON_BOOKING, couponGate });
  await page.goto(DETAIL_PATH);
  const remove = page.getByRole('button', { name: 'Remove coupon', exact: true });
  await expect(remove).toBeEnabled();
  await remove.click();
  const back = page.getByRole('link', { name: 'Back to my bookings', exact: true });
  await back.focus();
  release();
  await expect(page.getByRole('textbox', { name: 'Discount code' })).toBeEnabled();
  await expect(back).toBeFocused();
});

for (const status of ['PENDING', 'CANCELED', 'COMPLETED'] as const) {
  test(`${status}: unpaid coupon history is recorded rather than described as usable`, async ({
    page,
  }) => {
    await mockPayments(page, { booking: APPLIED_COUPON_BOOKING, status });
    await page.goto(DETAIL_PATH);
    const strip = page.getByRole('region', { name: 'Discount code' });
    await expect(strip).toContainText(bookingCouponCopy.en.recorded.replace('{percent}', '10'));
    await expect(strip).not.toContainText(bookingCouponCopy.en.applied.replace('{percent}', '10'));
    await expect(strip.getByRole('button')).toHaveCount(0);
  });
}

test('booking reads wait for payment reconciliation to complete', async ({ page }) => {
  const state = await mockPayments(page, { booking: COUPON_BOOKING });
  await page.goto(DETAIL_PATH);
  await expect(page.getByRole('textbox', { name: 'Discount code' })).toBeEnabled();
  let release = () => {};
  let markStarted = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  await page.route('**/api/v1/bookings/me/mock-payment-booking/payments/current', async (route) => {
    markStarted();
    await gate;
    state.booking = {
      ...state.booking,
      paymentStatus: 'PAID',
      paidAt: PAID_AT,
      paymentReference: 'reconciled-receipt',
    };
    await route.fulfill({
      json: {
        ...state.current,
        paymentStatus: 'PAID',
        paidAt: PAID_AT,
        reference: 'reconciled-receipt',
      },
    });
  });
  const before = state.bookingReads;
  await page.getByRole('button', { name: 'Check payment status', exact: true }).click();
  await started;
  // A parallel booking request would be observable while the reconciliation is held.
  await expect.poll(() => state.bookingReads, { timeout: 300 }).toBe(before);
  release();
  await expect(page.getByText('reconciled-receipt', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Discount code' })).toHaveCount(0);
});

for (const language of ['th', 'en'] as const) {
  test(`${language}: minimal QR countdown ticks, survives reload and keeps payment locked at zero`, async ({
    page,
  }) => {
    const start = new Date('2026-11-13T08:00:00Z');
    await page.clock.install({ time: new Date(start.getTime() - 1000) });
    await page.clock.pauseAt(start);
    const state = await mockPayments(page, {
      language,
      booking: APPLIED_COUPON_BOOKING,
      paymentExpiresAt: new Date(start.getTime() + 61_000).toISOString(),
    });
    await page.goto(DETAIL_PATH);
    const panel = page.getByRole('region', {
      name: language === 'en' ? 'Pay with PromptPay' : 'ชำระด้วย PromptPay',
      exact: true,
    });
    await page
      .getByRole('button', {
        name: language === 'en' ? 'Create test QR' : 'สร้าง QR ทดสอบ',
        exact: true,
      })
      .click();
    const timer = page.getByRole('timer');
    await expect(timer).toHaveText('01:01');
    await expect(timer).toHaveAttribute('aria-live', 'off');
    await page.clock.fastForward(1000);
    await expect(timer).toHaveText('01:00');
    await page.reload();
    await expect(timer).toHaveText('01:00');
    expect(state.posts).toBe(1);
    await panel.screenshot({
      path: `/tmp/hktutor-qr-countdown-${language}-${test.info().project.name}.png`,
    });
    await page.clock.fastForward(60_000);
    await expect(timer).toHaveText('00:00');
    await expect(
      panel.getByText(language === 'en' ? 'Time is up' : 'หมดเวลาแล้ว', { exact: true }),
    ).toBeVisible();
    await expect(panel.getByRole('img')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: bookingCouponCopy[language].remove, exact: true }),
    ).toBeDisabled();
    await expect(panel.getByRole('button', { name: /Create.*test QR|สร้าง QR/ })).toHaveCount(0);
    expect(state.posts).toBe(1);
    state.booking = { ...state.booking, paymentPending: false };
    state.current = {
      ...state.current,
      paymentPending: false,
      attempt: state.current.attempt
        ? { ...state.current.attempt, status: 'EXPIRED', qrCodeUrl: null }
        : null,
    };
    await panel
      .getByRole('button', {
        name: language === 'en' ? 'Check payment status' : 'ตรวจสถานะชำระเงิน',
        exact: true,
      })
      .click();
    await expect(timer).toHaveCount(0);
    const retry = panel.getByRole('button', {
      name: language === 'en' ? 'Create another test QR' : 'สร้าง QR ทดสอบใหม่',
      exact: true,
    });
    await expect(retry).toBeEnabled();
    const stub = retry.locator('svg').locator('..');
    await expect(stub).toHaveCSS('border-left-style', 'dashed');
    await panel
      .getByRole('button', {
        name: language === 'en' ? 'Check payment status' : 'ตรวจสถานะชำระเงิน',
        exact: true,
      })
      .focus();
    await page.keyboard.press('Shift+Tab');
    await expect(retry).toBeFocused();
    await expect(retry).toHaveCSS('outline-style', 'solid');
    expect(await retry.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await retry.screenshot({ path: test.info().outputPath(`retry-ticket-${language}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

for (const language of ['en', 'th'] as const) {
  test(`${language}: payment closes at the lesson-start deadline without reload`, async ({
    page,
  }) => {
    const now = new Date('2026-11-15T07:00:00Z');
    await page.clock.install({ time: now });
    const state = await mockPayments(page, {
      language,
      booking: {
        ...BOOKING,
        slot: {
          ...BOOKING.slot,
          startAtUtc: '2026-11-15T07:00:05Z',
          endAtUtc: '2026-11-15T08:00:05Z',
        },
      },
    });
    await page.goto(DETAIL_PATH);
    const pay = page.getByRole('button', {
      name: language === 'en' ? 'Create test QR' : 'สร้าง QR ทดสอบ',
      exact: true,
    });
    await expect(pay).toBeEnabled();
    await page.clock.fastForward(5000);
    await expect(pay).toHaveCount(0);
    await expect(
      page.getByText(
        language === 'en'
          ? 'The payment deadline has passed. New payments are closed.'
          : 'พ้นเส้นตายชำระเงินแล้ว ไม่สามารถเริ่มชำระเงินใหม่ได้',
        { exact: true },
      ),
    ).toBeVisible();
    expect(state.posts).toBe(0);
  });
}

for (const language of ['en', 'th'] as const) {
  test(`${language}: server deadline rejection closes checkout despite a slow client clock`, async ({
    page,
  }) => {
    const state = await mockPayments(page, { language });
    state.failure = { status: 409, code: 'BOOKING_PAYMENT_DEADLINE_PASSED' };
    await page.goto(DETAIL_PATH);
    const pay = page.getByRole('button', {
      name: language === 'en' ? 'Create test QR' : 'สร้าง QR ทดสอบ',
      exact: true,
    });
    await expect(pay).toBeEnabled();
    await pay.click();
    await expect(
      page.getByText(bookingCouponCopy[language].deadlinePassed, { exact: true }),
    ).toBeVisible();
    await expect(pay).toHaveCount(0);
    await page
      .getByRole('button', {
        name: language === 'en' ? 'Check payment status' : 'ตรวจสถานะชำระเงิน',
        exact: true,
      })
      .click();
    await expect(pay).toHaveCount(0);
    expect(state.posts).toBe(1);
  });

  test(`${language}: a pending QR explains closure at lesson start and keeps reconciling`, async ({
    page,
  }) => {
    const now = new Date('2026-11-15T07:00:00Z');
    await page.clock.install({ time: now });
    const start = '2026-11-15T07:00:05Z';
    const state = await mockPayments(page, {
      language,
      paymentExpiresAt: start,
      booking: {
        ...BOOKING,
        slot: { ...BOOKING.slot, startAtUtc: start, endAtUtc: '2026-11-15T08:00:05Z' },
      },
    });
    await page.goto(DETAIL_PATH);
    await page
      .getByRole('button', {
        name: language === 'en' ? 'Create test QR' : 'สร้าง QR ทดสอบ',
        exact: true,
      })
      .click();
    await expect(page.getByRole('img', { name: /PromptPay QR|QR PromptPay/ })).toBeVisible();
    await page.clock.fastForward(5000);
    await expect(page.getByRole('img', { name: /PromptPay QR|QR PromptPay/ })).toHaveCount(0);
    await expect(
      page.getByText(
        language === 'en'
          ? 'The lesson has started and the QR is closed. Checking the existing payment result; wait and check status.'
          : 'เริ่มเรียนแล้ว QR ปิดรับชำระเงิน ระบบกำลังตรวจผลรายการเดิม กรุณารอและตรวจสถานะ',
        { exact: true },
      ),
    ).toBeVisible();
    const reads = state.statusReads;
    await page.clock.fastForward(5000);
    await expect.poll(() => state.statusReads).toBeGreaterThan(reads);
    expect(state.posts).toBe(1);
  });
}
