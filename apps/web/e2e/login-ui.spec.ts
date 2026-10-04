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

test('login offers one header signup action and accessible bilingual password help', async ({
  page,
}) => {
  await page.goto('/');
  const header = page.locator('header');
  await expect(header.locator('a[href="/register"]')).toHaveCount(1);
  await expect(header.getByRole('link', { name: 'Sign up', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
  await expect(page.locator('main').getByRole('alert')).toHaveCount(0);
  await expect(page.getByText('Having trouble signing in?')).toHaveCount(0);

  const help = page.getByRole('button', { name: 'Forgot password?', exact: true });
  await help.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Forgot password?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Password reset is not available yet.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(help).toBeFocused();

  await page.getByRole('button', { name: 'Switch language to Thai' }).click();
  await expect(header.getByRole('link', { name: 'สมัครสมาชิก', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'ลืมรหัสผ่าน?', exact: true }).click();
  const thaiDialog = page.getByRole('dialog', { name: 'ลืมรหัสผ่าน?' });
  await expect(thaiDialog.getByText('ขณะนี้ยังไม่รองรับการรีเซ็ตรหัสผ่าน')).toBeVisible();
  await thaiDialog.getByRole('button', { name: 'ปิด', exact: true }).click();
  await expect(thaiDialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'ลืมรหัสผ่าน?', exact: true })).toBeFocused();

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
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Forgot password?', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Forgot password?' })).toBeVisible();
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
  await expect(page.getByRole('button', { name: 'ลืมรหัสผ่าน?', exact: true })).toBeVisible();
});
