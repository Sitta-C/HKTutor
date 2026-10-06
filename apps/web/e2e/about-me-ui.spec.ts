import { expect, test } from '@playwright/test';

test('the single top why link scrolls again when its fragment is already in the URL', async ({
  page,
}) => {
  await page.route('**/api/v1/auth/refresh', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Unauthorized' }),
    }),
  );
  await page.goto('/about-me');
  await page.getByRole('button', { name: 'Switch language to Thai' }).click();
  const whyLink = page.getByRole('link', { name: 'ทำไมต้อง HKTutor', exact: true });
  await expect(whyLink).toHaveCount(1);
  await expect(
    page.locator('header').getByRole('link', { name: 'ทำไมต้อง HKTutor' }),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  await whyLink.click();
  await expect(page).toHaveURL('/about-me#why-hktutor');
  const firstScroll = await page.evaluate(() => window.scrollY);
  expect(firstScroll).toBeGreaterThan(100);

  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page).toHaveURL('/about-me#why-hktutor');
  await whyLink.focus();
  await page.keyboard.press('Enter');
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThanOrEqual(firstScroll - 1);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole('button', { name: 'เปลี่ยนภาษาเป็นภาษาอังกฤษ' }).click();
  await page.getByRole('link', { name: 'Why HKTutor', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(1);
});
