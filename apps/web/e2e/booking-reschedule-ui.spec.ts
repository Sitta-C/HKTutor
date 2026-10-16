import { expect, test } from '@playwright/test';

import type {
  BookingDetail,
  CurrentRescheduleRequestResponse,
  RescheduleRequestStatus,
  RescheduleTargetSlot,
} from '@/lib/api/types';
import type { Page } from '@playwright/test';

const target: RescheduleTargetSlot = {
  id: 'target-slot',
  tutorProfileId: 'tutor',
  startAtUtc: '2099-10-18T16:00:00Z',
  endAtUtc: '2099-10-18T18:00:00Z',
};
const original = {
  id: 'original-slot',
  startAtUtc: '2099-10-17T03:00:00Z',
  endAtUtc: '2099-10-17T04:00:00Z',
};

// Every API call is intercepted; this suite never modifies a real database.
async function setup(
  page: Page,
  role: 'STUDENT' | 'TUTOR',
  options: {
    requester?: 'self' | 'other';
    language?: 'en' | 'th';
    errorStatus?: number | 'network';
    errorCode?: string;
    gate?: Promise<void>;
    cutoff?: boolean;
    readStatus?: number;
  } = {},
) {
  const userId = role === 'TUTOR' ? 'tutor' : 'student';
  const otherId = role === 'TUTOR' ? 'student' : 'tutor';
  let booking: BookingDetail = {
    id: 'reschedule-preview',
    status: 'CONFIRMED',
    tutor: { tutorId: 'tutor', displayName: 'Praew' },
    listing: {
      id: 'listing',
      subjectId: 'math',
      subjectName: 'Mathematics',
      gradeLevelId: 'grade',
      gradeLevelName: 'Grade 10',
      pricePerHour: '500.00',
      description: '',
    },
    slot: options.cutoff
      ? {
          ...original,
          startAtUtc: new Date(Date.now() + 3600_000).toISOString(),
          endAtUtc: new Date(Date.now() + 7200_000).toISOString(),
        }
      : original,
    subtotalAmount: '500.00',
    discountAmount: '0.00',
    netAmount: '500.00',
    currency: 'THB',
    paymentStatus: 'UNPAID',
    paidAt: null,
    mockReference: null,
    createdAt: '2026-10-16T03:00:00Z',
    updatedAt: '2026-10-16T03:00:00Z',
  };
  let latest: CurrentRescheduleRequestResponse['request'] = options.requester
    ? {
        id: 'request',
        bookingId: booking.id,
        fromSlotId: original.id,
        requestedSlotId: target.id,
        requestedById: options.requester === 'self' ? userId : otherId,
        reason: 'Exam conflict',
        status: 'PENDING',
        requestedAt: '2026-10-16T03:00:00Z',
        reviewedById: null,
        decidedAt: null,
        withdrawnAt: null,
      }
    : null;
  let approvalAvailable = !options.cutoff;
  let failRead = false;
  let slotReads = 0;
  const writes: { action: string; body: unknown }[] = [];
  const closeRequest = (status: RescheduleRequestStatus) => {
    if (!latest) {
      throw new Error('No request');
    }
    latest = { ...latest, status };
    if (status === 'APPROVED') {
      booking = { ...booking, slot: target };
    }
  };
  await page.addInitScript(
    (language) => localStorage.setItem('hktutor-language', language),
    options.language ?? 'en',
  );
  await page
    .context()
    .addCookies([{ name: 'hktutor_refresh', value: 'preview', url: 'http://localhost:3000' }]);
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    if (path === '/auth/refresh') {
      return route.fulfill({
        json: {
          accessToken: 'preview',
          user: { id: userId, role, email: 'preview@example.test', displayName: 'Preview' },
        },
      });
    }
    if (path === '/profiles/me') {
      return route.fulfill({
        json: {
          role,
          consentCurrent: true,
          policyVersion: '2026-01',
          profileComplete: true,
          profile: {
            firstName: 'Mint',
            lastName: 'Preview',
            nickname: 'Mint',
            school: 'School',
            gradeLevel: 'Grade 10',
            phone: '0812345678',
            displayName: 'Praew',
            bio: 'Tutor',
            experienceYears: 5,
            verificationStatus: 'VERIFIED',
            ratingAverage: null,
            reviewCount: 0,
          },
        },
      });
    }
    if (path === '/profiles/me/avatar') {
      return route.fulfill({ json: { avatar: null } });
    }
    if (path === '/bookings/me/reschedule-preview') {
      return route.fulfill({ json: booking });
    }
    if (path === '/bookings/me' || path === '/bookings/tutor') {
      const filter = url.searchParams.get('status');
      const items =
        !filter || filter === booking.status ? [{ ...booking, student: { nickname: 'Mint' } }] : [];
      return route.fulfill({ json: { items, total: items.length } });
    }
    if (path === '/tutors/tutor/availability' || path === '/tutors/me/availability') {
      slotReads += 1;
      expect(url.searchParams.get('from')).toMatch(/Z$/);
      const slots = [
        target,
        { ...target, ...original },
        { ...target, id: 'past', startAtUtc: '2020-01-01T00:00:00Z' },
        { ...target, id: 'overlap', startAtUtc: '2099-10-17T03:30:00Z' },
      ];
      return route.fulfill({
        json: slots.map((slot) => ({ ...slot, state: 'OPEN', createdAt: '2026-10-16T03:00:00Z' })),
      });
    }
    if (path === '/bookings/reschedule-preview/reschedule-requests/current') {
      if (options.readStatus || failRead) {
        return route.fulfill({
          status: options.readStatus ?? 503,
          json: { message: 'Read unavailable' },
        });
      }
      const allowedActions =
        latest?.status === 'PENDING'
          ? latest.requestedById === userId
            ? ['WITHDRAW']
            : approvalAvailable
              ? ['APPROVE', 'REJECT']
              : ['REJECT']
          : options.cutoff
            ? []
            : ['CREATE'];
      return route.fulfill({
        json: {
          request: latest?.status === 'PENDING' ? latest : null,
          targetSlot: latest?.status === 'PENDING' ? target : null,
          allowedActions,
        },
      });
    }
    if (
      path === '/bookings/reschedule-preview/reschedule-requests' ||
      path.startsWith('/reschedule-requests/request/')
    ) {
      const action = path.endsWith('/reschedule-requests')
        ? 'create'
        : (path.split('/').at(-1) ?? '');
      const data = route.request().postData();
      writes.push({ action, body: data ? route.request().postDataJSON() : null });
      await options.gate;
      if (options.errorStatus === 'network') {
        return route.abort('failed');
      }
      if (options.errorStatus) {
        return route.fulfill({
          status: options.errorStatus,
          json: {
            code:
              options.errorCode ??
              (options.errorStatus === 403
                ? 'BOOKING_NOT_PARTICIPANT'
                : 'RESCHEDULE_RACE_CONFLICT'),
            message: 'Rejected',
          },
        });
      }
      if (action === 'create') {
        latest = {
          id: 'request',
          bookingId: booking.id,
          fromSlotId: booking.slot.id,
          requestedSlotId: target.id,
          requestedById: userId,
          status: 'PENDING',
          reason: 'Exam conflict',
          requestedAt: '2026-10-16T03:00:00Z',
          decidedAt: null,
          reviewedById: null,
          withdrawnAt: null,
        };
        return route.fulfill({
          status: 201,
          json: {
            requestId: 'request',
            bookingId: booking.id,
            targetSlotId: target.id,
            status: 'PENDING',
          },
        });
      }
      closeRequest(
        action === 'approve' ? 'APPROVED' : action === 'reject' ? 'REJECTED' : 'WITHDRAWN',
      );
      return route.fulfill({
        json: {
          requestId: 'request',
          status: latest?.status,
          ...(action === 'approve'
            ? {
                newSlot: target,
                booking: {
                  id: booking.id,
                  slotId: target.id,
                  status: 'CONFIRMED',
                  subtotalAmount: '500.00',
                  netAmount: '500.00',
                  updatedAt: '2026-10-16T03:00:00Z',
                },
              }
            : {}),
        },
      });
    }
    return route.fulfill({ status: 404, json: { message: 'Unexpected preview request' } });
  });
  await page.goto(
    role === 'STUDENT' ? '/dashboard/bookings/reschedule-preview' : '/dashboard/bookings',
  );
  if (role === 'TUTOR') {
    await page
      .getByRole('button', {
        name: options.language === 'th' ? 'ยืนยันแล้ว' : 'CONFIRMED',
        exact: true,
      })
      .click();
  }
  const panel = page.getByRole('region', {
    name: options.language === 'th' ? 'เลื่อนเวลาคลาส' : 'Reschedule class',
    exact: true,
  });
  const reload = async () => {
    await page.reload();
    if (role === 'TUTOR') {
      await page.getByRole('button', { name: 'CONFIRMED', exact: true }).click();
    }
  };
  return {
    panel,
    writes,
    closeRequest,
    reload,
    getBooking: () => booking,
    getSlotReads: () => slotReads,
    disableApproval: () => {
      approvalAvailable = false;
    },
    failReads: () => {
      failRead = true;
    },
  };
}

for (const role of ['STUDENT', 'TUTOR'] as const) {
  test(`${role} selects a future slot, creates and withdraws without moving the booking`, async ({
    page,
  }, testInfo) => {
    const ui = await setup(page, role);
    await expect(ui.panel.getByRole('radio')).toHaveCount(1);
    await expect(ui.panel.getByRole('radio')).toHaveAccessibleName(
      '18 Oct 2099 · 23:00 → 19 Oct 2099 · 01:00',
    );
    await ui.panel.screenshot({ path: testInfo.outputPath('reschedule-target-picker.png') });
    await expect(
      ui.panel.getByRole('button', { name: 'Send reschedule request', exact: true }),
    ).toBeDisabled();
    await ui.panel.getByRole('radio').check();
    await ui.panel.getByRole('textbox').fill('  Exam conflict  ');
    await ui.panel.getByRole('button', { name: 'Send reschedule request', exact: true }).click();
    await expect(ui.panel.getByRole('status')).toHaveText('Pending reschedule');
    await expect(ui.panel).toContainText('Only the other participant can approve or reject');
    await expect(
      ui.panel.getByRole('button', { name: 'Approve reschedule', exact: true }),
    ).toHaveCount(0);
    expect(ui.writes).toEqual([
      { action: 'create', body: { targetSlotId: target.id, reason: 'Exam conflict' } },
    ]);
    await ui.panel.getByRole('button', { name: 'Withdraw reschedule', exact: true }).click();
    await expect(ui.panel.getByRole('status')).toContainText('Reschedule withdrawn');
    expect(ui.getBooking().slot).toEqual(original);
    await ui.reload();
    await expect(ui.panel.getByRole('status')).toHaveText('No reschedule request.');
    expect(ui.getBooking().slot).toEqual(original);
  });

  test(`${role} counterparty approves and sees persisted new time after reload`, async ({
    page,
  }) => {
    const ui = await setup(page, role, { requester: 'other' });
    await expect(ui.panel).toContainText('only the requester can withdraw');
    await expect(
      ui.panel.getByRole('button', { name: 'Withdraw reschedule', exact: true }),
    ).toHaveCount(0);
    await ui.panel.getByRole('button', { name: 'Approve reschedule', exact: true }).click();
    await expect(ui.panel.getByRole('status')).toHaveText('Reschedule approved');
    await expect(ui.panel).toContainText(
      'Current class time: 18 Oct 2099 · 23:00 → 19 Oct 2099 · 01:00',
    );
    expect(ui.getBooking().slot.id).toBe(target.id);
    await ui.reload();
    await expect(ui.panel.getByRole('status')).toHaveText('No reschedule request.');
    await expect(ui.panel).toContainText('Current class time: 18 Oct 2099');
  });

  test(`${role} rejects a pending request and preserves the original booking`, async ({ page }) => {
    const ui = await setup(page, role, { requester: 'other' });
    await ui.panel.getByRole('button', { name: 'Reject reschedule', exact: true }).click();
    await expect(ui.panel.getByRole('status')).toContainText('Reschedule rejected');
    expect(ui.getBooking().slot).toEqual(original);
    await expect(ui.panel.getByRole('radio')).toHaveCount(1);
  });

  test(`${role} collision locks actions until refreshed state permits only rejection`, async ({
    page,
  }) => {
    const ui = await setup(page, role, {
      requester: 'other',
      errorStatus: 409,
      errorCode: 'RESCHEDULE_TARGET_RESERVED',
    });
    await ui.panel.getByRole('button', { name: 'Approve reschedule', exact: true }).click();
    await expect(ui.panel.getByRole('alert')).toContainText('target is no longer available');
    await expect(
      ui.panel.getByRole('button', { name: 'Reject reschedule', exact: true }),
    ).toBeDisabled();
    expect(ui.getBooking().slot).toEqual(original);
    ui.disableApproval();
    await ui.panel.getByRole('button', { name: 'Refresh reschedule and booking' }).click();
    await expect(
      ui.panel.getByRole('button', { name: 'Approve reschedule', exact: true }),
    ).toHaveCount(0);
    await expect(
      ui.panel.getByRole('button', { name: 'Reject reschedule', exact: true }),
    ).toBeEnabled();
    expect(ui.writes).toHaveLength(1);
  });

  test(`${role} refresh after a competing approval loads the booking and request together`, async ({
    page,
  }) => {
    const ui = await setup(page, role, { requester: 'self' });
    await expect(ui.panel.getByRole('status')).toHaveText('Pending reschedule');
    ui.closeRequest('APPROVED');
    await ui.panel.getByRole('button', { name: 'Refresh reschedule and booking' }).click();
    await expect(ui.panel.getByRole('status')).toHaveText('No reschedule request.');
    await expect(ui.panel).toContainText('Current class time: 18 Oct 2099');
    expect(ui.writes).toHaveLength(0);
  });
}

test('cutoff suppresses create and approve while retaining reject/withdraw', async ({ page }) => {
  const ui = await setup(page, 'STUDENT', { cutoff: true, requester: 'other' });
  await expect(
    ui.panel.getByRole('button', { name: 'Reject reschedule', exact: true }),
  ).toBeEnabled();
  await expect(
    ui.panel.getByRole('button', { name: 'Approve reschedule', exact: true }),
  ).toHaveCount(0);
  await expect(ui.panel).toContainText('cutoff has passed');
  expect(ui.getSlotReads()).toBe(0);
});

test('a booking inside cutoff without a request offers no creation', async ({ page }) => {
  const ui = await setup(page, 'STUDENT', { cutoff: true });
  await expect(ui.panel.getByRole('status')).toHaveText('No reschedule request.');
  await expect(ui.panel).toContainText('at least 24 hours');
  await expect(ui.panel.getByRole('radio')).toHaveCount(0);
  expect(ui.getSlotReads()).toBe(0);
});

test('server cutoff validation overrides a previously eligible form', async ({ page }) => {
  const ui = await setup(page, 'STUDENT', {
    errorStatus: 409,
    errorCode: 'RESCHEDULE_CUTOFF_EXCEEDED',
  });
  await ui.panel.getByRole('radio').check();
  await ui.panel.getByRole('button', { name: 'Send reschedule request', exact: true }).click();
  await expect(ui.panel.getByRole('alert')).toContainText('at least 24 hours');
  await expect(
    ui.panel.getByRole('button', { name: 'Send reschedule request', exact: true }),
  ).toBeDisabled();
  expect(ui.getBooking().slot).toEqual(original);
  expect(ui.writes).toHaveLength(1);
});

test('a payment refresh started before approval cannot restore the original slot', async ({
  page,
}) => {
  const ui = await setup(page, 'STUDENT', { requester: 'other' });
  await expect(ui.panel.getByRole('status')).toHaveText('Pending reschedule');
  const snapshot = ui.getBooking();
  let release = () => {};
  let started = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reading = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route('**/api/v1/bookings/me/reschedule-preview', async (route) => {
    started();
    await gate;
    await route.fulfill({ json: snapshot });
  });
  await page.getByRole('button', { name: 'Load latest status', exact: true }).click();
  await reading;
  await ui.panel.getByRole('button', { name: 'Approve reschedule', exact: true }).click();
  await expect(ui.panel.getByRole('status')).toHaveText('Reschedule approved');
  const response = page.waitForResponse(
    (result) => new URL(result.url()).pathname === '/api/v1/bookings/me/reschedule-preview',
  );
  release();
  await response;
  await expect(ui.panel).toContainText('Current class time: 18 Oct 2099 · 23:00');
  await expect(ui.panel.getByRole('status')).toHaveText('Reschedule approved');
});

test('a payment write finishes before a reschedule can start', async ({ page }) => {
  const ui = await setup(page, 'STUDENT', { requester: 'other' });
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/bookings/me/reschedule-preview/mock-payment', async (route) => {
    await gate;
    await route.fulfill({
      json: {
        bookingId: 'reschedule-preview',
        paymentStatus: 'PAID',
        amount: '500.00',
        reference: 'DEMO-RESCHEDULE',
        paidAt: '2026-10-16T03:00:00Z',
      },
    });
  });
  const payment = page.getByRole('region', { name: 'Mock payment', exact: true });
  await payment.getByRole('textbox').fill('DEMO-RESCHEDULE');
  await payment.getByRole('button', { name: 'Record mock payment', exact: true }).click();
  await expect(
    ui.panel.getByRole('button', { name: 'Approve reschedule', exact: true }),
  ).toBeDisabled();
  expect(ui.writes).toHaveLength(0);
  release();
  await expect(payment.getByText('Paid', { exact: true })).toBeVisible();
  await expect(
    ui.panel.getByRole('button', { name: 'Approve reschedule', exact: true }),
  ).toBeEnabled();
});

for (const status of [403, 'network'] as const) {
  test(`${status} failure keeps original time and requires refresh before another write`, async ({
    page,
  }) => {
    const ui = await setup(page, 'STUDENT', { requester: 'other', errorStatus: status });
    await ui.panel.getByRole('button', { name: 'Approve reschedule', exact: true }).click();
    await expect(ui.panel.getByRole('alert')).toContainText(
      status === 403 ? 'permission' : 'could not be confirmed',
    );
    await expect(
      ui.panel.getByRole('button', { name: 'Approve reschedule', exact: true }),
    ).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Cancel class', exact: true })).toBeDisabled();
    expect(ui.getBooking().slot).toEqual(original);
    expect(ui.writes).toHaveLength(1);
  });
}

test('a failed current-state read never exposes mutation controls', async ({ page }) => {
  const ui = await setup(page, 'STUDENT', { readStatus: 403 });
  await expect(ui.panel.getByRole('alert')).toContainText('permission');
  await expect(ui.panel.getByRole('radio')).toHaveCount(0);
  expect(ui.writes).toHaveLength(0);
});

test('a failed read after create locks the form without claiming pending or resending', async ({
  page,
}) => {
  const ui = await setup(page, 'STUDENT');
  await ui.panel.getByRole('radio').check();
  ui.failReads();
  await ui.panel.getByRole('button', { name: 'Send reschedule request', exact: true }).click();
  await expect(ui.panel.getByRole('alert')).toContainText('could not be confirmed');
  await expect(
    ui.panel.getByRole('button', { name: 'Send reschedule request', exact: true }),
  ).toBeDisabled();
  expect(ui.writes).toHaveLength(1);
});

test('an in-flight decision disables duplicate writes, refresh and cancellation', async ({
  page,
}) => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ui = await setup(page, 'STUDENT', { requester: 'other', gate });
  await ui.panel.getByRole('button', { name: 'Approve reschedule', exact: true }).click();
  await expect(ui.panel.getByRole('button', { name: 'Saving…' }).first()).toBeDisabled();
  await expect(
    ui.panel.getByRole('button', { name: 'Refresh reschedule and booking' }),
  ).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Cancel class', exact: true })).toBeDisabled();
  await expect.poll(() => ui.writes.length).toBe(1);
  release();
  await expect(ui.panel.getByRole('status')).toHaveText('Reschedule approved');
});

test('Thai target selection remains keyboard accessible at 320px', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 740 });
  const ui = await setup(page, 'STUDENT', { language: 'th' });
  const radio = ui.panel.getByRole('radio');
  await radio.focus();
  await page.keyboard.press('Space');
  await expect(radio).toBeChecked();
  await expect(ui.panel.getByRole('textbox')).toHaveAccessibleName('เหตุผล (ไม่บังคับ)');
  await expect(
    ui.panel.getByRole('button', { name: 'ส่งคำขอเลื่อนเวลา', exact: true }),
  ).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await ui.panel.screenshot({ path: testInfo.outputPath('reschedule-thai-mobile.png') });
});
