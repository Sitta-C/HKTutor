import { expect, test } from '@playwright/test';

import type { ComparisonSort } from '@/components/tutors/tutor-comparison-sort';
import type { PublicTutorDetail, TutorSearchResult } from '@/lib/api/types';
import type { Page } from '@playwright/test';

/**
 * S3-T35 QA: comparison sort priorities, ties, invalid sort and missing future availability on
 * the card's fixture. Every API read is intercepted; sorting is client-side (S3-T33), so no
 * database is involved. After each change every column is checked in full: name, price, subject,
 * rating, reviews, experience and next slot.
 */

interface Tutor {
  id: string;
  listingId: string;
  name: string;
  price: number;
  subject: string;
  rating: number | null;
  reviews: number;
  experience: number;
  slot: string | null;
}

// The card's fixture (A 450 / 4.8 / sooner, B 350 / 4.4 / a week later, C no rating and no slot)
// plus D, which ties B on price and rating to show selection order breaking ties.
const A: Tutor = {
  id: 't-a',
  listingId: 'c-a',
  name: 'Teacher Arun',
  price: 450,
  subject: 'Physics',
  rating: 4.8,
  reviews: 5,
  experience: 6,
  slot: '2099-11-08T03:00:00.000Z',
};
const B: Tutor = {
  id: 't-b',
  listingId: 'c-b',
  name: 'Teacher Busaba',
  price: 350,
  subject: 'Mathematics',
  rating: 4.4,
  reviews: 7,
  experience: 3,
  slot: '2099-11-15T03:00:00.000Z',
};
const C: Tutor = {
  id: 't-c',
  listingId: 'c-c',
  name: 'Teacher Chai',
  price: 500,
  subject: 'English',
  rating: null,
  reviews: 0,
  experience: 1,
  slot: null,
};
const D: Tutor = {
  id: 't-d',
  listingId: 'c-d',
  name: 'Teacher Dao',
  price: 350,
  subject: 'Biology',
  rating: 4.4,
  reviews: 2,
  experience: 4,
  slot: '2099-11-15T03:00:00.000Z',
};
const TUTORS = [A, B, C, D];

const searchRow = (item: Tutor): TutorSearchResult => ({
  tutorId: item.id,
  listingId: item.listingId,
  displayName: item.name,
  subject: item.subject,
  grade: 'Grade 10',
  description: 'Clear explanations and guided practice.',
  experienceYears: item.experience,
  pricePerHour: item.price,
  ratingAverage: item.rating,
  reviewCount: item.reviews,
  recommendationTags: [],
  verificationStatus: 'VERIFIED',
  nextAvailableAt: item.slot,
});

async function mockApi(page: Page) {
  const state = { failA: false, holdA: false };
  const reads: string[] = [];
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => localStorage.setItem('hktutor-language', 'en'));
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    if (path === '/auth/refresh') {
      return route.fulfill({ status: 401, json: { message: 'Unauthorized' } });
    }
    if (path === '/subjects' || path === '/grade-levels') {
      return route.fulfill({ json: { items: [] } });
    }
    if (path === '/tutors') {
      return route.fulfill({
        json: { items: TUTORS.map(searchRow), page: 1, pageSize: 10, total: 4, totalPages: 1 },
      });
    }
    const match = /^\/tutors\/([^/]+)(\/availability)?$/.exec(path);
    const item = TUTORS.find(({ id }) => id === match?.[1]);
    if (!match || !item) {
      return route.fulfill({ status: 500, json: { message: 'Unexpected request' } });
    }
    reads.push(path);
    if (item === A && state.holdA) {
      await held;
    }
    if (item === A && state.failA) {
      return route.fulfill({ status: 500, json: { message: 'Unavailable' } });
    }
    if (match[2]) {
      return route.fulfill({
        json: item.slot
          ? [
              {
                id: `${item.id}-slot`,
                startAtUtc: item.slot,
                endAtUtc: item.slot.replace('03:00', '04:00'),
              },
            ]
          : [],
      });
    }
    const detail: PublicTutorDetail = {
      tutor: {
        tutorId: item.id,
        displayName: item.name,
        bio: 'Profile-only biography.',
        experienceYears: item.experience,
        verificationStatus: 'VERIFIED',
        ratingAverage: item.rating,
        reviewCount: item.reviews,
      },
      listings: [
        {
          listingId: item.listingId,
          subject: item.subject,
          grade: 'Grade 10',
          pricePerHour: item.price,
          description: 'Profile-only description.',
        },
      ],
    };
    return route.fulfill({ json: detail });
  });
  return { state, reads, release };
}

const pocket = (page: Page) => page.locator('[data-comparison-button]');
const panel = (page: Page) => page.locator('[data-comparison-panel]');
const select = (page: Page, item: Tutor) =>
  page
    .locator('article')
    .nth(TUTORS.indexOf(item))
    .getByRole('button', { name: /^(Select to compare|Selected):/ });
const radio = (page: Page, sort: ComparisonSort) =>
  panel(page).locator(`input[type="radio"][value="${sort}"]`);
const priority = (page: Page, sort: ComparisonSort) =>
  panel(page)
    .locator('label')
    .filter({ has: page.locator(`input[type="radio"][value="${sort}"]`) });

async function open(
  page: Page,
  selection: Tutor[],
  query = '',
  ready = selection.length,
): Promise<void> {
  await page.goto(`/tutors${query}`);
  await expect(page.locator('article')).toHaveCount(TUTORS.length);
  for (const item of selection) {
    await select(page, item).click();
  }
  await pocket(page).click();
  await expect(panel(page).locator('[data-comparison-column="ready"]')).toHaveCount(ready);
}

/** Checks the column order and every displayed value of every column. */
async function expectColumns(page: Page, expected: Tutor[]): Promise<void> {
  const ids = expected.map(({ id }) => id);
  await expect
    .poll(() =>
      panel(page)
        .locator('thead [data-tutor-column]')
        .evaluateAll((cells) => cells.map((cell) => cell.getAttribute('data-tutor-column'))),
    )
    .toEqual(ids);
  for (const [index, item] of expected.entries()) {
    await expect(panel(page).locator('thead [data-tutor-column]').nth(index)).toContainText(
      item.name,
    );
    const cells = panel(page).locator(`tbody [data-tutor-column="${item.id}"]`);
    await expect(cells).toHaveCount(6);
    await expect(cells.nth(0)).toContainText(`${item.price} ฿`);
    await expect(cells.nth(1)).toHaveText(`${item.subject}Grade 10`);
    await expect(cells.nth(2)).toContainText(
      item.rating === null ? 'New tutor' : item.rating.toFixed(2),
    );
    await expect(cells.nth(3)).toHaveText(String(item.reviews));
    await expect(cells.nth(4)).toHaveText(`${item.experience} years`);
    if (item.slot) {
      await expect(cells.nth(5).locator('time')).toHaveAttribute('datetime', item.slot);
    } else {
      await expect(cells.nth(5)).toHaveText('No future slots');
    }
  }
  for (const row of await panel(page).locator('tbody tr').all()) {
    await expect
      .poll(() =>
        row
          .locator('[data-tutor-column]')
          .evaluateAll((cells) => cells.map((cell) => cell.getAttribute('data-tutor-column'))),
      )
      .toEqual(ids);
  }
}

const ORDERS: Record<ComparisonSort, Tutor[]> = {
  lowest_price: [B, A, C],
  highest_rating: [A, B, C],
  earliest_availability: [A, B, C],
};
const LABELS: Record<ComparisonSort, string> = {
  lowest_price: 'Lowest price',
  highest_rating: 'Highest rating',
  earliest_availability: 'Earliest availability',
};

for (const selection of [
  [C, A, B],
  [A, B],
]) {
  test(`every priority, repeatedly, keeps whole columns and the selection (${selection.length} tutors)`, async ({
    page,
  }) => {
    const { reads } = await mockApi(page);
    await open(page, selection);
    const loaded = [...reads];
    const wanted = (sort: ComparisonSort) =>
      ORDERS[sort].filter((item) => selection.includes(item));

    await expect(radio(page, 'lowest_price')).toBeChecked();
    await expectColumns(page, wanted('lowest_price'));
    for (const sort of [
      'highest_rating',
      'earliest_availability',
      'lowest_price',
      'earliest_availability',
      'highest_rating',
      'lowest_price',
    ] as const) {
      await priority(page, sort).click();
      await expect(radio(page, sort)).toBeChecked();
      await expect(panel(page).locator('[data-comparison-sort-status]')).toHaveText(
        `Tutors sorted by: ${LABELS[sort]}.`,
      );
      await expectColumns(page, wanted(sort));
      for (const item of selection) {
        await expect(select(page, item)).toHaveAttribute('aria-pressed', 'true');
      }
      await expect(pocket(page)).toHaveAccessibleName(`Tutor comparison (${selection.length}/3)`);
    }
    // Sorting at most three tutors is client-side: no further reads.
    expect(reads).toEqual(loaded);
  });
}

test('equal price and rating keep the order the tutors were selected in', async ({ page }) => {
  await mockApi(page);
  await open(page, [D, B, A]);
  await expectColumns(page, [D, B, A]);
  await priority(page, 'highest_rating').click();
  await expectColumns(page, [A, D, B]);
  await priority(page, 'earliest_availability').click();
  await expectColumns(page, [A, D, B]);

  await panel(page).getByRole('button', { name: 'Clear selection' }).click();
  for (const item of [B, D, A]) {
    await select(page, item).click();
  }
  await pocket(page).click();
  await expect(panel(page).locator('[data-comparison-column="ready"]')).toHaveCount(3);
  await priority(page, 'lowest_price').click();
  await expectColumns(page, [B, D, A]);
  await priority(page, 'highest_rating').click();
  await expectColumns(page, [A, B, D]);
});

for (const value of ['unknown', 'PRICE', 'lowest-price']) {
  test(`an invalid sort "${value}" shows a message and sorts by lowest price`, async ({ page }) => {
    await mockApi(page);
    await open(page, [C, A, B], `?comparisonSort=${value}`);
    await expect(panel(page).getByRole('alert')).toHaveText(
      'Invalid comparison sort. Showing lowest price first.',
    );
    await expect(radio(page, 'lowest_price')).toBeChecked();
    await expectColumns(page, [B, A, C]);
    for (const item of [C, A, B]) {
      await expect(select(page, item)).toHaveAttribute('aria-pressed', 'true');
    }
    await priority(page, 'highest_rating').click();
    await expect(panel(page).getByRole('alert')).toHaveCount(0);
    await expectColumns(page, [A, B, C]);
    expect(new URL(page.url()).searchParams.getAll('comparisonSort')).toEqual(['highest_rating']);
  });
}

test('sorting repeatedly while a tutor reloads keeps each column whole when it finishes', async ({
  page,
}) => {
  const { state, release } = await mockApi(page);
  state.failA = true;
  try {
    await open(page, [C, B, A], '', 2);
    await expect(panel(page).locator('[data-comparison-column="error"]')).toHaveCount(1);

    state.failA = false;
    state.holdA = true;
    await panel(page).getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(panel(page).locator('[data-comparison-column="loading"]')).toHaveCount(1);
    for (const sort of [
      'highest_rating',
      'earliest_availability',
      'lowest_price',
      'highest_rating',
    ] as const) {
      await priority(page, sort).click();
      await expect(radio(page, sort)).toBeChecked();
      // The reloading column waits at the end; the ready columns are sorted around it.
      await expect(panel(page).locator('thead [data-tutor-column]').last()).toHaveAttribute(
        'data-tutor-column',
        A.id,
      );
    }
    state.holdA = false;
    release();
    await expect(panel(page).locator('[data-comparison-column="ready"]')).toHaveCount(3);
    await expect(radio(page, 'highest_rating')).toBeChecked();
    await expectColumns(page, [A, B, C]);
    await priority(page, 'lowest_price').click();
    await expectColumns(page, [B, A, C]);
  } finally {
    release();
  }
});
