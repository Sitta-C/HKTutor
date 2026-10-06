import { expect, test } from '@playwright/test';

import type { Page, Route } from '@playwright/test';

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
  // Whatever leaves PENDING on the server drops out of the next inbox reload.
  const pendingOnServer = new Set(requestedBookings.map((item) => item.id));

  await page.route('**/api/v1/**', async (route) => {
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
      const items = requestedBookings
        .filter((item) => pendingOnServer.has(item.id))
        .map(pendingBooking);
      return json(route, { items, total: items.length });
    }
    if (request.method() === 'POST' && path === `/bookings/tutor/${maliBookingId}/confirm`) {
      decisionRequests.push({ path, body: request.postDataJSON() });
      pendingOnServer.delete(maliBookingId);
      return json(route, {
        bookingId: maliBookingId,
        status: 'CONFIRMED',
        slotStatus: 'RESERVED',
        canceledAt: null,
      });
    }
    if (request.method() === 'POST' && path === `/bookings/tutor/${nidaBookingId}/reject`) {
      decisionRequests.push({ path, body: request.postDataJSON() });
      pendingOnServer.delete(nidaBookingId);
      return json(route, {
        bookingId: nidaBookingId,
        status: 'CANCELED',
        slotStatus: 'AVAILABLE',
        canceledAt: '2099-09-15T00:00:00.000Z',
      });
    }
    if (request.method() === 'POST' && path === `/bookings/tutor/${ployBookingId}/confirm`) {
      pendingOnServer.delete(ployBookingId);
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
      pendingOnServer.delete(somchaiBookingId);
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

  const requests = page.getByRole('list', { name: 'Booking requests' });
  const maliRow = requests.getByRole('listitem').filter({ hasText: 'Mali' });
  const nidaRow = requests.getByRole('listitem').filter({ hasText: 'Nida' });
  const ployRow = requests.getByRole('listitem').filter({ hasText: 'Ploy' });
  const somchaiRow = requests.getByRole('listitem').filter({ hasText: 'Somchai' });
  await expect(requests.getByRole('listitem')).toHaveCount(4);
  await expect(page.getByText('4 requests awaiting your reply')).toBeVisible();
  await expect(maliRow.getByText('PENDING', { exact: true })).toBeVisible();

  // Confirming keeps the slot reserved and shows the status the server returned.
  await maliRow.getByRole('button', { name: 'Confirm the booking from Mali' }).click();
  const confirmDialog = page.getByRole('dialog');
  await expect(confirmDialog.getByRole('heading', { name: 'Confirm this booking?' })).toBeVisible();
  await confirmDialog.getByRole('button', { name: 'Yes, confirm booking' }).click();

  await expect(page.getByText('Booking confirmed. The lesson time stays reserved.')).toBeVisible();
  await expect(maliRow.getByText('CONFIRMED', { exact: true })).toBeVisible();
  await expect(maliRow.getByRole('button', { name: /Confirm the booking/ })).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Rejecting sends the tutor's reason and releases the time.
  await nidaRow.getByRole('button', { name: 'Reject the booking from Nida' }).click();
  const rejectDialog = page.getByRole('dialog');
  await expect(rejectDialog.getByRole('heading', { name: 'Reject this booking?' })).toBeVisible();
  await rejectDialog.getByLabel('Reason (optional)').fill('I am no longer available at that time.');
  await rejectDialog.getByRole('button', { name: 'Yes, reject booking' }).click();

  await expect(page.getByText('Booking rejected. The lesson time is open again.')).toBeVisible();
  await expect(nidaRow.getByText('CANCELED', { exact: true })).toBeVisible();
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
  await expect(ployRow.getByRole('button', { name: 'Refresh' })).toBeVisible();
  await expect(requests.getByRole('listitem')).toHaveCount(4);
  await expect(page.getByText('2 requests awaiting your reply')).toBeVisible();
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

  await somchaiRow.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByRole('heading', { name: 'No bookings in this view' })).toBeVisible();
  await expectAccessiblePageShell(page);

  // The student-owned booking screens stay closed to a tutor.
  await page.goto(`/dashboard/bookings/new?listingId=${listingId}&slotId=slot-1`);
  await expect(page).toHaveURL((url) => url.pathname === '/dashboard/bookings');
  await expect(page.getByRole('heading', { name: /Booking inbox/ })).toBeVisible();
});

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

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function unhandled(route: Route, method: string, path: string) {
  return json(route, { message: `Unhandled E2E request: ${method} ${path}` }, 500);
}
