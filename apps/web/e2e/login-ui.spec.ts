import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/auth/refresh', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Unauthorized' }),
    }),
  );
});

test('login offers one header signup action and accessible bilingual password recovery', async ({
  page,
}) => {
  await page.goto('/');
  const header = page.locator('header');
  await expect(header.locator('a[href="/register"]')).toHaveCount(1);
  await expect(header.getByRole('link', { name: 'Sign up', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
  await expect(page.locator('main').getByRole('alert')).toHaveCount(0);
  const recovery = page.getByRole('link', { name: 'Forgot password?', exact: true });
  await recovery.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/forgot-password');
  await page.goto('/');
  await page.getByRole('button', { name: 'Switch language to Thai' }).click();
  await expect(header.getByRole('link', { name: 'สมัครสมาชิก', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'ลืมรหัสผ่าน?', exact: true })).toHaveAttribute(
    'href',
    '/forgot-password',
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(1);
});

test('failed login shows an alert while keeping password help available', async ({ page }) => {
  await page.route('**/api/v1/auth/login', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Invalid credentials' }),
    }),
  );
  await page.goto('/');
  await page.getByLabel('Email address', { exact: true }).fill('student@example.test');
  await page.getByLabel('Password', { exact: true }).fill('incorrect-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('main').getByRole('alert')).toHaveText(
    'Unable to sign in. Please check your details and try again.',
  );
  await expect(page.locator('[data-notebook-toast="error"]')).toHaveText(
    'Unable to sign in. Please check your details and try again.',
  );
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
  await page.getByRole('link', { name: 'Forgot password?', exact: true }).click();
  await expect(page).toHaveURL('/forgot-password');
});

test('registration shares the about link and offers one header login action', async ({ page }) => {
  await page.goto('/register');
  const header = page.locator('header');
  const nav = header.locator('nav');
  await expect(nav.getByRole('link')).toHaveCount(1);
  await expect(nav.getByRole('link', { name: 'Return to login' })).toHaveAttribute('href', '/');
  await expect(
    header.getByRole('link', { name: 'Learn with us', includeHidden: true }),
  ).toHaveAttribute('href', '/about-me');

  await page.getByRole('button', { name: 'Switch language to Thai' }).click();
  await expect(
    header.getByRole('link', { name: 'เรียนรู้ไปกับเรา', includeHidden: true }),
  ).toHaveAttribute('href', '/about-me');
  await nav.getByRole('link', { name: 'กลับไปหน้าเข้าสู่ระบบ' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('link', { name: 'ลืมรหัสผ่าน?', exact: true })).toBeVisible();
});
