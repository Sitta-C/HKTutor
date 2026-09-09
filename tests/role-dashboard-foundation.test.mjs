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
