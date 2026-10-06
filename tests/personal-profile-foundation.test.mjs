import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const migrationsRoot = 'apps/api/prisma/migrations';
const migrationSuffix = '_add_personal_profiles';
const read = (filePath) => fs.readFile(filePath, 'utf8');

async function readMigration() {
  const entries = await fs.readdir(migrationsRoot, { withFileTypes: true });
  const matches = entries.filter(
    (entry) => entry.isDirectory() && entry.name.endsWith(migrationSuffix),
  );
  assert.equal(matches.length, 1, 'personal-profile migration must exist exactly once');
  return read(path.join(migrationsRoot, matches[0].name, 'migration.sql'));
}

test('adds role-specific personal profile fields without putting private names on User', async () => {
  const schema = await read('apps/api/prisma/schema.prisma');

  assert.match(
    schema,
    /model StudentProfile\s*{[\s\S]*firstName\s+String[\s\S]*lastName\s+String[\s\S]*nickname\s+String[\s\S]*school\s+String[\s\S]*gradeLevel\s+String[\s\S]*phone\s+String/,
  );
  assert.match(schema, /studentProfile\s+StudentProfile\?/);
  assert.match(
    schema,
    /model TutorProfile\s*{[\s\S]*firstName\s+String\?[\s\S]*lastName\s+String\?[\s\S]*nickname\s+String\?[\s\S]*displayName\s+String/,
  );

  const userBlock = schema.match(/model User\s*{([\s\S]*?)\n}/)?.[1] ?? '';
  assert.doesNotMatch(userBlock, /^\s*(firstName|lastName|nickname|phone)\s/m);
});

test('creates the student profile table with bounded nonempty data and restrictive ownership', async () => {
  const sql = await readMigration();

  assert.match(sql, /CREATE TABLE "StudentProfile"/i);
  for (const column of ['firstName', 'lastName', 'nickname', 'school', 'gradeLevel', 'phone']) {
    assert.match(sql, new RegExp(`"${column}"\\s+TEXT\\s+NOT NULL`, 'i'));
  }
  assert.match(sql, /StudentProfile_names_nonempty_check/);
  assert.match(sql, /StudentProfile_education_nonempty_check/);
  assert.match(sql, /StudentProfile_phone_length_check/);
  assert.match(
    sql,
    /FOREIGN KEY \("userId"\) REFERENCES "User"\("id"\)\s+ON DELETE RESTRICT ON UPDATE CASCADE/i,
  );
  assert.match(sql, /ALTER TABLE "TutorProfile"[\s\S]*ADD COLUMN "firstName" TEXT/);
});

test('exposes owner-only profile APIs and requires current consent for private reads and writes', async () => {
  const controller = await read('apps/api/src/modules/profiles/profiles.controller.ts');
  const service = await read('apps/api/src/modules/profiles/profiles.service.ts');

  assert.match(controller, /@Controller\('profiles\/me'\)/);
  assert.match(controller, /@UseGuards\(JwtAuthGuard\)/);
  assert.match(controller, /@Put\('student'\)[\s\S]*@Roles\(Role\.STUDENT\)/);
  assert.match(controller, /@Put\('tutor'\)[\s\S]*@Roles\(Role\.TUTOR\)/);
  assert.match(service, /ensureCurrentConsent/);
  assert.match(service, /CURRENT_PRIVACY_POLICY_VERSION/);
  assert.match(service, /Accept the current privacy notice before viewing a profile/);
  assert.doesNotMatch(service, /select:\s*{[^}]*passwordHash/s);
});

test('adds profile onboarding/edit pages and redirects verified users to onboarding', async () => {
  const dashboard = await read('apps/web/src/app/dashboard/page.tsx');
  const editor = await read('apps/web/src/components/profile/profile-editor.tsx');
  const listingEditor = await read('apps/web/src/components/listings/tutor-listing-editor.tsx');
  const listingsPage = await read('apps/web/src/components/listings/tutor-listings-page.tsx');
  const profileSession = await read('apps/web/src/lib/use-profile-session.ts');
  const verify = await read('apps/web/src/components/verify.tsx');
  const navigation = await read('apps/web/src/lib/dashboard-navigation.ts');

  for (const field of [
    'firstName',
    'lastName',
    'nickname',
    'school',
    'gradeLevel',
    'phone',
    'displayName',
    'bio',
    'experienceYears',
  ]) {
    assert.match(editor, new RegExp(`\\b${field}\\b`));
  }
  assert.match(editor, /acceptCurrentPrivacyNotice/);
  assert.match(
    editor,
    /await acceptCurrentPrivacyNotice\(\);[\s\S]*await loadCurrentProfile\(user\.id, \{ force: true \}\)/,
  );
  assert.match(dashboard, /useProfileSession/);
  assert.match(dashboard, /profileMode: 'required'/);
  assert.match(profileSession, /isProfileSetupError\(currentProfileError\)/);
  assert.match(profileSession, /router\.replace\(onboardingPath\(preserveReturnTo\)\)/);
  assert.match(verify, /replace\('\/onboarding\/profile'\)/);
  assert.match(navigation, /href: '\/dashboard\/profile'/);
  assert.match(editor, /min-\[1061px\]:grid-cols/);
  assert.match(editor, /<PaperCard/);
  assert.match(editor, /<Identity/);
  assert.match(editor, /onboardingNoteTitle/);
  assert.match(editor, /secondaryDetail/);
  assert.match(editor, /statusTone/);
  assert.doesNotMatch(editor, /label={text\.privacyNotice}/);
  assert.match(
    editor,
    /const savedShellName = studentRole[\s\S]*initialStudent\.nickname\.trim\(\)[\s\S]*initialTutor\.displayName\.trim\(\)/,
  );
  assert.doesNotMatch(
    editor,
    /const shellName = studentRole \? student\.nickname\.trim\(\) : tutor\.nickname\.trim\(\)/,
  );
  assert.match(listingsPage, /useProfileSession/);
  assert.match(listingsPage, /<DashboardShell[\s\S]*user={profileUser}/);
  assert.match(listingsPage, /if \(profileError \|\| !profileUser \|\| !tutorProfile\)/);
  assert.match(listingEditor, /if \(profileError \|\| !profile \|\| !profileUser\)/);
  assert.match(listingEditor, /<DashboardShell user={profileUser}/);
  assert.doesNotMatch(listingEditor, /profile\?\.displayName \|\| user\.email/);
  assert.doesNotMatch(editor, /profile-form-card|profile-grid|profile-summary-row/);
});

test('connects profile identity and the production sidebar to shared signed avatar rendering', async () => {
  const profileEditor = await read('apps/web/src/components/profile/profile-editor.tsx');
  const dashboardShell = await read('apps/web/src/components/dashboard/dashboard-shell.tsx');
  const avatar = await read('apps/web/src/components/profile/profile-avatar.tsx');

  assert.doesNotMatch(profileEditor, /visualVariant=/);
  assert.match(profileEditor, /imageUrl\?: string \| null/);
  assert.match(profileEditor, /<OwnProfileAvatar/);
  assert.match(profileEditor, /<AvatarEditor/);
  assert.match(avatar, /loadAvatar\(key, publicTutorId\)/);
  assert.match(avatar, /<Image[\s\S]*src={url}/);
  assert.match(avatar, /unoptimized/);
  assert.match(avatar, /<span aria-hidden="true">{fallback}<\/span>/);
  assert.match(dashboardShell, /userAvatarUrl\?: string \| null/);
  assert.match(dashboardShell, /imageUrl={userAvatarUrl}/);
  assert.match(dashboardShell, /function SidebarAvatar/);
});

test('uses the production dashboard shell across product feature surfaces', async () => {
  const productionShell = await read('apps/web/src/components/dashboard/dashboard-shell.tsx');
  const featureFiles = [
    'apps/web/src/components/availability/manage-tutor-availability.tsx',
    'apps/web/src/components/bookings/student-booking-shell.tsx',
    'apps/web/src/components/listings/tutor-listing-editor.tsx',
    'apps/web/src/components/listings/tutor-listings-page.tsx',
    'apps/web/src/components/tutors/public-tutor-search-shell.tsx',
  ];

  assert.match(productionShell, /id="dashboard-sidebar"/);
  assert.match(productionShell, /aria-controls="dashboard-sidebar"/);
  assert.match(productionShell, /window\.matchMedia\('\(max-width: 1023px\)'\)/);
  assert.match(productionShell, /mt-auto border-t border-dashed/);
  for (const filePath of featureFiles) {
    assert.match(await read(filePath), /DashboardShell/);
  }
});

test('keeps the tracked UI design reference free of personal work state', async () => {
  const design = await read('ui-design/uidesign.md');

  assert.match(design, /16 existing route pages/);
  assert.match(design, /production code and tests are authoritative/);
  assert.doesNotMatch(design, /reviewed through|Tonnam|First\/P|Korpai/);
});
