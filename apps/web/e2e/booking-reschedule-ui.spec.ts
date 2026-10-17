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
    open?: boolean;
    inboxCount?: number;
    targetSlot?: RescheduleTargetSlot;
  } = {},
) {
  const requestedTarget = options.targetSlot ?? target;
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
        requestedSlotId: requestedTarget.id,
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
      booking = { ...booking, slot: requestedTarget };
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
    if (path === '/bookings/reschedule-preview/class-details') {
      return route.fulfill({
        json: {
          bookingId: booking.id,
          status: booking.status,
          startAt: booking.slot.startAtUtc,
          endAt: booking.slot.endAtUtc,
          subject: { id: booking.listing.subjectId, name: booking.listing.subjectName },
          meetingUrl: null,
          attendance: null,
          participants: {
            tutor: {
              id: booking.tutor.tutorId,
              detail: { displayName: booking.tutor.displayName },
            },
          },
        },
      });
    }
    if (path === '/bookings/me' || path === '/bookings/tutor') {
      const filter = url.searchParams.get('status');
      const ordinary = Array.from({ length: (options.inboxCount ?? 1) - 1 }, (_, index) => ({
        ...booking,
        id: `ordinary-${index}`,
        student: { nickname: `Student ${index + 1}` },
        slot: {
          id: `ordinary-slot-${index}`,
          startAtUtc: new Date(
            Date.parse(original.startAtUtc) + (index + 1) * 86_400_000,
          ).toISOString(),
          endAtUtc: new Date(
            Date.parse(original.endAtUtc) + (index + 1) * 86_400_000,
          ).toISOString(),
        },
      }));
      const items =
        !filter || filter === booking.status
          ? [...ordinary, { ...booking, student: { nickname: 'Mint' } }]
          : [];
      return route.fulfill({ json: { items, total: items.length } });
    }
    if (/^\/bookings\/ordinary-\d+\/reschedule-requests\/current$/.test(path)) {
      return route.fulfill({
        json: { request: null, targetSlot: null, allowedActions: ['CREATE'] },
      });
    }
    if (path === '/tutors/tutor/availability' || path === '/tutors/me/availability') {
      slotReads += 1;
      expect(url.searchParams.get('from')).toMatch(/Z$/);
      const slots = [
        requestedTarget,
        { ...requestedTarget, ...original },
        { ...requestedTarget, id: 'past', startAtUtc: '2020-01-01T00:00:00Z' },
        { ...requestedTarget, id: 'overlap', startAtUtc: '2099-10-17T03:30:00Z' },
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
          targetSlot: latest?.status === 'PENDING' ? requestedTarget : null,
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
          requestedSlotId: requestedTarget.id,
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
            targetSlotId: requestedTarget.id,
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
                newSlot: requestedTarget,
                booking: {
                  id: booking.id,
                  slotId: requestedTarget.id,
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
  const panel = page
    .getByRole('region', {
      name: options.language === 'th' ? 'เลื่อนเวลาคลาส' : 'Reschedule class',
      exact: true,
    })
    .last();
  const open = async () => {
    const disclosure = panel.locator('button[aria-expanded]');
    await expect(disclosure).toBeEnabled();
    if ((await disclosure.getAttribute('aria-expanded')) === 'false') {
      await disclosure.click();
    }
  };
  if (options.open !== false) {
    await open();
  }
  const reload = async () => {
    await page.reload();
    if (role === 'TUTOR') {
      await page.getByRole('button', { name: 'CONFIRMED', exact: true }).click();
    }
    if (options.open !== false) {
      await open();
    }
  };
  return {
    panel,
    writes,
    closeRequest,
    reload,
    open,
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
    const slotRow = ui.panel.getByRole('radio').locator('..');
    const unselectedColor = await slotRow.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    await ui.panel.getByRole('radio').check();
    await ui.panel.getByRole('textbox').fill('  Exam conflict  ');
    await expect(slotRow).toContainText('2 hours');
    expect(await slotRow.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(
      unselectedColor,
    );
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
    await ui.open();
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
    await ui.open();
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
    await ui.open();
    await expect(ui.panel.getByRole('status')).toHaveText('No reschedule request.');
    await expect(ui.panel).toContainText('Current class time: 18 Oct 2099');
    expect(ui.writes).toHaveLength(0);
  });

  for (const requester of ['self', 'other'] as const) {
    test(`${role} expired target suppresses approval but retains ${requester === 'self' ? 'withdrawal' : 'rejection'}`, async ({
      page,
    }) => {
      await page.clock.install({ time: new Date('2099-10-10T03:00:00Z') });
      const ui = await setup(page, role, {
        requester,
        targetSlot: {
          ...target,
          startAtUtc: '2099-10-10T03:01:00Z',
          endAtUtc: '2099-10-10T05:01:00Z',
        },
      });
      const approve = ui.panel.getByRole('button', { name: 'Approve reschedule', exact: true });
      if (requester === 'other') {
        await expect(approve).toBeEnabled();
      }
      await page.clock.runFor(61_000);
      await expect(approve).toHaveCount(0);
      await expect(ui.panel.getByRole('status')).toHaveText('Pending reschedule');
      const closeAction = requester === 'self' ? 'Withdraw reschedule' : 'Reject reschedule';
      await ui.panel.getByRole('button', { name: closeAction, exact: true }).click();
      await expect(ui.panel.getByRole('status')).toContainText(
        requester === 'self' ? 'Reschedule withdrawn' : 'Reschedule rejected',
      );
      expect(ui.getBooking().slot).toEqual(original);
      expect(ui.writes.map((write) => write.action)).toEqual([
        requester === 'self' ? 'withdraw' : 'reject',
      ]);
    });
  }

  test(`${role} server target expiry requires refresh before another action`, async ({ page }) => {
    const ui = await setup(page, role, {
      requester: 'other',
      errorStatus: 400,
      errorCode: 'RESCHEDULE_TARGET_PAST',
    });
    await ui.panel.getByRole('button', { name: 'Approve reschedule', exact: true }).click();
    await expect(ui.panel.getByRole('alert')).toContainText('requested time has already started');
    await expect(
      ui.panel.getByRole('button', { name: 'Approve reschedule', exact: true }),
    ).toBeDisabled();
    await expect(
      ui.panel.getByRole('button', { name: 'Reject reschedule', exact: true }),
    ).toBeDisabled();
    expect(ui.getBooking().slot).toEqual(original);
    ui.disableApproval();
    await ui.panel.getByRole('button', { name: 'Refresh reschedule and booking' }).click();
    await ui.open();
    await expect(
      ui.panel.getByRole('button', { name: 'Approve reschedule', exact: true }),
    ).toHaveCount(0);
    await expect(
      ui.panel.getByRole('button', { name: 'Reject reschedule', exact: true }),
    ).toBeEnabled();
    expect(ui.writes).toHaveLength(1);
  });
}

for (const role of ['STUDENT', 'TUTOR'] as const) {
  for (const language of ['en', 'th'] as const) {
    for (const requester of ['self', 'other'] as const) {
      test(`${role} pending ${requester} disclosure uses ${language} role wording and restores approval focus`, async ({
        page,
      }) => {
        const ui = await setup(page, role, { language, requester, open: false });
        const viewLabel = language === 'th' ? 'ดูคำขอเลื่อนเวลา' : 'View reschedule request';
        const reviewLabel =
          language === 'th' ? 'พิจารณาคำขอเลื่อนเวลา' : 'Review reschedule request';
        const label = requester === 'self' ? viewLabel : reviewLabel;
        await expect(ui.panel.getByRole('button', { name: label, exact: true })).toBeEnabled();
        await expect(
          ui.panel.getByRole('button', {
            name: requester === 'self' ? reviewLabel : viewLabel,
            exact: true,
          }),
        ).toHaveCount(0);
        await ui.open();
        const approve = ui.panel.getByRole('button', {
          name: language === 'th' ? 'อนุมัติการเลื่อนเวลา' : 'Approve reschedule',
          exact: true,
        });
        if (requester === 'self') {
          await expect(approve).toHaveCount(0);
          await expect(
            ui.panel.getByRole('button', {
              name: language === 'th' ? 'ถอนคำขอเลื่อนเวลา' : 'Withdraw reschedule',
              exact: true,
            }),
          ).toBeEnabled();
          await page.keyboard.press('Escape');
          await expect(ui.panel.getByRole('button', { name: label, exact: true })).toBeFocused();
          expect(ui.writes).toHaveLength(0);
        } else {
          await approve.click();
          await expect(ui.panel.getByRole('status')).toHaveText(
            language === 'th' ? 'อนุมัติการเลื่อนเวลาแล้ว' : 'Reschedule approved',
          );
          const trigger = ui.panel.getByRole('button', { expanded: false });
          await expect(trigger).toBeFocused();
          await expect(trigger).toBeEnabled();
          expect(ui.getBooking().slot.id).toBe(target.id);
          expect(ui.writes).toHaveLength(1);
        }
      });
    }
  }
}

test('approval does not steal focus after the user leaves while the new panel loads', async ({
  page,
}) => {
  const ui = await setup(page, 'STUDENT', { requester: 'other' });
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/bookings/reschedule-preview/reschedule-requests/current', async (route) => {
    await gate;
    await route.fulfill({ json: { request: null, targetSlot: null, allowedActions: ['CREATE'] } });
  });
  await ui.panel.getByRole('button', { name: 'Approve reschedule', exact: true }).click();
  await expect(ui.panel.getByRole('button', { name: 'Reschedule', exact: true })).toBeDisabled();
  const back = page.getByRole('link', { name: 'Back to my bookings', exact: true });
  await back.focus();
  release();
  await expect(ui.panel.getByRole('status')).toHaveText('Reschedule approved');
  await expect(ui.panel.getByRole('button', { name: 'Reschedule', exact: true })).toBeEnabled();
  await expect(back).toBeFocused();
});

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
  await ui.open();
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
  await expect(ui.panel.getByRole('button', { expanded: true })).toBeDisabled();
  await expect.poll(() => ui.writes.length).toBe(1);
  release();
  await expect(ui.panel.getByRole('status')).toHaveText('Reschedule approved');
});

for (const language of ['en', 'th'] as const) {
  for (const width of [320, 768, 1440]) {
    test(`a ten-booking tutor inbox stays compact with a visible pending cue in ${language} at ${width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      const ui = await setup(page, 'TUTOR', {
        language,
        requester: 'other',
        open: false,
        inboxCount: 10,
      });
      const rows = page.getByRole('article');
      await expect(rows).toHaveCount(10);
      await expect(rows.getByRole('button', { expanded: false })).toHaveCount(10);
      await expect(rows.getByRole('radio')).toHaveCount(0);
      await expect(rows.getByRole('textbox')).toHaveCount(0);
      const pendingCopy = language === 'th' ? 'รอตอบรับการเลื่อนเวลา' : 'Pending reschedule';
      const identity = rows
        .last()
        .getByRole('heading', { name: 'Mint', exact: true })
        .locator('..');
      await expect(identity.getByText(pendingCopy, { exact: true })).toBeVisible();
      await expect(
        rows.last().getByText(language === 'th' ? 'ยืนยันแล้ว' : 'CONFIRMED', {
          exact: true,
        }),
      ).toBeVisible();
      const sizes = await rows.evaluateAll((elements) =>
        elements.map((element) => element.getBoundingClientRect().height),
      );
      expect(Math.max(...sizes.slice(0, 9))).toBeLessThan(700);
      const idlePanels = page.getByRole('region', {
        name: language === 'th' ? 'เลื่อนเวลาคลาส' : 'Reschedule class',
        exact: true,
      });
      const panelSizes = await idlePanels.evaluateAll((elements) =>
        elements.slice(0, 9).map((element) => element.getBoundingClientRect().height),
      );
      expect(Math.max(...panelSizes)).toBeLessThan(120);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: testInfo.outputPath(`compact-inbox-${language}-${width}.png`),
      });
      await ui.open();
      await expect(
        ui.panel.getByRole('button', {
          name: language === 'th' ? 'อนุมัติการเลื่อนเวลา' : 'Approve reschedule',
          exact: true,
        }),
      ).toBeEnabled();
      const targetTime = ui.panel.getByRole('group', {
        name: language === 'th' ? 'เวลาคลาสที่ขอ' : 'Requested class time',
        exact: true,
      });
      await expect(targetTime).toContainText('23:00 →');
      await expect(targetTime).toContainText('01:00');
      await expect(targetTime).toContainText(language === 'th' ? '2 ชั่วโมง' : '2 hours');
      await expect(ui.panel.getByText('Exam conflict', { exact: true })).toBeVisible();
      await rows
        .last()
        .screenshot({ path: testInfo.outputPath(`request-review-${language}-${width}.png`) });
      await page.keyboard.press('Escape');
      const disclosure = ui.panel.getByRole('button', { expanded: false });
      await expect(disclosure).toBeFocused();
      await expect(identity.getByText(pendingCopy, { exact: true })).toBeVisible();
      expect(ui.writes).toHaveLength(0);
    });
  }
}

test('closing and reopening a failed request preserves its error, refresh and action locks', async ({
  page,
}) => {
  const ui = await setup(page, 'TUTOR', { requester: 'other', errorStatus: 409 });
  await ui.panel.getByRole('button', { name: 'Approve reschedule', exact: true }).click();
  await expect(ui.panel.getByRole('alert')).toContainText('Refresh before continuing');
  await ui.panel.getByRole('button', { expanded: true }).click();
  await expect(ui.panel.getByRole('alert')).toBeVisible();
  await expect(
    ui.panel.getByRole('button', { name: 'Refresh reschedule and booking' }),
  ).toBeEnabled();
  await ui.open();
  await expect(
    ui.panel.getByRole('button', { name: 'Approve reschedule', exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Cancel class', exact: true })).toBeDisabled();
  expect(ui.writes).toHaveLength(1);
});

test('student payment stays ahead of the optional reschedule form and disclosure preserves its draft', async ({
  page,
}) => {
  const ui = await setup(page, 'STUDENT', { open: false });
  await expect(ui.panel.getByRole('radio')).toHaveCount(0);
  const payment = page.getByRole('region', { name: 'Mock payment', exact: true });
  await expect(payment).toBeVisible();
  expect(
    await payment.evaluate((element) => {
      const reschedule = document.querySelector('section[aria-label="Reschedule class"]');
      return (
        reschedule !== null &&
        Boolean(element.compareDocumentPosition(reschedule) & Node.DOCUMENT_POSITION_FOLLOWING)
      );
    }),
  ).toBe(true);
  await ui.open();
  await ui.panel.getByRole('radio').check();
  await ui.panel.getByRole('textbox').fill('Keep my reason');
  await page.keyboard.press('Escape');
  await expect(ui.panel.getByRole('button', { expanded: false })).toBeFocused();
  await expect(ui.panel.getByRole('radio')).toHaveCount(0);
  await ui.open();
  await expect(ui.panel.getByRole('radio')).toBeChecked();
  await expect(ui.panel.getByRole('textbox')).toHaveValue('Keep my reason');
  expect(ui.writes).toHaveLength(0);
});

test('Thai target selection remains keyboard accessible at 320px', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 740 });
  const ui = await setup(page, 'STUDENT', { language: 'th' });
  await expect(ui.panel.locator('[tabindex="-1"]')).toBeFocused();
  const radio = ui.panel.getByRole('radio');
  await radio.focus();
  await page.keyboard.press('Space');
  await expect(radio).toBeChecked();
  await expect(ui.panel.getByRole('textbox')).toHaveAccessibleName('เหตุผล (ไม่บังคับ)');
  await ui.panel.getByRole('textbox').focus();
  await expect(radio.locator('..')).toContainText('2 ชั่วโมง');
  await expect(radio.locator('..')).toHaveClass(/border-student-deep\/30/);
  await expect(
    ui.panel.getByRole('button', { name: 'ส่งคำขอเลื่อนเวลา', exact: true }),
  ).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await ui.panel.screenshot({ path: testInfo.outputPath('reschedule-thai-mobile.png') });
});
