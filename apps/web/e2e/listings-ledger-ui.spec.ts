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
    beforePublish?: () => Promise<void>;
    failPublish?: boolean;
    failRestore?: boolean;
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
      if (path.endsWith('/publish')) {
        await options.beforePublish?.();
        if (options.failPublish) {
          await route.fulfill({ status: 500, json: { message: 'Unavailable' } });
          return;
        }
      }
      if (path.endsWith('/status') && request.postDataJSON().publicationStatus === 'ARCHIVED') {
        await options.beforeArchive?.();
        if (options.failArchive) {
          await route.fulfill({ status: 500, json: { message: 'Unavailable' } });
          return;
        }
      }
      if (
        path.endsWith('/status') &&
        request.postDataJSON().publicationStatus === 'DRAFT' &&
        options.failRestore
      ) {
        await route.fulfill({ status: 500, json: { message: 'Unavailable' } });
        return;
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
  await page
    .getByRole('alertdialog', { name: 'Publish this listing?' })
    .getByRole('button', { name: /^(Publish|Archive)$/ })
    .click();
  await expect(physics.getByText('Published', { exact: true })).toBeVisible();
  await expect(page.locator('[data-notebook-toast="success"]')).toHaveText('Listing published.');
  await search.fill('');
  const math = ledger.getByRole('article', { name: 'Mathematics', exact: true });
  const dialog = page.getByRole('alertdialog', { name: 'Archive this listing?' });
  await math.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await expect(dialog.getByRole('heading', { name: 'Mathematics', exact: true })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: /^(Publish|Archive)$/ })).toBeFocused();
  await page.keyboard.press('Tab');
  // Native Chromium dialogs can traverse browser chrome and the dialog before the first button.
  if (await page.evaluate(() => document.activeElement === document.body)) {
    await page.keyboard.press('Tab');
  }
  if (await dialog.evaluate((element) => document.activeElement === element)) {
    await expect(dialog).toBeFocused();
    await page.keyboard.press('Tab');
  }
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(math.getByRole('button', { name: 'Archive', exact: true })).toBeFocused();
  expect(writes).toHaveLength(1);
  await math.getByRole('button', { name: 'Archive', exact: true }).click();
  await dialog.getByRole('button', { name: /^(Publish|Archive)$/ }).focus();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(math.getByRole('button', { name: 'Archive', exact: true })).toBeFocused();
  expect(writes).toHaveLength(1);
  await math.getByRole('button', { name: 'Archive', exact: true }).click();
  await dialog.getByRole('button', { name: /^(Publish|Archive)$/ }).click();
  await expect(math.getByText('Archived', { exact: true })).toBeVisible();
  await expect(
    page.locator('[data-notebook-toast="success"]').filter({ hasText: 'Listing archived.' }),
  ).toHaveCount(1);
  await math.getByRole('button', { name: 'Restore draft', exact: true }).click();
  await expect(math.getByText('Draft', { exact: true })).toBeVisible();
  await expect(
    page
      .locator('[data-notebook-toast="success"]')
      .filter({ hasText: 'Listing restored to draft.' }),
  ).toHaveCount(1);
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

for (const language of ['th', 'en'] as const) {
  test(`preserves create action placement and spacing after returning from the editor in ${language}`, async ({
    page,
  }) => {
    await mockListings(page, { language });
    for (const width of [320, 639, 640, 768, 1440]) {
      await page.setViewportSize({ width, height: 1100 });
      await page.goto('/dashboard/listings');
      const create = page.getByRole('link', {
        name: language === 'th' ? 'สร้างประกาศใหม่' : 'New listing',
        exact: true,
      });
      for (const returning of [false, true]) {
        if (returning) {
          await create.focus();
          await page.keyboard.press('Enter');
          await page.waitForURL('**/dashboard/listings/new');
          await page.goBack();
        }
        await expect(create).toBeVisible();
        await expect(create).toHaveCount(1);
        await expect(page.getByRole('article')).toHaveCount(3);
        const layout = await create.evaluate((element) => {
          const header = element.closest('header');
          const introduction = header?.querySelector('div');
          const summary = header?.nextElementSibling;
          const main = element.closest('main');
          if (!header || !introduction || !summary || !main) {
            throw new Error('The create action must belong to the page introduction.');
          }
          return {
            header: header.getBoundingClientRect().toJSON(),
            introduction: introduction.getBoundingClientRect().toJSON(),
            action: element.getBoundingClientRect().toJSON(),
            summary: summary.getBoundingClientRect().toJSON(),
            overflow: main.scrollWidth - main.clientWidth,
          };
        });
        expect(layout.overflow).toBeLessThanOrEqual(1);
        expect(layout.summary.top - layout.header.bottom).toBeGreaterThanOrEqual(23);
        if (width < 640) {
          expect(layout.action.top - layout.introduction.bottom).toBeGreaterThanOrEqual(19);
          expect(Math.abs(layout.action.width - layout.header.width)).toBeLessThanOrEqual(1);
        } else {
          expect(layout.action.left - layout.introduction.right).toBeGreaterThanOrEqual(23);
        }
      }
    }
  });
}

test('keeps publication blue and archiving warning red when switching alerts', async ({ page }) => {
  const writes = await mockListings(page, { language: 'en' });
  await page.goto('/dashboard/listings');
  for (const action of ['publish', 'archive', 'publish'] as const) {
    const publishing = action === 'publish';
    await page
      .getByRole('article', { name: publishing ? 'Physics' : 'Mathematics', exact: true })
      .getByRole('button', { name: publishing ? 'Publish' : 'Archive', exact: true })
      .click();
    const dialog = page.getByRole('alertdialog');
    const accent = await page.evaluate((publish) => {
      const sample = document.createElement('span');
      sample.style.color = publish
        ? 'var(--color-tutor-deep)'
        : 'color-mix(in srgb, var(--color-red-700) 75%, var(--color-notebook-muted))';
      document.body.append(sample);
      const color = getComputedStyle(sample).color;
      sample.remove();
      return color;
    }, publishing);
    await expect(dialog.getByRole('button', { name: /^(Publish|Archive)$/ })).toHaveCSS(
      'background-color',
      accent,
    );
    await expect(dialog.locator(':scope > div').first().locator('span').first()).toHaveCSS(
      'color',
      accent,
    );
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  }
  expect(writes).toEqual([]);
});

for (const subject of ['Physics', 'English']) {
  test(`confirms publication of ${subject} without requests on cancel or Escape`, async ({
    page,
  }) => {
    const writes = await mockListings(page, { language: 'en' });
    await page.goto('/dashboard/listings');
    const course = page.getByRole('article', { name: subject, exact: true });
    const publish = course.getByRole('button', { name: 'Publish', exact: true });
    const dialog = page.getByRole('alertdialog', { name: 'Publish this listing?' });
    await publish.click();
    await expect(dialog.getByRole('heading', { name: subject, exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(publish).toBeFocused();
    await publish.click();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(publish).toBeFocused();
    expect(writes).toEqual([]);
    await publish.click();
    await dialog.getByRole('button', { name: /^(Publish|Archive)$/ }).click();
    await expect(dialog).toHaveCount(0);
    await expect(course.getByText('Published', { exact: true })).toBeVisible();
    expect(writes).toEqual([
      {
        path: `/tutors/me/listings/${subject === 'Physics' ? 'physics' : 'english'}/publish`,
        body: null,
      },
    ]);
  });
}

test('fits the Thai publish alert at 320px and publishes only the selected course', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  const writes = await mockListings(page);
  await page.goto('/dashboard/listings');
  const physics = page.getByRole('article', { name: 'Physics', exact: true });
  await physics.getByRole('button', { name: 'เผยแพร่', exact: true }).click();
  const dialog = page.getByRole('alertdialog', { name: 'เผยแพร่ประกาศนี้?' });
  await expect(
    dialog.getByText('นักเรียนจะเห็นประกาศนี้ ตรวจสอบรายละเอียดก่อนยืนยันการเผยแพร่'),
  ).toBeVisible();
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
  expect(writes).toEqual([]);
  await dialog.getByRole('button', { name: /^(เผยแพร่|เก็บถาวร)$/ }).click();
  await expect(physics.getByText('เผยแพร่แล้ว', { exact: true })).toBeVisible();
  expect(writes).toEqual([{ path: '/tutors/me/listings/physics/publish', body: null }]);
});

test('keeps publish failures in the alert with the draft unchanged', async ({ page }) => {
  await mockListings(page, { language: 'en', failPublish: true });
  await page.goto('/dashboard/listings');
  const physics = page.getByRole('article', { name: 'Physics', exact: true });
  await physics.getByRole('button', { name: 'Publish', exact: true }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Publish this listing?' });
  await dialog.getByRole('button', { name: /^(Publish|Archive)$/ }).click();
  await expect(dialog.locator('[role="alert"]:not([data-notebook-toast])')).toHaveText(
    'Unable to update this listing. Check your profile status and try again.',
  );
  const toast = dialog.locator('[data-notebook-toast="error"]');
  await expect(toast).toHaveText(
    'Unable to update this listing. Check your profile status and try again.',
  );
  expect(
    await toast.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return element.contains(
        document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
      );
    }),
  ).toBe(true);
  await expect(dialog.getByRole('button', { name: /^(Publish|Archive)$/ })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(physics.getByText('Draft', { exact: true })).toBeVisible();
});

test('prevents duplicate publication and dismissal until publishing finishes', async ({ page }) => {
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const writes = await mockListings(page, { language: 'en', beforePublish: () => pending });
  await page.goto('/dashboard/listings');
  const physics = page.getByRole('article', { name: 'Physics', exact: true });
  await physics.getByRole('button', { name: 'Publish', exact: true }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Publish this listing?' });
  await dialog.getByRole('button', { name: /^(Publish|Archive)$/ }).click();
  await expect(dialog.getByRole('button', { name: 'Working…', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  release();
  await expect(dialog).toHaveCount(0);
  await expect(physics.getByText('Published', { exact: true })).toBeVisible();
  expect(writes).toHaveLength(1);
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
  await expect(dialog.getByRole('button', { name: /^(เผยแพร่|เก็บถาวร)$/ })).toBeVisible();
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
  await dialog.getByRole('button', { name: /^(Publish|Archive)$/ }).click();
  await expect(dialog.locator('[role="alert"]:not([data-notebook-toast])')).toHaveText(
    'Unable to update this listing. Check your profile status and try again.',
  );
  await expect(dialog.locator('[data-notebook-toast="error"]')).toHaveCount(1);
  await expect(dialog.getByRole('button', { name: /^(Publish|Archive)$/ })).toBeEnabled();
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
  await dialog.getByRole('button', { name: /^(Publish|Archive)$/ }).click();
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

for (const language of ['en', 'th'] as const) {
  for (const width of [320, 768, 1440]) {
    test(`${language} error toast stays above native confirmation at ${width}px and survives closing it`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const writes = await mockListings(page, { language, failPublish: true });
      await page.goto('/dashboard/listings');
      const course = page.getByRole('article', { name: 'Physics', exact: true });
      await course
        .getByRole('button', { name: language === 'th' ? 'เผยแพร่' : 'Publish', exact: true })
        .click();
      const dialog = page.getByRole('alertdialog');
      await dialog
        .getByRole('button', { name: language === 'th' ? 'เผยแพร่' : 'Publish', exact: true })
        .click();
      const toast = page.locator('[data-notebook-toast="error"]');
      await expect(toast).toHaveCount(1);
      await expect(dialog.locator('[data-notebook-toast="error"]')).toHaveCount(1);
      expect(
        await toast.evaluate((element) => {
          const box = element.getBoundingClientRect();
          return (
            box.left >= 0 &&
            box.right <= innerWidth &&
            element.scrollWidth <= element.clientWidth &&
            element.contains(
              document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
            )
          );
        }),
      ).toBe(true);
      await toast.screenshot({ path: testInfo.outputPath(`toast-error-${language}-${width}.png`) });
      await dialog
        .getByRole('button', { name: language === 'th' ? 'ยกเลิก' : 'Cancel', exact: true })
        .click();
      await expect(
        page.locator('body > [data-notebook-toast-region] [data-notebook-toast="error"]'),
      ).toHaveCount(1);
      await expect(toast).toHaveCount(0, { timeout: 5000 });
      expect(writes).toHaveLength(1);
    });
  }
}

test('failed restore keeps the course archived and reports one error toast', async ({ page }) => {
  const writes = await mockListings(page, { language: 'en', failRestore: true });
  await page.goto('/dashboard/listings');
  const course = page.getByRole('article', { name: 'English', exact: true });
  await course.getByRole('button', { name: 'Restore draft', exact: true }).click();
  await expect(page.locator('[data-notebook-toast="error"]')).toHaveCount(1);
  await expect(course.getByText('Archived', { exact: true })).toBeVisible();
  await expect(page.locator('[data-notebook-toast="success"]')).toHaveCount(0);
  expect(writes).toEqual([
    { path: '/tutors/me/listings/english/status', body: { publicationStatus: 'DRAFT' } },
  ]);
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
