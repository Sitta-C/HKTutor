import { expect, test } from '@playwright/test';

import type { TeachingListing } from '@/lib/api/types';
import type { Page } from '@playwright/test';

const listings: TeachingListing[] = [
  {
    id: 'math',
    subject: { id: 'math-subject', code: 'MATH', name: 'Mathematics', active: true },
    gradeLevel: { id: 'high', code: 'HIGH', name: 'Upper secondary', active: true, sortOrder: 1 },
    pricePerHour: 450,
    description: 'Build a clear foundation and prepare for exams.',
    publicationStatus: 'PUBLISHED',
    publishedAt: '2026-10-03T04:00:00.000Z',
    createdAt: '2026-10-01T04:00:00.000Z',
    updatedAt: '2026-10-03T04:00:00.000Z',
  },
  {
    id: 'physics',
    subject: { id: 'physics-subject', code: 'PHYSICS', name: 'Physics', active: true },
    gradeLevel: { id: 'high', code: 'HIGH', name: 'Upper secondary', active: true, sortOrder: 1 },
    pricePerHour: 500,
    description: 'Understand mechanics through everyday examples.',
    publicationStatus: 'DRAFT',
    publishedAt: null,
    createdAt: '2026-10-01T04:00:00.000Z',
    updatedAt: '2026-10-05T04:00:00.000Z',
  },
  {
    id: 'english',
    subject: { id: 'english-subject', code: 'ENGLISH', name: 'English', active: true },
    gradeLevel: { id: 'low', code: 'LOW', name: 'Lower secondary', active: true, sortOrder: 2 },
    pricePerHour: 350,
    description: 'Read and write with confidence.',
    publicationStatus: 'ARCHIVED',
    publishedAt: null,
    createdAt: '2026-10-01T04:00:00.000Z',
    updatedAt: '2026-10-05T04:00:00.000Z',
  },
];

async function mockListings(
  page: Page,
  options: {
    language?: 'en' | 'th';
    verified?: boolean;
    fail?: boolean;
    empty?: boolean;
    beforeRead?: () => Promise<void>;
    beforeArchive?: () => Promise<void>;
    failArchive?: boolean;
  } = {},
) {
  const writes: Array<{ path: string; body: unknown }> = [];
  let items = options.empty ? [] : listings.map((listing) => ({ ...listing }));
  await page
    .context()
    .addCookies([
      { name: 'hktutor_refresh', value: 'ui-test-session', url: 'http://localhost:3000' },
    ]);
  await page.addInitScript(
    (language) => window.localStorage.setItem('hktutor-language', language),
    options.language ?? 'th',
  );
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    let body: unknown;
    if (path === '/auth/refresh') {
      body = {
        accessToken: 'ui-test-token',
        user: {
          id: 'ledger-tutor',
          email: 'tutor@example.test',
          role: 'TUTOR',
          displayName: 'Anan',
        },
      };
    } else if (path === '/profiles/me') {
      body = {
        role: 'TUTOR',
        consentCurrent: true,
        profileComplete: true,
        policyVersion: '2026-01',
        profile: {
          displayName: 'Anan',
          bio: 'Mathematics tutor',
          experienceYears: 5,
          verificationStatus: options.verified === false ? 'PENDING' : 'VERIFIED',
          ratingAverage: null,
          reviewCount: 0,
        },
      };
    } else if (path === '/tutors/me/listings') {
      await options.beforeRead?.();
      if (options.fail) {
        await route.fulfill({ status: 500, json: { message: 'Unavailable' } });
        return;
      }
      body = items;
    } else {
      const item = items.find((listing) => path.startsWith(`/tutors/me/listings/${listing.id}/`));
      if (!item) {
        await route.fulfill({ status: 404, json: { message: 'Not found' } });
        return;
      }
      writes.push({ path, body: request.postData() ? request.postDataJSON() : null });
      if (path.endsWith('/status') && request.postDataJSON().publicationStatus === 'ARCHIVED') {
        await options.beforeArchive?.();
        if (options.failArchive) {
          await route.fulfill({ status: 500, json: { message: 'Unavailable' } });
          return;
        }
      }
      const updated: TeachingListing = {
        ...item,
        publicationStatus: path.endsWith('/publish')
          ? 'PUBLISHED'
          : path.endsWith('/status')
            ? request.postDataJSON().publicationStatus
            : item.publicationStatus,
      };
      items = items.map((listing) => (listing.id === updated.id ? updated : listing));
      body = updated;
    }
    await route.fulfill({ json: body });
  });
  return writes;
}

test('preserves search, filtering, edit links and publication actions in the ledger', async ({
  page,
}) => {
  const writes = await mockListings(page, { language: 'en' });
  await page.goto('/dashboard/listings');
  const ledger = page.getByRole('region', { name: 'Teaching listings', exact: true });
  await expect(ledger.getByRole('article')).toHaveCount(3);
  const search = page.getByRole('searchbox', { name: 'Search teaching listings' });
  await search.fill('mechanics');
  const physics = ledger.getByRole('article', { name: 'Physics', exact: true });
  await expect(ledger.getByRole('article')).toHaveCount(1);
  await expect(physics.getByRole('link', { name: 'Edit' })).toHaveAttribute(
    'href',
    '/dashboard/listings/physics/edit',
  );
  await physics.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(physics.getByText('Published', { exact: true })).toBeVisible();
  await search.fill('');
  const math = ledger.getByRole('article', { name: 'Mathematics', exact: true });
  const dialog = page.getByRole('alertdialog', { name: 'Archive this listing?' });
  await math.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await expect(dialog.getByRole('heading', { name: 'Mathematics', exact: true })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Confirm', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(math.getByRole('button', { name: 'Archive', exact: true })).toBeFocused();
  expect(writes).toHaveLength(1);
  await math.getByRole('button', { name: 'Archive', exact: true }).click();
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(math.getByRole('button', { name: 'Archive', exact: true })).toBeFocused();
  expect(writes).toHaveLength(1);
  await math.getByRole('button', { name: 'Archive', exact: true }).click();
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(math.getByText('Archived', { exact: true })).toBeVisible();
  await math.getByRole('button', { name: 'Restore draft', exact: true }).click();
  await expect(math.getByText('Draft', { exact: true })).toBeVisible();
  const filters = page.getByRole('group', { name: 'Filter teaching listings' });
  if (await filters.isVisible()) {
    await filters.getByRole('button', { name: 'Draft 1', exact: true }).click();
  } else {
    await page.getByRole('combobox', { name: 'Filter teaching listings' }).selectOption('DRAFT');
  }
  await expect(ledger.getByRole('article')).toHaveCount(1);
  expect(writes).toEqual([
    { path: '/tutors/me/listings/physics/publish', body: null },
    { path: '/tutors/me/listings/math/status', body: { publicationStatus: 'ARCHIVED' } },
    { path: '/tutors/me/listings/math/status', body: { publicationStatus: 'DRAFT' } },
  ]);
});

test('fits the Thai ledger and archive alert at 320px and respects verification', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  const writes = await mockListings(page, { verified: false });
  await page.goto('/dashboard/listings');
  await expect(page.getByText('กำลังรอตรวจสอบโปรไฟล์', { exact: true })).toBeVisible();
  const ledger = page.getByRole('region', { name: 'รายการประกาศสอน', exact: true });
  const publishButtons = ledger.getByRole('button', { name: 'เผยแพร่', exact: true });
  await expect(publishButtons).toHaveCount(2);
  for (const button of await publishButtons.all()) {
    await expect(button).toBeDisabled();
  }
  const math = ledger.getByRole('article', { name: 'Mathematics', exact: true });
  await math.getByRole('button', { name: 'เก็บถาวร', exact: true }).click();
  const dialog = page.getByRole('alertdialog', { name: 'เก็บประกาศนี้ไว้ถาวร?' });
  await expect(dialog.getByRole('button', { name: 'ยืนยัน', exact: true })).toBeVisible();
  const fits = await page.locator('main').evaluate((element) => {
    return [...element.querySelectorAll('article, button, input, select')].every((child) => {
      if (!child.getClientRects().length) return true;
      const rect = child.getBoundingClientRect();
      return (
        rect.left >= 0 &&
        rect.right <= window.innerWidth + 1 &&
        child.scrollWidth <= child.clientWidth + 1
      );
    });
  });
  expect(fits).toBe(true);
  expect(
    await dialog.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return (
        rect.left >= 0 &&
        rect.right <= window.innerWidth &&
        element.scrollWidth <= element.clientWidth
      );
    }),
  ).toBe(true);
  await dialog.getByRole('button', { name: 'ยกเลิก', exact: true }).click();
  expect(writes).toEqual([]);
});

test('keeps an archive failure visible in the alert without changing the course status', async ({
  page,
}) => {
  await mockListings(page, { language: 'en', failArchive: true });
  await page.goto('/dashboard/listings');
  const math = page.getByRole('article', { name: 'Mathematics', exact: true });
  await math.getByRole('button', { name: 'Archive', exact: true }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Archive this listing?' });
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText(
    'Unable to update this listing. Check your profile status and try again.',
  );
  await expect(dialog.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(math.getByText('Published', { exact: true })).toBeVisible();
});

test('keeps the alert open and prevents duplicate requests while archiving', async ({ page }) => {
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const writes = await mockListings(page, { language: 'en', beforeArchive: () => pending });
  await page.goto('/dashboard/listings');
  const math = page.getByRole('article', { name: 'Mathematics', exact: true });
  await math.getByRole('button', { name: 'Archive', exact: true }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Archive this listing?' });
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Working…', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  release();
  await expect(dialog).toHaveCount(0);
  await expect(math.getByText('Archived', { exact: true })).toBeVisible();
  expect(writes).toHaveLength(1);
});

test('keeps counts unavailable on load failure and does not show an empty account', async ({
  page,
}) => {
  await mockListings(page, { language: 'en', fail: true });
  await page.goto('/dashboard/listings');
  await expect(page.locator('main').getByRole('alert')).toHaveText(
    'Unable to load your teaching listings.',
  );
  const summary = page.getByRole('region', { name: 'Listing overview' });
  await expect(summary.locator('dd')).toHaveText(['—', '—']);
  await expect(
    page.getByRole('heading', { name: 'Create your first teaching listing' }),
  ).toHaveCount(0);
});

test('keeps the ledger shell visible with unavailable counts while loading', async ({ page }) => {
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await mockListings(page, { language: 'en', beforeRead: () => pending });
  await page.goto('/dashboard/listings');
  const summary = page.getByRole('region', { name: 'Listing overview' });
  await expect(summary.locator('dd')).toHaveText(['—', '—']);
  await expect(page.locator('main').getByRole('status')).toHaveText(
    'Loading your teaching listings…',
  );
  release();
  await expect(summary.locator('dd')).toHaveText(['3', '1']);
});

test('shows zero counts and the first listing action for a successfully empty account', async ({
  page,
}) => {
  await mockListings(page, { language: 'en', empty: true });
  await page.goto('/dashboard/listings');
  const summary = page.getByRole('region', { name: 'Listing overview' });
  await expect(summary.locator('dd')).toHaveText(['0', '0']);
  await expect(
    page.getByRole('heading', { name: 'Create your first teaching listing' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Create first listing' })).toHaveAttribute(
    'href',
    '/dashboard/listings/new',
  );
});
