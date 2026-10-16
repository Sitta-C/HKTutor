import { expect, test } from '@playwright/test';

import type { EmailFlow } from '@/lib/api/types';

for (const purpose of ['verification', 'password-reset'] as const) {
  test(`${purpose} locks the original email, restores cooldown after reload and resends without an email input`, async ({
    page,
  }) => {
    await page.clock.install();
    await page.clock.pauseAt(new Date('2026-10-16T12:00:00Z'));
    const startedAt = await page.evaluate(() => Date.now());
    let readyAt = startedAt + 60_000;
    let missing = false;
    const writes: unknown[] = [];
    const flow = async (): Promise<EmailFlow> => ({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      email: 'original@example.com',
      purpose,
      resendAvailableAt: new Date(readyAt).toISOString(),
      retryAfterSeconds: Math.max(
        0,
        Math.ceil((readyAt - (await page.evaluate(() => Date.now()))) / 1000),
      ),
    });
    await page.route('**/api/v1/auth/refresh', (route) => route.fulfill({ status: 401, json: {} }));
    await page.route('**/api/v1/auth/email-flow?*', async (route) =>
      route.fulfill(missing ? { status: 400, json: {} } : { json: await flow() }),
    );
    const endpoint = purpose === 'verification' ? 'resend-verification' : 'resend-password-reset';
    await page.route(`**/api/v1/auth/${endpoint}`, async (route) => {
      writes.push(route.request().postDataJSON());
      readyAt = (await page.evaluate(() => Date.now())) + 60_000;
      await route.fulfill({
        json: { message: 'Generic accepted result', emailFlow: await flow() },
      });
    });
    await page.goto(
      purpose === 'verification'
        ? '/register/verify?email=attacker@example.com'
        : '/forgot-password',
    );
    const email = page.getByLabel('Email address', { exact: true });
    await expect(email).toHaveValue('original@example.com');
    await expect(email).toHaveAttribute('readonly', '');
    await expect(
      page.getByRole('button', { name: 'Resend available in 01:00', exact: true }),
    ).toBeDisabled();
    await page.clock.fastForward(23_000);
    await page.reload();
    await expect(email).toHaveValue('original@example.com');
    await expect(
      page.getByRole('button', { name: 'Resend available in 00:37', exact: true }),
    ).toBeDisabled();
    expect(writes).toHaveLength(0);
    await page.clock.fastForward(37_000);
    const label = purpose === 'verification' ? 'Resend email' : 'Resend reset email';
    await page.getByRole('button', { name: label, exact: true }).click();
    expect(writes).toEqual([{ flowId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }]);
    await expect(
      page.getByRole('button', { name: 'Resend available in 01:00', exact: true }),
    ).toBeDisabled();
    await page.clock.fastForward(3_000);
    await page.getByRole('button', { name: 'Switch language to Thai' }).click();
    await expect(
      page.getByRole('button', { name: 'ส่งอีกครั้งได้ใน 00:57', exact: true }),
    ).toBeDisabled();
    await expect(page.locator('main').getByRole('status').first()).toContainText(
      purpose === 'verification' ? 'ส่งอีเมลยืนยันใหม่แล้ว' : 'หากบัญชีเข้าเงื่อนไข',
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    if (purpose === 'password-reset') {
      await page.getByRole('button', { name: 'กรอกอีเมลผิด? เริ่มคำขอใหม่' }).click();
      await expect(page.getByLabel('อีเมล', { exact: true })).toBeEditable();
      await expect(page.getByLabel('อีเมล', { exact: true })).toHaveValue('');
    } else {
      await page.getByRole('link', { name: 'กรอกอีเมลผิด? กลับไปสมัครสมาชิก' }).click();
      await expect(page).toHaveURL('/register');
    }
    missing = true;
  });
}

test('verification cannot substitute an email through the URL when its signed flow is missing', async ({
  page,
}) => {
  await page.route('**/api/v1/auth/refresh', (route) => route.fulfill({ status: 401, json: {} }));
  await page.route('**/api/v1/auth/email-flow?*', (route) =>
    route.fulfill({ status: 400, json: {} }),
  );
  await page.goto('/register/verify?email=other@example.com');
  await expect(page.getByLabel('Email address', { exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Resend email', exact: true })).toBeDisabled();
  await expect(page.locator('main').getByRole('alert')).toContainText(
    'This email request is unavailable',
  );
  await expect(
    page.getByRole('link', { name: 'Entered the wrong email? Back to registration' }),
  ).toBeVisible();
});

test('a failed flow reload keeps the original reset email locked and requires recovery before resending', async ({
  page,
}) => {
  let unavailable = false;
  const flow = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    email: 'original@example.com',
    purpose: 'password-reset',
    resendAvailableAt: new Date(0).toISOString(),
    retryAfterSeconds: 0,
  };
  await page.route('**/api/v1/auth/refresh', (route) => route.fulfill({ status: 401, json: {} }));
  await page.route('**/api/v1/auth/email-flow?*', (route) =>
    route.fulfill(unavailable ? { status: 503, json: {} } : { json: flow }),
  );
  await page.route('**/api/v1/auth/resend-password-reset', (route) => {
    unavailable = true;
    return route.fulfill({ status: 503, json: {} });
  });
  await page.goto('/forgot-password');
  await page.getByRole('button', { name: 'Resend reset email', exact: true }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText('Unable to complete');
  await expect(page.getByLabel('Email address', { exact: true })).toHaveValue(
    'original@example.com',
  );
  await expect(page.getByLabel('Email address', { exact: true })).toHaveAttribute('readonly', '');
  await expect(
    page.getByRole('button', { name: 'Resend reset email', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Reload email request', exact: true }),
  ).toBeVisible();
});
