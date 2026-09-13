import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const read = (filePath) => fs.readFile(filePath, 'utf8');

test('preserves the selected guest booking across login and student onboarding', async () => {
  const [proxy, login, bookingShell, profileEditor, returnTo] = await Promise.all([
    read('apps/web/src/proxy.ts'),
    read('apps/web/src/components/login.tsx'),
    read('apps/web/src/components/bookings/student-booking-shell.tsx'),
    read('apps/web/src/components/profile/profile-editor.tsx'),
    read('apps/web/src/lib/return-to.ts'),
  ]);

  assert.match(proxy, /loginUrl\.searchParams\.set\(\s*'returnTo'/);
  assert.match(login, /sanitizeReturnTo\(searchParams\.get\('returnTo'\)\)/);
  assert.match(login, /router\.replace\(returnTo\)/);
  assert.match(bookingShell, /withReturnTo\('\/onboarding\/profile', currentBrowserPath\(\)\)/);
  assert.match(profileEditor, /router\.replace\(readOnboardingReturnTo\(\)\)/);
  assert.match(returnTo, /value\.startsWith\('\/\/'\)/);
  assert.match(returnTo, /value\.includes\('\\\\'\)/);
});

test('gates every private flow route and connects both dashboards to live booking data', async () => {
  const [availability, listingList, listingEditor, tutorDashboard, studentDashboard, bookingApi] =
    await Promise.all([
      read('apps/web/src/components/availability/tutor-availability-page.tsx'),
      read('apps/web/src/components/listings/tutor-listings-page.tsx'),
      read('apps/web/src/components/listings/tutor-listing-editor.tsx'),
      read('apps/web/src/components/dashboard/tutor-dashboard.tsx'),
      read('apps/web/src/components/dashboard/student-dashboard.tsx'),
      read('apps/web/src/lib/api/bookings.ts'),
    ]);

  for (const guardedPage of [availability, listingList, listingEditor]) {
    assert.match(guardedPage, /resolveDashboardGate/);
    assert.match(guardedPage, /withReturnTo\('\/onboarding\/profile'/);
  }
  assert.match(tutorDashboard, /getTutorBookings\(\)/);
  assert.match(tutorDashboard, /getTutorAvailability/);
  assert.match(tutorDashboard, /getTutorListings\(\)/);
  assert.match(studentDashboard, /getMyBookings\(\)/);
  assert.match(studentDashboard, /navBadges=\{\{ bookings: String\(bookings\.length\) \}\}/);
  assert.match(bookingApi, /authenticatedFetch<TutorBookingsResponse>\(`\/bookings\/tutor/);
});

test('allows pending tutors to publish while surfacing verification status throughout discovery', async () => {
  const [tutorsService, bookingService, searchPage, tutorDetail, listingEditor] = await Promise.all(
    [
      read('apps/api/src/tutors/tutors.service.ts'),
      read('apps/api/src/bookings/bookings.service.ts'),
      read('apps/web/src/components/tutors/tutor-search-page.tsx'),
      read('apps/web/src/components/tutors/tutor-availability-page.tsx'),
      read('apps/web/src/components/listings/tutor-listing-editor.tsx'),
    ],
  );

  assert.match(
    tutorsService,
    /verificationStatus:\s*\{\s*in: \[TutorVerificationStatus\.PENDING, TutorVerificationStatus\.VERIFIED\]/,
  );
  assert.doesNotMatch(
    tutorsService.match(/async postPublishListing[\s\S]*?\n {2}}/)?.[0] ?? '',
    /verificationStatus|Tutor is not verified/,
  );
  assert.match(bookingService, /verificationStatus === TutorVerificationStatus\.REJECTED/);
  assert.match(searchPage, /result\.verificationStatus === 'VERIFIED'/);
  assert.match(tutorDetail, /detail\.tutor\.verificationStatus === 'VERIFIED'/);
  assert.match(listingEditor, /Students will see that verification is pending/);
});

test('keeps the walking-skeleton seed bookable and registration delivery recoverable', async () => {
  const [seed, authService, register, verify] = await Promise.all([
    read('apps/api/src/database/seed/booking-fixtures.seed.ts'),
    read('apps/api/src/auth/auth.service.ts'),
    read('apps/web/src/components/register.tsx'),
    read('apps/web/src/components/verify.tsx'),
  ]);

  assert.match(seed, /DEMO_SLOT_DAYS_AHEAD = 7/);
  assert.match(seed, /setUTCDate\(startAtUtc\.getUTCDate\(\) \+ DEMO_SLOT_DAYS_AHEAD\)/);
  assert.doesNotMatch(seed, /2030-/);
  assert.match(authService, /return this\.resendVerification\(\{ email: existing\.email \}\)/);
  assert.match(register, /err instanceof ApiError && err\.status === 503/);
  assert.match(register, /delivery=failed/);
  assert.match(verify, /copy\.register\.verificationDeliveryFailed/);
});

test('makes the public booking action role-aware', async () => {
  const detail = await read('apps/web/src/components/tutors/tutor-availability-page.tsx');

  assert.match(
    detail,
    /disabled=\{!selectedListing \|\| Boolean\(user && user\.role !== 'STUDENT'\)\}/,
  );
  assert.match(detail, /router\.push\(user \? bookingPath : withReturnTo\('\/', bookingPath\)\)/);
  assert.match(detail, /text\.studentOnly/);
  assert.match(detail, /text\.signInToChoose/);
});
