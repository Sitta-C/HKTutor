import { expect, test } from '@playwright/test';

import type { ComparisonSort } from '@/components/tutors/tutor-comparison-sort';
import type { PublicTutorDetail, TutorSearchResult } from '@/lib/api/types';
import type { Page } from '@playwright/test';

// All public/auth reads are intercepted. No fixture touches a project database.
const courses: TutorSearchResult[] = Array.from({ length: 12 }, (_, index) => ({
  tutorId: index < 2 ? 'shared-tutor' : `tutor-${index}`,
  listingId: `course-${index}`,
  displayName: index < 2 ? 'Teacher Anan' : `Teacher ${index}`,
  subject: index === 1 ? 'Science' : 'Mathematics',
  grade: 'Grade 10',
  description: 'Clear explanations and guided practice.',
  experienceYears: index === 3 ? 2 : 5,
  pricePerHour: 450,
  ratingAverage: index === 3 ? null : 4.33,
  reviewCount: index === 3 ? 0 : 2,
  recommendationTags: [],
  verificationStatus: 'VERIFIED',
  nextAvailableAt: '2099-11-08T03:00:00.000Z',
}));

async function mockComparison(page: Page, language: 'en' | 'th' = 'en') {
  const state = {
    failSearch: false,
    hidden: false,
    unavailableCourse: false,
    failDetail: false,
    malformedPrice: false,
    slow: false,
    sharedPrice: 425,
    secondRating: 4.33,
    laterSecondSlot: false,
  };
  const calls: string[] = [];
  const unexpected: string[] = [];
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript((value) => localStorage.setItem('hktutor-language', value), language);
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    if (path === '/auth/refresh') {
      return route.fulfill({ status: 401, json: { message: 'Unauthorized' } });
    }
    if (path === '/subjects') {
      return route.fulfill({
        json: { items: [{ id: 'math', code: 'MATH', name: 'Mathematics', active: true }] },
      });
    }
    if (path === '/grade-levels') {
      return route.fulfill({
        json: { items: [{ id: 'g10', code: 'G10', name: 'Grade 10', active: true, sortOrder: 1 }] },
      });
    }
    if (path === '/tutors') {
      if (state.failSearch) {
        return route.fulfill({ status: 500, json: { message: 'Unavailable' } });
      }
      const number = Number(url.searchParams.get('page') ?? 1);
      return route.fulfill({
        json: {
          items: courses.slice((number - 1) * 10, number * 10),
          page: number,
          pageSize: 10,
          total: 12,
          totalPages: 2,
        },
      });
    }
    const match = /^\/tutors\/([^/]+)(\/availability)?$/.exec(path);
    const tutor = courses.find((course) => course.tutorId === match?.[1]);
    if (tutor && match) {
      calls.push(path);
      if (state.slow && tutor.tutorId === 'shared-tutor') {
        await gate;
      }
      if (state.hidden && tutor.tutorId === 'shared-tutor') {
        return route.fulfill({ status: 404, json: { message: 'Not found' } });
      }
      if (state.failDetail && tutor.tutorId === 'shared-tutor') {
        return route.fulfill({ status: 500, json: { message: 'Unavailable' } });
      }
      if (match[2]) {
        return route.fulfill({
          json:
            tutor.tutorId === 'tutor-3'
              ? []
              : [
                  {
                    id: 'later',
                    startAtUtc: '2099-11-10T03:00:00.000Z',
                    endAtUtc: '2099-11-10T04:00:00.000Z',
                  },
                  {
                    id: 'next',
                    startAtUtc:
                      state.laterSecondSlot && tutor.tutorId === 'tutor-2'
                        ? '2099-11-09T03:00:00.000Z'
                        : '2099-11-08T03:00:00.000Z',
                    endAtUtc:
                      state.laterSecondSlot && tutor.tutorId === 'tutor-2'
                        ? '2099-11-09T04:00:00.000Z'
                        : '2099-11-08T04:00:00.000Z',
                  },
                ],
        });
      }
      const detail: PublicTutorDetail = {
        tutor: {
          tutorId: tutor.tutorId,
          displayName: tutor.displayName,
          bio: 'Tutor bio stays on the profile page.',
          experienceYears: tutor.experienceYears,
          ratingAverage: tutor.tutorId === 'tutor-2' ? state.secondRating : tutor.ratingAverage,
          reviewCount: tutor.reviewCount,
          verificationStatus: 'VERIFIED',
        },
        listings:
          state.unavailableCourse && tutor.tutorId === 'tutor-2'
            ? []
            : courses
                .filter((course) => course.tutorId === tutor.tutorId)
                .map((course) => ({
                  ...course,
                  pricePerHour:
                    course.tutorId === 'shared-tutor'
                      ? state.sharedPrice
                      : state.malformedPrice && course.tutorId === 'tutor-2'
                        ? 0
                        : course.pricePerHour,
                })),
      };
      return route.fulfill({ json: detail });
    }
    unexpected.push(path);
    return route.fulfill({ status: 500, json: { message: 'Unexpected request' } });
  });
  return { state, calls, unexpected, release };
}

const pocket = (page: Page) => page.locator('[data-comparison-button]');
const panel = (page: Page) => page.locator('[data-comparison-panel]');
const choose = (page: Page, index: number) =>
  page
    .locator('article')
    .nth(index)
    .getByRole('button', { name: /Select to compare|Use this course|Selected/ });

const priorityLabel = (page: Page, sort: ComparisonSort) =>
  panel(page)
    .locator('label')
    .filter({ has: page.locator(`input[type="radio"][value="${sort}"]`) });

async function expectColumnOrder(page: Page, expected: string[]): Promise<void> {
  const rows = panel(page).locator('tr');
  await expect(rows).toHaveCount(7);
  for (const row of await rows.all()) {
    await expect
      .poll(() =>
        row
          .locator('[data-tutor-column]')
          .evaluateAll((cells) => cells.map((cell) => cell.getAttribute('data-tutor-column'))),
      )
      .toEqual(expected);
  }
}

for (const count of [2, 3]) {
  test(`Priority Tabs preserve ${count} selections, URL history, focus and scroll without reads (S3-T34)`, async ({
    page,
  }, testInfo) => {
    if (testInfo.project.name === 'mobile-chromium') {
      await page.setViewportSize({ width: 320, height: 900 });
    }
    const { state, calls } = await mockComparison(page);
    state.secondRating = 4.9;
    state.laterSecondSlot = true;
    const params = new URLSearchParams({
      tutorIds: 'retained-a,retained-b',
      listingIds: 'retained-course-a,retained-course-b',
      selectionOrder: '1,0',
    });
    params.append('keep', 'first');
    params.append('keep', 'second');
    await page.goto(`/tutors?${params}#comparison`);
    const selected = count === 3 ? [3, 2, 0] : [2, 0];
    for (const index of selected) {
      await choose(page, index).click();
    }
    await pocket(page).click();
    await expect(panel(page).locator('[data-comparison-column="ready"]')).toHaveCount(count);
    const reads = [...calls];
    const orders: Record<ComparisonSort, string[]> = {
      lowest_price:
        count === 3 ? ['shared-tutor', 'tutor-3', 'tutor-2'] : ['shared-tutor', 'tutor-2'],
      highest_rating:
        count === 3 ? ['tutor-2', 'shared-tutor', 'tutor-3'] : ['tutor-2', 'shared-tutor'],
      earliest_availability:
        count === 3 ? ['shared-tutor', 'tutor-2', 'tutor-3'] : ['shared-tutor', 'tutor-2'],
    };
    const radio = (sort: ComparisonSort) =>
      panel(page).locator(`input[type="radio"][value="${sort}"]`);
    const scroll = panel(page).locator('[data-comparison-scroll]');
    const scrollLeft = await scroll.evaluate((element) => {
      element.scrollLeft = element.scrollWidth - element.clientWidth;
      return element.scrollLeft;
    });
    const assertSort = async (sort: ComparisonSort) => {
      await expect(radio(sort)).toBeChecked();
      await expectColumnOrder(page, orders[sort]);
      await expect(panel(page).locator('[data-comparison-sort-status]')).toContainText(
        sort === 'lowest_price'
          ? 'Lowest price'
          : sort === 'highest_rating'
            ? 'Highest rating'
            : 'Earliest availability',
      );
      expect(await scroll.evaluate((element) => element.scrollLeft)).toBe(scrollLeft);
      for (const index of selected) {
        await expect(choose(page, index)).toHaveAttribute('aria-pressed', 'true');
      }
      const url = new URL(page.url());
      for (const key of ['tutorIds', 'listingIds', 'selectionOrder', 'keep']) {
        expect(url.searchParams.getAll(key)).toEqual(params.getAll(key));
      }
      expect(url.hash).toBe('#comparison');
      expect(calls).toEqual(reads);
    };
    await assertSort('lowest_price');
    await radio('lowest_price').focus();
    await page.keyboard.press('ArrowRight');
    await expect(radio('highest_rating')).toBeFocused();
    await assertSort('highest_rating');
    await expect(page).toHaveURL(/comparisonSort=highest_rating/);
    await page.goBack();
    await assertSort('lowest_price');
    expect(new URL(page.url()).searchParams.has('comparisonSort')).toBe(false);
    await page.goForward();
    await assertSort('highest_rating');
    for (const sort of [
      'earliest_availability',
      'lowest_price',
      'highest_rating',
      'earliest_availability',
    ] as const) {
      await priorityLabel(page, sort).click();
      await expect(radio(sort)).toBeFocused();
      await assertSort(sort);
    }
    await page.goBack();
    await assertSort('highest_rating');
    await page.goForward();
    await assertSort('earliest_availability');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`priority-tabs-${count}.png`) });
  });
}

test('Priority Tabs repair an ambiguous URL and restore its guidance on Back (S3-T34)', async ({
  page,
}) => {
  const { calls } = await mockComparison(page);
  await page.goto('/tutors?comparisonSort=lowest_price&comparisonSort=highest_rating');
  await choose(page, 0).click();
  await choose(page, 2).click();
  await pocket(page).click();
  await expect(panel(page).locator('[data-comparison-column="ready"]')).toHaveCount(2);
  await expect(panel(page).getByRole('alert')).toContainText('Invalid comparison sort');
  const reads = [...calls];
  await priorityLabel(page, 'lowest_price').click();
  await expect(panel(page).getByRole('alert')).toHaveCount(0);
  expect(new URL(page.url()).searchParams.getAll('comparisonSort')).toEqual(['lowest_price']);
  await page.goBack();
  await expect(panel(page).getByRole('alert')).toContainText('Invalid comparison sort');
  await expect(panel(page).getByRole('radio', { name: 'Lowest price', exact: true })).toBeChecked();
  await expectColumnOrder(page, ['shared-tutor', 'tutor-2']);
  expect(calls).toEqual(reads);
});

test('Priority Tabs keep errors and selected priority across a pending retry (S3-T34)', async ({
  page,
}) => {
  const { state, calls, release } = await mockComparison(page);
  state.failDetail = true;
  state.secondRating = 4.9;
  try {
    await page.goto('/tutors');
    await choose(page, 0).click();
    await choose(page, 2).click();
    await pocket(page).click();
    await expect(panel(page).getByRole('button', { name: 'Try again' })).toBeVisible();
    const reads = [...calls];
    await priorityLabel(page, 'highest_rating').click();
    await expect(panel(page).getByRole('button', { name: 'Try again' })).toBeVisible();
    expect(calls).toEqual(reads);
    state.failDetail = false;
    state.slow = true;
    await panel(page).getByRole('button', { name: 'Try again' }).click();
    const priority = panel(page).getByRole('radio', { name: 'Highest rating', exact: true });
    await expect(priority).toBeDisabled();
    await expect(priority).toBeChecked();
    await expect(pocket(page)).toHaveAccessibleName('Tutor comparison (2/3)');
    state.slow = false;
    release();
    await expect(priority).toBeEnabled();
    await expect(priority).toBeChecked();
    await expectColumnOrder(page, ['tutor-2', 'shared-tutor']);
  } finally {
    release();
  }
});

test('Priority Tabs have translated labels and stay disabled until data loads (S3-T34)', async ({
  page,
}) => {
  const { state, release } = await mockComparison(page, 'th');
  state.slow = true;
  try {
    await page.goto('/tutors');
    for (const index of [0, 2]) {
      await page
        .locator('article')
        .nth(index)
        .getByRole('button', { name: /^เลือกเปรียบเทียบ:/ })
        .click();
    }
    await pocket(page).click();
    const lowest = panel(page).getByRole('radio', { name: 'ราคาต่ำสุด', exact: true });
    await expect(lowest).toBeDisabled();
    await expect(lowest).toBeChecked();
    await expect(
      panel(page).getByRole('radio', { name: 'คะแนนสูงสุด', exact: true }),
    ).toBeDisabled();
    await expect(
      panel(page).getByRole('radio', { name: 'เวลาว่างเร็วสุด', exact: true }),
    ).toBeDisabled();
    state.slow = false;
    release();
    await expect(lowest).toBeEnabled();
    await priorityLabel(page, 'earliest_availability').click();
    await expect(panel(page).locator('[data-comparison-sort-status]')).toHaveText(
      'เรียงติวเตอร์แล้ว: เวลาว่างเร็วสุด',
    );
  } finally {
    release();
  }
});

for (const scenario of [
  { sort: 'lowest_price', expected: ['shared-tutor', 'tutor-3', 'tutor-2'] },
  { sort: 'highest_rating', expected: ['tutor-2', 'shared-tutor', 'tutor-3'] },
  { sort: 'earliest_availability', expected: ['shared-tutor', 'tutor-2', 'tutor-3'] },
  { sort: '__proto__', expected: ['shared-tutor', 'tutor-3', 'tutor-2'] },
]) {
  test(`sorts complete comparison columns for ${scenario.sort} (S3-T33)`, async ({
    page,
  }, testInfo) => {
    const { state, unexpected } = await mockComparison(page);
    state.secondRating = 4.9;
    state.laterSecondSlot = true;
    await page.goto(`/tutors?comparisonSort=${scenario.sort}`);
    for (const index of [3, 2, 0]) {
      await choose(page, index).click();
    }
    await pocket(page).click();
    await expect(panel(page).locator('[data-comparison-column="ready"]')).toHaveCount(3);
    const columnIds = (selector: string) =>
      panel(page)
        .locator(selector)
        .evaluateAll((cells) => cells.map((cell) => cell.getAttribute('data-tutor-column')));
    expect(await columnIds('thead [data-tutor-column]')).toEqual(scenario.expected);
    for (let row = 1; row <= 6; row++) {
      expect(await columnIds(`tbody tr:nth-child(${row}) [data-tutor-column]`)).toEqual(
        scenario.expected,
      );
    }
    await expect(
      panel(page).locator('tbody tr').first().locator('[data-tutor-column="shared-tutor"]'),
    ).toContainText('425');
    await expect(
      panel(page).locator('tbody tr').nth(2).locator('[data-tutor-column="tutor-2"]'),
    ).toContainText('4.90');
    await expect(panel(page).getByRole('alert')).toHaveCount(scenario.sort === '__proto__' ? 1 : 0);
    for (const index of [3, 2, 0]) {
      await expect(choose(page, index)).toHaveAttribute('aria-pressed', 'true');
    }
    await page.screenshot({ path: testInfo.outputPath('comparison-sort.png') });
    expect(unexpected).toEqual([]);
  });
}

test('re-sorts refreshed public data without changing selected courses (S3-T33)', async ({
  page,
}) => {
  const { state, unexpected } = await mockComparison(page);
  await page.goto('/tutors');
  await choose(page, 0).click();
  await choose(page, 2).click();
  await pocket(page).click();
  await expect(panel(page).locator('[data-comparison-column="ready"]')).toHaveCount(2);
  await expect(panel(page).locator('thead [data-tutor-column]').first()).toHaveAttribute(
    'data-tutor-column',
    'shared-tutor',
  );
  await panel(page).getByRole('button', { name: 'Close comparison' }).click();
  await expect(panel(page)).not.toBeVisible();
  state.sharedPrice = 500;
  await pocket(page).click();
  await expect(panel(page).locator('[data-comparison-column="ready"]')).toHaveCount(2);
  await expect(panel(page).locator('thead [data-tutor-column]').first()).toHaveAttribute(
    'data-tutor-column',
    'tutor-2',
  );
  await expect(
    panel(page).locator('tbody tr').first().locator('[data-tutor-column="shared-tutor"]'),
  ).toContainText('500');
  await expect(choose(page, 0)).toHaveAttribute('aria-pressed', 'true');
  await expect(choose(page, 2)).toHaveAttribute('aria-pressed', 'true');
  expect(unexpected).toEqual([]);
});

test('selection boundaries, same-tutor replacement, persisted search selection and immediate comparison', async ({
  page,
}, testInfo) => {
  if (testInfo.project.name === 'mobile-chromium') {
    await page.setViewportSize({ width: 320, height: 900 });
  }
  const { state, unexpected } = await mockComparison(page);
  await page.goto('/tutors');
  await expect(page.locator('article')).toHaveCount(10);
  await expect(pocket(page)).toHaveAccessibleName('Tutor comparison (0/3)');
  await choose(page, 0).click();
  await choose(page, 1).click();
  await expect(pocket(page)).toHaveAccessibleName('Tutor comparison (1/3)');
  await expect(choose(page, 1)).toHaveAttribute('aria-pressed', 'true');
  await choose(page, 2).click();
  await choose(page, 3).click();
  await expect(pocket(page)).toHaveAccessibleName('Tutor comparison (3/3)');
  await expect(choose(page, 4)).toBeDisabled();
  await choose(page, 0).click();
  await pocket(page).click();
  await expect(panel(page).locator('[data-comparison-column="ready"]')).toHaveCount(3);
  await expect(panel(page).locator('tbody tr')).toHaveCount(6);
  await expect(panel(page).getByRole('button', { name: 'Compare', exact: true })).toHaveCount(0);
  await expect(panel(page).locator('tbody tr').first()).toContainText('425');
  await expect(panel(page)).toContainText('New tutor');
  await expect(panel(page)).toContainText('No future slots');
  await expect(panel(page).getByRole('cell', { name: /10:00/ }).first()).toBeVisible();
  const fits = await panel(page).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return (
      rect.left >= 0 &&
      rect.right <= innerWidth + 1 &&
      rect.top >= 0 &&
      rect.bottom <= innerHeight + 1
    );
  });
  expect(fits).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('course-tabs-notebook-ledger.png'),
    fullPage: true,
  });
  await panel(page)
    .getByRole('button', { name: 'Remove tutor: Teacher Anan', exact: true })
    .click();
  await expect(panel(page).locator('[data-comparison-column="ready"]')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(panel(page)).not.toBeVisible();
  await expect(pocket(page)).toBeFocused();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('article')).toHaveCount(2);
  await expect(pocket(page)).toHaveAccessibleName('Tutor comparison (2/3)');
  state.failSearch = true;
  await page.getByRole('button', { name: 'Previous', exact: true }).click();
  await expect(page.getByText('We could not load tutors')).toBeVisible();
  await expect(pocket(page)).toHaveAccessibleName('Tutor comparison (2/3)');
  state.failSearch = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('article')).toHaveCount(10);
  await page.locator('#tutor-search-ranking').selectOption('lowest_price');
  await expect(choose(page, 2)).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(pocket(page)).toHaveAccessibleName('Tutor comparison (0/3)');
  await choose(page, 0).click();
  await page.locator('article').first().getByRole('link', { name: 'View times' }).click();
  await expect(page).toHaveURL(/\/tutors\/shared-tutor/);
  await page.goBack();
  await expect(pocket(page)).toHaveAccessibleName('Tutor comparison (0/3)');
  expect(unexpected).toEqual([]);
});

test('revalidates public visibility, rejects missing courses and retries real load failures', async ({
  page,
}) => {
  const { state, calls, unexpected } = await mockComparison(page);
  await page.goto('/tutors');
  await choose(page, 0).click();
  await choose(page, 2).click();
  state.hidden = true;
  state.unavailableCourse = true;
  await pocket(page).click();
  await expect(panel(page).locator('[data-comparison-column="unavailable"]')).toHaveCount(2);
  await expect(panel(page)).not.toContainText('Teacher Anan');
  await expect(panel(page)).not.toContainText('Teacher 2');
  await expect(panel(page)).not.toContainText('450');
  await panel(page).getByRole('button', { name: 'Close comparison' }).click();
  await expect(panel(page)).not.toBeVisible();
  state.hidden = false;
  state.unavailableCourse = false;
  state.failDetail = true;
  await pocket(page).click();
  await expect(panel(page).getByRole('button', { name: 'Try again' })).toBeVisible();
  state.failDetail = false;
  await panel(page).getByRole('button', { name: 'Try again' }).click();
  await expect(panel(page).locator('[data-comparison-column="ready"]')).toHaveCount(2);
  const reads = calls.length;
  await page.keyboard.press('Escape');
  await expect(panel(page)).not.toBeVisible();
  await pocket(page).click();
  await expect(panel(page).locator('[data-comparison-column="ready"]')).toHaveCount(2);
  expect(calls.length).toBeGreaterThan(reads);
  await panel(page).getByRole('button', { name: 'Clear selection' }).click();
  await expect(panel(page).locator('table')).toHaveCount(0);
  await expect(panel(page)).toContainText('Select a course');
  expect(unexpected).toEqual([]);
});

test('a removed tutor cannot return through a delayed old response', async ({ page }) => {
  const { state, release } = await mockComparison(page);
  state.slow = true;
  try {
    await page.goto('/tutors');
    await choose(page, 0).click();
    await choose(page, 2).click();
    await pocket(page).click();
    await expect(panel(page).locator('[data-comparison-column="loading"]')).toHaveCount(2);
    await panel(page).getByRole('button', { name: 'Remove tutor: 1', exact: true }).click();
    await expect(panel(page).locator('[data-comparison-column="ready"]')).toHaveCount(1);
    release();
    await expect(panel(page)).not.toContainText('Teacher Anan');
    await expect(panel(page)).toContainText('Select one more tutor');
  } finally {
    release();
  }
});

test('a timed-out public read becomes retryable without losing the selection', async ({ page }) => {
  const { state, release, calls } = await mockComparison(page);
  await page.clock.install({ time: new Date('2026-11-07T00:00:00.000Z') });
  state.slow = true;
  try {
    await page.goto('/tutors');
    await choose(page, 0).click();
    await choose(page, 2).click();
    await pocket(page).click();
    await expect.poll(() => calls.includes('/tutors/shared-tutor')).toBe(true);
    await page.clock.fastForward(16_000);
    await expect(panel(page).locator('[data-comparison-column="error"]').first()).toBeVisible();
    await expect(pocket(page)).toHaveAccessibleName('Tutor comparison (2/3)');
    state.slow = false;
    release();
    await panel(page).getByRole('button', { name: 'Try again' }).first().click();
    await expect(panel(page).locator('[data-comparison-column="ready"]')).toHaveCount(2);
  } finally {
    release();
  }
});

test('Compact Dock stays centered through scroll/resize with keyboard activation and Thai copy', async ({
  page,
}, testInfo) => {
  if (testInfo.project.name === 'mobile-chromium') {
    await page.setViewportSize({ width: 320, height: 900 });
  }
  await mockComparison(page, 'th');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/tutors');
  await expect(pocket(page)).toContainText('เลือกติวเตอร์ 2–3 คนเพื่อเปรียบเทียบ');
  await expect(pocket(page)).toContainText('0/3');
  const readDockGeometry = () =>
    pocket(page).evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const viewport = window.visualViewport;
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        center: rect.left + rect.width / 2,
        viewportCenter: (viewport?.offsetLeft ?? 0) + (viewport?.width ?? innerWidth) / 2,
        viewportBottom: (viewport?.offsetTop ?? 0) + (viewport?.height ?? innerHeight),
      };
    });
  const dockGeometry = async () => {
    const geometry = await readDockGeometry();
    expect(Math.abs(geometry.center - geometry.viewportCenter)).toBeLessThanOrEqual(1);
    expect(geometry.left).toBeGreaterThanOrEqual(11);
    expect(geometry.right).toBeLessThanOrEqual((await page.evaluate(() => innerWidth)) - 11);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportBottom - 15);
    return geometry;
  };
  await dockGeometry();
  await pocket(page).focus();
  await page.keyboard.press('Enter');
  await expect(panel(page)).toBeVisible();
  await expect(panel(page)).toContainText('เลือกคอร์สที่สนใจ');
  await page.keyboard.press('Escape');
  await expect(pocket(page)).toBeFocused();
  await page
    .locator('article')
    .nth(0)
    .getByRole('button', { name: /^เลือกเปรียบเทียบ:/ })
    .click();
  await expect(pocket(page)).toContainText('เลือกเพิ่มอีก 1 คนเพื่อเทียบกัน');
  await page
    .locator('article')
    .nth(2)
    .getByRole('button', { name: /^เลือกเปรียบเทียบ:/ })
    .click();
  await expect(pocket(page).locator('span').last()).toHaveText('2/3');
  await expect(pocket(page)).toContainText('เลือกแล้ว 2 คน');
  const before = await dockGeometry();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const scrolled = await dockGeometry();
  expect(scrolled.center).toBe(before.center);
  expect(scrolled.bottom).toBe(before.bottom);
  const next = page.getByRole('button', { name: 'ถัดไป', exact: true });
  const nextBounds = await next.boundingBox();
  expect(nextBounds ? nextBounds.y + nextBounds.height : Number.POSITIVE_INFINITY).toBeLessThan(
    scrolled.top,
  );
  await pocket(page).focus();
  await page.keyboard.press('Space');
  await expect(panel(page).locator('[data-comparison-column="ready"]')).toHaveCount(2);
  await expect(panel(page)).toContainText('เปรียบเทียบติวเตอร์');
  await page.keyboard.press('Escape');
  await expect(panel(page)).not.toBeVisible();
  await expect(pocket(page)).toBeFocused();
  const fixed = await dockGeometry();
  await page.keyboard.press('ArrowRight');
  expect(await dockGeometry()).toEqual(fixed);
  await page.setViewportSize({ width: 320, height: 640 });
  await expect
    .poll(async () => {
      const geometry = await readDockGeometry();
      return Math.abs(geometry.bottom - (geometry.viewportBottom - 16));
    })
    .toBeLessThanOrEqual(1);
  await dockGeometry();
  await pocket(page).click();
  await expect(panel(page)).toBeVisible();
  const dockTop = (await dockGeometry()).top;
  await expect
    .poll(async () => {
      const rect = await panel(page).boundingBox();
      return rect ? rect.y + rect.height : Number.POSITIVE_INFINITY;
    })
    .toBeLessThanOrEqual(dockTop - 11);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
  await page.keyboard.press('Escape');
  await expect(panel(page)).not.toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const finalNext = await next.boundingBox();
  expect(finalNext ? finalNext.y + finalNext.height : Number.POSITIVE_INFINITY).toBeLessThan(
    (await dockGeometry()).top,
  );
  await page.screenshot({ path: testInfo.outputPath('compact-dock-mobile.png') });
});

test('compares only allow-listed public values and shows malformed ones as unavailable (S3-T31)', async ({
  page,
}) => {
  const { state, unexpected } = await mockComparison(page);
  state.malformedPrice = true;
  await page.goto('/tutors');
  await expect(page.locator('article').first()).toContainText('Clear explanations');
  await choose(page, 0).click();
  await choose(page, 2).click();
  await pocket(page).click();
  await expect(panel(page).locator('[data-comparison-column="ready"]')).toHaveCount(2);
  const price = panel(page).locator('tbody tr').first();
  await expect(price.locator('[data-tutor-column="shared-tutor"]')).toContainText('425');
  await expect(price.locator('[data-tutor-column="tutor-2"]')).toHaveText('Unavailable');
  await expect(price).not.toContainText('NaN');
  await expect(panel(page)).not.toContainText('Tutor bio stays on the profile page.');
  await expect(panel(page)).not.toContainText('Clear explanations');
  const headers = await panel(page)
    .locator('thead [data-tutor-column]')
    .evaluateAll((cells) => cells.map((cell) => cell.getAttribute('data-tutor-column')));
  expect(headers).toEqual(['shared-tutor', 'tutor-2']);
  expect(unexpected).toEqual([]);
});
