import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const read = (filePath) => fs.readFile(filePath, 'utf8');

test('preserves the selected guest booking across login and student onboarding', async () => {
  const [proxy, login, bookingShell, profileSession, profileEditor, returnTo] = await Promise.all([
    read('apps/web/src/proxy.ts'),
    read('apps/web/src/components/login.tsx'),
    read('apps/web/src/components/bookings/student-booking-shell.tsx'),
    read('apps/web/src/lib/use-profile-session.ts'),
    read('apps/web/src/components/profile/profile-editor.tsx'),
    read('apps/web/src/lib/return-to.ts'),
  ]);

  assert.match(proxy, /loginUrl\.searchParams\.set\(\s*'returnTo'/);
  assert.match(login, /sanitizeReturnTo\(searchParams\.get\('returnTo'\)\)/);
  assert.match(login, /router\.replace\(returnTo\)/);
  assert.match(bookingShell, /preserveReturnTo: true/);
  assert.match(profileSession, /withReturnTo\(ONBOARDING_PROFILE_PATH, currentPath\)/);
  assert.match(profileEditor, /router\.replace\(readOnboardingReturnTo\(\)\)/);
  assert.match(returnTo, /value\.startsWith\('\/\/'\)/);
  assert.match(returnTo, /value\.includes\('\\\\'\)/);
});

test('gates every private flow route and connects both dashboards to live booking data', async () => {
  const [
    availability,
    listingList,
    listingEditor,
    profileSession,
    tutorDashboard,
    studentDashboard,
    bookingApi,
  ] = await Promise.all([
    read('apps/web/src/components/availability/manage-tutor-availability.tsx'),
    read('apps/web/src/components/listings/tutor-listings-page.tsx'),
    read('apps/web/src/components/listings/tutor-listing-editor.tsx'),
    read('apps/web/src/lib/use-profile-session.ts'),
    read('apps/web/src/components/dashboard/tutor-dashboard.tsx'),
    read('apps/web/src/components/dashboard/student-dashboard.tsx'),
    read('apps/web/src/lib/api/bookings.ts'),
  ]);

  for (const guardedPage of [availability, listingList, listingEditor]) {
    assert.match(guardedPage, /useProfileSession/);
    assert.match(guardedPage, /profileMode: 'required'/);
  }
  assert.match(profileSession, /resolveDashboardGate\(currentProfileResult\)/);
  assert.match(profileSession, /withReturnTo\(ONBOARDING_PROFILE_PATH, currentPath\)/);
  assert.match(tutorDashboard, /loadTutorDashboardBookings\(\{ status: 'PENDING' \}\)/);
  assert.match(tutorDashboard, /status: 'CONFIRMED', from: new Date\(mountedAt\)/);
  assert.match(tutorDashboard, /getTutorAvailability/);
  assert.match(tutorDashboard, /getTutorListings\(\)/);
  assert.match(studentDashboard, /getMyBookings\(\{ pageSize: 100 \}\)/);
  assert.match(
    studentDashboard,
    /bookings: isLoading \|\| loadError \? '—' : String\(bookings\.length\)/,
  );
  assert.match(bookingApi, /authenticatedFetch<TutorBookingsResponse>\(`\/bookings\/tutor/);
});

test('checks the tutor profile gate before loading listing edit dependencies', async () => {
  const listingEditor = await read('apps/web/src/components/listings/tutor-listing-editor.tsx');
  const effectStart = listingEditor.indexOf('useEffect(() => {');
  const effectEnd = listingEditor.indexOf('return () => {', effectStart);
  const loadSequence = listingEditor.slice(effectStart, effectEnd);
  const profileGate = loadSequence.indexOf(
    "if (sessionLoading || profileError || !user || user.role !== 'TUTOR' || !profile) return;",
  );
  const listingRequest = loadSequence.indexOf('getTutorListing(listingId)');

  assert.ok(effectStart >= 0 && effectEnd > effectStart);
  assert.ok(profileGate >= 0 && profileGate < listingRequest);
  assert.match(listingEditor, /requiredRole: 'TUTOR'/);
  assert.match(listingEditor, /profileMode: 'required'/);
});

test('uses one fail-closed tutor allowlist across publish, discovery, availability, and booking', async () => {
  const [
    tutorAccess,
    tutorDirectory,
    tutorListings,
    tutorAvailability,
    bookingService,
    searchPage,
    searchCopy,
    tutorDetail,
    listingEditor,
  ] = await Promise.all([
    read('apps/api/src/modules/tutors/public-tutor-access.ts'),
    read('apps/api/src/modules/tutors/tutor-directory.service.ts'),
    read('apps/api/src/modules/tutors/tutor-listings.service.ts'),
    read('apps/api/src/modules/tutors/tutor-availability.service.ts'),
    read('apps/api/src/modules/bookings/bookings.service.ts'),
    read('apps/web/src/components/tutors/tutor-search-page.tsx'),
    read('apps/web/src/components/tutors/tutor-search-copy.ts'),
    read('apps/web/src/components/tutors/public-tutor-availability.tsx'),
    read('apps/web/src/components/listings/tutor-listing-editor.tsx'),
  ]);

  assert.match(tutorAccess, /verificationStatus: TutorVerificationStatus\.VERIFIED/);
  assert.match(tutorAccess, /accountStatus: AccountStatus\.ACTIVE/);
  assert.match(tutorAccess, /deletedAt: null/);
  assert.match(tutorAccess, /role: Role\.TUTOR/);
  for (const tutorService of [tutorDirectory, tutorListings, tutorAvailability]) {
    assert.match(tutorService, /where: \{ \.\.\.publicTutorWhere, userId/);
  }
  assert.match(bookingService, /findFirst\(\{\s*where: \{ \.\.\.publicTutorWhere, userId:/);
  assert.doesNotMatch(bookingService, /verificationStatus === TutorVerificationStatus\.REJECTED/);
  assert.match(searchPage, /text\.verifiedOnly/);
  assert.match(searchCopy, /VERIFIED TUTORS ONLY/);
  assert.doesNotMatch(searchCopy, /VERIFICATION PENDING/);
  assert.match(tutorDetail, /\{text\.verified\}/);
  assert.doesNotMatch(tutorDetail, /text\.pendingVerification/);
  assert.match(listingEditor, /must be verified before publishing/);
});

test('keeps the walking-skeleton seed bookable and repeated registration safe', async () => {
  const [seed, authService, register, verify] = await Promise.all([
    read('apps/api/src/infrastructure/database/seed/booking-fixtures.seed.ts'),
    read('apps/api/src/modules/auth/auth.service.ts'),
    read('apps/web/src/components/register.tsx'),
    read('apps/web/src/components/verify.tsx'),
  ]);

  assert.match(seed, /DEMO_SLOT_DAYS_AHEAD = 7/);
  assert.match(seed, /setUTCDate\(startAtUtc\.getUTCDate\(\) \+ DEMO_SLOT_DAYS_AHEAD\)/);
  assert.doesNotMatch(seed, /2030-/);
  assert.match(authService, /if \(existing\) \{\s*return \{ message: REGISTRATION_MESSAGE \}/);
  assert.doesNotMatch(
    authService,
    /return this\.resendVerification\(\{ email: existing\.email \}\)/,
  );
  assert.match(register, /err instanceof ApiError && err\.status === 503/);
  assert.match(register, /delivery=failed/);
  assert.doesNotMatch(register, /err instanceof ApiError && err\.status === 409/);
  assert.match(
    register,
    /router\.push\(`\/register\/verify\?email=\$\{encodeURIComponent\(email\)\}`\)/,
  );
  assert.match(verify, /copy\.register\.verificationDeliveryFailed/);
});

test('makes the public booking action role-aware', async () => {
  const detail = await read('apps/web/src/components/tutors/public-tutor-availability.tsx');

  assert.match(
    detail,
    /disabled=\{!selectedListing \|\| Boolean\(user && user\.role !== 'STUDENT'\)\}/,
  );
  assert.match(detail, /router\.push\(user \? bookingPath : withReturnTo\('\/', bookingPath\)\)/);
  assert.match(detail, /text\.studentOnly/);
  assert.match(detail, /text\.signInToChoose/);
});
