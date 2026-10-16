import { expect, test } from '@playwright/test';

const TOKEN = 'a'.repeat(43);
const resetFlow = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  email: 'student@example.com',
  purpose: 'password-reset',
  resendAvailableAt: new Date(Date.now() + 60_000).toISOString(),
  retryAfterSeconds: 60,
};

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/auth/email-flow?*', (route) =>
    route.fulfill({ status: 400, json: { message: 'No flow' } }),
  );
  await page.route('**/api/v1/auth/refresh', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Unauthorized' }),
    }),
  );
});

test('requests a reset link with generic feedback, bilingual copy and no horizontal overflow', async ({
  page,
}) => {
  let email: unknown;
  await page.route('**/api/v1/auth/forgot-password', async (route) => {
    email = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Generic result', emailFlow: resetFlow }),
    });
  });
  await page.goto('/');
  await page.getByRole('link', { name: 'Forgot password?', exact: true }).click();
  await expect(page).toHaveURL('/forgot-password');
  await page.getByLabel('Email address', { exact: true }).fill('student@example.com');
  await page.getByRole('button', { name: 'Send reset link', exact: true }).click();
  expect(email).toEqual({ email: 'student@example.com' });
  await expect(page.locator('main').getByRole('status')).toContainText(
    'If the account is eligible',
  );
  await page.getByRole('button', { name: 'Switch language to Thai' }).click();
  await expect(page.locator('main').getByRole('status')).toContainText('หากบัญชีเข้าเงื่อนไข');
  await expect(
    page.getByRole('button', { name: 'กรอกอีเมลผิด? เริ่มคำขอใหม่', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('อีเมล', { exact: true })).toHaveAttribute('readonly', '');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(1);
});

test('validates confirmation then resets once and returns to sign in', async ({ page }) => {
  const requests: unknown[] = [];
  await page.route('**/api/v1/auth/reset-password', async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Password reset' }),
    });
  });
  await page.goto(`/reset-password?token=${TOKEN}`);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
  await page.getByLabel('New password', { exact: true }).fill('new-password123');
  await page.getByLabel('Confirm new password', { exact: true }).fill('different123');
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  await expect(page.locator('main').getByRole('alert')).toHaveText('The passwords do not match.');
  await expect(page.getByLabel('Confirm new password', { exact: true })).toBeFocused();
  expect(requests).toHaveLength(0);
  await page.getByLabel('Confirm new password', { exact: true }).fill('new-password123');
  await page.getByRole('button', { name: 'Show password', exact: true }).click();
  await expect(page.getByLabel('New password', { exact: true })).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  await expect(page.locator('main').getByRole('status')).toContainText(
    'Your password has been changed',
  );
  expect(requests).toEqual([{ token: TOKEN, password: 'new-password123' }]);
  await expect(page).toHaveURL('/reset-password');
  await page.locator('main').getByRole('link', { name: 'Back to sign in', exact: true }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
});

test('handles expired and malformed links with a recovery action', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/v1/auth/reset-password', async (route) => {
    requests += 1;
    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Invalid link' }),
    });
  });
  await page.goto('/reset-password');
  await expect(page.locator('main').getByRole('alert')).toContainText('This link is invalid');
  await expect(page.locator('form')).toHaveCount(0);
  expect(requests).toBe(0);
  await page.goto(`/reset-password?token=${TOKEN}`);
  await page.getByLabel('New password', { exact: true }).fill('password123');
  await page.getByLabel('Confirm new password', { exact: true }).fill('password123');
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText('This link is invalid');
  await page.getByRole('link', { name: 'Request a new link', exact: true }).click();
  await expect(page).toHaveURL('/forgot-password');
  expect(requests).toBe(1);
});

test('preserves fields on network failure and prevents duplicate pending requests', async ({
  page,
}) => {
  let requests = 0;
  let finish: () => void = () => undefined;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.route('**/api/v1/auth/reset-password', async (route) => {
    requests += 1;
    await pending;
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Unavailable' }),
    });
  });
  await page.goto(`/reset-password?token=${TOKEN}`);
  await page.getByLabel('New password', { exact: true }).fill('password123');
  await page.getByLabel('Confirm new password', { exact: true }).fill('password123');
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Resetting password...', exact: true }),
  ).toBeDisabled();
  finish();
  await expect(page.locator('main').getByRole('alert')).toHaveText(
    'Unable to complete the request. Please try again.',
  );
  await expect(page.getByLabel('New password', { exact: true })).toHaveValue('password123');
  expect(requests).toBe(1);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(1);
});

test('shows rate-limit feedback in Thai and English', async ({ page }) => {
  await page.route('**/api/v1/auth/forgot-password', (route) =>
    route.fulfill({
      status: 429,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Too many requests' }),
    }),
  );
  await page.goto('/forgot-password');
  await page.getByLabel('Email address', { exact: true }).fill('student@example.com');
  await page.getByRole('button', { name: 'Send reset link', exact: true }).click();
  await expect(page.locator('main').getByRole('alert')).toHaveText(
    'Too many requests. Please wait one minute and try again.',
  );
  await page.getByRole('button', { name: 'Switch language to Thai' }).click();
  await expect(page.locator('main').getByRole('alert')).toHaveText(
    'ส่งคำขอมากเกินไป กรุณารอหนึ่งนาทีแล้วลองอีกครั้ง',
  );
});
