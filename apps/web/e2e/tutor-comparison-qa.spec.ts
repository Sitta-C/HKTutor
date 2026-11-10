import { expect, test } from '@playwright/test';

import type { PublicTutorDetail, TutorSearchResult } from '@/lib/api/types';
import type { Page } from '@playwright/test';

/**
 * S3-T32 QA: selection boundaries, missing values, six aligned attributes and privacy, on the
 * card's fixture set. Every API read is intercepted; no fixture touches a project database. The
 * real PostgreSQL side of the same visibility rules is apps/api db:verify:comparison-visibility.
 */

interface Course extends TutorSearchResult {
  /** Detail-only values, so search and the public profile can disagree like real stale data. */
  detailExperienceYears?: number;
  bio: string;
}

const course = (
  tutorId: string,
  listingId: string,
  displayName: string,
  values: Partial<Course>,
): Course => ({
  tutorId,
  listingId,
  displayName,
  subject: 'Mathematics',
  grade: 'Grade 10',
  description: `Private-looking course description for ${displayName}.`,
  bio: `Long biography for ${displayName} that stays on the profile page.`,
  experienceYears: 4,
  pricePerHour: 400,
  ratingAverage: 4.33,
  reviewCount: 2,
  recommendationTags: [],
  verificationStatus: 'VERIFIED',
  nextAvailableAt: '2099-11-08T03:00:00.000Z',
  ...values,
});

// One tutor with two courses, a new tutor, invalid experience with no future slot, a tutor hidden
// after selection and a tutor whose selected course is removed after selection.
const COURSES: Course[] = [
  course('t-101', 'c-101', 'Teacher Mali', { pricePerHour: 350 }),
  course('t-101', 'c-102', 'Teacher Mali', {
    subject: 'Physics',
    grade: 'Grade 11',
    pricePerHour: 500,
  }),
  course('t-102', 'c-103', 'Teacher Kiet', {
    pricePerHour: 450,
    ratingAverage: null,
    reviewCount: 0,
  }),
  course('t-103', 'c-104', 'Teacher Pim', {
    pricePerHour: 420,
    ratingAverage: 4,
    reviewCount: 1,
    detailExperienceYears: -1,
    nextAvailableAt: null,
  }),
  course('t-104', 'c-105', 'Teacher Niran', { pricePerHour: 380 }),
  course('t-105', 'c-106', 'Teacher Lek', { pricePerHour: 610 }),
  course('t-105', 'c-107', 'Teacher Lek', { subject: 'Science', pricePerHour: 990 }),
];
/** The public search row: everything except the detail-only bio and experience override. */
const searchRow = (item: Course): TutorSearchResult => ({
  tutorId: item.tutorId,
  listingId: item.listingId,
  displayName: item.displayName,
  subject: item.subject,
  grade: item.grade,
  description: item.description,
  experienceYears: item.experienceYears,
  pricePerHour: item.pricePerHour,
  ratingAverage: item.ratingAverage,
  reviewCount: item.reviewCount,
  recommendationTags: item.recommendationTags,
  verificationStatus: item.verificationStatus,
  nextAvailableAt: item.nextAvailableAt,
});

const MALI = 0;
const MALI_PHYSICS = 1;
const KIET = 2;
const PIM = 3;
const NIRAN = 4;
const LEK = 5;

async function mockApi(page: Page) {
  const state = { niranHidden: false, lekCourseRemoved: false, kietFails: false };
  const requests: string[] = [];
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => localStorage.setItem('hktutor-language', 'en'));
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1', '');
    requests.push(`${request.method()} ${path}`);
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
      return route.fulfill({
        json: {
          items: COURSES.map(searchRow),
          page: 1,
          pageSize: 10,
          total: COURSES.length,
          totalPages: 1,
        },
      });
    }
    const match = /^\/tutors\/([^/]+)(\/availability)?$/.exec(path);
    const own = COURSES.filter(({ tutorId }) => tutorId === match?.[1]);
    const first = own[0];
    if (!match || !first || request.method() !== 'GET') {
      return route.fulfill({ status: 500, json: { message: 'Unexpected request' } });
    }
    if (state.niranHidden && first.tutorId === 't-104') {
      return route.fulfill({ status: 404, json: { message: 'Published tutor not found' } });
    }
    if (state.kietFails && first.tutorId === 't-102') {
      return route.fulfill({ status: 500, json: { message: 'Unavailable' } });
    }
    if (match[2]) {
      return route.fulfill({
        json:
          first.nextAvailableAt === null
            ? []
            : [
                {
                  id: `${first.tutorId}-slot`,
                  startAtUtc: first.nextAvailableAt,
                  endAtUtc: '2099-11-08T04:00:00.000Z',
                },
              ],
      });
    }
    const detail: PublicTutorDetail = {
      tutor: {
        tutorId: first.tutorId,
        displayName: first.displayName,
        bio: first.bio,
        experienceYears: first.detailExperienceYears ?? first.experienceYears,
        verificationStatus: 'VERIFIED',
        ratingAverage: first.ratingAverage,
        reviewCount: first.reviewCount,
      },
      listings: own
        .filter(({ listingId }) => !(state.lekCourseRemoved && listingId === 'c-106'))
        .map(({ listingId, subject, grade, pricePerHour, description }) => ({
          listingId,
          subject: subject ?? '',
          grade: grade ?? '',
          pricePerHour,
          description,
        })),
    };
    return route.fulfill({ json: detail });
  });
  return { state, requests };
}

const pocket = (page: Page) => page.locator('[data-comparison-button]');
const panel = (page: Page) => page.locator('[data-comparison-panel]');
const status = (page: Page) => page.locator('[data-comparison-selection-status]');
const toggle = (page: Page, index: number) =>
  page
    .locator('article')
    .nth(index)
    .getByRole('button', { name: /^(Select to compare|Use this course|Selected):/ });
const column = (page: Page, tutorId: string) =>
  panel(page).locator(`tbody [data-tutor-column="${tutorId}"]`);
const priorities = (page: Page) => panel(page).locator('input[type="radio"]');

async function pick(page: Page, indexes: number[]): Promise<void> {
  for (const index of indexes) {
    await toggle(page, index).click();
  }
}

test('selection boundaries by keyboard: 0, 1, the same tutor twice, 2, 3, a fourth and removal back to 1', async ({
  page,
}) => {
  await mockApi(page);
  await page.goto('/tutors');
  await expect(page.locator('article')).toHaveCount(COURSES.length);

  // 0 tutors: no dock, only the 2–3 guidance.
  await expect(pocket(page)).toHaveCount(0);
  await expect(page.locator('#tutor-comparison-guide')).toHaveText('Select 2–3 tutors to compare.');

  // 1 tutor: announced, the dock asks for one more and comparing (sorting) stays disabled.
  await toggle(page, MALI).focus();
  await page.keyboard.press('Space');
  await expect(toggle(page, MALI)).toHaveAttribute('aria-pressed', 'true');
  await expect(status(page)).toHaveText(
    'Selected Teacher Mali. 1/3. Select 2–3 tutors to compare.',
  );
  await expect(pocket(page)).toHaveAccessibleName('Tutor comparison (1/3)');
  await expect(pocket(page)).toContainText('Select one more tutor to compare.');
  await pocket(page).focus();
  await page.keyboard.press('Enter');
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).locator('[data-comparison-column]')).toHaveCount(1);
  for (const radio of await priorities(page).all()) {
    await expect(radio).toBeDisabled();
  }
  await page.keyboard.press('Escape');
  await expect(pocket(page)).toBeFocused();

  // The same tutor's other course replaces the course instead of counting twice.
  await toggle(page, MALI_PHYSICS).focus();
  await page.keyboard.press('Enter');
  await expect(pocket(page)).toHaveAccessibleName('Tutor comparison (1/3)');
  await expect(toggle(page, MALI_PHYSICS)).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle(page, MALI)).not.toHaveAttribute('aria-pressed', 'true');

  // 2 and 3 tutors, then the fourth is refused and the limit is announced.
  await toggle(page, KIET).focus();
  await page.keyboard.press('Enter');
  await expect(pocket(page)).toHaveAccessibleName('Tutor comparison (2/3)');
  await toggle(page, PIM).focus();
  await page.keyboard.press('Space');
  await expect(pocket(page)).toHaveAccessibleName('Tutor comparison (3/3)');
  await expect(status(page)).toHaveText(
    'Selected Teacher Pim. 3/3. Three tutors selected. Remove one to choose another.',
  );
  await expect(toggle(page, NIRAN)).toBeDisabled();
  await expect(toggle(page, LEK)).toBeDisabled();

  // Comparing is enabled at 3, and removing by keyboard goes 3 -> 2 -> 1.
  await pocket(page).focus();
  await page.keyboard.press('Enter');
  await expect(panel(page).locator('[data-comparison-column="ready"]')).toHaveCount(3);
  for (const radio of await priorities(page).all()) {
    await expect(radio).toBeEnabled();
  }
  for (const [name, left] of [
    ['Teacher Pim', 2],
    ['Teacher Kiet', 1],
  ] as const) {
    await panel(page)
      .getByRole('button', { name: `Remove tutor: ${name}`, exact: true })
      .focus();
    await page.keyboard.press('Enter');
    await expect(panel(page).locator('[data-comparison-column]')).toHaveCount(left);
    await expect(pocket(page)).toHaveAccessibleName(`Tutor comparison (${left}/3)`);
  }
  for (const radio of await priorities(page).all()) {
    await expect(radio).toBeDisabled();
  }
  await expect(toggle(page, NIRAN)).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(pocket(page)).toBeFocused();
});

for (const count of [2, 3] as const) {
  test(`six aligned attributes use the selected course and show missing values honestly (${count} tutors)`, async ({
    page,
  }) => {
    const { requests } = await mockApi(page);
    await page.goto('/tutors');
    await pick(page, count === 3 ? [MALI_PHYSICS, KIET, PIM] : [MALI_PHYSICS, KIET]);
    await pocket(page).click();
    await expect(panel(page).locator('[data-comparison-column="ready"]')).toHaveCount(count);

    const table = panel(page).getByRole('table');
    await expect(table.getByRole('rowheader')).toHaveText([
      'Price / hour',
      'Subject',
      'Average rating',
      'Review count',
      'Experience',
      'Next availability',
    ]);
    for (const row of await table.locator('tbody tr').all()) {
      await expect(row.locator('[data-tutor-column]')).toHaveCount(count);
    }

    // Mali's column is the selected Physics course, never the cheaper Mathematics one.
    const mali = column(page, 't-101');
    await expect(mali.nth(0)).toContainText('500 ฿');
    await expect(mali.nth(1)).toHaveText('PhysicsGrade 11');
    await expect(mali.nth(2)).toContainText('4.33');
    await expect(mali.nth(3)).toHaveText('2');
    await expect(mali.nth(4)).toHaveText('4 years');
    await expect(mali.nth(5)).toContainText('10:00');

    // A new tutor shows New tutor and 0 reviews, never a 0.00 rating.
    const kiet = column(page, 't-102');
    await expect(kiet.nth(2)).toHaveText('New tutor');
    await expect(kiet.nth(3)).toHaveText('0');
    await expect(panel(page)).not.toContainText('0.00');

    if (count === 3) {
      // Invalid experience and no future slot are labelled, not invented.
      const pim = column(page, 't-103');
      await expect(pim.nth(4)).toHaveText('Unavailable');
      await expect(pim.nth(5)).toHaveText('No future slots');
    }

    // Profile text and course descriptions stay on the profile page.
    for (const item of COURSES) {
      await expect(panel(page)).not.toContainText(item.bio);
      await expect(panel(page)).not.toContainText(item.description);
    }
    await expect(
      panel(page).getByRole('link', { name: 'View tutor profile: Teacher Mali', exact: true }),
    ).toHaveAttribute('href', '/tutors/t-101?listingId=c-102');
    // Apart from the session check every request is a read.
    expect(
      requests.filter((line) => !line.startsWith('GET ') && line !== 'POST /auth/refresh'),
    ).toEqual([]);
  });
}

test('a tutor hidden and a course removed after selection never reveal cached search data', async ({
  page,
}) => {
  const { state, requests } = await mockApi(page);
  await page.goto('/tutors');
  await pick(page, [MALI, NIRAN, LEK]);
  await pocket(page).click();
  await expect(panel(page).locator('[data-comparison-column="ready"]')).toHaveCount(3);
  await page.keyboard.press('Escape');

  state.niranHidden = true;
  state.lekCourseRemoved = true;
  await pocket(page).click();
  await expect(panel(page).locator('[data-comparison-column="ready"]')).toHaveCount(1);
  await expect(panel(page).locator('[data-comparison-column="unavailable"]')).toHaveCount(2);
  await expect(panel(page).getByText('This tutor or course is no longer available.')).toHaveCount(
    2,
  );
  // Nothing from the search cards (names, prices, other courses) fills the unavailable columns.
  for (const text of ['Teacher Niran', 'Teacher Lek', '380', '610', '990', 'Science']) {
    await expect(panel(page)).not.toContainText(text);
  }
  await expect(panel(page).getByRole('link')).toHaveCount(1);
  await expect(panel(page).locator('[data-tutor-verification="VERIFIED"]')).toHaveCount(1);
  const removeNames = await panel(page)
    .getByRole('button', { name: /^Remove tutor:/ })
    .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label')));
  expect(removeNames).toHaveLength(3);
  expect(removeNames).toContain('Remove tutor: Teacher Mali');
  expect(removeNames.filter((name) => /Niran|Lek/.test(name ?? ''))).toEqual([]);

  // Besides the session check, only public catalog, search, detail and availability reads.
  const allowed =
    /^(POST \/auth\/refresh|GET \/(subjects|grade-levels|tutors|tutors\/t-10[145](\/availability)?))$/;
  expect(requests.filter((line) => !allowed.test(line))).toEqual([]);
});

test('retrying one failed tutor keeps the others, and links go to the selected course', async ({
  page,
}) => {
  const { state, requests } = await mockApi(page);
  state.kietFails = true;
  await page.goto('/tutors');
  await pick(page, [MALI_PHYSICS, KIET, PIM]);
  await pocket(page).click();
  await expect(panel(page).locator('[data-comparison-column="ready"]')).toHaveCount(2);
  await expect(panel(page).locator('[data-comparison-column="error"]')).toHaveCount(1);
  await expect(panel(page).getByRole('link')).toHaveCount(2);

  const before = requests.length;
  state.kietFails = false;
  await panel(page).getByRole('button', { name: 'Try again', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(panel(page).locator('[data-comparison-column="ready"]')).toHaveCount(3);
  expect(
    requests
      .slice(before)
      .every((line) => line === 'GET /tutors/t-102' || line === 'GET /tutors/t-102/availability'),
  ).toBe(true);
  await expect(column(page, 't-101').nth(0)).toContainText('500 ฿');

  const links = panel(page).getByRole('link', { name: /^View tutor profile:/ });
  await expect(links).toHaveCount(3);
  expect(
    await links.evaluateAll((items) => items.map((item) => item.getAttribute('href'))),
  ).toEqual(
    expect.arrayContaining([
      '/tutors/t-101?listingId=c-102',
      '/tutors/t-102?listingId=c-103',
      '/tutors/t-103?listingId=c-104',
    ]),
  );
  await panel(page)
    .getByRole('link', { name: 'View tutor profile: Teacher Kiet', exact: true })
    .focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/tutors\/t-102\?listingId=c-103$/);
});
