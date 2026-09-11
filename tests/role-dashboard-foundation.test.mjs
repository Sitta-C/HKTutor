import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const read = (file) => fs.readFile(file, 'utf8');

test('dashboard navigation contract isolates Student, Tutor, and Admin roles', async () => {
  const navSource = await read('apps/web/src/lib/dashboard-navigation.ts');

  // Must export the view resolver and nav item getters
  assert.match(navSource, /export function resolveDashboardView/);
  assert.match(navSource, /export function getDashboardNavItems/);
  assert.match(navSource, /export function getDashboardRoleConfig/);

  // Safe fallback must return admin and never fall through to student or tutor
  assert.match(navSource, /return\s+['"]admin['"]/);
  assert.doesNotMatch(navSource, /default:\s*return\s+['"]student['"]/);
  assert.doesNotMatch(navSource, /default:\s*return\s+['"]tutor['"]/);
});

test('dashboard navigation returns distinct items per role', async () => {
  const navSource = await read('apps/web/src/lib/dashboard-navigation.ts');

  // Student specific navigation: myBookings
  assert.match(navSource, /role === ['"]STUDENT['"][\s\S]*myBookings/);
  // Tutor specific navigation: myListings and availability
  assert.match(navSource, /role === ['"]TUTOR['"][\s\S]*myListings/);
  assert.match(navSource, /role === ['"]TUTOR['"][\s\S]*availability/);
  // Admin navigation must only have privacy and sign out
  const adminNav = navSource.slice(navSource.lastIndexOf('// Explicit safe ADMIN navigation'));
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
  const [shellSource, cssSource] = await Promise.all([
    read('apps/web/src/components/dashboard/dashboard-shell.tsx'),
    read('apps/web/src/app/globals.css'),
  ]);

  // Accessible buttons and aria labels
  assert.match(shellSource, /aria-label={copy\.dashboard\.sidebar\.closeSidebar}/);
  assert.match(shellSource, /aria-label={copy\.dashboard\.sidebar\.openSidebar}/);
  assert.match(shellSource, /aria-pressed={language === 'th'}/);
  assert.match(shellSource, /aria-hidden="true"/);
  assert.match(shellSource, /className="dash-rail-toggle"/);
  assert.match(shellSource, /href="\/dashboard"[\s\S]*className="dash-logo"/);
  assert.doesNotMatch(shellSource, /className="dash-reopen-logo"/);

  // Focus visible styles
  assert.match(cssSource, /\.dash-sb-close:focus-visible/);
  assert.match(cssSource, /\.dash-rail-toggle:focus-visible/);
  assert.match(cssSource, /\.dash-lang-btn:focus-visible/);

  // Responsive sidebar rail keeps navigation available while collapsed
  assert.match(cssSource, /\.dash-app\.sb-collapsed \.dash-sidebar/);
  assert.match(cssSource, /flex-basis:\s*4\.75rem/);
  assert.match(cssSource, /\.dash-app\.sb-collapsed \.dash-side-nav a/);
  assert.match(cssSource, /@media \(max-width: 960px\)/);
  assert.match(cssSource, /\.dash-header nav > a:not\(\.dash-cta\)/);
  assert.match(cssSource, /white-space:\s*nowrap/);
  assert.match(cssSource, /@media \(prefers-reduced-motion: reduce\)/);
});

test('role-specific views render distinct content with honest empty states', async () => {
  const [studentSource, tutorSource, adminSource, i18nSource] = await Promise.all([
    read('apps/web/src/components/dashboard/student-dashboard.tsx'),
    read('apps/web/src/components/dashboard/tutor-dashboard.tsx'),
    read('apps/web/src/components/dashboard/admin-dashboard.tsx'),
    read('apps/web/src/lib/i18n.tsx'),
  ]);

  // Student view features
  assert.match(studentSource, /dash-role-chip-student/);
  assert.match(studentSource, /studentCopy\.yourTutors/);
  assert.match(studentSource, /studentCopy\.noUpcomingLessons/);
  assert.match(studentSource, /studentCopy\.noTutorsYetTitle/);
  // Student view must not have tutor listings or availability panels
  assert.doesNotMatch(studentSource, /myListings/);
  assert.doesNotMatch(studentSource, /manageAvailability/);

  // Tutor view features
  assert.match(tutorSource, /dash-role-chip-tutor/);
  assert.match(tutorSource, /tutorCopy\.bookingRequests/);
  assert.match(tutorSource, /tutorCopy\.myListings/);
  assert.match(tutorSource, /tutorCopy\.todayBangkokTime/);
  assert.match(tutorSource, /tutorCopy\.noUpcomingSessions/);
  assert.match(tutorSource, /dash-earnings-value/);
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

test('dashboard page derives role only from AuthContext and enforces loading/unauthenticated safeguards', async () => {
  const pageSource = await read('apps/web/src/app/dashboard/page.tsx');

  // Must import useAuth
  assert.match(pageSource, /import\s+{\s*useAuth\s*}\s+from\s+['"]@\/lib\/auth-context['"]/);

  // Derives role strictly from AuthContext user
  assert.match(pageSource, /const\s+{\s*isLoading,\s*logout,\s*user\s*}\s*=\s*useAuth\(\)/);
  assert.match(pageSource, /if\s*\(\s*user\.role\s*===\s*['"]STUDENT['"]\s*\)/);
  assert.match(pageSource, /if\s*\(\s*user\.role\s*===\s*['"]TUTOR['"]\s*\)/);
  // Explicit safe Admin fallback
  assert.match(pageSource, /return\s+<AdminDashboard/);

  // Guards against flashing content during loading or unauthenticated
  assert.match(pageSource, /if\s*\(\s*isLoading\s*\|\|\s*!user\s*\)/);
  assert.match(pageSource, /role="status"/);

  // Unauthenticated redirect to root
  assert.match(
    pageSource,
    /if\s*\(\s*!isLoading\s*&&\s*!user\s*\)\s*{\s*router\.replace\(['"]\/['"]\)/,
  );

  // Never inspects query params, searchParams, window, or localStorage for role
  assert.doesNotMatch(
    pageSource,
    /searchParams|localStorage|sessionStorage|location\.search|document\.cookie/,
  );
});
