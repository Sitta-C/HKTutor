import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const clientPath = 'apps/web/src/lib/api/bookings.ts';
const typesPath = 'apps/web/src/lib/api/types.ts';
const confirmationPath = 'apps/web/src/components/bookings/booking-confirmation-page.tsx';
const listPath = 'apps/web/src/components/bookings/student-bookings-page.tsx';
const detailPath = 'apps/web/src/components/bookings/student-booking-detail-page.tsx';
const availabilityPath = 'apps/web/src/components/tutors/tutor-availability-page.tsx';

test('defines the finalized S1-T24 booking client contracts for S1-T25', async () => {
  const client = await fs.readFile(clientPath, 'utf8');
  const types = await fs.readFile(typesPath, 'utf8');

  assert.match(client, /getBookingQuote\(listingId: string, slotId: string\)/);
  assert.ok(client.includes('authenticatedFetch<BookingQuote>(`/bookings/quote?'));
  assert.match(client, /createBooking\(payload: CreateBookingPayload\)/);
  assert.match(client, /authenticatedFetch<BookingResponse>\('\/bookings'/);
  assert.match(client, /getMyBookings\(queryInput: MyBookingsQuery/);
  assert.ok(client.includes('authenticatedFetch<MyBookingsResponse>(`/bookings/me'));
  assert.match(client, /getMyBooking\(bookingId: string\)/);
  assert.match(client, /createBookingOnce/);

  for (const field of [
    'BookingStatus',
    'CreateBookingPayload',
    'BookingQuote',
    'BookingResponse',
    'BookingView',
    'BookingDetail',
    'MyBookingsResponse',
  ]) {
    assert.match(types, new RegExp(`export (?:type|interface) ${field}`));
  }
});

test('connects selected public availability to quote and create without client authority fields', async () => {
  const confirmation = await fs.readFile(confirmationPath, 'utf8');
  const availability = await fs.readFile(availabilityPath, 'utf8');

  assert.match(availability, /getPublicTutorAvailability\(tutorId\)/);
  assert.match(availability, /dashboard\/bookings\/new\?listingId=/);
  assert.match(confirmation, /getBookingQuote\(listingId, slotId\)/);
  assert.match(confirmation, /createBookingOnce\(\{ listingId, slotId \}/);
  assert.doesNotMatch(confirmation, /submitInFlight\.current = true/);
  assert.doesNotMatch(confirmation, /studentUserId|pricePerHour:|netAmount:/);
  assert.match(confirmation, /status === 409/);
  assert.match(confirmation, /Choose another time/);
  assert.match(confirmation, /disabled=\{isSubmitting\}/);
});

test('renders Student-owned list/detail states and an explicit empty state', async () => {
  const list = await fs.readFile(listPath, 'utf8');
  const detail = await fs.readFile(detailPath, 'utf8');

  assert.match(list, /getMyBookings\(/);
  assert.match(list, /items\.length === 0/);
  assert.match(list, /emptyTitle/);
  assert.match(list, /status/);
  assert.match(detail, /getMyBooking\(bookingId\)/);
  assert.match(detail, /getBookingErrorMessage/);
  assert.match(detail, /dashboard\/bookings/);
});
