import { expect, test } from '@playwright/test';

import { translations } from '@/lib/i18n';

import type { Page } from '@playwright/test';

// All responses are preview fixtures. No account, email or profile is written to a real service.
const student = {
  firstName: 'Mint',
  lastName: 'Preview',
  nickname: 'Mint',
  school: 'Preview school',
  gradeLevel: 'Grade 10',
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

async function mockActions(
  page: Page,
  options: {
    role?: 'STUDENT' | 'TUTOR';
    language?: 'en' | 'th';
    guest?: boolean;
    onboarding?: boolean;
    consentCurrent?: boolean;
    profileFailure?: boolean;
    consentFailure?: boolean;
    logoutFailure?: boolean;
    registerStatus?: number;
    resendStatus?: number;
    verifyStatus?: number;
    listingFailure?: boolean;
    archivedListing?: boolean;
  } = {},
) {
  const role = options.role ?? 'STUDENT';
  let signedIn = !options.guest;
  let consentCurrent = options.consentCurrent ?? true;
  let profileComplete = !options.onboarding;
  let profile = role === 'STUDENT' ? { ...student } : { ...tutor };
  let listing = {
    id: 'preview-course',
    subject: { id: 'math', code: 'MATH', name: 'Mathematics', active: true },
    gradeLevel: { id: 'g10', code: 'G10', name: 'Grade 10', active: true, sortOrder: 10 },
    pricePerHour: 500,
    description: 'Review concepts and work through practice questions.',
    publicationStatus: options.archivedListing ? 'ARCHIVED' : 'DRAFT',
    publishedAt: null,
    createdAt: '2026-10-07T00:00:00Z',
    updatedAt: '2026-10-07T00:00:00Z',
  };
  const writes: string[] = [];
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(
    (language) => localStorage.setItem('hktutor-language', language),
    options.language ?? 'en',
  );
  await page
    .context()
    .addCookies([
      { name: 'hktutor_refresh', value: 'toast-preview', url: 'http://localhost:3000' },
    ]);
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    const method = request.method();
    const fail = (status = 500) => route.fulfill({ status, json: { message: 'Preview failure' } });
    const session = {
      accessToken: 'preview-token',
      user: { id: 'toast-preview', email: 'preview@example.test', role, displayName: 'Preview' },
    };
    if (method !== 'GET' && path !== '/auth/refresh') writes.push(`${method} ${path}`);
    if (path === '/auth/refresh') return signedIn ? route.fulfill({ json: session }) : fail(401);
    if (path === '/auth/login' || path === '/auth/verify-email') {
      if (path.endsWith('verify-email') && options.verifyStatus) return fail(options.verifyStatus);
      signedIn = true;
      return route.fulfill({ json: session });
    }
    if (path === '/auth/logout') {
      signedIn = false;
      return options.logoutFailure ? fail() : route.fulfill({ status: 204 });
    }
    if (path === '/auth/register')
      return options.registerStatus
        ? fail(options.registerStatus)
        : route.fulfill({ json: { message: 'Created' } });
    if (path === '/auth/resend-verification')
      return options.resendStatus
        ? fail(options.resendStatus)
        : route.fulfill({ json: { message: 'Sent' } });
    if (path === '/auth/consent') {
      if (options.consentFailure) return fail();
      consentCurrent = true;
      return route.fulfill({
        json: { policyVersion: '2026-09-30', consentAcceptedAt: '2026-10-07T00:00:00Z' },
      });
    }
    if (path === '/profiles/me')
      return route.fulfill({
        json: {
          role,
          consentCurrent,
          profileComplete,
          policyVersion: '2026-09-30',
          profile: options.onboarding && !profileComplete ? null : profile,
        },
      });
    if (path === '/profiles/me/avatar') return route.fulfill({ json: { avatar: null } });
    if (path === `/profiles/me/${role.toLowerCase()}`) {
      if (options.profileFailure) return fail();
      profile = { ...profile, ...request.postDataJSON() };
      profileComplete = true;
      return route.fulfill({ json: profile });
    }
    if (path === '/subjects') return route.fulfill({ json: { items: [listing.subject] } });
    if (path === '/grade-levels') return route.fulfill({ json: { items: [listing.gradeLevel] } });
    if (path.startsWith('/tutors/me/listings')) {
      if (method !== 'GET') {
        if (options.listingFailure) return fail();
        const payload = request.postData() ? request.postDataJSON() : {};
        listing = {
          ...listing,
          ...payload,
          ...(path.endsWith('/publish') ? { publicationStatus: 'PUBLISHED' } : {}),
        };
      }
      return route.fulfill({
        json: path === '/tutors/me/listings' && method === 'GET' ? [listing] : listing,
      });
    }
    if (path === '/bookings/me' || path === '/tutors/me/bookings')
      return route.fulfill({ json: { items: [], total: 0 } });
    if (path === '/tutors/me/availability') return route.fulfill({ json: [] });
    return fail(404);
  });
  return { writes, pageErrors };
}

async function expectToast(page: Page, tone: 'success' | 'error', message: string) {
  const toast = page.locator(`[data-notebook-toast="${tone}"]`).filter({ hasText: message });
  await expect(toast).toHaveCount(1);
  await expect(toast).toHaveText(message);
  await expect(toast).toBeVisible();
  const layout = await toast.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return {
      fits: box.left >= 0 && box.right <= innerWidth && element.scrollWidth <= element.clientWidth,
      animation: getComputedStyle(element).animationName,
    };
  });
  expect(layout.fits).toBe(true);
  expect(layout.animation).toBe('none');
  return toast;
}

for (const language of ['en', 'th'] as const) {
  for (const role of ['STUDENT', 'TUTOR'] as const) {
    for (const failed of [false, true]) {
      test(`${language} ${role} profile ${failed ? 'failure' : 'success'} reports once and keeps submitted data`, async ({
        page,
      }) => {
        await page.setViewportSize({ width: language === 'th' ? 320 : 1440, height: 1000 });
        const calls = await mockActions(page, { role, language, profileFailure: failed });
        await page.goto('/dashboard/profile');
        const field = page.locator(role === 'STUDENT' ? '#nickname' : '#displayName');
        await field.fill('Updated preview');
        await page
          .getByRole('button', {
            name: language === 'th' ? 'บันทึกโปรไฟล์' : 'Save profile',
            exact: true,
          })
          .click();
        await expectToast(
          page,
          failed ? 'error' : 'success',
          language === 'th'
            ? failed
              ? 'ไม่สามารถบันทึกโปรไฟล์ได้'
              : 'บันทึกโปรไฟล์สำเร็จ'
            : failed
              ? 'Unable to save your profile.'
              : 'Profile saved successfully',
        );
        await expect(field).toHaveValue('Updated preview');
        expect(calls.writes).toEqual([`PUT /profiles/me/${role.toLowerCase()}`]);
        expect(calls.pageErrors).toEqual([]);
      });
    }
    test(`${language} ${role} sign-in toast persists through navigation and expires`, async ({
      page,
    }) => {
      await mockActions(page, { role, language, guest: true });
      await page.goto('/?returnTo=%2Fdashboard%2Fprofile');
      await page.locator('#email').fill('preview@example.test');
      await page.locator('#password').fill('Preview12345');
      await page
        .getByRole('button', { name: translations[language].login.submit, exact: true })
        .click();
      const toast = await expectToast(page, 'success', translations[language].login.signedIn);
      await expect(page).toHaveURL(/dashboard\/profile$/);
      await expect(toast).toHaveCount(0, { timeout: 5000 });
    });
  }
  for (const status of [200, 500, 503]) {
    test(`${language} registration ${status} reports its actual outcome`, async ({ page }) => {
      const calls = await mockActions(page, {
        language,
        guest: true,
        ...(status === 200 ? {} : { registerStatus: status }),
      });
      await page.setViewportSize({ width: 320, height: 1000 });
      await page.goto('/register');
      await page.locator('#email').fill('preview@example.test');
      await page.locator('#password').fill('Preview12345');
      await page.locator('#confirmPassword').fill('Preview12345');
      await page.locator('#policy').check();
      await page
        .getByRole('button', { name: translations[language].register.submit, exact: true })
        .click();
      await expectToast(
        page,
        status === 200 ? 'success' : 'error',
        status === 200
          ? translations[language].register.accountCreated
          : status === 503
            ? translations[language].register.verificationDeliveryFailed
            : translations[language].register.registrationFailed,
      );
      if (status !== 500) await expect(page).toHaveURL(/register\/verify\?email=/);
      expect(calls.writes).toEqual(['POST /auth/register']);
    });
  }
  for (const failed of [false, true]) {
    test(`${language} resend ${failed ? 'failure' : 'success'} reports once`, async ({ page }) => {
      const calls = await mockActions(page, {
        language,
        guest: true,
        ...(failed ? { resendStatus: 500 } : {}),
      });
      await page.goto('/register/verify?email=preview@example.test');
      await page
        .getByRole('button', { name: translations[language].register.otpResend, exact: true })
        .click();
      await expectToast(
        page,
        failed ? 'error' : 'success',
        failed
          ? translations[language].register.resendFailed
          : translations[language].register.otpResent,
      );
      expect(calls.writes).toEqual(['POST /auth/resend-verification']);
    });
    test(`${language} verification ${failed ? 'failure' : 'success'} reports once`, async ({
      page,
    }) => {
      const calls = await mockActions(page, {
        language,
        guest: true,
        ...(failed ? { verifyStatus: 400 } : {}),
      });
      await page.goto('/register/verify?token=preview-token');
      await expectToast(
        page,
        failed ? 'error' : 'success',
        failed
          ? translations[language].register.verificationFailed
          : translations[language].register.verificationSuccess,
      );
      expect(calls.writes).toEqual(['POST /auth/verify-email']);
    });
  }
}

for (const role of ['STUDENT', 'TUTOR'] as const) {
  for (const failed of [false, true]) {
    test(`${role} consent ${failed ? 'failure' : 'success'} shows feedback without saving profile fields`, async ({
      page,
    }) => {
      const calls = await mockActions(page, {
        role,
        consentCurrent: false,
        consentFailure: failed,
      });
      await page.goto('/dashboard/profile');
      await page.locator('#policy').check();
      await page.getByRole('button', { name: 'Save and continue', exact: true }).click();
      await expectToast(
        page,
        failed ? 'error' : 'success',
        failed ? 'Unable to save your profile.' : 'Privacy notice accepted.',
      );
      expect(calls.writes).toEqual(['POST /auth/consent']);
    });
    test(`${role} logout ${failed ? 'failure' : 'success'} reports honestly after redirect with no unhandled rejection`, async ({
      page,
    }) => {
      const calls = await mockActions(page, { role, logoutFailure: failed });
      await page.goto('/dashboard/profile');
      if ((page.viewportSize()?.width ?? 0) < 1024) {
        await page
          .getByRole('button', { name: translations.en.dashboard.sidebar.openSidebar, exact: true })
          .click();
      }
      await page
        .locator('#dashboard-sidebar')
        .getByRole('button', { name: 'Sign out', exact: true })
        .click();
      await expectToast(
        page,
        failed ? 'error' : 'success',
        failed ? translations.en.common.signOutFailed : translations.en.common.signedOut,
      );
      await expect(page).toHaveURL('http://localhost:3000/');
      expect(calls.writes).toEqual(['POST /auth/logout']);
      expect(calls.pageErrors).toEqual([]);
    });
  }
  test(`${role} onboarding success survives the existing return link`, async ({ page }) => {
    const calls = await mockActions(page, { role, onboarding: true });
    await page.goto('/onboarding/profile?returnTo=%2Fdashboard%2Fprofile');
    const fields =
      role === 'STUDENT'
        ? student
        : {
            firstName: tutor.firstName,
            lastName: tutor.lastName,
            nickname: tutor.nickname,
            displayName: tutor.displayName,
            bio: tutor.bio,
            experienceYears: String(tutor.experienceYears),
          };
    for (const [key, value] of Object.entries(fields)) await page.locator(`#${key}`).fill(value);
    await page.getByRole('button', { name: 'Save and continue', exact: true }).click();
    await expectToast(page, 'success', 'Profile saved successfully');
    await expect(page).toHaveURL(/dashboard\/profile$/);
    expect(calls.writes).toEqual([`PUT /profiles/me/${role.toLowerCase()}`]);
  });
}

for (const action of ['save', 'publish', 'restore'] as const) {
  for (const failed of [false, true]) {
    test(`tutor editor ${action} ${failed ? 'failure' : 'success'} reports once`, async ({
      page,
    }) => {
      const calls = await mockActions(page, {
        role: 'TUTOR',
        listingFailure: failed,
        archivedListing: action === 'restore',
      });
      await page.goto('/dashboard/listings/preview-course/edit');
      await page
        .getByRole('button', {
          name:
            action === 'save'
              ? 'Save changes'
              : action === 'publish'
                ? 'Save & publish'
                : 'Restore draft',
          exact: true,
        })
        .click();
      await expectToast(
        page,
        failed ? 'error' : 'success',
        failed
          ? 'Unable to save this listing. Check the details and try again.'
          : action === 'restore'
            ? 'Listing restored to draft.'
            : 'Your listing changes have been saved.',
      );
      expect(calls.writes).toHaveLength(action === 'publish' && !failed ? 2 : 1);
      expect(calls.pageErrors).toEqual([]);
    });
  }
}
