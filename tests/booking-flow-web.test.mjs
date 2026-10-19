import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const clientPath = 'apps/web/src/lib/api/bookings.ts';
const typesPath = 'apps/web/src/lib/api/types.ts';
const confirmationPath = 'apps/web/src/components/bookings/booking-confirmation-page.tsx';
const listPath = 'apps/web/src/components/bookings/student-bookings-page.tsx';
const detailPath = 'apps/web/src/components/bookings/student-booking-detail-page.tsx';
const availabilityPath = 'apps/web/src/components/tutors/public-tutor-availability.tsx';
const paginationPath = 'apps/web/src/components/ui/notebook-pagination.tsx';

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

  assert.match(
    availability,
    /getPublicTutorAvailability\(tutorId, \{ from: availabilityFrom, to: availabilityTo \}\)/,
  );
  assert.match(availability, /dashboard\/bookings\/new\?listingId=/);
  assert.match(confirmation, /getBookingQuote\(listingId, slotId\)/);
  assert.match(confirmation, /createBookingOnce\(\{ listingId, slotId \}/);
  assert.doesNotMatch(confirmation, /submitInFlight\.current = true/);
  assert.doesNotMatch(confirmation, /studentUserId|pricePerHour:|netAmount:/);
  assert.match(confirmation, /status === 409/);
  assert.match(confirmation, /text\.chooseAnotherTime/);
  assert.match(confirmation, /disabled=\{isSubmitting\}/);
  assert.match(confirmation, /setQuote\(null\)/);
  assert.match(confirmation, /formatBangkokDateTime\(activeCreated\.createdAt, language\)/);
  assert.doesNotMatch(
    confirmation,
    /formatBangkokRange\(activeCreated\.createdAt, activeCreated\.createdAt/,
  );
  assert.doesNotMatch(confirmation, /bookingCopy/);
  assert.match(confirmation, /copy\.dashboard\.booking/);
});

test('renders Student-owned list/detail states and an explicit empty state', async () => {
  const [list, detail, pagination] = await Promise.all([
    fs.readFile(listPath, 'utf8'),
    fs.readFile(detailPath, 'utf8'),
    fs.readFile(paginationPath, 'utf8'),
  ]);

  assert.match(list, /getMyBookings\(/);
  assert.match(list, /items\.length === 0/);
  assert.match(list, /emptyTitle/);
  assert.match(list, /status/);
  assert.match(list, /pageSize: BOOKINGS_PAGE_SIZE/);
  assert.match(list, /setPage\(1\)/);
  assert.match(
    list,
    /<NotebookPagination\s[^>]*page=\{page\}[^>]*total=\{total\}[^>]*pageSize=\{BOOKINGS_PAGE_SIZE\}[^>]*onPageChange=/,
  );
  assert.match(pagination, /const pageCount = Math\.ceil\(total \/ pageSize\)/);
  assert.match(pagination, /if \(pageCount <= 1\) \{\s*return null;/);
  assert.match(pagination, /disabled=\{page === 1\}/);
  assert.match(pagination, /disabled=\{page === pageCount\}/);
  assert.match(pagination, /onPageChange\(page - 1\)/);
  assert.match(pagination, /onPageChange\(page \+ 1\)/);
  assert.match(detail, /getMyBooking\(bookingId\)/);
  assert.match(detail, /getBookingErrorMessage/);
  assert.match(detail, /dashboard\/bookings/);
});

test('ties booking-list loading to the selected filter, page and refresh request', async () => {
  const list = await fs.readFile(listPath, 'utf8');
  const effect = list.match(/useEffect\(\(\) => \{([\s\S]*?)\n {2}\}, \[([^\]]+)\]\);/);

  assert.ok(effect, 'the booking list must load from an effect');
  assert.match(effect[1], /getMyBookings\(\{[\s\S]*?status: filter[\s\S]*?page,/);
  assert.deepEqual(
    effect[2].split(',').map((value) => value.trim()),
    ['filter', 'page', 'reloadKey', 'selectionKey'],
  );
  assert.match(effect[1], /\.then\(\(response\) => \{\s*if \(!active\) return;/);
  assert.match(effect[1], /\.catch\(\(caught: unknown\) => \{\s*if \(!active\) return;/);
  assert.match(effect[1], /return \(\) => \{\s*active = false;/);
  assert.equal([...effect[1].matchAll(/setLoadedSelection\(selectionKey\)/g)].length, 2);
  assert.match(list, /const selectionKey = `\$\{filter\}:\$\{page\}:\$\{reloadKey\}`/);
  assert.match(list, /const selectionLoaded = loadedSelection === selectionKey/);
  assert.match(list, /const loading = isLoading \|\| !selectionLoaded/);
  assert.match(list, /const countsAvailable = !loading && error === null && total !== null/);
  assert.match(
    list,
    /if \(filter === value && page === 1\) return;\s*setIsLoading\(true\);\s*setFilter\(value\);\s*setPage\(1\);/,
  );
  assert.match(list, /role="group" aria-label=\{text\.status\}/);
});
