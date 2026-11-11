import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

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
    if (url.pathname === '/api/v1/admin/coupons') {
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

async function fillForm(page: Page, code = ' new_10 ') {
  await page.getByLabel('Coupon code', { exact: true }).fill(code);
  await page.getByLabel('Discount (%)', { exact: true }).fill('10');
  await page.getByLabel('Maximum uses', { exact: true }).fill('100');
  await page.getByLabel('Expiry date', { exact: true }).fill('2026-11-12');
  await page.getByLabel('Expiry time', { exact: true }).fill('00:00');
}

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
    await page.getByRole('button', { name: 'Open sidebar', exact: true }).click();
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
  await expect(page.getByLabel('Coupon code', { exact: true })).toBeFocused();
  expect(posts).toBe(0);
  await fillForm(page, 'WELCOME10');
  await page.getByLabel('Discount (%)', { exact: true }).fill('101');
  await page.getByRole('button', { name: 'Create coupon', exact: true }).click();
  await expect(page.getByLabel('Discount (%)', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  expect(posts).toBe(0);
  await page.getByLabel('Discount (%)', { exact: true }).fill('10');
  await page.getByRole('button', { name: 'Create coupon', exact: true }).click();
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
  await expect(page.getByLabel('Expiry date', { exact: true })).toBeFocused();
  await expect(page.getByLabel('Expiry date', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
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
  await expect(page.getByRole('button', { name: 'Creating coupon…', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Coupon code', { exact: true })).toBeDisabled();
  expect(posts).toBe(1);
  release?.();
  await expect(page.getByRole('button', { name: 'Create coupon', exact: true })).toBeEnabled();
});

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
  await expect(
    page.getByRole('button', { name: 'Check creation result', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Coupon code', { exact: true })).toHaveValue(' new_10 ');
  await expect(page.getByRole('button', { name: 'Create coupon', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Check creation result', exact: true }).click();
  await expect(
    page.getByText(
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
  await page.getByRole('button', { name: 'Check creation result', exact: true }).click();
  await expect(
    page.getByText(
      'This code was not found after checking the list. You can retry creating the coupon.',
    ),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create coupon', exact: true })).toBeEnabled();
  expect(posts).toBe(1);
});

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
    await route.fulfill({ status: 403, json: { message: 'consent required' } });
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
    await page.locator('#coupon-date').fill('2026-11-30');
    await page.locator('#coupon-time').fill('23:59');
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
    for (const input of await page.locator('form input:not([type="checkbox"])').all()) {
      const box = await input.boundingBox();
      expect(box?.width).toBeGreaterThan(100);
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect(box?.x).toBeGreaterThanOrEqual(0);
      if (box) {
        expect(box.x + box.width).toBeLessThanOrEqual(width);
      }
    }
    const output = path.resolve('..', '..', 'ui-design', 'review-evidence', 's3-t22');
    await mkdir(output, { recursive: true });
    await page.getByRole('heading', { level: 1 }).click();
    await page.screenshot({
      path: path.join(output, `coupons-${width}-${language}.png`),
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });
}
