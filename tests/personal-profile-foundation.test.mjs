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
});
