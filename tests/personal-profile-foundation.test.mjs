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
  const controller = await read('apps/api/src/profiles/profiles.controller.ts');
  const service = await read('apps/api/src/profiles/profiles.service.ts');

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
  const styles = await read('apps/web/src/app/globals.css');
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
  assert.match(editor, /await acceptCurrentPrivacyNotice\(\);[\s\S]*await getMyProfile\(\)/);
  assert.match(
    dashboard,
    /error instanceof ApiError && error\.status === 400[\s\S]*replace\('\/onboarding\/profile'\)/,
  );
  assert.match(verify, /replace\('\/onboarding\/profile'\)/);
  assert.match(navigation, /href: '\/dashboard\/profile'/);
  assert.match(editor, /profile-form-card \$\{studentRole \? 'student' : 'tutor'\}/);
  assert.match(editor, /profile-grid \$\{studentRole \? 'student' : 'tutor'\}/);
  assert.match(editor, /className="profile-summary-row"/);
  assert.match(editor, /onboardingNoteTitle/);
  assert.match(editor, /secondaryDetail/);
  assert.match(editor, /className="profile-status-dot"/);
  assert.doesNotMatch(editor, /className="profile-read-only-icon"/);
  assert.doesNotMatch(editor, /label={text\.privacyNotice}/);
  assert.match(
    editor,
    /const savedShellName = studentRole[\s\S]*initialStudent\.nickname\.trim\(\)[\s\S]*initialTutor\.displayName\.trim\(\)/,
  );
  assert.doesNotMatch(
    editor,
    /const shellName = studentRole \? student\.nickname\.trim\(\) : tutor\.nickname\.trim\(\)/,
  );
  assert.match(
    listingsPage,
    /setProfileDisplayName\(tutorProfile\?\.displayName\.trim\(\) \|\| null\)/,
  );
  assert.match(listingsPage, /<DashboardShell[\s\S]*user={shellUser}/);
  assert.match(listingsPage, /if \(!profileDisplayName\)[\s\S]*return <ListingPageState>/);
  assert.match(
    listingEditor,
    /if \(!profile\)[\s\S]*const profileDisplayName = profile\.displayName\.trim\(\)[\s\S]*<DashboardShell user={shellUser}/,
  );
  assert.doesNotMatch(listingEditor, /profile\?\.displayName \|\| user\.email/);
  assert.match(
    styles,
    /\.profile-grid\.student\s*{[\s\S]*?minmax\(0, 1\.35fr\) minmax\(290px, 0\.75fr\)/,
  );
  assert.match(
    styles,
    /\.profile-grid\.tutor\s*{[\s\S]*?minmax\(0, 1\.4fr\) minmax\(300px, 0\.82fr\)/,
  );
  assert.match(styles, /\.profile-public-card::after/);
  assert.match(styles, /\.profile-summary-row\s*{/);
  assert.match(styles, /\.profile-status-dot\s*{/);
  assert.match(
    styles,
    /\.profile-system-info\.student\s*{[\s\S]*?minmax\(0, 2fr\) minmax\(180px, 1fr\)/,
  );
  assert.match(
    styles,
    /\.profile-system-info\.tutor\s*{[\s\S]*?minmax\(220px, 1\.8fr\)[\s\S]*?repeat\(3, minmax\(110px, 1fr\)\)/,
  );
  assert.match(
    styles,
    /\.profile-system-info > \.profile-read-only:first-child b\s*{[\s\S]*?overflow-wrap: anywhere/,
  );
  assert.match(styles, /\.profile-form-card\.student \.profile-field input:focus/);
  assert.match(styles, /\.profile-form-card\.tutor \.profile-field input:focus/);
});

test('keeps profile prototypes aligned with the production sidebar controls', async () => {
  const profileEditor = await read('apps/web/src/components/profile/profile-editor.tsx');
  const dashboardShell = await read('apps/web/src/components/dashboard/dashboard-shell.tsx');

  assert.doesNotMatch(profileEditor, /visualVariant=/);
  assert.match(dashboardShell, /className="dash-art"/);

  for (const role of ['student', 'tutor']) {
    const prototype = await read(`ui-design/pages/${role}-profile.html`);
    const sidebar = prototype.match(/<aside class="dash-sidebar"[\s\S]*?<\/aside>/)?.[0];

    assert.ok(sidebar, `${role} production-aligned sidebar must exist`);
    assert.match(prototype, /href="\.\.\/\.\.\/apps\/web\/src\/app\/globals\.css"/);
    assert.match(prototype, /class="dash-root"/);
    assert.match(prototype, /class="dash-art"/);
    assert.match(prototype, /class="blob dash-b1"/);
    assert.match(prototype, /class="blob dash-b2"/);
    assert.match(prototype, new RegExp(`class="blob dash-b3-${role}"`));
    assert.match(prototype, /class="dash-app"/);
    assert.match(prototype, /class="dash-sidebar"/);
    assert.match(prototype, /class="dash-rail-toggle"/);
    assert.match(prototype, /class="dash-sidebar-backdrop"/);
    assert.match(prototype, /class="dash-header"/);
    assert.match(prototype, /class="dash-lang-btn"/);
    assert.match(prototype, /class="dash-cta"/);
    assert.match(prototype, /class="dash-main"/);
    assert.match(prototype, /class="dash-footer"/);
    assert.match(prototype, /dashboardApp\.classList\.toggle\('sb-collapsed'/);
    assert.match(prototype, /hktutor-sidebar-collapsed/);
    assert.match(prototype, new RegExp(`href="dashboard-${role}\\.html"`));
    assert.match(prototype, /\.system-info>\.read-only:first-child b{[^}]*overflow-wrap:anywhere/);
    assert.doesNotMatch(prototype, /document\.body\.classList\.toggle\('sb-collapsed'/);
    assert.doesNotMatch(prototype, /dash-app-profile|dash-notification/);
    assert.doesNotMatch(sidebar, /class="(?:sidebar|sb-head|logo|rail-toggle|sb-close|side-nav)\b/);
    assert.doesNotMatch(sidebar, /<span class="ico">(?:▦|👤|📅|⚙️|🛟|🔒|↩)/u);
  }

  const studentPrototype = await read('ui-design/pages/student-profile.html');
  const studentStatusStrip = studentPrototype.match(
    /<div class="system-info"[\s\S]*?<div class="form-actions">/,
  )?.[0];
  assert.ok(studentStatusStrip, 'student status strip must exist');
  assert.doesNotMatch(studentStatusStrip, /Privacy notice/);
  assert.match(studentPrototype, /\.system-info{grid-template-columns:minmax\(0,2fr\)/);
});

test('uses the production dashboard shell across every remaining product prototype', async () => {
  const sharedShell = await read('ui-design/shared/prototype-shell.js');
  const productionShell = await read('apps/web/src/components/dashboard/dashboard-shell.tsx');
  const sharedPages = ['availability', 'booking', 'listing-form', 'search'];
  const dashboardPages = ['dashboard-student', 'dashboard-tutor'];

  for (const className of [
    'dash-root',
    'dash-art',
    'dash-app',
    'dash-sidebar-backdrop',
    'dash-sidebar',
    'dash-logo',
    'dash-rail-toggle',
    'dash-sb-close',
    'dash-side-nav',
    'dash-header',
    'dash-lang-btn',
    'dash-main',
    'dash-footer',
  ]) {
    assert.match(productionShell, new RegExp(className));
    assert.match(sharedShell, new RegExp(className));
  }

  assert.match(sharedShell, /class="blob dash-b1"/);
  assert.match(sharedShell, /class="blob dash-b2"/);
  assert.match(sharedShell, /class="blob dash-b3-/);
  assert.match(sharedShell, /dashboardApp\.classList\.toggle\('sb-collapsed'/);
  assert.match(sharedShell, /hktutor-sidebar-collapsed/);
  assert.match(sharedShell, /id === active \? ' class="is-active" aria-current="page"'/);
  assert.doesNotMatch(sharedShell, /proto-sidebar|proto-header|reopen-logo/);

  for (const pageName of [...sharedPages, ...dashboardPages]) {
    const prototype = await read('ui-design/pages/' + pageName + '.html');
    assert.match(prototype, /href="\.\.\/\.\.\/apps\/web\/src\/app\/globals\.css"/);
    assert.match(prototype, /src="\.\.\/shared\/prototype-shell\.js"/);
    assert.match(prototype, /HKTutorPrototype\.mount\(/);
  }

  for (const pageName of dashboardPages) {
    const prototype = await read('ui-design/pages/' + pageName + '.html');
    assert.match(prototype, /active: 'dashboard'/);
    assert.doesNotMatch(prototype, /class="reopen-logo"|class="sidebar"|class="app"|class="art"/);
    assert.doesNotMatch(prototype, /function toggleSidebar\(/);
  }
});

test('keeps tracked web contributor and UI design docs free of personal work state', async () => {
  const webGuide = await read('apps/web/AGENTS.md');
  const design = await read('ui-design/uidesign.md');

  assert.match(webGuide, /stable web-specific framework guidance/);
  assert.match(webGuide, /BEGIN:nextjs-agent-rules/);
  assert.match(design, /11 existing route pages/);
  assert.match(design, /production `dash-\*` element structure/);
  assert.doesNotMatch(webGuide, /reviewed through|Tonnam|First\/P|Korpai/);
  assert.doesNotMatch(design, /reviewed through|Tonnam|First\/P|Korpai/);
});
