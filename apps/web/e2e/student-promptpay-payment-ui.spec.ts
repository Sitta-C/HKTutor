import { expect, test } from '@playwright/test';

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
    failPaymentRead: false,
    posts: 0,
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
      return route.fulfill({
        status: state.failRefresh ? 500 : 200,
        json: state.failRefresh ? { message: 'Unavailable' } : state.booking,
      });
    }
    if (path === '/bookings/me/mock-payment-booking/payments/current') {
      return route.fulfill({
        status: state.failPaymentRead ? 503 : 200,
        json: state.failPaymentRead ? { message: 'Unavailable' } : state.current,
      });
    }
    if (path === '/bookings/me/mock-payment-booking/payments/promptpay') {
      state.posts += 1;
      await options.paymentGate;
      state.booking = { ...state.booking, paymentPending: true };
      state.current = {
        ...state.current,
        paymentPending: true,
        attempt: {
          id: `attempt-${state.posts}`,
          status: state.loseResponse ? 'CREATING' : 'PENDING',
          amount: BOOKING.netAmount,
          currency: 'THB',
          chargeId: state.loseResponse ? null : `chrg_test_example${state.posts}`,
          qrCodeUrl: state.loseResponse ? null : 'https://api.omise.co/test-qr.svg',
          expiresAt: new Date(Date.now() + 900_000).toISOString(),
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
