import { expect, test } from '@playwright/test';

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
    slow: false,
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
                    startAtUtc: '2099-11-08T03:00:00.000Z',
                    endAtUtc: '2099-11-08T04:00:00.000Z',
                  },
                ],
        });
      }
      const detail: PublicTutorDetail = {
        tutor: {
          tutorId: tutor.tutorId,
          displayName: tutor.displayName,
          bio: '',
          experienceYears: tutor.experienceYears,
          ratingAverage: tutor.ratingAverage,
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
                  pricePerHour: course.tutorId === 'shared-tutor' ? 425 : course.pricePerHour,
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

test('normal-motion flights, free dragging, immediate reopening, keyboard moves and Thai copy', async ({
  page,
}, testInfo) => {
  if (testInfo.project.name === 'mobile-chromium') {
    await page.setViewportSize({ width: 320, height: 900 });
  }
  await mockComparison(page, 'th');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/tutors');
  await page
    .locator('article')
    .nth(0)
    .getByRole('button', { name: /^เลือกเปรียบเทียบ:/ })
    .click();
  await page
    .locator('article')
    .nth(2)
    .getByRole('button', { name: /^เลือกเปรียบเทียบ:/ })
    .click();
  await expect(pocket(page).locator('span').last()).toHaveText('2');
  const before = await pocket(page).boundingBox();
  if (!before) {
    throw new Error('Missing floating button');
  }
  await page.mouse.move(before.x + 30, before.y + 30);
  await page.mouse.down();
  await page.mouse.move(100, 220, { steps: 20 });
  await page.mouse.up();
  await expect(pocket(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(panel(page)).not.toBeVisible();
  await pocket(page).click();
  await expect(panel(page).locator('[data-comparison-column="ready"]')).toHaveCount(2);
  await expect(panel(page)).toContainText('เปรียบเทียบติวเตอร์');
  await page.keyboard.press('Escape');
  await expect(panel(page)).not.toBeVisible();
  await expect(pocket(page)).toBeFocused();
  const moved = await pocket(page).boundingBox();
  if (!moved) {
    throw new Error('Missing moved button');
  }
  expect(moved.x).toBeLessThan(before.x);
  await page.keyboard.press('ArrowRight');
  const shifted = await pocket(page).boundingBox();
  expect(shifted?.x).toBeGreaterThan(moved.x);
  await page.setViewportSize({ width: 320, height: 640 });
  await pocket(page).click();
  await expect(panel(page)).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
});
