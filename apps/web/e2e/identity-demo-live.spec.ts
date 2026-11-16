import { expect, test } from '@playwright/test';

import type { APIRequestContext, APIResponse, Page, TestInfo } from '@playwright/test';

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error('Run pnpm test:demo:playwright to prepare temporary E11 fixtures');
  }
  return value;
}

const PASSWORD = requiredEnvironment('HKTUTOR_E11_DEMO_PASSWORD');
const RUN_ID = requiredEnvironment('HKTUTOR_E11_DEMO_RUN_ID');
const TOKEN_SECRET = requiredEnvironment('HKTUTOR_E11_DEMO_TOKEN_SECRET');
const POLICY_VERSION = '2026-09-30';
const API = '/api/v1';

function fixtureEmail(label: string): string {
  return `${label}+${RUN_ID}@e11-demo.invalid`;
}

function fixtureId(suffix: string): string {
  return `${RUN_ID.slice(0, 24)}${suffix.padStart(12, '0')}`;
}

function verificationToken(label: string): string {
  return `${TOKEN_SECRET}-${label}`;
}
const studentProfile = {
  firstName: 'Synthetic',
  lastName: 'Learner',
  nickname: 'New Demo',
  school: 'E11 Demonstration School',
  gradeLevel: 'Grade 10',
  phone: '0800000000',
};

async function jsonObject(response: APIResponse): Promise<Record<string, unknown>> {
  const body: unknown = await response.json();
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('Expected a JSON object from the demonstration API');
  }
  return Object.fromEntries(Object.entries(body));
}

async function accessToken(response: APIResponse): Promise<string> {
  expect(response.status()).toBe(200);
  const body = await jsonObject(response);
  if (typeof body.accessToken !== 'string' || !body.accessToken) {
    throw new Error('Demonstration authentication did not issue an access credential');
  }
  return body.accessToken;
}

async function login(request: APIRequestContext, email: string): Promise<string> {
  const send = () => request.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
  let response = await send();
  if (response.status() === 429) {
    const seconds = Number(response.headers()['retry-after']);
    expect(seconds).toBeGreaterThan(0);
    expect(seconds).toBeLessThanOrEqual(60);
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    response = await send();
  }
  return accessToken(response);
}

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function expectError(response: APIResponse, status: number, code: string): Promise<void> {
  expect(response.status()).toBe(status);
  const body = await jsonObject(response);
  expect(body.code).toBe(code);
  expect(Object.keys(body).sort()).toEqual(['code', 'error', 'message', 'statusCode']);
}

async function evidence(page: Page, name: string, testInfo: TestInfo): Promise<void> {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true, mask: [page.locator('input[type="password"]')] });
  await testInfo.attach(name, { path, contentType: 'image/png' });
  // Hold an already-verified result so viewers can read it in the demonstration video.
  await page.waitForTimeout(1200);
}

test.describe('Project Demonstration 2 — E11 Identity, Privacy & Access Control', () => {
  test.beforeEach(async ({ context }) => {
    // API-only cases need no page and therefore produce no empty video.
    await context.addInitScript(() => localStorage.setItem('hktutor-language', 'en'));
  });

  test('US11-1 TC-A02: incorrect password is rejected by the live API and login UI', async ({
    page,
  }, testInfo) => {
    await page.goto('/');
    await page.getByLabel('Email address', { exact: true }).fill(fixtureEmail('student'));
    await page.getByLabel('Password', { exact: true }).fill('wrong-password-123');
    const failed = page.waitForResponse((response) => response.url().endsWith('/auth/login'));
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    expect((await failed).status()).toBe(401);
    await expect(page.locator('main').getByRole('alert')).toContainText('Unable to sign in');
    await expect(page).toHaveURL('/');
    expect(
      (await page.context().cookies()).some((cookie) => cookie.name === 'hktutor_refresh'),
    ).toBe(false);
    await evidence(page, 'tc-a02-incorrect-password', testInfo);
  });

  test('US11-1 TC-A10/A01/A08/A09: sign in, read own identity, sign out and reject the old JWT', async ({
    page,
  }, testInfo) => {
    await page.goto('/');
    await page.getByLabel('Email address', { exact: true }).fill(fixtureEmail('student'));
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    const signedIn = page.waitForResponse((response) => response.url().endsWith('/auth/login'));
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    const body: unknown = await (await signedIn).json();
    if (
      typeof body !== 'object' ||
      body === null ||
      !('accessToken' in body) ||
      typeof body.accessToken !== 'string'
    ) {
      throw new Error('Browser login did not issue an access credential');
    }
    const token = body.accessToken;
    await expect(page).toHaveURL('/dashboard');
    await expect(page.getByRole('heading', { name: /Welcome back, Demo/ })).toBeVisible();
    const cookies = await page.context().cookies();
    expect(cookies.find((cookie) => cookie.name === 'hktutor_refresh')?.httpOnly).toBe(true);
    const identity = await page.request.get(`${API}/auth/me`, { headers: bearer(token) });
    expect(identity.status()).toBe(200);
    const user = await jsonObject(identity);
    expect(user.role).toBe('STUDENT');
    expect(user.email).toBe(fixtureEmail('student'));
    expect(user).not.toHaveProperty('passwordHash');
    expect(user).not.toHaveProperty('refreshToken');
    const stored = await page.evaluate(() => ({ ...localStorage, ...sessionStorage }));
    expect(JSON.stringify(stored).includes(token)).toBe(false);
    await evidence(page, 'tc-a10-student-dashboard', testInfo);
    const signedOut = page.waitForResponse((response) => response.url().endsWith('/auth/logout'));
    await page
      .getByRole('button', { name: 'Sign out', exact: true })
      .filter({ visible: true })
      .click();
    expect((await signedOut).status()).toBe(204);
    await expect(page).toHaveURL('/');
    expect(
      (await page.context().cookies()).some((cookie) => cookie.name === 'hktutor_refresh'),
    ).toBe(false);
    await expectError(
      await page.request.get(`${API}/auth/me`, { headers: bearer(token) }),
      401,
      'UNAUTHENTICATED',
    );
    await page.goto('/dashboard/profile');
    await expect(page).toHaveURL('/?returnTo=%2Fdashboard%2Fprofile');
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  });

  test('US11-1/US11-2 TC-A05/A06/A07/B01/B02: registration validation and generic duplicate response', async ({
    request,
  }) => {
    const registration = {
      email: fixtureEmail('rejected'),
      password: PASSWORD,
      role: 'student',
      consent: true,
      policyVersion: POLICY_VERSION,
    };
    for (const [caseId, changes] of [
      ['TC-A05', { password: 'short1' }],
      ['TC-A06', { role: 'admin' }],
      ['TC-B01', { consent: false }],
      ['TC-B02', { policyVersion: '2020-01-01' }],
    ] as const) {
      await test.step(caseId, async () => {
        const response = await request.post(`${API}/auth/register`, {
          data: { ...registration, ...changes },
        });
        await expectError(response, 400, 'VALIDATION_FAILED');
        expect(response.headers()['set-cookie'] ?? '').not.toContain('hktutor_refresh=');
      });
    }
    await test.step('TC-A07', async () => {
      const response = await request.post(`${API}/auth/register`, {
        data: { ...registration, email: fixtureEmail('student') },
      });
      expect(response.status()).toBe(201);
      const body = await jsonObject(response);
      expect(body.message).toBe(
        'If an account can be created, a verification email has been sent.',
      );
      expect(body).not.toHaveProperty('accessToken');
      expect(response.headers()['set-cookie'] ?? '').not.toContain('hktutor_refresh=');
    });
  });

  test('US11-2 TC-B05: registration UI requires privacy consent', async ({ page }, testInfo) => {
    await page.goto('/register');
    await page.locator('#email').fill(fixtureEmail('rejected'));
    await page.locator('#password').fill(PASSWORD);
    await page.locator('#confirmPassword').fill(PASSWORD);
    const submissions: string[] = [];
    page.on('request', (request) => {
      if (request.url().endsWith('/auth/register')) {
        submissions.push(request.method());
      }
    });
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(page.locator('#policy')).toHaveAttribute('aria-invalid', 'true');
    await expect(page).toHaveURL('/register');
    expect(submissions).toEqual([]);
    await evidence(page, 'tc-b05-consent-required', testInfo);
  });

  test('US11-1 TC-A03/A13: nonexistent, expired and consumed verification tokens are rejected', async ({
    request,
  }) => {
    for (const label of ['missing', 'expired', 'consumed']) {
      await test.step(label, async () => {
        const response = await request.post(`${API}/auth/verify-email`, {
          data: { token: verificationToken(label) },
        });
        await expectError(response, 400, 'VALIDATION_FAILED');
        expect(response.headers()['set-cookie'] ?? '').not.toContain('hktutor_refresh=');
      });
    }
  });

  test('US11-2/US11-4 TC-B03/B04/D15: stale consent blocks profile reads and writes until accepted', async ({
    request,
  }) => {
    const token = await login(request, fixtureEmail('consent'));
    const headers = bearer(token);
    await expectError(
      await request.get(`${API}/profiles/me`, { headers }),
      400,
      'VALIDATION_FAILED',
    );
    await expectError(
      await request.put(`${API}/profiles/me/student`, { headers, data: studentProfile }),
      400,
      'VALIDATION_FAILED',
    );
    for (const changes of [{ consent: false }, { policyVersion: '2020-01-01' }]) {
      await expectError(
        await request.post(`${API}/auth/consent`, {
          headers,
          data: { consent: true, policyVersion: POLICY_VERSION, ...changes },
        }),
        400,
        'VALIDATION_FAILED',
      );
      await expectError(
        await request.get(`${API}/profiles/me`, { headers }),
        400,
        'VALIDATION_FAILED',
      );
    }
    const accepted = await request.post(`${API}/auth/consent`, {
      headers,
      data: { consent: true, policyVersion: POLICY_VERSION },
    });
    expect(accepted.status()).toBe(200);
    const consent = await jsonObject(accepted);
    expect(consent.policyVersion).toBe(POLICY_VERSION);
    expect(Number.isFinite(Date.parse(String(consent.consentAcceptedAt)))).toBe(true);
    const profile = await request.get(`${API}/profiles/me`, { headers });
    expect(profile.status()).toBe(200);
    expect(await jsonObject(profile)).toMatchObject({
      consentCurrent: true,
      profileComplete: false,
      profile: null,
    });
  });

  test('US11-3/US11-4 TC-C01/C02/C03/C04/D08: server role checks and foreign-listing ownership', async ({
    request,
  }) => {
    const student = await login(request, fixtureEmail('student'));
    for (const path of ['/admin/tutor-verifications', '/tutors/me/listings']) {
      await expectError(
        await request.get(`${API}${path}`, { headers: bearer(student) }),
        403,
        'FORBIDDEN',
      );
    }
    await expectError(
      await request.get(`${API}/admin/verifications`, { headers: bearer(student) }),
      404,
      'NOT_FOUND',
    );
    const tutor = await accessToken(
      await request.post(`${API}/auth/verify-email`, {
        data: { token: verificationToken('tutor') },
      }),
    );
    await expectError(
      await request.put(`${API}/profiles/me/student`, {
        headers: bearer(tutor),
        data: studentProfile,
      }),
      403,
      'FORBIDDEN',
    );
    const own = await request.get(`${API}/tutors/me/listings`, { headers: bearer(tutor) });
    expect(own.status()).toBe(200);
    const listings: unknown = await own.json();
    expect(listings).toEqual([expect.objectContaining({ id: fixtureId('104') })]);
    await expectError(
      await request.patch(`${API}/tutors/me/listings/${fixtureId('105')}`, {
        headers: bearer(tutor),
        data: { description: 'Unauthorized edit must never be persisted' },
      }),
      404,
      'NOT_FOUND',
    );
    const otherTutor = await accessToken(
      await request.post(`${API}/auth/verify-email`, {
        data: { token: verificationToken('other-tutor') },
      }),
    );
    const unchanged = await request.get(`${API}/tutors/me/listings/${fixtureId('105')}`, {
      headers: bearer(otherTutor),
    });
    expect(unchanged.status()).toBe(200);
    expect((await jsonObject(unchanged)).description).toBe('E11 owner-only teaching listing 5');
  });

  test('US11-1/US11-4 TC-A12/A13/D14/D01/D02/D03/D07/D10: verification, onboarding, profile persistence and invalid edits', async ({
    page,
  }, testInfo) => {
    const verified = page.waitForResponse((response) =>
      response.url().endsWith('/auth/verify-email'),
    );
    await page.goto(
      `/register/verify?token=${encodeURIComponent(verificationToken('onboarding'))}`,
    );
    const verification = await verified;
    expect(verification.status()).toBe(200);
    const body: unknown = await verification.json();
    if (
      typeof body !== 'object' ||
      body === null ||
      !('accessToken' in body) ||
      typeof body.accessToken !== 'string'
    ) {
      throw new Error('Browser verification did not issue an access credential');
    }
    const headers = bearer(body.accessToken);
    await expect(page).toHaveURL('/onboarding/profile');
    const beforeProfile = await page.request.get(`${API}/profiles/me`, { headers });
    expect(beforeProfile.status()).toBe(200);
    expect(await jsonObject(beforeProfile)).toMatchObject({
      profileComplete: false,
      profile: null,
    });
    await page.goto('/dashboard');
    await expect(page).toHaveURL('/onboarding/profile');
    await test.step('TC-D14 — create a profile after validating the empty form', async () => {
      await page.getByRole('button', { name: 'Save and continue', exact: true }).click();
      await expect(page.locator('form input[aria-invalid="true"]')).toHaveCount(6);
      for (const [field, value] of Object.entries(studentProfile)) {
        await page.locator(`#${field}`).fill(value);
      }
      await page.getByRole('button', { name: 'Save and continue', exact: true }).click();
      await expect(page).toHaveURL('/dashboard');
    });
    await page.goto('/dashboard/profile');
    await expect(page.locator('#school')).toHaveValue(studentProfile.school);
    await page.locator('#nickname').fill('Updated Demo');
    await page.getByRole('button', { name: 'Save profile', exact: true }).click();
    await expect(page.getByText('Profile saved successfully', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.locator('#nickname')).toHaveValue('Updated Demo');
    await evidence(page, 'tc-d01-profile-persisted', testInfo);
    const current = await jsonObject(await page.request.get(`${API}/profiles/me`, { headers }));
    expect(current.profileComplete).toBe(true);
    expect(current.profile).toEqual({ ...studentProfile, nickname: 'Updated Demo' });
    for (const [caseId, changes] of [
      ['TC-D03', { firstName: '' }],
      ['TC-D07', { userId: fixtureId('1') }],
    ] as const) {
      await test.step(caseId, async () => {
        await expectError(
          await page.request.put(`${API}/profiles/me/student`, {
            headers,
            data: { ...studentProfile, ...changes },
          }),
          400,
          'VALIDATION_FAILED',
        );
        const unchanged = await page.request.get(`${API}/profiles/me`, { headers });
        expect((await jsonObject(unchanged)).profile).toEqual(current.profile);
      });
    }
    await expectError(
      await page.request.post(`${API}/auth/verify-email`, {
        data: { token: verificationToken('onboarding') },
      }),
      400,
      'VALIDATION_FAILED',
    );
  });

  test('US11-1/US11-4 TC-A04/D09: anonymous clients receive no private profile', async ({
    page,
    request,
  }) => {
    for (const path of ['/auth/me', '/profiles/me']) {
      await expectError(await request.get(`${API}${path}`), 401, 'UNAUTHENTICATED');
    }
    await page.goto('/dashboard/profile');
    await expect(page).toHaveURL('/?returnTo=%2Fdashboard%2Fprofile');
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  });
});
