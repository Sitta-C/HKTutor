import { expect, test } from '@playwright/test';

import type { SaveTutorProfilePayload, TutorProfile } from '@/lib/api/types';
import type { Page } from '@playwright/test';

const tutorProfile: TutorProfile = {
  firstName: 'Anan',
  lastName: 'Dee',
  nickname: 'Anan',
  displayName: 'Anan',
  bio: 'Mathematics tutor',
  experienceYears: 5,
  verificationStatus: 'VERIFIED',
  ratingAverage: '4.80',
  reviewCount: 24,
};

async function mockProfile(
  page: Page,
  options: {
    meta?: Partial<TutorProfile>;
    language?: 'en' | 'th';
    email?: string;
    student?: boolean;
  } = {},
) {
  const calls: string[] = [];
  let profile = { ...tutorProfile, ...options.meta };
  const studentProfile = {
    firstName: 'Nan',
    lastName: 'Dee',
    nickname: 'Nan',
    school: 'Example School',
    gradeLevel: 'Grade 10',
    phone: '0812345678',
  };
  await page
    .context()
    .addCookies([
      { name: 'hktutor_refresh', value: 'ui-test-session', url: 'http://localhost:3000' },
    ]);
  await page.addInitScript(
    (language) => window.localStorage.setItem('hktutor-language', language),
    options.language ?? 'th',
  );
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    calls.push(`${request.method()} ${path}`);
    let body: unknown;
    if (path === '/auth/refresh') {
      body = {
        accessToken: 'ui-test-token',
        user: {
          id: 'profile-ui',
          email: options.email ?? 'tutor@example.test',
          role: options.student ? 'STUDENT' : 'TUTOR',
          displayName: options.student ? 'Nan' : 'Anan',
        },
      };
    } else if (path === '/profiles/me') {
      body = {
        role: options.student ? 'STUDENT' : 'TUTOR',
        consentCurrent: true,
        profileComplete: true,
        policyVersion: '2026-01',
        profile: options.student ? studentProfile : profile,
      };
    } else if (path === '/profiles/me/tutor' && request.method() === 'PUT') {
      const payload: SaveTutorProfilePayload = request.postDataJSON();
      profile = { ...profile, ...payload, ratingAverage: '3.50', reviewCount: 25 };
      body = profile;
    } else {
      await route.fulfill({ status: 404, json: { message: 'Not found' } });
      return;
    }
    await route.fulfill({ json: body });
  });
  return calls;
}

test('shows real metadata and five fractional stars without submitting the form', async ({
  page,
}) => {
  const calls = await mockProfile(page, {
    meta: { ratingAverage: '4.40', reviewCount: 33, verificationStatus: 'REJECTED' },
  });
  await page.goto('/dashboard/profile');
  const summary = page.getByRole('region', { name: 'สรุปบัญชีติวเตอร์' });
  await expect(summary.getByRole('img', { name: 'คะแนน 4.4 จาก 5 ดาว' })).toBeVisible();
  await expect(summary.getByText('จาก 33 รีวิว', { exact: true })).toBeVisible();
  await expect(summary.getByText('ไม่ผ่านการตรวจสอบ', { exact: true })).toBeVisible();
  expect(
    await summary
      .locator('[data-rating-fill]')
      .evaluateAll((stars) => stars.map((star) => star.getAttribute('data-rating-fill'))),
  ).toEqual(['100', '100', '100', '100', '40']);
  const reviews = summary.getByRole('button', { name: 'อ่านรีวิวทั้งหมด' });
  await reviews.focus();
  await page.keyboard.press('Enter');
  await expect(summary.getByRole('status')).toHaveText('ยังไม่เปิดให้อ่านรีวิวรายรายการในขณะนี้');
  expect(calls.filter((call) => call.startsWith('PUT') || call.includes('reviews'))).toEqual([]);
  await expect(page).toHaveURL(/\/dashboard\/profile$/);
});

test('shows the new tutor state without invented ratings or review actions', async ({ page }) => {
  await mockProfile(page, { meta: { ratingAverage: null, reviewCount: 0 } });
  await page.goto('/dashboard/profile');
  const summary = page.getByRole('region', { name: 'สรุปบัญชีติวเตอร์' });
  await expect(summary.getByRole('img', { name: 'ยังไม่มีคะแนนรีวิว' })).toBeVisible();
  await expect(summary.getByText('ติวเตอร์ใหม่ · ยังไม่มีรีวิว')).toBeVisible();
  await expect(summary.locator('[data-rating-fill="0"]')).toHaveCount(5);
  await expect(summary.getByRole('button', { name: 'อ่านรีวิวทั้งหมด' })).toHaveCount(0);
});

test('keeps English copy and refreshes the rating from the existing save response', async ({
  page,
}) => {
  const calls = await mockProfile(page, { language: 'en' });
  await page.goto('/dashboard/profile');
  const summary = page.getByRole('region', { name: 'Tutor account summary' });
  await expect(summary.getByRole('img', { name: 'Rated 4.8 out of 5 stars' })).toBeVisible();
  await page.locator('#displayName').fill('Anan Updated');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(summary.getByRole('img', { name: 'Rated 3.5 out of 5 stars' })).toBeVisible();
  await expect(summary.getByText('From 25 reviews', { exact: true })).toBeVisible();
  await summary.getByRole('button', { name: 'Read all reviews' }).click();
  await expect(summary.getByRole('status')).toHaveText(
    'Individual reviews are not available to read yet.',
  );
  expect(calls.filter((call) => call.startsWith('PUT'))).toEqual(['PUT /profiles/me/tutor']);
});

test('fits long emails, status, stars and the notice at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  const email = 'tutor.mathematics.long-address@example.test';
  await mockProfile(page, { email, meta: { verificationStatus: 'PENDING' } });
  await page.goto('/dashboard/profile');
  const summary = page.getByRole('region', { name: 'สรุปบัญชีติวเตอร์' });
  await expect(summary.getByText(email, { exact: true })).toBeVisible();
  await expect(summary.getByText('รอการตรวจสอบ', { exact: true })).toBeVisible();
  await summary.getByRole('button', { name: 'อ่านรีวิวทั้งหมด' }).click();
  await expect(summary.getByRole('status')).toBeVisible();
  const fits = await summary.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return (
      rect.left >= 0 &&
      rect.right <= window.innerWidth &&
      element.scrollWidth <= element.clientWidth
    );
  });
  expect(fits).toBe(true);
});

test('matches the surrounding profile field typography, surfaces and column alignment', async ({
  page,
}) => {
  await mockProfile(page);
  await page.goto('/dashboard/profile');
  const summary = page.getByRole('region', { name: 'สรุปบัญชีติวเตอร์' });
  const caption = summary.locator('dt').first();
  const email = summary.locator('dd').first();
  const profileLabel = page.locator('label[for="firstName"]');
  const profileInput = page.locator('#firstName');
  const labelProperties = ['font-size', 'font-weight', 'line-height', 'color'];
  const valueProperties = [
    'font-size',
    'background-color',
    'border-color',
    'border-radius',
    'padding-left',
    'padding-right',
    'min-height',
  ];
  const readStyles = (element: Element, properties: string[]) => {
    const style = getComputedStyle(element);
    return properties.map((property) => style.getPropertyValue(property));
  };
  expect(await caption.evaluate(readStyles, labelProperties)).toEqual(
    await profileLabel.evaluate(readStyles, labelProperties),
  );
  expect(await email.evaluate(readStyles, valueProperties)).toEqual(
    await profileInput.evaluate(readStyles, valueProperties),
  );
  const emailBox = await email.boundingBox();
  const inputBox = await profileInput.boundingBox();
  expect(emailBox).not.toBeNull();
  expect(inputBox).not.toBeNull();
  expect(emailBox?.x).toBe(inputBox?.x);
  expect(emailBox?.width).toBe(inputBox?.width);
  expect(emailBox?.height).toBe(inputBox?.height);
});

test('preserves the student account fields and completion summary', async ({ page }) => {
  await mockProfile(page, { student: true, email: 'student@example.test' });
  await page.goto('/dashboard/profile');
  await expect(page.locator('[data-profile-summary]')).toHaveCount(0);
  await expect(
    page.locator('form').getByText('student@example.test', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('form').getByText('ข้อมูลครบ', { exact: true })).toBeVisible();
  await expect(page.locator('#school')).toHaveValue('Example School');
});
