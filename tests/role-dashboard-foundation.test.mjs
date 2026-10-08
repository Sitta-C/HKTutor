import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const read = (file) => fs.readFile(file, 'utf8');

test('dashboard navigation contract isolates Student, Tutor, and Admin roles', async () => {
  const navSource = await read('apps/web/src/lib/dashboard-navigation.ts');

  // Must export the view resolver and nav item getters
  assert.match(navSource, /export function resolveDashboardView/);
  assert.match(navSource, /export function getDashboardNavItems/);
  assert.match(navSource, /export function getUserInitial/);

  // Safe fallback must return admin and never fall through to student or tutor
  assert.match(navSource, /return\s+['"]admin['"]/);
  assert.doesNotMatch(navSource, /default:\s*return\s+['"]student['"]/);
  assert.doesNotMatch(navSource, /default:\s*return\s+['"]tutor['"]/);
});

test('dashboard navigation returns distinct items per role', async () => {
  const navSource = await read('apps/web/src/lib/dashboard-navigation.ts');
  const navItemsStart = navSource.indexOf('export function getDashboardNavItems');

  const studentNav = navSource.slice(
    navSource.indexOf("if (role === 'STUDENT')", navItemsStart),
    navSource.indexOf("if (role === 'TUTOR')", navItemsStart),
  );
  const tutorNav = navSource.slice(
    navSource.indexOf("if (role === 'TUTOR')", navItemsStart),
    navSource.indexOf('// Explicit safe ADMIN navigation', navItemsStart),
  );
  assert.match(studentNav, /href: '\/dashboard\/bookings'/);
  assert.doesNotMatch(studentNav, /\/dashboard\/listings|\/dashboard\/availability/);
  assert.match(tutorNav, /href: '\/dashboard\/listings'/);
  assert.match(tutorNav, /href: '\/dashboard\/availability'/);
  assert.doesNotMatch(tutorNav, /\/dashboard\/bookings/);
  // Admin navigation must only have privacy and sign out
  const adminNav = navSource.slice(
    navSource.lastIndexOf('// Explicit safe ADMIN navigation'),
    navSource.indexOf('export function getUserDisplayName'),
  );
  assert.doesNotMatch(adminNav, /myBookings|myListings|availability/);
});

test('dashboard i18n defines symmetric EN and TH copies', async () => {
  const i18nSource = await read('apps/web/src/lib/i18n.tsx');

  assert.match(i18nSource, /dashboard:\s*{/);

  // Both EN and TH must contain the dashboard sections
  const enMatch = i18nSource.match(/en:\s*{[\s\S]*?dashboard:\s*{([\s\S]*?)}\s*,\s*},/);
  const thMatch = i18nSource.match(/th:\s*{[\s\S]*?dashboard:\s*{([\s\S]*?)}\s*,\s*},/);

  assert.ok(enMatch, 'dashboard section must exist in en translations');
  assert.ok(thMatch, 'dashboard section must exist in th translations');

  for (const section of ['sidebar', 'header', 'nav', 'common', 'student', 'tutor', 'admin']) {
    assert.match(enMatch[1], new RegExp(`${section}:\\s*{`));
    assert.match(thMatch[1], new RegExp(`${section}:\\s*{`));
  }
});

test('role selection never reads from localStorage, cookies, or URL search params', async () => {
  const [navSource, i18nSource] = await Promise.all([
    read('apps/web/src/lib/dashboard-navigation.ts'),
    read('apps/web/src/lib/i18n.tsx'),
  ]);

  // dashboard-navigation must not touch window, document, localStorage, or URL
  assert.doesNotMatch(
    navSource,
    /localStorage|sessionStorage|URLSearchParams|window\.location|document\.cookie/,
  );
  // i18n dashboard translations should not hardcode fake user booking data as real
  assert.doesNotMatch(i18nSource, /Pim · Mathematics · 450฿/);
});

test('dashboard shell enforces accessibility, responsive toggle, and visible focus states', async () => {
  const shellSource = await read('apps/web/src/components/dashboard/dashboard-shell.tsx');
  const languageSwitch = await read('apps/web/src/components/public/public-ui.tsx');

  // Accessible buttons and aria labels
  assert.match(shellSource, /aria-label={copy\.dashboard\.sidebar\.closeSidebar}/);
  assert.match(shellSource, /aria-label={copy\.dashboard\.sidebar\.openSidebar}/);
  assert.match(shellSource, /<LanguageSwitch\s*\/>/);
  assert.match(languageSwitch, /aria-pressed={language === 'th'}/);
  assert.match(shellSource, /aria-hidden="true"/);
  assert.match(shellSource, /aria-controls="dashboard-sidebar"/);
  assert.match(shellSource, /aria-expanded=/);
  assert.match(shellSource, /inert={isMobileSidebar && isSidebarCollapsed/);
  assert.match(shellSource, /focus-visible:ring-2/);
  assert.match(shellSource, /motion-reduce:transition-none/);
  assert.match(shellSource, /window\.matchMedia\('\(max-width: 1023px\)'\)/);
  assert.match(shellSource, /lg:grid-cols-\[5rem_minmax\(0,1fr\)\]/);
  assert.match(shellSource, /mt-auto border-t border-dashed/);
});

test('role-specific views render distinct content with honest empty states', async () => {
  const [studentSource, tutorSource, adminSource, i18nSource] = await Promise.all([
    read('apps/web/src/components/dashboard/student-dashboard.tsx'),
    read('apps/web/src/components/dashboard/tutor-dashboard.tsx'),
    read('apps/web/src/components/dashboard/admin-dashboard.tsx'),
    read('apps/web/src/lib/i18n.tsx'),
  ]);

  // Student view features
  assert.match(studentSource, /studentCopy\.plannerEyebrow/);
  assert.match(studentSource, /studentCopy\.tutorsFromBookings/);
  assert.match(studentSource, /studentCopy\.noUpcomingLessons/);
  assert.match(studentSource, /studentCopy\.noTutorsYetTitle/);
  // Student view must not have tutor listings or availability panels
  assert.doesNotMatch(studentSource, /myListings/);
  assert.doesNotMatch(studentSource, /manageAvailability/);

  // Tutor view features
  assert.match(tutorSource, /tutorCopy\.eyebrow/);
  assert.match(tutorSource, /tutorCopy\.bookingRequests/);
  assert.match(tutorSource, /TutorDashboardAnalytics/);
  assert.match(tutorSource, /tutorCopy\.todayBangkokTime/);
  assert.match(tutorSource, /tutorCopy\.noUpcomingSessions/);
  assert.doesNotMatch(tutorSource, /dash-earnings-value|dash-strength|dash-qa|type="search"/);
  assert.doesNotMatch(i18nSource, /thisMonth:\s*['"]0฿/);
  // Tutor view must not have student-specific panels
  assert.doesNotMatch(tutorSource, /studentCopy\.yourTutors/);

  // Admin view features
  assert.match(adminSource, /dash-role-chip-admin/);
  assert.match(adminSource, /adminCopy\.notice/);
  assert.match(adminSource, /adminCopy\.signOutButton/);
  // Admin view must never render student/tutor features
  assert.doesNotMatch(adminSource, /studentCopy|tutorCopy|dash-summary/);

  // Neither student nor tutor view presents fake mock bookings as real user data
  assert.doesNotMatch(studentSource, /Pim · 450฿/);
  assert.doesNotMatch(tutorSource, /4,050฿/);
});

test('dashboard page derives role only from the centralized profile session', async () => {
  const [pageSource, profileSession] = await Promise.all([
    read('apps/web/src/app/dashboard/page.tsx'),
    read('apps/web/src/lib/use-profile-session.ts'),
  ]);

  assert.match(pageSource, /useProfileSession/);
  assert.match(pageSource, /profileMode: 'required'/);
  assert.match(profileSession, /useAuth\(\)/);
  assert.match(pageSource, /if\s*\(\s*user\.role\s*===\s*['"]STUDENT['"]\s*\)/);
  assert.match(pageSource, /if\s*\(\s*user\.role\s*===\s*['"]TUTOR['"]\s*\)/);
  // Explicit safe Admin fallback
  assert.match(pageSource, /return\s+<AdminDashboard/);

  // Guards against flashing content during loading or unauthenticated
  assert.match(pageSource, /if\s*\(\s*isLoading\s*\|\|\s*!user\s*\)/);
  assert.match(pageSource, /<DashboardLoading\s*\/>/);
  const loadingSource = await read('apps/web/src/components/ui/notebook-loading.tsx');
  assert.match(loadingSource, /role="status"/);

  assert.match(profileSession, /if \(!allowGuest\) router\.replace\('\/'\)/);

  // Never inspects query params, searchParams, window, or localStorage for role
  assert.doesNotMatch(
    pageSource,
    /searchParams|localStorage|sessionStorage|location\.search|document\.cookie/,
  );
});
