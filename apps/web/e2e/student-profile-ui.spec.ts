import { expect, test } from '@playwright/test';

import type { StudentProfile } from '@/lib/api/types';
import type { Page } from '@playwright/test';

// Preview fixtures only: every API response is intercepted; no real account is changed.
const student: StudentProfile = {
  firstName: 'Mint',
  lastName: 'Preview',
  nickname: 'Mint',
  school: 'Preview school',
  gradeLevel: 'Grade 10 / classroom A',
  phone: '0812345678',
};
const tutor = {
  firstName: 'Anan',
  lastName: 'Preview',
  nickname: 'Anan',
  displayName: 'Anan',
  bio: 'Mathematics tutor',
  experienceYears: 5,
  verificationStatus: 'VERIFIED',
  ratingAverage: null,
  reviewCount: 0,
};

async function mockProfile(
  page: Page,
  options: {
    language?: 'en' | 'th';
    empty?: boolean;
    consent?: boolean;
    role?: 'STUDENT' | 'TUTOR';
    long?: boolean;
    loading?: boolean;
    loadFailure?: boolean;
  } = {},
) {
  const role = options.role ?? 'STUDENT';
  let profile = role === 'STUDENT' ? { ...student } : { ...tutor };
  if (options.long && 'school' in profile) {
    profile.nickname = 'ชื่อเล่นตัวอย่างที่ยาวมากสำหรับตรวจการตัดบรรทัด'.repeat(2);
    profile.school = 'Preview International School '.repeat(5);
    profile.gradeLevel = 'Grade 10 / classroom A / additional class information '.repeat(2);
  }
  const email = options.long
    ? 'student.long-address-for-responsive-preview@example.test'
    : 'preview@example.test';
  let complete = !options.empty;
  let consentCurrent = options.consent ?? true;
  let signedIn = true;
  const writes: { path: string; payload: unknown }[] = [];
  const calls: string[] = [];
  const state = { saveStatus: 200, holdSave: false };
  let releaseLoad = () => {};
  const loadGate = new Promise<void>((resolve) => {
    releaseLoad = resolve;
  });
  let releaseSave = () => {};
  const saveGate = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(
    (language) => localStorage.setItem('hktutor-language', language),
    options.language ?? 'en',
  );
  await page
    .context()
    .addCookies([
      { name: 'hktutor_refresh', value: 'profile-preview', url: 'http://localhost:3000' },
    ]);
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    const method = request.method();
    calls.push(`${method} ${path}`);
    if (path === '/auth/refresh') {
      return route.fulfill({
        status: signedIn ? 200 : 401,
        json: signedIn
          ? {
              accessToken: 'preview-token',
              user: { id: 'profile-preview', email, role, displayName: 'Preview' },
            }
          : { message: 'Signed out' },
      });
    }
    if (path === '/profiles/me') {
      if (options.loading) await loadGate;
      return route.fulfill({
        status: options.loadFailure ? 500 : 200,
        json: options.loadFailure
          ? { message: 'Preview load error' }
          : {
              role,
              consentCurrent,
              profileComplete: complete,
              policyVersion: '2026-09-30',
              profile: complete ? profile : null,
            },
      });
    }
    if (path === '/profiles/me/avatar') return route.fulfill({ json: { avatar: null } });
    if (method !== 'GET') writes.push({ path, payload: request.postDataJSON() });
    if (path === '/auth/consent') {
      consentCurrent = true;
      return route.fulfill({
        json: { policyVersion: '2026-09-30', consentAcceptedAt: '2026-10-07T00:00:00Z' },
      });
    }
    if (method === 'PUT' && path === `/profiles/me/${role.toLowerCase()}`) {
      if (state.holdSave) await saveGate;
      if (state.saveStatus !== 200)
        return route.fulfill({
          status: state.saveStatus,
          json: {
            message:
              state.saveStatus === 400
                ? ['phone must be a valid phone number']
                : 'Preview save error',
          },
        });
      profile = { ...profile, ...request.postDataJSON() };
      complete = true;
      return route.fulfill({ json: profile });
    }
    if (path === '/auth/logout') {
      signedIn = false;
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ status: 404, json: { message: 'No preview response' } });
  });
  return { state, writes, calls, releaseLoad, releaseSave, email };
}

async function fillStudent(page: Page) {
  for (const [field, value] of Object.entries(student)) {
    await page.locator(`#${field}`).fill(` ${value} `);
  }
}

for (const language of ['en', 'th'] as const) {
  test(`private paper summary fits long text at 1440, 768 and 320px (${language})`, async ({
    page,
  }, testInfo) => {
    const fixture = await mockProfile(page, { language, long: true });
    await page.goto('/dashboard/profile');
    const summary = page.getByRole('complementary', {
      name: language === 'en' ? 'Account summary' : 'สรุปบัญชี',
    });
    await expect(summary).toBeVisible();
    await expect(
      summary.getByText(
        language === 'en' ? 'Kept in your private profile' : 'เก็บไว้ในโปรไฟล์ส่วนตัว',
      ),
    ).toBeVisible();
    await expect(
      summary.getByText(language === 'en' ? 'What tutors can see' : 'ข้อมูลที่ติวเตอร์มองเห็น'),
    ).toBeVisible();
    await expect(summary.getByText(student.firstName, { exact: true })).toHaveCount(0);
    await expect(summary.getByText(fixture.email, { exact: true })).toHaveCount(0);
    for (const width of [1440, 768, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(page.locator('form').getByText(fixture.email, { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect(await summary.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      await expect
        .poll(() =>
          summary.evaluate((element, viewportWidth) => {
            const form = document.querySelector('main form');
            if (!form) return false;
            const formBox = form.getBoundingClientRect();
            const summaryBox = element.getBoundingClientRect();
            return viewportWidth === 1440
              ? summaryBox.left > formBox.right
              : summaryBox.top > formBox.bottom;
          }, width),
        )
        .toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`student-profile-${language}-${width}.png`),
        fullPage: true,
      });
    }
    expect(fixture.calls.filter((call) => /catalog|grade-levels/.test(call))).toEqual([]);
  });
}

test('edit updates the private summary, cancel resets it, and saving preserves the six-field payload', async ({
  page,
}) => {
  const fixture = await mockProfile(page);
  await page.goto('/dashboard/profile');
  await page.locator('#nickname').fill('Mint Updated');
  const summary = page.getByRole('complementary', { name: 'Account summary' });
  await expect(summary.getByRole('heading', { name: 'Mint Updated' })).toBeVisible();
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('#nickname')).toHaveValue('Mint');
  await expect(summary.getByRole('heading', { name: 'Mint', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
  await fillStudent(page);
  fixture.state.holdSave = true;
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saving…', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
  fixture.releaseSave();
  await expect(page.getByText('Profile saved successfully', { exact: true })).toBeVisible();
  expect(fixture.writes).toEqual([{ path: '/profiles/me/student', payload: student }]);
  await expect(page.getByText('Unsaved changes', { exact: true })).toHaveCount(0);
});

test('empty onboarding validates all six fields, focuses errors and keeps failed edits for retry', async ({
  page,
}) => {
  const fixture = await mockProfile(page, { empty: true });
  await page.goto('/onboarding/profile?returnTo=%2Fdashboard%2Fprofile');
  const submit = page.getByRole('button', { name: 'Save and continue', exact: true });
  await submit.click();
  await expect(page.locator('#firstName')).toBeFocused();
  await expect(page.locator('form input[aria-invalid="true"]')).toHaveCount(6);
  expect(fixture.writes).toEqual([]);
  await fillStudent(page);
  await page.locator('#phone').fill('invalid');
  await submit.click();
  await expect(page.locator('#phone')).toBeFocused();
  expect(fixture.writes).toEqual([]);
  await page.locator('#phone').fill(student.phone);
  fixture.state.saveStatus = 400;
  await submit.click();
  await expect(page.locator('#phone')).toBeFocused();
  await expect(page.locator('#phone')).toHaveAttribute('aria-invalid', 'true');
  fixture.state.saveStatus = 500;
  await page.locator('#phone').fill(student.phone);
  await submit.click();
  await expect(page.locator('form').getByRole('alert')).toContainText('Unable to save');
  await expect(page.locator('#school')).toHaveValue(` ${student.school} `);
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();
  fixture.state.saveStatus = 200;
  await submit.click();
  await expect(page).toHaveURL(/\/dashboard\/profile$/);
  await expect(page.locator('#gradeLevel')).toHaveValue(student.gradeLevel);
});

test('consent stays required, opens the notice and hands completed accounts back to returnTo', async ({
  page,
}) => {
  const fixture = await mockProfile(page, { consent: false });
  await page.goto('/onboarding/profile?returnTo=%2Fdashboard%2Fprofile');
  await expect(page.locator('#firstName')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save and continue', exact: true }).click();
  await expect(page.locator('#policy')).toHaveAttribute('aria-invalid', 'true');
  expect(fixture.writes).toEqual([]);
  await page.getByRole('button', { name: 'HKTutor privacy notice', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.locator('#policy').check();
  await page.getByRole('button', { name: 'Save and continue', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/profile$/);
  expect(fixture.writes.map((write) => write.path)).toEqual(['/auth/consent']);
});

test('student loading and load errors retain the shell; onboarding sign-out remains available', async ({
  page,
}) => {
  const fixture = await mockProfile(page, { empty: true, loading: true, loadFailure: true });
  await page.goto('/onboarding/profile');
  await expect(page.getByRole('status').filter({ hasText: 'Loading profile…' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Dashboard top navigation' })).toBeVisible();
  fixture.releaseLoad();
  await expect(page.locator('form').getByRole('alert')).toContainText('Unable to load');
  await expect(
    page
      .getByRole('navigation', { name: 'Dashboard top navigation' })
      .getByRole('button', { name: 'Sign out', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Dashboard top navigation' })
    .getByRole('button', { name: 'Sign out', exact: true })
    .click();
  await expect(page).toHaveURL('http://localhost:3000/');
  expect(fixture.writes.map((write) => write.path)).toEqual(['/auth/logout']);
});

test('tutor onboarding keeps the chosen public preview, validation and original save contract', async ({
  page,
}) => {
  const fixture = await mockProfile(page, { role: 'TUTOR', empty: true });
  await page.goto('/onboarding/profile?returnTo=%2Fdashboard%2Fprofile');
  await page.getByRole('button', { name: 'Save and continue', exact: true }).click();
  await expect(page.locator('#bio')).toBeFocused();
  for (const [field, value] of Object.entries(tutor).slice(0, 6)) {
    await page.locator(`#${field}`).fill(String(value));
  }
  await expect(page.getByRole('complementary', { name: 'Student view' })).toBeVisible();
  await page.getByRole('button', { name: 'Save and continue', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/profile$/);
  expect(fixture.writes).toEqual([
    {
      path: '/profiles/me/tutor',
      payload: {
        firstName: tutor.firstName,
        lastName: tutor.lastName,
        nickname: tutor.nickname,
        displayName: tutor.displayName,
        bio: tutor.bio,
        experienceYears: tutor.experienceYears,
      },
    },
  ]);
});
