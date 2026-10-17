import { expect, test } from '@playwright/test';

import { MAX_BOOKING_DECISION_TEXT_LENGTH } from '@/components/bookings/tutor-booking-inbox-model';

import type { Page, Route } from '@playwright/test';

const expectedResourceFailures = new WeakMap<Page, Set<string>>();

const listingId = '22222222-2222-4222-8222-222222222222';
const maliBookingId = '44444444-4444-4444-8444-444444444444';
const nidaBookingId = '55555555-5555-4555-8555-555555555555';
const ployBookingId = '66666666-6666-4666-8666-666666666666';
const somchaiBookingId = '77777777-7777-4777-8777-777777777777';

const tutorUser = {
  id: 'tutor-e2e',
  email: 'tutor@example.test',
  role: 'TUTOR' as const,
  displayName: 'Teacher Anan',
};
const tutorProfile = {
  firstName: 'Anan',
  lastName: 'Dee',
  nickname: 'Anan',
  displayName: 'Teacher Anan',
  bio: 'Patient mathematics tutor for secondary school students.',
  experienceYears: 5,
  verificationStatus: 'VERIFIED' as const,
  ratingAverage: null,
  reviewCount: 0,
};
const bookingListing = {
  id: listingId,
  subjectId: 'subject-math',
  subjectName: 'Mathematics',
  gradeLevelId: 'grade-10',
  gradeLevelName: 'Grade 10',
  pricePerHour: '500.00',
  description: 'Algebra and geometry lessons tailored to the student.',
};

const requestedBookings = [
  { id: maliBookingId, nickname: 'Mali', startHourUtc: 3 },
  { id: nidaBookingId, nickname: 'Nida', startHourUtc: 5 },
  { id: ployBookingId, nickname: 'Ploy', startHourUtc: 7 },
  { id: somchaiBookingId, nickname: 'Somchai', startHourUtc: 9 },
] as const;

function pendingBooking({
  id,
  nickname,
  startHourUtc,
}: {
  id: string;
  nickname: string;
  startHourUtc: number;
}) {
  const hour = (value: number) => String(value).padStart(2, '0');
  return {
    id,
    status: 'PENDING',
    student: { nickname },
    listing: bookingListing,
    slot: {
      id: `slot-${id}`,
      startAtUtc: `2099-09-20T${hour(startHourUtc)}:00:00.000Z`,
      endAtUtc: `2099-09-20T${hour(startHourUtc + 1)}:00:00.000Z`,
    },
    subtotalAmount: '500.00',
    discountAmount: '0.00',
    netAmount: '500.00',
    currency: 'THB',
    createdAt: '2099-09-14T00:00:00.000Z',
  };
}

test('tutor confirms, rejects and recovers from missing and stale booking requests', async ({
  page,
}) => {
  const listRequests: string[] = [];
  const decisionRequests: { path: string; body: unknown }[] = [];
  // The mock keeps each booking's status so a filtered query answers like the API does.
  const statuses = new Map(requestedBookings.map((item) => [item.id, 'PENDING']));
  const removed = new Set<string>();

  await page.route('**/api/v1/**', async (route) => {
    if (await fulfillInboxSupportingRead(route)) {
      return;
    }
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1', '');

    if (request.method() === 'POST' && path === '/auth/refresh') {
      return json(route, { accessToken: 'e2e-access-token', expiresIn: 900, user: tutorUser });
    }
    if (request.method() === 'GET' && path === '/profiles/me') {
      return json(route, {
        role: tutorUser.role,
        consentCurrent: true,
        policyVersion: '2026-01',
        profileComplete: true,
        profile: tutorProfile,
      });
    }
    if (request.method() === 'GET' && path === '/bookings/tutor') {
      listRequests.push(url.search);
      const wanted = url.searchParams.get('status');
      const items = requestedBookings
        .filter((item) => !removed.has(item.id))
        .map((item) => ({ ...pendingBooking(item), status: statuses.get(item.id) }))
        .filter((booking) => !wanted || booking.status === wanted);
      return json(route, { items, total: items.length });
    }
    if (request.method() === 'POST' && path === `/bookings/tutor/${maliBookingId}/confirm`) {
      decisionRequests.push({ path, body: request.postDataJSON() });
      statuses.set(maliBookingId, 'CONFIRMED');
      return json(route, {
        bookingId: maliBookingId,
        status: 'CONFIRMED',
        slotStatus: 'RESERVED',
        canceledAt: null,
      });
    }
    if (request.method() === 'POST' && path === `/bookings/tutor/${nidaBookingId}/reject`) {
      decisionRequests.push({ path, body: request.postDataJSON() });
      statuses.set(nidaBookingId, 'CANCELED');
      return json(route, {
        bookingId: nidaBookingId,
        status: 'CANCELED',
        slotStatus: 'AVAILABLE',
        canceledAt: '2099-09-15T00:00:00.000Z',
      });
    }
    if (request.method() === 'POST' && path === `/bookings/tutor/${ployBookingId}/confirm`) {
      removed.add(ployBookingId);
      return json(
        route,
        {
          code: 'BOOKING_NOT_FOUND',
          error: 'Not Found',
          message: 'Booking not found',
          statusCode: 404,
        },
        404,
      );
    }
    if (request.method() === 'POST' && path === `/bookings/tutor/${somchaiBookingId}/confirm`) {
      statuses.set(somchaiBookingId, 'CONFIRMED');
      return json(
        route,
        {
          code: 'BOOKING_NOT_PENDING',
          error: 'Conflict',
          message: 'Only a pending booking can be confirmed or rejected; this booking is CONFIRMED',
          statusCode: 409,
        },
        409,
      );
    }
    return unhandled(route, request.method(), path);
  });

  // The dashboard proxy needs the refresh cookie before the mocked session can load.
  await page
    .context()
    .addCookies([{ name: 'hktutor_refresh', value: 'e2e', domain: 'localhost', path: '/' }]);
  await page.goto('/dashboard/bookings');

  await expect(page.getByRole('heading', { name: /Booking inbox/ })).toBeVisible();
  await expectAccessiblePageShell(page);
  expect(listRequests[0]).toBe('?status=PENDING&page=1&pageSize=10');

  const maliRow = page.getByRole('article', { name: 'Mali' });
  const nidaRow = page.getByRole('article', { name: 'Nida' });
  const ployRow = page.getByRole('article', { name: 'Ploy' });
  const somchaiRow = page.getByRole('article', { name: 'Somchai' });
  await expect(page.getByRole('article')).toHaveCount(4);
  await expect(page.getByText('4 bookings PENDING')).toBeVisible();
  await expect(maliRow.getByText('PENDING', { exact: true })).toBeVisible();

  // Confirming keeps the slot reserved and shows the status the server returned.
  await maliRow.getByRole('button', { name: 'Confirm the booking from Mali' }).click();
  const confirmDialog = page.getByRole('dialog');
  await expect(confirmDialog.getByRole('heading', { name: 'Confirm this booking?' })).toBeVisible();
  await confirmDialog.getByRole('button', { name: 'Yes, confirm booking' }).click();

  await expect(page.getByText('Booking confirmed. The lesson time stays reserved.')).toBeVisible();
  // The confirmed request leaves the pending view, and the refetched count follows it.
  await expect(page.getByText('3 bookings PENDING')).toBeVisible();
  await expect(maliRow).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Rejecting sends the tutor's reason and releases the time.
  await nidaRow.getByRole('button', { name: 'Reject the booking from Nida' }).click();
  const rejectDialog = page.getByRole('dialog');
  await expect(rejectDialog.getByRole('heading', { name: 'Reject this booking?' })).toBeVisible();
  await rejectDialog.getByLabel('Reason (optional)').fill('I am no longer available at that time.');
  await rejectDialog.getByRole('button', { name: 'Yes, reject booking' }).click();

  await expect(page.getByText('Booking rejected. The lesson time is open again.')).toBeVisible();
  await expect(page.getByText('2 bookings PENDING')).toBeVisible();
  await expect(nidaRow).toHaveCount(0);
  expect(decisionRequests).toEqual([
    { path: `/bookings/tutor/${maliBookingId}/confirm`, body: {} },
    {
      path: `/bookings/tutor/${nidaBookingId}/reject`,
      body: { reason: 'I am no longer available at that time.' },
    },
  ]);

  // A booking that no longer exists keeps its row so the tutor reads why nothing changed, and the
  // pending count still matches the two rows that are waiting for a reply.
  await ployRow.getByRole('button', { name: 'Confirm the booking from Ploy' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Yes, confirm booking' }).click();

  await expect(
    ployRow.getByText('This booking no longer exists. Refresh the inbox.'),
  ).toBeVisible();
  await expect(ployRow.getByRole('button', { name: /Confirm the booking/ })).toHaveCount(0);
  await expect(ployRow.getByRole('button', { name: 'Refresh', exact: true })).toBeVisible();
  // Nothing was persisted, so the locked row and the count both stay where they were.
  await expect(page.getByRole('article')).toHaveCount(2);
  await expect(page.getByText('2 bookings PENDING')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // A stale row is locked the same way, so no decision is retried against old data.
  await somchaiRow.getByRole('button', { name: 'Confirm the booking from Somchai' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Yes, confirm booking' }).click();

  await expect(
    somchaiRow.getByText(
      'This request is no longer pending. Refresh the inbox to see its current status.',
    ),
  ).toBeVisible();
  await expect(somchaiRow.getByRole('button', { name: /Confirm the booking/ })).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await somchaiRow.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No bookings in this view' })).toBeVisible();
  await expectAccessiblePageShell(page);

  // Every decision is readable in the all-status view with the status the server persisted.
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await expect(maliRow.getByText('CONFIRMED', { exact: true })).toBeVisible();
  await expect(nidaRow.getByText('CANCELED', { exact: true })).toBeVisible();
  await expect(maliRow.getByRole('button', { name: /Confirm the booking/ })).toHaveCount(0);

  // The student-owned booking screens stay closed to a tutor.
  await page.goto(`/dashboard/bookings/new?listingId=${listingId}&slotId=slot-1`);
  await expect(page).toHaveURL((url) => url.pathname === '/dashboard/bookings');
  await expect(page.getByRole('heading', { name: /Booking inbox/ })).toBeVisible();
});

test('paging after a decision skips no request when the pending set shrinks', async ({ page }) => {
  // 21 pending requests: deciding one on page 1 moves request 11 up into it.
  const pending = Array.from({ length: 21 }, (_, index) => ({
    id: `aaaaaaaa-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    nickname: `Student ${String(index + 1).padStart(2, '0')}`,
    startHourUtc: 1 + (index % 20),
  }));
  const decided = new Set<string>();

  await page.route('**/api/v1/**', async (route) => {
    if (await fulfillInboxSupportingRead(route)) {
      return;
    }
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1', '');

    if (request.method() === 'POST' && path === '/auth/refresh') {
      return json(route, { accessToken: 'e2e-access-token', expiresIn: 900, user: tutorUser });
    }
    if (request.method() === 'GET' && path === '/profiles/me') {
      return json(route, {
        role: tutorUser.role,
        consentCurrent: true,
        policyVersion: '2026-01',
        profileComplete: true,
        profile: tutorProfile,
      });
    }
    if (request.method() === 'GET' && path === '/bookings/tutor') {
      const open = pending.filter((item) => !decided.has(item.id));
      const page1 = Number(url.searchParams.get('page') ?? '1');
      const size = Number(url.searchParams.get('pageSize') ?? '10');
      return json(route, {
        items: open.slice((page1 - 1) * size, page1 * size).map(pendingBooking),
        total: open.length,
      });
    }
    const confirmed = pending.find((item) => path === `/bookings/tutor/${item.id}/confirm`);
    if (request.method() === 'POST' && confirmed) {
      decided.add(confirmed.id);
      return json(route, {
        bookingId: confirmed.id,
        status: 'CONFIRMED',
        slotStatus: 'RESERVED',
        canceledAt: null,
      });
    }
    return unhandled(route, request.method(), path);
  });

  await page
    .context()
    .addCookies([{ name: 'hktutor_refresh', value: 'e2e', domain: 'localhost', path: '/' }]);
  await page.goto('/dashboard/bookings');

  await expect(page.getByText('21 bookings PENDING')).toBeVisible();
  await expect(page.getByRole('article', { name: 'Student 01', exact: true })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Student 11', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Confirm the booking from Student 01' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Yes, confirm booking' }).click();
  await expect(page.getByText('20 bookings PENDING')).toBeVisible();

  // The page refetched, so the request that moved up is on page 1 instead of being paged over.
  await expect(page.getByRole('article', { name: 'Student 11', exact: true })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Student 01', exact: true })).toHaveCount(0);

  await page
    .getByRole('navigation', { name: 'Booking inbox pages' })
    .getByRole('button', { name: 'Next', exact: true })
    .click();
  await expect(page.getByRole('article', { name: 'Student 12', exact: true })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(10);
});

test('ended classes link to classroom details and do not record attendance on the card', async ({
  page,
}) => {
  const endedBooking = pendingBooking({
    id: maliBookingId,
    nickname: 'Mali',
    startHourUtc: 3,
  });
  endedBooking.status = 'CONFIRMED';
  endedBooking.slot = {
    ...endedBooking.slot,
    startAtUtc: '2020-09-20T03:00:00.000Z',
    endAtUtc: '2020-09-20T04:00:00.000Z',
  };
  await openMockInbox(page, [endedBooking]);

  await page.getByRole('button', { name: 'All', exact: true }).click();
  const row = page.getByRole('article', { name: 'Mali' });
  await expect(row.getByRole('button', { name: 'Attended', exact: true })).toHaveCount(0);
  await expect(row.getByRole('button', { name: 'Absent', exact: true })).toHaveCount(0);
  await expect(row.getByRole('link', { name: 'Classroom details', exact: true })).toHaveAttribute(
    'href',
    `/dashboard/bookings/${maliBookingId}`,
  );
  await expect(row.getByText('CONFIRMED', { exact: true })).toBeVisible();
});

type InboxBooking = ReturnType<typeof pendingBooking>;
type DecisionAction = 'confirm' | 'reject';

test.describe('decision API response edges', () => {
  const runtimeErrors = new WeakMap<Page, string[]>();

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('hktutor-language', 'en'));
    const errors: string[] = [];
    runtimeErrors.set(page, errors);
    expectedResourceFailures.set(page, new Set());
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      // Only the deliberately failed decision URL is exempt; unexpected resource failures fail QA.
      const expectedFailure =
        message.text().startsWith('Failed to load resource:') &&
        expectedResourceFailures.get(page)?.has(message.location().url);
      if (!expectedFailure) errors.push(message.text());
    });
  });

  test.afterEach(async ({ page }) => {
    // Drain route handlers and keep listeners active through page shutdown, including late errors.
    await page.unrouteAll({ behavior: 'wait' });
    await page.close();
    expect(runtimeErrors.get(page)).toEqual([]);
  });

  for (const action of ['confirm', 'reject'] as const) {
    test(`${action} waits for the API and submits only once while in flight`, async ({ page }) => {
      const bookings = requestedBookings.slice(0, 2).map(pendingBooking);
      let requests = 0;
      let releaseResponse: (() => void) | undefined;
      const heldResponse = new Promise<void>((resolve) => {
        releaseResponse = resolve;
      });
      await openMockInbox(page, bookings, async (route, item) => {
        requests += 1;
        await heldResponse;
        await successfulDecision(route, item, action);
      });
      await page.getByRole('button', { name: 'All', exact: true }).click();
      const mali = page.getByRole('article', { name: 'Mali' });
      const nida = page.getByRole('article', { name: 'Nida' });
      await mali
        .getByRole('button', { name: `${capitalize(action)} the booking from Mali` })
        .click();
      const dialog = page.getByRole('dialog');

      try {
        // Two native submissions verify one visible dialog produces only one API request.
        await dialog.locator('form').evaluate((form: HTMLFormElement) => {
          form.requestSubmit();
          form.requestSubmit();
        });
        await expect.poll(() => requests).toBe(1);
        await expect(mali.getByText('PENDING', { exact: true })).toBeVisible();
        await expect(nida.getByText('PENDING', { exact: true })).toBeVisible();
        await expect(page.getByText('2 bookings All')).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'Working…' })).toBeDisabled();
        await expect(dialog.getByRole('button', { name: 'Keep as pending' })).toBeDisabled();
        await page.keyboard.press('Escape');
        await expect(dialog).toBeVisible();
      } finally {
        releaseResponse?.();
      }

      await expect(dialog).toHaveCount(0);
      await expect(
        mali.getByText(action === 'confirm' ? 'CONFIRMED' : 'CANCELED', { exact: true }),
      ).toBeVisible();
      await expect(nida.getByText('PENDING', { exact: true })).toBeVisible();
      expect(requests).toBe(1);
      await expect(mali.getByRole('button', { name: /the booking from Mali/ })).toHaveCount(0);
    });

    for (const failure of [
      {
        status: 403,
        code: 'BOOKING_NOT_OWNED',
        message: 'This booking belongs to another tutor. Nothing was changed.',
      },
      {
        status: 409,
        code: 'BOOKING_NOT_PENDING',
        message: 'This request is no longer pending. Refresh the inbox to see its current status.',
      },
      {
        status: 409,
        code: 'BOOKING_TRANSITION_CONFLICT',
        message: 'Another update changed this booking first. Refresh the inbox and try again.',
      },
    ]) {
      test(`${action} locks a failed row for ${failure.code} until refresh`, async ({
        page,
      }, testInfo) => {
        const bookings = requestedBookings.slice(0, 2).map(pendingBooking);
        let requests = 0;
        await openMockInbox(page, bookings, async (route) => {
          requests += 1;
          expectedResourceFailures.get(page)?.add(route.request().url());
          await json(route, { code: failure.code, statusCode: failure.status }, failure.status);
        });
        const mali = page.getByRole('article', { name: 'Mali' });
        const nida = page.getByRole('article', { name: 'Nida' });
        await mali
          .getByRole('button', { name: `${capitalize(action)} the booking from Mali` })
          .click();
        await page
          .getByRole('dialog')
          .getByRole('button', { name: `Yes, ${action} booking` })
          .click();

        await expect(mali.getByRole('alert')).toContainText(failure.message);
        await expect(mali.getByText('PENDING', { exact: true })).toBeVisible();
        await expect(page.getByText('2 bookings PENDING')).toBeVisible();
        await expect(mali.getByRole('button', { name: /the booking from Mali/ })).toHaveCount(0);
        await expect(
          nida.getByRole('button', { name: 'Confirm the booking from Nida' }),
        ).toBeEnabled();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(page.getByText(/Booking confirmed\.|Booking rejected\./)).toHaveCount(0);
        expect(requests).toBe(1);

        if (failure.status === 403 && action === 'confirm') {
          await page.screenshot({ path: testInfo.outputPath('inbox-403.png'), fullPage: true });
        }
        // The refreshed API snapshot wins; this fixture represents another request confirming Mali.
        const first = bookings[0];
        if (!first) throw new Error('Mali fixture is missing');
        first.status = 'CONFIRMED';
        await mali.getByRole('button', { name: 'Refresh', exact: true }).click();
        await expect(mali).toHaveCount(0);
        await expect(page.getByText('1 booking PENDING')).toBeVisible();
        await page.getByRole('button', { name: 'All', exact: true }).click();
        await expect(mali.getByText('CONFIRMED', { exact: true })).toBeVisible();
        await expect(mali.getByRole('button', { name: /the booking from Mali/ })).toHaveCount(0);
        expect(requests).toBe(1);
      });
    }

    for (const failure of ['validation', 'server', 'offline'] as const) {
      test(`${action} keeps its dialog and can retry after ${failure}`, async ({ page }) => {
        const bookings = requestedBookings.slice(0, 2).map(pendingBooking);
        let requests = 0;
        await openMockInbox(page, bookings, async (route, item) => {
          requests += 1;
          if (requests === 1) {
            expectedResourceFailures.get(page)?.add(route.request().url());
            if (failure === 'offline') return route.abort('failed');
            return json(
              route,
              { message: 'fixture failure' },
              failure === 'validation' ? 400 : 500,
            );
          }
          return successfulDecision(route, item, action);
        });
        const mali = page.getByRole('article', { name: 'Mali' });
        await mali
          .getByRole('button', { name: `${capitalize(action)} the booking from Mali` })
          .click();
        const dialog = page.getByRole('dialog');
        await dialog.getByRole('button', { name: `Yes, ${action} booking` }).click();
        await expect(dialog.getByRole('alert')).toContainText(
          failure === 'validation'
            ? 'Please check the reason and try again.'
            : 'Something went wrong and nothing was changed. Please try again.',
        );
        await expect(mali.getByText('PENDING', { exact: true })).toBeVisible();
        await expect(page.getByText('2 bookings PENDING')).toBeVisible();
        await expect(page.getByText(/Booking confirmed\.|Booking rejected\./)).toHaveCount(0);
        await expect(dialog.getByRole('button', { name: `Yes, ${action} booking` })).toBeEnabled();
        await dialog.getByRole('button', { name: `Yes, ${action} booking` }).click();
        await expect(dialog).toHaveCount(0);
        await expect(mali).toHaveCount(0);
        await expect(page.getByText('1 booking PENDING')).toBeVisible();
        expect(requests).toBe(2);
        await page.getByRole('button', { name: 'All', exact: true }).click();
        await expect(
          mali.getByText(action === 'confirm' ? 'CONFIRMED' : 'CANCELED', { exact: true }),
        ).toBeVisible();
      });
    }
  }

  for (const length of [
    MAX_BOOKING_DECISION_TEXT_LENGTH - 1,
    MAX_BOOKING_DECISION_TEXT_LENGTH,
    MAX_BOOKING_DECISION_TEXT_LENGTH + 1,
  ]) {
    test(`rejection input respects the 500-character native limit for ${length} characters`, async ({
      page,
    }) => {
      const bookings = requestedBookings.slice(0, 1).map(pendingBooking);
      const bodies: unknown[] = [];
      await openMockInbox(page, bookings, async (route, item) => {
        bodies.push(route.request().postDataJSON());
        await successfulDecision(route, item, 'reject');
      });
      await page.getByRole('button', { name: 'Reject the booking from Mali' }).click();
      const dialog = page.getByRole('dialog');
      const reason = dialog.getByLabel('Reason (optional)');
      await reason.fill('x'.repeat(length));
      const acceptedLength = Math.min(length, MAX_BOOKING_DECISION_TEXT_LENGTH);
      await expect(reason).toHaveValue('x'.repeat(acceptedLength));
      await expect(
        dialog.getByText(
          `Up to ${MAX_BOOKING_DECISION_TEXT_LENGTH} characters. (${acceptedLength}/${MAX_BOOKING_DECISION_TEXT_LENGTH})`,
        ),
      ).toBeVisible();
      await dialog.getByRole('button', { name: 'Yes, reject booking' }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(bodies).toEqual([{ reason: 'x'.repeat(acceptedLength) }]);
      await expect(
        page.getByText('Booking rejected. The lesson time is open again.'),
      ).toBeVisible();
    });
  }

  test('blank rejection text is omitted and the API result decides the status', async ({
    page,
  }) => {
    const bookings = requestedBookings.slice(0, 1).map(pendingBooking);
    const bodies: unknown[] = [];
    await openMockInbox(page, bookings, async (route, item) => {
      bodies.push(route.request().postDataJSON());
      await successfulDecision(route, item, 'reject');
    });
    await page.getByRole('button', { name: 'Reject the booking from Mali' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Reason (optional)').fill('   ');
    await dialog.getByRole('button', { name: 'Yes, reject booking' }).click();
    await expect(dialog).toHaveCount(0);
    expect(bodies).toEqual([{}]);
    await expect(page.getByText('Booking rejected. The lesson time is open again.')).toBeVisible();
  });

  test('the all-status inbox offers decisions only for PENDING', async ({ page }, testInfo) => {
    const bookings = ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELED', 'EXPIRED'].map(
      (status, index) => ({
        ...pendingBooking({
          id: `status-${status}`,
          nickname: `Student ${status}`,
          startHourUtc: index + 3,
        }),
        status,
      }),
    );
    await openMockInbox(page, bookings);
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await expect(page.getByRole('article')).toHaveCount(5);
    for (const status of ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELED', 'EXPIRED']) {
      const row = page.getByRole('article', { name: `Student ${status}` });
      await expect(row.getByText(status, { exact: true })).toBeVisible();
      await expect(row.getByRole('button', { name: /the booking from/ })).toHaveCount(
        status === 'PENDING' ? 2 : 0,
      );
    }
    await expectAccessiblePageShell(page);
    if ((page.viewportSize()?.width ?? 0) < 640) {
      await page.setViewportSize({ width: 320, height: 800 });
    }
    const pending = page.getByRole('article', { name: 'Student PENDING' });
    for (const language of ['en', 'th'] as const) {
      if (language === 'th') {
        await page.getByRole('button', { name: 'Switch language to Thai' }).click();
      }
      await page.keyboard.press('Tab');
      const actions = pending.getByRole('button', {
        name:
          language === 'th' ? /^(ยืนยัน|ปฏิเสธ)การจองจาก /u : /^(Confirm|Reject) the booking from /,
      });
      await expect(actions).toHaveCount(2);
      for (const action of await actions.all()) {
        await expect(action.locator('svg')).toHaveCount(1);
        await expect(action.locator('svg')).toHaveAttribute('aria-hidden', 'true');
        const bounds = await action.boundingBox();
        expect(bounds?.height).toBeGreaterThanOrEqual(46);
        expect(await action.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
          true,
        );
        await action.focus();
        await expect(action).toHaveCSS('outline-style', 'solid');
      }
      const confirm = actions.last();
      const stub = confirm.locator('svg').locator('..');
      await expect(stub).toHaveCSS('border-right-style', 'dashed');
      await expect(confirm).toHaveText(language === 'th' ? 'ยืนยัน' : 'Confirm');
      await expectAccessiblePageShell(page);
      await pending.screenshot({ path: testInfo.outputPath(`inbox-actions-${language}.png`) });
    }
    await page.screenshot({ path: testInfo.outputPath('inbox-states.png'), fullPage: true });
  });
});

async function openMockInbox(
  page: Page,
  bookings: InboxBooking[],
  decide?: (route: Route, item: InboxBooking, action: DecisionAction) => Promise<void>,
): Promise<void> {
  await page.route('**/api/v1/**', async (route) => {
    if (await fulfillInboxSupportingRead(route)) {
      return;
    }
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1', '');
    if (request.method() === 'POST' && path === '/auth/refresh') {
      return json(route, { accessToken: 'e2e-access-token', expiresIn: 900, user: tutorUser });
    }
    if (request.method() === 'GET' && path === '/profiles/me') {
      return json(route, {
        role: tutorUser.role,
        consentCurrent: true,
        policyVersion: '2026-01',
        profileComplete: true,
        profile: tutorProfile,
      });
    }
    if (request.method() === 'GET' && path === '/bookings/tutor') {
      const status = url.searchParams.get('status');
      const items = bookings.filter((item) => !status || item.status === status);
      return json(route, { items, total: items.length });
    }
    if (request.method() === 'POST' && decide) {
      for (const item of bookings) {
        for (const action of ['confirm', 'reject'] as const) {
          if (path === `/bookings/tutor/${item.id}/${action}`) return decide(route, item, action);
        }
      }
    }
    return unhandled(route, request.method(), path);
  });
  await page
    .context()
    .addCookies([{ name: 'hktutor_refresh', value: 'e2e', domain: 'localhost', path: '/' }]);
  await page.goto('/dashboard/bookings');
  await expect(page).toHaveURL((url) => url.pathname === '/dashboard/bookings');
  await expect(page).toHaveTitle(/HKTutor/);
  await expect(page.getByRole('heading', { name: /Booking inbox/ })).toBeVisible();
  await expectAccessiblePageShell(page);
}

async function successfulDecision(
  route: Route,
  item: InboxBooking,
  action: DecisionAction,
): Promise<void> {
  item.status = action === 'confirm' ? 'CONFIRMED' : 'CANCELED';
  await json(route, {
    bookingId: item.id,
    status: item.status,
    slotStatus: action === 'confirm' ? 'RESERVED' : 'AVAILABLE',
    canceledAt: action === 'confirm' ? null : '2099-09-15T00:00:00.000Z',
  });
}

function capitalize(action: DecisionAction): string {
  return action === 'confirm' ? 'Confirm' : 'Reject';
}

async function expectAccessiblePageShell(page: Page) {
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveCount(1);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const root = document.scrollingElement ?? document.documentElement;
        return root.scrollWidth - root.clientWidth;
      }),
    )
    .toBeLessThanOrEqual(1);
}

async function fulfillInboxSupportingRead(route: Route): Promise<boolean> {
  const request = route.request();
  if (request.method() !== 'GET') {
    return false;
  }
  const path = new URL(request.url()).pathname.replace('/api/v1', '');
  if (path === '/notifications') {
    await json(route, { items: [], nextCursor: null, unreadCount: 0 });
    return true;
  }
  if (path === '/profiles/me/avatar') {
    await json(route, { avatar: null });
    return true;
  }
  if (/^\/bookings\/[^/]+\/reschedule-requests\/current$/.test(path)) {
    // These booking-inbox fixtures contain no pending reschedule requests.
    await json(route, { request: null, targetSlot: null, allowedActions: [] });
    return true;
  }
  return false;
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function unhandled(route: Route, method: string, path: string) {
  return json(route, { message: `Unhandled E2E request: ${method} ${path}` }, 500);
}
