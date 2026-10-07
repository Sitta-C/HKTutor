import { expect, test } from '@playwright/test';

import type { Page } from '@playwright/test';

const USER_ID = '20000000-0000-4000-8000-000000000001';
const TUTOR_ID = '20000000-0000-4000-8000-000000000002';
const VERSION = '2026-10-06T07:00:00.000Z';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZi8AAAAASUVORK5CYII=',
  'base64',
);

async function mockAvatar(
  page: Page,
  options: {
    student?: boolean;
    onboarding?: boolean;
    failUpload?: boolean;
    expireUrl?: boolean;
    language?: 'en' | 'th';
    hasPhoto?: boolean;
  } = {},
) {
  let avatarUpdatedAt: string | null = options.hasPhoto ? VERSION : null;
  let signedRequests = 0;
  const calls: string[] = [];
  await page
    .context()
    .addCookies([
      { name: 'hktutor_refresh', value: 'ui-test-session', url: 'http://localhost:3000' },
    ]);
  await page.addInitScript(
    (language) => window.localStorage.setItem('hktutor-language', language),
    options.language ?? 'en',
  );
  await page.route('https://storage.example.test/**', (route) =>
    route.fulfill({ contentType: 'image/png', body: PNG }),
  );
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    calls.push(`${request.method()} ${path}`);
    let body: unknown;
    if (path === '/auth/refresh') {
      body = {
        accessToken: 'ui-token',
        user: {
          id: USER_ID,
          email: 'user@example.test',
          role: options.student ? 'STUDENT' : 'TUTOR',
          displayName: 'Anan',
        },
      };
    } else if (path === '/profiles/me') {
      body = {
        avatarUpdatedAt,
        consentCurrent: true,
        policyVersion: '2026-09-30',
        role: options.student ? 'STUDENT' : 'TUTOR',
        profileComplete: !options.onboarding,
        profile: options.onboarding
          ? null
          : options.student
            ? {
                firstName: 'Nan',
                lastName: 'Dee',
                nickname: 'Nan',
                school: 'Demo School',
                gradeLevel: 'Grade 10',
                phone: '0812345678',
              }
            : {
                firstName: 'Anan',
                lastName: 'Dee',
                nickname: 'Anan',
                displayName: 'Anan',
                bio: 'Mathematics tutor',
                experienceYears: 5,
                verificationStatus: 'VERIFIED',
                ratingAverage: null,
                reviewCount: 0,
              },
      };
    } else if (path === '/profiles/me/avatar') {
      if (request.method() === 'POST') {
        expect(request.headers()['content-type']).toContain('multipart/form-data; boundary=');
        expect(request.headers()['authorization']).toBe('Bearer ui-token');
        if (options.failUpload) {
          await route.fulfill({ status: 400, json: { message: 'Invalid photo' } });
          return;
        }
        avatarUpdatedAt = '2026-10-06T07:01:00.000Z';
        body = { avatarUpdatedAt };
      } else if (request.method() === 'DELETE') {
        avatarUpdatedAt = null;
        body = { avatarUpdatedAt };
      } else {
        signedRequests += 1;
        body = {
          avatar: avatarUpdatedAt
            ? {
                url: `https://storage.example.test/photo-${avatarUpdatedAt.includes('07:01') ? 'new' : 'old'}-${signedRequests}.png`,
                expiresAt: new Date(
                  Date.now() + (options.expireUrl && signedRequests === 1 ? 2000 : 300000),
                ).toISOString(),
                updatedAt: avatarUpdatedAt,
              }
            : null,
        };
      }
    } else if (path === '/subjects') {
      body = { items: [{ id: 'math', code: 'MATH', name: 'Mathematics', active: true }] };
    } else if (path === '/grade-levels') {
      body = { items: [{ id: 'g10', code: 'G10', name: 'Grade 10', active: true, sortOrder: 10 }] };
    } else if (path === '/tutors') {
      body = {
        items: [
          {
            tutorId: TUTOR_ID,
            listingId: '10000000-0000-4000-8000-000000000001',
            avatarUpdatedAt: VERSION,
            displayName: 'Public Tutor',
            description: 'Math lessons',
            experienceYears: 5,
            subject: 'Mathematics',
            grade: 'Grade 10',
            pricePerHour: 500,
            ratingAverage: null,
            reviewCount: 0,
            verificationStatus: 'VERIFIED',
            nextAvailableAt: null,
          },
        ],
        page: 1,
        pageSize: 10,
        total: 1,
        totalPages: 1,
      };
    } else if (path === `/tutors/${TUTOR_ID}/avatar`) {
      expect(request.headers()['authorization']).toBeUndefined();
      body = {
        avatar: {
          url: 'https://storage.example.test/public-tutor.png',
          updatedAt: VERSION,
          expiresAt: new Date(Date.now() + 300000).toISOString(),
        },
      };
    } else {
      await route.fulfill({ status: 404, json: { message: 'Not found' } });
      return;
    }
    await route.fulfill({ json: body });
  });
  return calls;
}

for (const student of [true, false]) {
  test(`${student ? 'student' : 'tutor'} uploads, replaces and removes a photo without submitting profile fields`, async ({
    page,
  }, testInfo) => {
    const calls = await mockAvatar(page, { student, hasPhoto: true });
    await page.goto('/dashboard/profile');
    const editor = page.getByRole('region', { name: 'Profile photo' });
    await expect(editor.locator('img')).toHaveAttribute('src', /photo-old/);
    const field = page.locator(student ? '#nickname' : '#displayName');
    await field.fill('Unsaved name');
    await editor
      .getByLabel('Choose photo')
      .setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: PNG });
    await expect(editor.locator('img')).toHaveAttribute('src', /^blob:/);
    expect(calls.filter((call) => call === 'POST /profiles/me/avatar')).toEqual([]);
    await editor.getByRole('button', { name: 'Upload photo', exact: true }).click();
    await expect(editor.getByRole('status')).toHaveText('Profile photo saved.');
    await expect(page.locator('[data-notebook-toast="success"]')).toHaveText(
      'Profile photo saved.',
    );
    await expect(editor.locator('img')).toHaveAttribute('src', /photo-new/);
    await editor.screenshot({ path: testInfo.outputPath('avatar-editor.png') });
    await expect(field).toHaveValue('Unsaved name');
    await expect(page.locator('#dashboard-sidebar [data-profile-avatar] img')).toHaveAttribute(
      'src',
      /photo-new/,
    );
    expect(calls.filter((call) => call.startsWith('PUT'))).toEqual([]);
    await editor.getByRole('button', { name: 'Remove photo', exact: true }).click();
    await expect(editor.getByRole('status')).toHaveText('Profile photo removed.');
    await expect(
      page.locator('[data-notebook-toast="success"]').filter({ hasText: 'Profile photo removed.' }),
    ).toHaveCount(1);
    await expect(editor.locator('img')).toHaveCount(0);
    await expect(page.locator('#dashboard-sidebar [data-profile-avatar] img')).toHaveCount(0);
    await expect(field).toHaveValue('Unsaved name');
    expect(
      calls.filter((call) => call === 'POST /profiles/me/avatar' || call.startsWith('DELETE')),
    ).toEqual(['POST /profiles/me/avatar', 'DELETE /profiles/me/avatar']);
  });
}

test('rejects unsupported and oversized selections before making upload requests', async ({
  page,
}) => {
  const calls = await mockAvatar(page);
  await page.goto('/dashboard/profile');
  const editor = page.getByRole('region', { name: 'Profile photo' });
  await editor.getByLabel('Choose photo').setInputFiles({
    name: 'vector.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg/>'),
  });
  await expect(editor.getByRole('alert')).toHaveText('Only JPEG, PNG and WebP are supported.');
  await expect(page.locator('[data-notebook-toast="error"]')).toHaveText(
    'Only JPEG, PNG and WebP are supported.',
  );
  await editor
    .getByLabel('Choose photo')
    .setInputFiles({ name: 'large.png', mimeType: 'image/png', buffer: Buffer.alloc(2097153) });
  await expect(editor.getByRole('alert')).toHaveText(
    'Choose a non-empty photo no larger than 2 MiB.',
  );
  expect(calls.filter((call) => call === 'POST /profiles/me/avatar')).toEqual([]);
});

test('keeps the saved photo after upload failure and allows cancelling the local preview', async ({
  page,
}) => {
  await mockAvatar(page, { hasPhoto: true, failUpload: true });
  await page.goto('/dashboard/profile');
  const editor = page.getByRole('region', { name: 'Profile photo' });
  await editor
    .getByLabel('Choose photo')
    .setInputFiles({ name: 'bad.png', mimeType: 'image/png', buffer: Buffer.from('broken png') });
  await editor.getByRole('button', { name: 'Upload photo', exact: true }).click();
  await expect(editor.getByRole('alert')).toHaveText(
    'Invalid photo. Use a static image up to 16 megapixels.',
  );
  await expect(page.locator('[data-notebook-toast="error"]')).toHaveText(
    'Invalid photo. Use a static image up to 16 megapixels.',
  );
  await editor.getByRole('button', { name: 'Cancel photo selection' }).click();
  await expect(editor.locator('img')).toHaveAttribute('src', /photo-old/);
});

test('photo removal failure reports one error and preserves the saved photo and unsaved fields', async ({
  page,
}) => {
  await mockAvatar(page, { student: true, hasPhoto: true });
  let deletes = 0;
  await page.route('**/api/v1/profiles/me/avatar', async (route) => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    deletes += 1;
    return route.fulfill({ status: 500, json: { message: 'Preview failure' } });
  });
  await page.goto('/dashboard/profile');
  const editor = page.getByRole('region', { name: 'Profile photo' });
  await page.locator('#nickname').fill('Unsaved preview');
  await editor.getByRole('button', { name: 'Remove photo', exact: true }).click();
  await expect(page.locator('[data-notebook-toast="error"]')).toHaveText(
    'Could not save your photo. Please try again.',
  );
  await expect(editor.locator('img')).toHaveAttribute('src', /photo-old/);
  await expect(page.locator('#nickname')).toHaveValue('Unsaved preview');
  expect(deletes).toBe(1);
});

test('offers an optional Thai photo upload during onboarding at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await mockAvatar(page, { onboarding: true, student: true, language: 'th' });
  await page.goto('/onboarding/profile');
  const editor = page.getByRole('region', { name: 'รูปโปรไฟล์' });
  await expect(editor.getByText('JPEG, PNG หรือ WebP ไม่เกิน 2 MiB · ไม่บังคับ')).toBeVisible();
  await editor
    .getByLabel('เลือกรูป')
    .setInputFiles({ name: 'รูปโปรไฟล์.png', mimeType: 'image/png', buffer: PNG });
  await editor.getByRole('button', { name: 'อัปโหลดรูป', exact: true }).click();
  await expect(editor.getByRole('status')).toHaveText('บันทึกรูปโปรไฟล์แล้ว');
  await expect(page.locator('[data-notebook-toast="success"]')).toHaveText('บันทึกรูปโปรไฟล์แล้ว');
  await expect(page).toHaveURL(/onboarding\/profile/);
  expect(await editor.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('renews signed URLs while a profile stays open', async ({ page }) => {
  const calls = await mockAvatar(page, { hasPhoto: true, expireUrl: true });
  await page.goto('/dashboard/profile');
  const editor = page.getByRole('region', { name: 'Profile photo' });
  await expect(editor.locator('img')).toHaveAttribute('src', /photo-old-[2-9]/, { timeout: 10000 });
  expect(calls.filter((call) => call === 'GET /profiles/me/avatar').length).toBeGreaterThan(1);
});

test('uses only the public tutor read endpoint for search result images', async ({ page }) => {
  const calls = await mockAvatar(page, { student: true });
  await page.goto('/tutors');
  await expect(page.locator('article [data-profile-avatar] img')).toHaveAttribute(
    'src',
    /public-tutor/,
  );
  expect(calls).toContain(`GET /tutors/${TUTOR_ID}/avatar`);
  expect(calls).not.toContain('GET /profiles/me/avatar');
});
