import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { formatCalendarDate } from '@/lib/date-time';

import type { AdminCoupon, UserRole } from '@/lib/api/types';
import type { Page, Route } from '@playwright/test';

test.use({ timezoneId: 'America/Los_Angeles' });

const NOW = new Date('2026-11-11T03:00:00.000Z');
const first: AdminCoupon = {
  id: 'coupon-one',
  code: 'WELCOME10',
  percent: 10,
  maxUses: 100,
  active: true,
  expiresAt: '2026-11-30T16:59:00.000Z',
  consumedUses: 12,
  reservedUses: 3,
  availableUses: 85,
  createdAt: '2026-11-10T03:00:00.000Z',
  updatedAt: '2026-11-10T03:00:00.000Z',
};
const examples: AdminCoupon[] = [
  first,
  {
    ...first,
    id: 'two',
    code: 'STUDY20',
    percent: 20,
    active: false,
    maxUses: 50,
    consumedUses: 8,
    reservedUses: 2,
    availableUses: 40,
    expiresAt: '2026-12-15T16:59:00.000Z',
  },
  {
    ...first,
    id: 'three',
    code: 'OCT15',
    percent: 15,
    maxUses: 30,
    consumedUses: 5,
    reservedUses: 0,
    availableUses: 25,
    expiresAt: '2026-10-31T16:59:00.000Z',
  },
  {
    ...first,
    id: 'four',
    code: 'LASTCALL',
    percent: 25,
    maxUses: 10,
    consumedUses: 8,
    reservedUses: 2,
    availableUses: 0,
  },
];

async function setup(
  page: Page,
  handler: (route: Route, url: URL) => Promise<void>,
  role: UserRole | 'GUEST' = 'ADMIN',
  language = 'en',
) {
  // The shared proxy checks cookie presence; GUEST represents an expired/rejected session.
  await page
    .context()
    .addCookies([
      { name: 'hktutor_refresh', value: 'ui-test-session', url: 'http://localhost:3000' },
    ]);
  await page.clock.setFixedTime(NOW);
  await page.addInitScript((value) => localStorage.setItem('hktutor-language', value), language);
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/v1/auth/refresh') {
      await route.fulfill({
        status: role === 'GUEST' ? 401 : 200,
        json:
          role === 'GUEST'
            ? { message: 'Unauthorized' }
            : {
                accessToken: 'ui-test-token',
                user: {
                  id: 'admin-coupons-ui',
                  email: 'admin@example.test',
                  displayName: 'Admin',
                  role,
                },
              },
      });
      return;
    }
    if (
      url.pathname === '/api/v1/admin/coupons' ||
      url.pathname.startsWith('/api/v1/admin/coupons/')
    ) {
      await handler(route, url);
      return;
    }
    if (url.pathname === '/api/v1/profiles/me') {
      await route.fulfill({
        json: {
          role,
          profile: null,
          consentCurrent: true,
          profileComplete: true,
          policyVersion: '2026-01',
        },
      });
      return;
    }
    await route.fulfill({
      status: 500,
      json: { message: `Unexpected fixture request: ${url.pathname}` },
    });
  });
  await page.goto('/dashboard/coupons');
}

async function pickExpiry(page: Page, date: string, time: string, language: 'en' | 'th' = 'en') {
  await page.locator('#coupon-date').click();
  await page
    .getByRole('gridcell', { name: formatCalendarDate(date, language), exact: true })
    .click();
  await page.locator('#coupon-time').click();
  const hour = page.getByRole('spinbutton', {
    name: language === 'th' ? 'ชั่วโมง' : 'Hour',
    exact: true,
  });
  const minute = page.getByRole('spinbutton', {
    name: language === 'th' ? 'นาที' : 'Minute',
    exact: true,
  });
  for (const [wheel, target, max] of [
    [hour, Number(time.slice(0, 2)), 23],
    [minute, Number(time.slice(3, 5)), 59],
  ] as const) {
    await wheel.focus();
    await wheel.press(target === max ? 'End' : 'Home');
    if (target !== max) {
      for (let jump = 0; jump < Math.floor(target / 5); jump += 1) {
        await wheel.press('PageDown');
      }
      for (let step = 0; step < target % 5; step += 1) {
        await wheel.press('ArrowDown');
      }
    }
  }
  await minute.press('Enter');
}

async function fillForm(page: Page, code = ' new_10 ') {
  await page.getByLabel('Coupon code', { exact: true }).fill(code);
  await page.getByLabel('Discount (%)', { exact: true }).fill('10');
  await page.getByLabel('Maximum uses', { exact: true }).fill('100');
  await pickExpiry(page, '2026-11-12', '00:00');
}

for (const language of ['en', 'th'] as const) {
  test(`shared expiry calendar and time wheel keep validation, keyboard and UTC (${language})`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const width =
      testInfo.project.name === 'chromium'
        ? 1440
        : testInfo.project.name === 'tablet-chromium'
          ? 768
          : 320;
    await page.setViewportSize({ width, height: 1000 });
    let payload: unknown;
    let posts = 0;
    await setup(
      page,
      async (route) => {
        if (route.request().method() === 'POST') {
          posts += 1;
          payload = route.request().postDataJSON();
          await route.fulfill({ status: 201, json: first });
        } else {
          await route.fulfill({ json: { items: [], nextCursor: null } });
        }
      },
      'ADMIN',
      language,
    );
    const date = page.locator('#coupon-date');
    const time = page.locator('#coupon-time');
    const submit = page.getByRole('button', {
      name: language === 'th' ? 'สร้างคูปอง' : 'Create coupon',
      exact: true,
    });
    await expect(date).toContainText(language === 'th' ? 'เลือกวันที่' : 'Choose a date');
    await expect(time).toContainText(language === 'th' ? 'เลือกเวลา' : 'Choose a time');
    await page.locator('#coupon-code').fill('NEW_10');
    await page.locator('#coupon-percent').fill('10');
    await page.locator('#coupon-maxUses').fill('100');
    await submit.click();
    await confirmPendingAction(page);
    await expect(date).toBeFocused();
    await expect(date).toHaveAttribute('data-invalid', 'true');
    await expect(time).toHaveAttribute('aria-describedby', /coupon-expiry-error/);
    expect(posts).toBe(0);
    await date.press('Enter');
    const calendar = page.getByRole('dialog', {
      name: language === 'th' ? 'เลือกวันที่หมดอายุของคูปอง' : 'Choose the coupon expiry date',
    });
    await expect(calendar).toBeVisible();
    await expect(
      calendar.getByRole('gridcell', {
        name: formatCalendarDate('2026-11-10', language),
        exact: true,
      }),
    ).toBeDisabled();
    await expect(calendar.getByRole('grid')).toContainText(language === 'th' ? 'พฤหัส' : 'Thu');
    const bounds = await calendar.boundingBox();
    expect(bounds).not.toBeNull();
    if (bounds) {
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    }
    await page.screenshot({
      path: testInfo.outputPath(`expiry-calendar-${language}.png`),
      fullPage: true,
    });
    await page.keyboard.press('Escape');
    await expect(date).toBeFocused();
    await expect(page.locator('input[name="date"]')).toHaveValue('');
    await pickExpiry(page, '2026-11-12', '23:59', language);
    await expect(date).toContainText(language === 'th' ? '2569' : '2026');
    await expect(date).not.toHaveAttribute('data-invalid', 'true');
    await expect(page.locator('input[name="date"]')).toHaveValue('2026-11-12');
    await expect(page.locator('input[name="time"]')).toHaveValue('23:59');
    await time.press('Enter');
    const minute = page.getByRole('spinbutton', {
      name: language === 'th' ? 'นาที' : 'Minute',
      exact: true,
    });
    await expect(
      page.getByRole('spinbutton', { name: language === 'th' ? 'ชั่วโมง' : 'Hour', exact: true }),
    ).toBeFocused();
    await minute.focus();
    await minute.press('ArrowDown');
    await expect(minute).toHaveAttribute('aria-valuenow', '0');
    await page.screenshot({
      path: testInfo.outputPath(`expiry-time-${language}.png`),
      fullPage: true,
    });
    await minute.press('Escape');
    await expect(time).toBeFocused();
    await expect(time).toContainText('23:00');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await submit.click();
    await confirmPendingAction(page);
    expect(payload).toEqual({
      code: 'NEW_10',
      percent: 10,
      maxUses: 100,
      expiresAt: '2026-11-12T16:00:00.000Z',
      active: true,
    });
    await expect(date).toContainText(language === 'th' ? 'เลือกวันที่' : 'Choose a date');
    await expect(time).toContainText(language === 'th' ? 'เลือกเวลา' : 'Choose a time');
    expect(posts).toBe(1);
  });
}

for (const language of ['en', 'th'] as const) {
  test(`activation uses server state, prevents duplicates and preserves counts (${language})`, async ({
    page,
  }, testInfo) => {
    let active = false;
    let patches = 0;
    let release: (() => void) | undefined;
    let gate: Promise<void> | undefined;
    await setup(
      page,
      async (route, url) => {
        if (route.request().method() === 'PATCH') {
          patches += 1;
          expect(url.pathname).toBe(`/api/v1/admin/coupons/${first.id}/activation`);
          const payload: unknown = route.request().postDataJSON();
          expect(payload).toEqual({ active: !active });
          if (gate) {
            await gate;
          }
          active = !active;
          await route.fulfill({ json: { ...first, active } });
        } else {
          await route.fulfill({ json: { items: [{ ...first, active }], nextCursor: null } });
        }
      },
      'ADMIN',
      language,
    );
    const list = page.getByRole('region', {
      name: language === 'th' ? 'ทะเบียนคูปอง' : 'Coupon register',
      exact: true,
    });
    const activate = page.getByRole('button', {
      name: `${language === 'th' ? 'เปิดใช้งาน' : 'Activate'} ${first.code}`,
      exact: true,
    });
    const deactivate = page.getByRole('button', {
      name: `${language === 'th' ? 'ปิดใช้งาน' : 'Deactivate'} ${first.code}`,
      exact: true,
    });
    await expect(activate).toBeVisible();
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await activate.focus();
    await activate.press('Enter');
    await confirmPendingAction(page);
    await expect(activate).toBeDisabled();
    await expect(activate).toHaveAttribute('aria-busy', 'true');
    await expect(
      list.locator('li span').filter({ hasText: language === 'th' ? /^ปิดใช้งาน$/ : /^Inactive$/ }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', {
        name: language === 'th' ? 'โหลดรายการคูปองใหม่' : 'Refresh coupons',
      }),
    ).toBeDisabled();
    expect(patches).toBe(1);
    release?.();
    gate = undefined;
    await expect(deactivate).toBeEnabled();
    await expect(
      list.locator('li span').filter({ hasText: language === 'th' ? /^ปิดใช้งาน$/ : /^Inactive$/ }),
    ).toHaveCount(0);
    await expect(list.locator('dd')).toHaveText(['12', '3', '85', '100']);
    await deactivate.click();
    await confirmPendingAction(page);
    await expect(activate).toBeEnabled();
    await expect(
      list.locator('li span').filter({ hasText: language === 'th' ? /^ปิดใช้งาน$/ : /^Inactive$/ }),
    ).toBeVisible();
    await expect(list.locator('dd')).toHaveText(['12', '3', '85', '100']);
    expect(patches).toBe(2);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await list.screenshot({ path: testInfo.outputPath(`activation-${language}.png`) });
  });
}

test('uncertain activation requires a successful refresh before another change', async ({
  page,
}) => {
  let active = false;
  let patches = 0;
  let failRefresh = false;
  await setup(page, async (route) => {
    if (route.request().method() === 'PATCH') {
      patches += 1;
      active = true;
      await route.abort('failed');
    } else {
      await route.fulfill(
        failRefresh
          ? { status: 503, json: { message: 'unavailable' } }
          : { json: { items: [{ ...first, active }], nextCursor: null } },
      );
    }
  });
  const activate = page.getByRole('button', { name: `Activate ${first.code}`, exact: true });
  await activate.click();
  await confirmPendingAction(page);
  await expect(activate).toBeDisabled();
  await expect(page.getByRole('listitem').getByRole('alert')).toContainText(
    'could not be confirmed',
  );
  expect(patches).toBe(1);
  failRefresh = true;
  await page.getByRole('button', { name: 'Refresh coupons' }).click();
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
  await expect(activate).toBeDisabled();
  failRefresh = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(
    page.getByRole('button', { name: `Deactivate ${first.code}`, exact: true }),
  ).toBeEnabled();
  expect(patches).toBe(1);
});

for (const status of [401, 403]) {
  test(`activation ${status} clears coupon data and retains access recovery`, async ({ page }) => {
    let reads = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await setup(page, async (route) => {
      if (route.request().method() === 'PATCH') {
        await gate;
        await route.fulfill({ status, json: { message: 'access denied' } });
      } else if (route.request().method() === 'POST') {
        await route.fulfill({ status: 201, json: { ...first, id: 'new-coupon', code: 'NEW_10' } });
      } else {
        reads += 1;
        await route.fulfill({ json: { items: [{ ...first, active: false }], nextCursor: null } });
      }
    });
    await fillForm(page);
    const initialReads = reads;
    const activate = page.getByRole('button', { name: `Activate ${first.code}`, exact: true });
    await activate.click();
    await confirmPendingAction(page);
    await expect(activate).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByRole('alertdialog')).toHaveAttribute('aria-busy', 'true');
    await expect(
      page.getByRole('alertdialog').getByRole('button', { name: 'Cancel', exact: true }),
    ).toBeDisabled();
    release?.();
    await expect(page.getByRole('heading', { name: first.code, exact: true })).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: `Activate ${first.code}`, exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('link', {
        name: status === 401 ? 'Sign in again' : 'Back to dashboard',
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'NEW_10', exact: true })).toHaveCount(0);
    expect(reads).toBe(initialReads);
  });
}

test('activation does not label an expired or exhausted coupon as usable', async ({ page }) => {
  let active = false;
  const limited = {
    ...first,
    expiresAt: '2026-11-01T00:00:00Z',
    consumedUses: 100,
    reservedUses: 0,
    availableUses: 0,
  };
  await setup(page, async (route) => {
    if (route.request().method() === 'PATCH') {
      active = true;
      await route.fulfill({ json: { ...limited, active } });
    } else {
      await route.fulfill({ json: { items: [{ ...limited, active }], nextCursor: null } });
    }
  });
  await page.getByRole('button', { name: `Activate ${first.code}`, exact: true }).click();
  await confirmPendingAction(page);
  await expect(
    page.getByRole('button', { name: `Deactivate ${first.code}`, exact: true }),
  ).toBeEnabled();
  const item = page.getByRole('listitem');
  await expect(item.getByText('Expired', { exact: true })).toBeVisible();
  await expect(item.getByText('No capacity', { exact: true })).toBeVisible();
  await expect(item.locator('dd')).toHaveText(['100', '0', '0', '100']);
});

test('creates only the T21 payload with Bangkok midnight, false active, focus and refreshed list', async ({
  page,
}) => {
  let payload: unknown;
  let created = false;
  await setup(page, async (route) => {
    if (route.request().method() === 'POST') {
      payload = route.request().postDataJSON();
      created = true;
      await route.fulfill({ status: 201, json: { ...first, code: 'NEW_10', active: false } });
    } else {
      await route.fulfill({
        json: {
          items: created ? [{ ...first, code: 'NEW_10', active: false }] : [],
          nextCursor: null,
        },
      });
    }
  });
  await expect(
    page.getByText('No coupons yet. Create the first one using the form.'),
  ).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  const mobileSidebar = (page.viewportSize()?.width ?? 1440) < 1024;
  if (mobileSidebar) {
    await page.getByRole('button', { name: 'Open sidebar', exact: true }).press('Enter');
  }
  await expect(page.getByRole('link', { name: 'Coupons', exact: true })).toHaveAttribute(
    'href',
    '/dashboard/coupons',
  );
  if (mobileSidebar) {
    await page.keyboard.press('Escape');
  }
  await fillForm(page);
  await page.getByLabel('Active on creation', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Create coupon', exact: true }).click();
  await confirmPendingAction(page);
  expect(payload).toEqual({
    code: 'NEW_10',
    percent: 10,
    maxUses: 100,
    expiresAt: '2026-11-11T17:00:00.000Z',
    active: false,
  });
  await expect(page.getByRole('heading', { name: 'NEW_10', exact: true })).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'New coupon', exact: true }).getByRole('status'),
  ).toBeFocused();
  await expect(page.getByLabel('Coupon code', { exact: true })).toHaveValue('');
});

test('validates boundaries and associates duplicate and server field errors without clearing input', async ({
  page,
}) => {
  let mode = 'duplicate';
  let posts = 0;
  await setup(page, async (route) => {
    if (route.request().method() === 'POST') {
      posts += 1;
      await route.fulfill({
        status: mode === 'duplicate' ? 409 : 400,
        json:
          mode === 'duplicate'
            ? { code: 'COUPON_CODE_EXISTS', message: 'duplicate' }
            : { code: 'VALIDATION_FAILED', message: ['expiresAt must be strictly in the future'] },
      });
    } else {
      await route.fulfill({ json: { items: [], nextCursor: null } });
    }
  });
  await page.getByRole('button', { name: 'Create coupon', exact: true }).click();
  await confirmPendingAction(page);
  await expect(page.getByLabel('Coupon code', { exact: true })).toBeFocused();
  expect(posts).toBe(0);
  await fillForm(page, 'WELCOME10');
  await page.getByLabel('Discount (%)', { exact: true }).fill('101');
  await page.getByRole('button', { name: 'Create coupon', exact: true }).click();
  await confirmPendingAction(page);
  await expect(page.getByLabel('Discount (%)', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  expect(posts).toBe(0);
  await page.getByLabel('Discount (%)', { exact: true }).fill('10');
  await page.getByRole('button', { name: 'Create coupon', exact: true }).click();
  await confirmPendingAction(page);
  await expect(page.getByLabel('Coupon code', { exact: true })).toHaveAttribute(
    'aria-describedby',
    /coupon-code-error/,
  );
  await expect(page.getByLabel('Coupon code', { exact: true })).toHaveValue('WELCOME10');
  await expect(page.locator('#coupon-code-error')).toHaveText(
    'This coupon code already exists. Choose another code.',
  );
  mode = 'validation';
  await page.getByLabel('Coupon code', { exact: true }).fill('OTHER10');
  await page.getByRole('button', { name: 'Create coupon', exact: true }).click();
  await confirmPendingAction(page);
  await expect(page.locator('#coupon-date')).toBeFocused();
  await expect(page.locator('#coupon-date')).toHaveAttribute('data-invalid', 'true');
  await expect(page.getByLabel('Maximum uses', { exact: true })).toHaveValue('100');
});

test('locks duplicate submissions while saving', async ({ page }) => {
  let posts = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await setup(page, async (route) => {
    if (route.request().method() === 'POST') {
      posts += 1;
      await gate;
      await route.fulfill({ status: 201, json: first });
    } else {
      await route.fulfill({ json: { items: [], nextCursor: null } });
    }
  });
  await fillForm(page);
  await page.getByRole('button', { name: 'Create coupon', exact: true }).click();
  await confirmPendingAction(page);
  await expect(page.getByRole('button', { name: 'Creating coupon…', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Coupon code', { exact: true })).toBeDisabled();
  expect(posts).toBe(1);
  release?.();
  await expect(page.getByRole('button', { name: 'Create coupon', exact: true })).toBeEnabled();
});

for (const language of ['en', 'th'] as const) {
  test(`percent endpoints and one-use coupons preserve the draft on duplicate (${language})`, async ({
    page,
  }) => {
    const payloads: unknown[] = [];
    await setup(
      page,
      async (route) => {
        if (route.request().method() === 'POST') {
          payloads.push(route.request().postDataJSON());
          await route.fulfill({ status: 409, json: { code: 'COUPON_CODE_EXISTS' } });
        } else {
          await route.fulfill({ json: { items: [], nextCursor: null } });
        }
      },
      'ADMIN',
      language,
    );
    await page.locator('#coupon-code').fill(' \tWelcome10 ');
    await page.locator('#coupon-maxUses').fill('1');
    await pickExpiry(page, '2026-11-12', '00:00', language);
    const submit = page.getByRole('button', {
      name: language === 'th' ? 'สร้างคูปอง' : 'Create coupon',
      exact: true,
    });
    for (const percent of [1, 100]) {
      await page.locator('#coupon-percent').fill(String(percent));
      await submit.click();
      await confirmPendingAction(page);
      await expect(page.locator('#coupon-code-error')).toBeVisible();
      await expect(page.locator('#coupon-code')).toBeFocused();
      await expect(page.locator('#coupon-code')).toHaveValue(' \tWelcome10 ');
      await expect(page.locator('#coupon-percent')).toHaveValue(String(percent));
      await expect(page.locator('#coupon-maxUses')).toHaveValue('1');
      await expect(page.locator('#coupon-date')).toContainText(language === 'th' ? '2569' : '2026');
      await expect(page.locator('#coupon-time')).toContainText('00:00');
    }
    expect(payloads).toEqual(
      [1, 100].map((percent) => ({
        code: 'WELCOME10',
        percent,
        maxUses: 1,
        expiresAt: '2026-11-11T17:00:00.000Z',
        active: true,
      })),
    );
  });
}

test('preserves network-failed creation and reconciles later pages before allowing another POST', async ({
  page,
}) => {
  let posts = 0;
  let checking = false;
  let failedCheck = true;
  await setup(page, async (route, url) => {
    if (route.request().method() === 'POST') {
      posts += 1;
      checking = true;
      await route.abort('failed');
      return;
    }
    if (checking && failedCheck) {
      await route.fulfill({ status: 503, json: { message: 'offline' } });
      return;
    }
    await route.fulfill({
      json: {
        items: checking && url.searchParams.has('cursor') ? [{ ...first, code: 'NEW_10' }] : [],
        nextCursor: checking && !url.searchParams.has('cursor') ? 'page+2=' : null,
      },
    });
  });
  await fillForm(page);
  await page.getByRole('button', { name: 'Create coupon', exact: true }).click();
  await confirmPendingAction(page);
  await expect(
    page.getByRole('button', { name: 'Check creation result', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Coupon code', { exact: true })).toHaveValue(' new_10 ');
  await expect(page.getByRole('button', { name: 'Create coupon', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Check creation result', exact: true }).click();
  await expect(
    page
      .getByRole('region', { name: 'New coupon' })
      .getByText(
        'Could not finish checking all coupons. Keep checking before trying to create again.',
      ),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create coupon', exact: true })).toBeDisabled();
  failedCheck = false;
  await page.getByRole('button', { name: 'Check creation result', exact: true }).click();
  await expect(page.locator('#coupon-code-error')).toContainText('already exists');
  expect(posts).toBe(1);
  await expect(page.getByLabel('Maximum uses', { exact: true })).toHaveValue('100');
});

test('an absent code after a full recovery scan permits a manual retry', async ({ page }) => {
  let posts = 0;
  await setup(page, async (route) => {
    if (route.request().method() === 'POST') {
      posts += 1;
      await route.fulfill({ status: 500, json: { message: 'uncertain' } });
    } else {
      await route.fulfill({ json: { items: [], nextCursor: null } });
    }
  });
  await fillForm(page);
  await page.getByRole('button', { name: 'Create coupon', exact: true }).click();
  await confirmPendingAction(page);
  await page.getByRole('button', { name: 'Check creation result', exact: true }).click();
  await expect(
    page.getByText(
      'This code was not found after checking the list. You can retry creating the coupon.',
    ),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create coupon', exact: true })).toBeEnabled();
  expect(posts).toBe(1);
});

for (const control of ['Create coupon', 'Activate STUDY20', 'Deactivate WELCOME10']) {
  test(`the ${control} button meets text contrast in normal and hover states`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await setup(page, async (route) => {
      await route.fulfill({ json: { items: examples.slice(0, 2), nextCursor: null } });
    });
    const button = page.getByRole('button', { name: control, exact: true });
    const contrast = () =>
      button.evaluate((element) => {
        const style = getComputedStyle(element);
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const context = canvas.getContext('2d');
        if (!context) {
          throw new Error('Expected a canvas context for sRGB color conversion');
        }
        const luminance = (color: string): number => {
          context.fillStyle = color;
          context.fillRect(0, 0, 1, 1);
          const [red = 0, green = 0, blue = 0] = Array.from(context.getImageData(0, 0, 1, 1).data)
            .slice(0, 3)
            .map((value) => {
              const channel = value / 255;
              return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
            });
          return red * 0.2126 + green * 0.7152 + blue * 0.0722;
        };
        const foreground = luminance(style.color);
        const background = luminance(style.backgroundColor);
        return {
          color: style.color,
          background: style.backgroundColor,
          ratio:
            (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05),
        };
      });
    const normal = await contrast();
    expect(normal.ratio).toBeGreaterThanOrEqual(4.5);
    if (await page.evaluate(() => matchMedia('(hover: hover)').matches)) {
      await button.hover();
      await expect.poll(async () => (await contrast()).background).not.toBe(normal.background);
      expect((await contrast()).ratio).toBeGreaterThanOrEqual(4.5);
    }
  });
}

for (const outcome of ['success', 'uncertain', 'refresh failure'] as const) {
  test(`creation after activation refreshes the register and preserves pagination (${outcome})`, async ({
    page,
  }) => {
    let created = false;
    let activationFinished = false;
    let reads = 0;
    let initialReads = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const newCoupon = { ...first, id: 'new-coupon', code: 'NEW_10' };
    await setup(page, async (route, url) => {
      if (route.request().method() === 'PATCH') {
        await gate;
        activationFinished = true;
        if (outcome === 'uncertain') {
          await route.abort('failed');
        } else {
          await route.fulfill({ json: { ...first, active: false } });
        }
      } else if (route.request().method() === 'POST') {
        created = true;
        await route.fulfill({ status: 201, json: newCoupon });
      } else {
        reads += 1;
        if (created) {
          expect(activationFinished).toBe(true);
        }
        if (outcome === 'refresh failure' && created && reads === initialReads + 1) {
          await route.fulfill({ status: 503, json: { message: 'offline' } });
        } else {
          await route.fulfill({
            json: {
              items: url.searchParams.has('cursor')
                ? [examples[1]]
                : created
                  ? [newCoupon, { ...first, active: false }]
                  : [first],
              nextCursor: url.searchParams.has('cursor') ? null : 'older-coupons',
            },
          });
        }
      }
    });
    const list = page.getByRole('region', { name: 'Coupon register', exact: true });
    const more = list.getByRole('button', { name: 'Load more coupons', exact: true });
    await expect(more).toBeVisible();
    await fillForm(page);
    initialReads = reads;
    const deactivate = list.getByRole('button', { name: 'Deactivate WELCOME10', exact: true });
    await deactivate.click();
    await confirmPendingAction(page);
    await expect(deactivate).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByRole('alertdialog')).toHaveAttribute('aria-busy', 'true');
    expect(reads).toBe(initialReads);
    release?.();
    await expect(page.locator('dialog[data-notebook-confirmation]')).toHaveCount(0);
    if (outcome !== 'uncertain') {
      await expect(
        list.getByRole('button', { name: 'Activate WELCOME10', exact: true }),
      ).toBeEnabled();
    }
    await page.getByRole('button', { name: 'Create coupon', exact: true }).click();
    await confirmPendingAction(page);
    await expect(list.getByRole('heading', { name: 'NEW_10', exact: true })).toBeVisible();
    if (outcome === 'refresh failure') {
      await expect(list.getByRole('alert')).toHaveText('Could not load coupons. Please try again.');
      await expect(list.getByRole('heading', { name: 'NEW_10', exact: true })).toBeVisible();
      await list.getByRole('button', { name: 'Try again', exact: true }).click();
    }
    await expect(more).toBeEnabled();
    await expect(
      list.getByRole('button', { name: 'Activate WELCOME10', exact: true }),
    ).toBeEnabled();
    expect(reads).toBe(initialReads + (outcome === 'refresh failure' ? 2 : 1));
    await more.click();
    await expect(list.getByRole('heading', { name: 'STUDY20', exact: true })).toBeVisible();
    await expect(list.getByRole('listitem')).toHaveCount(3);
    await expect(list.getByRole('heading', { name: 'NEW_10', exact: true })).toHaveCount(1);
    await expect(more).toHaveCount(0);
  });
}

for (const language of ['en', 'th']) {
  test(`recovery displays the 21st coupon even when first-page refresh fails (${language})`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    let mode: 'initial' | 'checking' | 'refresh' = 'initial';
    let posts = 0;
    const recent = Array.from({ length: 20 }, (_, index) => ({
      ...first,
      id: `recent-${index}`,
      code: `RECENT_${index}`,
    }));
    const recovered: AdminCoupon = {
      ...first,
      id: 'old-coupon',
      code: 'RECOVER_10',
      percent: 35,
      consumedUses: 11,
      reservedUses: 7,
      availableUses: 82,
      active: false,
    };
    await setup(
      page,
      async (route, url) => {
        if (route.request().method() === 'POST') {
          posts += 1;
          mode = 'checking';
          await route.abort('failed');
        } else if (mode === 'refresh') {
          await route.fulfill({ status: 503, json: { message: 'offline' } });
        } else if (url.searchParams.has('cursor')) {
          mode = 'refresh';
          await route.fulfill({ json: { items: [recovered], nextCursor: null } });
        } else {
          await route.fulfill({ json: { items: recent, nextCursor: 'page-2' } });
        }
      },
      'ADMIN',
      language,
    );
    const register = page.getByRole('region', {
      name: language === 'th' ? 'ทะเบียนคูปอง' : 'Coupon register',
      exact: true,
    });
    await expect(register.getByRole('listitem')).toHaveCount(20);
    await page.locator('#coupon-code').fill('recover_10');
    await page.locator('#coupon-percent').fill('10');
    await page.locator('#coupon-maxUses').fill('100');
    await pickExpiry(page, '2026-11-30', '23:59', language === 'th' ? 'th' : 'en');
    await page
      .getByRole('button', {
        name: language === 'th' ? 'สร้างคูปอง' : 'Create coupon',
        exact: true,
      })
      .click();
    await confirmPendingAction(page);
    await page
      .getByRole('button', {
        name: language === 'th' ? 'ตรวจสอบผลการสร้าง' : 'Check creation result',
        exact: true,
      })
      .click();
    const match = page.getByRole('region', {
      name: language === 'th' ? 'คูปองที่พบ' : 'Existing coupon',
      exact: true,
    });
    await expect(match).toBeVisible();
    await expect(match.getByText('RECOVER_10 · 35%', { exact: true })).toBeVisible();
    expect(await match.locator('dd').allTextContents()).toEqual(
      expect.arrayContaining(['11', '7', '82', '100']),
    );
    await expect(match.locator('time')).toHaveAttribute('datetime', recovered.expiresAt);
    await expect(
      match.getByText(language === 'th' ? 'ปิดใช้งาน' : 'Inactive', { exact: true }),
    ).toBeVisible();
    await expect(register.getByRole('alert')).toBeVisible();
    await expect(register.getByRole('listitem')).toHaveCount(20);
    await expect(register.getByText('RECOVER_10', { exact: true })).toHaveCount(0);
    expect(posts).toBe(1);
    const output = testInfo.outputPath('screenshots');
    await mkdir(output, { recursive: true });
    await expect(page.locator('[data-notebook-toast]')).toHaveCount(0);
    await match.scrollIntoViewIfNeeded();
    await match.screenshot({
      path: path.join(output, `recovery-${testInfo.project.name}-${language}.png`),
    });
    await page.locator('#coupon-code').fill('ANOTHER10');
    await expect(match).toHaveCount(0);
    await expect(page.locator('#coupon-percent')).toHaveValue('10');
    await expect(
      page.getByRole('button', {
        name: language === 'th' ? 'สร้างคูปอง' : 'Create coupon',
        exact: true,
      }),
    ).toBeEnabled();
  });
}

test('paginates with real counts, retains rows on failure, and retries the failed page', async ({
  page,
}) => {
  let failMore = true;
  await setup(page, async (route, url) => {
    if (url.searchParams.has('cursor') && failMore) {
      await route.fulfill({ status: 503, json: { message: 'retry' } });
      return;
    }
    await route.fulfill({
      json: {
        items: url.searchParams.has('cursor') ? examples.slice(1) : [first],
        nextCursor: url.searchParams.has('cursor') ? null : 'next+/=',
      },
    });
  });
  const list = page.getByRole('region', { name: 'Coupon register', exact: true });
  await expect(list.getByRole('heading', { name: first.code })).toBeVisible();
  await expect(list.locator('dd')).toHaveText(['12', '3', '85', '100']);
  await page.getByRole('button', { name: 'Load more coupons' }).click();
  await expect(list.getByText('Could not load coupons. Please try again.')).toBeVisible();
  await expect(list.getByRole('heading', { name: first.code })).toBeVisible();
  failMore = false;
  await list.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(list.getByRole('listitem')).toHaveCount(4);
  await expect(list.getByText('Inactive', { exact: true })).toBeVisible();
  await expect(list.getByText('Expired', { exact: true })).toBeVisible();
  await expect(list.getByText('No capacity', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load more coupons' })).toHaveCount(0);
});

test('retains a confirmed creation if the subsequent list refresh fails', async ({ page }) => {
  let created = false;
  await setup(page, async (route) => {
    if (route.request().method() === 'POST') {
      created = true;
      await route.fulfill({ status: 201, json: { ...first, code: 'NEW_10' } });
    } else {
      await route.fulfill(
        created
          ? { status: 503, json: { message: 'offline' } }
          : { json: { items: [], nextCursor: null } },
      );
    }
  });
  await fillForm(page);
  await page.getByRole('button', { name: 'Create coupon', exact: true }).click();
  await confirmPendingAction(page);
  await expect(page.getByRole('heading', { name: 'NEW_10', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create coupon', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Check creation result' })).toHaveCount(0);
});

test('an old initial GET cannot erase a coupon created while it was loading', async ({ page }) => {
  let created = false;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await setup(page, async (route) => {
    if (route.request().method() === 'POST') {
      created = true;
      await route.fulfill({ status: 201, json: { ...first, code: 'NEW_10' } });
    } else if (!created) {
      await gate;
      await route.fulfill({ json: { items: [], nextCursor: null } });
    } else {
      await route.fulfill({ json: { items: [{ ...first, code: 'NEW_10' }], nextCursor: null } });
    }
  });
  await expect(page.getByText('Loading coupons…', { exact: true })).toBeVisible();
  await fillForm(page);
  await page.getByRole('button', { name: 'Create coupon', exact: true }).click();
  await confirmPendingAction(page);
  await expect(page.getByRole('heading', { name: 'NEW_10', exact: true })).toBeVisible();
  release?.();
  await expect(page.getByRole('heading', { name: 'NEW_10', exact: true })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'NEW_10' })).toHaveCount(1);
});

test('failed initial loading is recoverable without displaying an invented empty register', async ({
  page,
}) => {
  let failed = true;
  await setup(page, async (route) => {
    await route.fulfill(
      failed
        ? { status: 503, json: { message: 'offline' } }
        : { json: { items: [first], nextCursor: null } },
    );
  });
  await expect(page.getByText('Could not load coupons. Please try again.')).toBeVisible();
  await expect(page.getByText('No coupons yet. Create the first one using the form.')).toHaveCount(
    0,
  );
  failed = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('heading', { name: first.code, exact: true })).toBeVisible();
});

test('a coupon switches to expired at its exclusive expiry without reloading the page', async ({
  page,
}) => {
  const expiry = new Date(NOW.getTime() + 1000).toISOString();
  await setup(page, async (route) => {
    await route.fulfill({ json: { items: [{ ...first, expiresAt: expiry }], nextCursor: null } });
  });
  const list = page.getByRole('region', { name: 'Coupon register', exact: true });
  await expect(list.getByText('Available', { exact: true })).toHaveCount(2);
  await page.clock.setFixedTime(new Date(expiry));
  await page.clock.runFor(1100);
  await expect(list.getByText('Expired', { exact: true })).toBeVisible();
});

test('POST 403 removes coupon data and disables creation after authorization changes', async ({
  page,
}) => {
  await setup(page, async (route) => {
    await route.fulfill(
      route.request().method() === 'POST'
        ? { status: 403, json: { message: 'forbidden' } }
        : { json: { items: [first], nextCursor: null } },
    );
  });
  await fillForm(page);
  await page.getByRole('button', { name: 'Create coupon', exact: true }).click();
  await confirmPendingAction(page);
  await expect(page.locator('p[role="alert"]')).toContainText('Access denied');
  await expect(page.getByRole('heading', { name: first.code, exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create coupon', exact: true })).toHaveCount(0);
});

for (const role of ['STUDENT', 'TUTOR', 'GUEST'] as const) {
  test(`does not fetch coupons for ${role}`, async ({ page }) => {
    let reads = 0;
    await setup(
      page,
      async (route) => {
        reads += 1;
        await route.fulfill({ json: { items: [], nextCursor: null } });
      },
      role,
    );
    await expect(page.locator('p[role="alert"]')).toContainText(
      role === 'GUEST' ? 'session has ended' : 'Access denied',
    );
    await expect(page.getByRole('button', { name: 'Create coupon', exact: true })).toHaveCount(0);
    expect(reads).toBe(0);
  });
}

test('API 403 hides the workspace rather than treating it as an empty list', async ({ page }) => {
  await setup(page, async (route) => {
    await route.fulfill({ status: 403, json: { message: 'Administrator role required' } });
  });
  await expect(page.locator('p[role="alert"]')).toContainText('Access denied');
  await expect(page.getByRole('button', { name: 'Create coupon', exact: true })).toHaveCount(0);
});

test('API 401 retries through auth refresh and then offers sign-in recovery', async ({ page }) => {
  let reads = 0;
  await setup(page, async (route) => {
    reads += 1;
    await route.fulfill({ status: 401, json: { message: 'revoked' } });
  });
  await expect(page.getByRole('link', { name: 'Sign in again' })).toHaveAttribute(
    'href',
    '/?returnTo=%2Fdashboard%2Fcoupons',
  );
  await expect(page.getByRole('button', { name: 'Create coupon', exact: true })).toHaveCount(0);
  // Development Strict Mode may start and cancel one additional initial GET.
  expect(reads).toBeGreaterThanOrEqual(2);
  expect(reads).toBeLessThanOrEqual(4);
});

for (const language of ['en', 'th']) {
  test(`responsive ${language} keyboard flow and screenshots`, async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const width =
      testInfo.project.name === 'chromium'
        ? 1440
        : testInfo.project.name === 'tablet-chromium'
          ? 768
          : 320;
    await page.setViewportSize({ width, height: width === 320 ? 860 : 1024 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await setup(
      page,
      async (route) => {
        await route.fulfill({ json: { items: examples, nextCursor: null } });
      },
      'ADMIN',
      language,
    );
    await expect(page.getByRole('heading', { name: 'WELCOME10', exact: true })).toBeVisible();
    const code = page.locator('#coupon-code');
    await code.focus();
    await page.keyboard.type('NEW_10');
    await page.keyboard.press('Tab');
    await expect(page.locator('#coupon-percent')).toBeFocused();
    await page.keyboard.type('10');
    await page.keyboard.press('Tab');
    await expect(page.locator('#coupon-maxUses')).toBeFocused();
    await page.keyboard.type('100');
    await pickExpiry(page, '2026-11-30', '23:59', language === 'th' ? 'th' : 'en');
    await expect(page.locator('html')).toHaveAttribute('lang', language);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await page.evaluate(() => document.fonts.ready);
    const bodyFont = await page
      .locator('body')
      .evaluate((element) => getComputedStyle(element).fontFamily);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-family', bodyFont);
    await expect(page.locator('#coupon-code')).toHaveCSS('font-family', bodyFont);
    await expect(page.locator('#coupon-code')).toHaveCSS('font-size', '16px');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-weight', '700');
    const noteFont = await page
      .locator('main .font-note')
      .evaluate((element) => getComputedStyle(element).fontFamily);
    expect(noteFont).toMatch(language === 'th' ? /mali/i : /caveat/i);
    const formBox = await page
      .getByRole('region', { name: language === 'th' ? 'คูปองใหม่' : 'New coupon', exact: true })
      .boundingBox();
    const registerBox = await page
      .getByRole('region', {
        name: language === 'th' ? 'ทะเบียนคูปอง' : 'Coupon register',
        exact: true,
      })
      .boundingBox();
    if (!formBox || !registerBox) {
      throw new Error('Expected the form and coupon register to be rendered');
    }
    if (width === 1440) {
      expect(registerBox.x).toBeGreaterThan(formBox.x + formBox.width);
      const sidebarBox = await page.locator('#dashboard-sidebar').boundingBox();
      if (!sidebarBox) {
        throw new Error('Expected the desktop sidebar to be rendered');
      }
      expect(formBox.x).toBeGreaterThanOrEqual(sidebarBox.x + sidebarBox.width);
    } else {
      expect(registerBox.y).toBeGreaterThan(formBox.y + formBox.height);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    for (const input of await page
      .locator('form input:not([type="checkbox"]):not([type="hidden"])')
      .all()) {
      const box = await input.boundingBox();
      expect(box?.width).toBeGreaterThan(100);
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect(box?.x).toBeGreaterThanOrEqual(0);
      if (box) {
        expect(box.x + box.width).toBeLessThanOrEqual(width);
      }
    }
    const output = testInfo.outputPath('screenshots');
    await mkdir(output, { recursive: true });
    await page.getByRole('heading', { level: 1 }).click();
    await page.screenshot({
      path: path.join(output, `coupons-${width}-${language}.png`),
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });
}

// Existing journey checks deliberately confirm the new review step before asserting the API result.
async function confirmPendingAction(page: Page): Promise<void> {
  const dialog = page.locator('dialog[data-notebook-confirmation]');
  if (await dialog.count()) await dialog.getByRole('button').last().click();
}

for (const width of [320, 768, 1440]) {
  test(`coupon creation is reviewed before POST and cancel keeps the draft (${width}px)`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: width === 320 ? 740 : 900 });
    let posts = 0;
    await setup(page, async (route) => {
      if (route.request().method() === 'POST') {
        posts += 1;
        await route.fulfill({
          status: 201,
          json: { ...first, id: 'confirmed-coupon', code: 'CONFIRM10' },
        });
      } else await route.fulfill({ json: { items: [], nextCursor: null } });
    });
    await fillForm(page, 'CONFIRM10');
    const trigger = page.getByRole('button', { name: 'Create coupon', exact: true });
    await trigger.click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('CONFIRM10');
    await expect(dialog).toContainText('10%');
    expect(posts).toBe(0);
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await dialog.screenshot({ path: testInfo.outputPath(`coupon-confirmation-${width}.png`) });
    await page.screenshot({
      path: testInfo.outputPath(`coupon-confirmation-${width}-context.png`),
    });
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(trigger).toBeFocused();
    await expect(page.getByLabel('Coupon code', { exact: true })).toHaveValue('CONFIRM10');
    expect(posts).toBe(0);
    await trigger.click();
    await confirmPendingAction(page);
    await expect(page.locator('[data-notebook-toast="success"]')).toContainText('Coupon created.');
    expect(posts).toBe(1);
  });
}
