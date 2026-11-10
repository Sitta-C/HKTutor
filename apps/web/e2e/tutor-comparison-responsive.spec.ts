import { expect, test } from '@playwright/test';

import type { PublicTutorDetail, TutorSearchResult } from '@/lib/api/types';
import type { Locator, Page, TestInfo } from '@playwright/test';

/**
 * S3-T36: the comparison journey at the card's three viewports, keyboard only. Each Playwright
 * project is resized to the card's size (desktop 1440x900, tablet 768x1024, mobile 390x844 with
 * the Pixel 7 touch/mobile emulation kept). Every API read is intercepted; no fixture touches a
 * project database or an external service. Screenshots are evidence, never the pass condition.
 */

const VIEWPORTS: Record<string, { width: number; height: number }> = {
  chromium: { width: 1440, height: 900 },
  'tablet-chromium': { width: 768, height: 1024 },
  'mobile-chromium': { width: 390, height: 844 },
};

type Language = 'en' | 'th';

interface Tutor {
  id: string;
  name: string;
  subject: string;
  price: number;
  rating: number | null;
  reviews: number;
  experience: number;
  slot: string | null;
}

const MALI: Tutor = {
  id: 't-mali',
  name: 'Teacher Mali',
  subject: 'Physics',
  price: 450,
  rating: 4.8,
  reviews: 5,
  experience: 6,
  slot: '2099-11-08T03:00:00.000Z',
};
const KIET: Tutor = {
  id: 't-kiet',
  name: 'Teacher Kiet',
  subject: 'Mathematics',
  price: 350,
  rating: 4.4,
  reviews: 7,
  experience: 3,
  slot: '2099-11-15T03:00:00.000Z',
};
const PIM: Tutor = {
  id: 't-pim',
  name: 'Teacher Pim',
  subject: 'English',
  price: 500,
  rating: null,
  reviews: 0,
  experience: 1,
  slot: null,
};
const NIRAN: Tutor = {
  id: 't-niran',
  name: 'Teacher Niran',
  subject: 'Chemistry',
  price: 400,
  rating: 4,
  reviews: 1,
  experience: 2,
  slot: '2099-11-20T03:00:00.000Z',
};
const LONG: Record<Language, Tutor> = {
  en: {
    id: 't-long',
    name: 'Teacher Supakorn Wattanasiriporn-Lertprasert',
    subject: 'Advanced Mathematics for University Entrance Examinations',
    price: 1250.5,
    rating: 4.67,
    reviews: 12,
    experience: 15,
    slot: '2099-11-09T11:30:00.000Z',
  },
  th: {
    id: 't-long',
    name: 'ครูสุภากร วัฒนศิริพร-เลิศประเสริฐ',
    subject: 'คณิตศาสตร์ขั้นสูงสำหรับเตรียมสอบเข้ามหาวิทยาลัยและแข่งขันระดับประเทศ',
    price: 1250.5,
    rating: 4.67,
    reviews: 12,
    experience: 15,
    slot: '2099-11-09T11:30:00.000Z',
  },
};

const searchRow = (item: Tutor): TutorSearchResult => ({
  tutorId: item.id,
  listingId: `course-${item.id}`,
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

async function mockApi(page: Page, tutors: Tutor[], language: Language = 'en') {
  const state = { hidden: new Set<string>(), failOnce: new Set<string>() };
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript((value) => localStorage.setItem('hktutor-language', value), language);
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
        json: {
          items: tutors.map(searchRow),
          page: 1,
          pageSize: 10,
          total: tutors.length,
          totalPages: 1,
        },
      });
    }
    const match = /^\/tutors\/([^/]+)(\/availability)?$/.exec(path);
    const item = tutors.find(({ id }) => id === match?.[1]);
    if (!match || !item) {
      return route.fulfill({ status: 500, json: { message: 'Unexpected request' } });
    }
    if (state.hidden.has(item.id)) {
      return route.fulfill({ status: 404, json: { message: 'Published tutor not found' } });
    }
    if (state.failOnce.has(item.id)) {
      if (!match[2]) {
        state.failOnce.delete(item.id);
      }
      return route.fulfill({ status: 500, json: { message: 'Unavailable' } });
    }
    if (match[2]) {
      const end = item.slot && new Date(Date.parse(item.slot) + 60 * 60 * 1000).toISOString();
      return route.fulfill({
        json: item.slot ? [{ id: `${item.id}-slot`, startAtUtc: item.slot, endAtUtc: end }] : [],
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
          listingId: `course-${item.id}`,
          subject: item.subject,
          grade: 'Grade 10',
          pricePerHour: item.price,
          description: 'Profile-only description.',
        },
      ],
    };
    return route.fulfill({ json: detail });
  });
  return state;
}

const pocket = (page: Page) => page.locator('[data-comparison-button]');
const panel = (page: Page) => page.locator('[data-comparison-panel]');
const toggle = (page: Page, tutors: Tutor[], item: Tutor) =>
  page
    .locator('article')
    .nth(tutors.indexOf(item))
    .getByRole('button', { name: /^(Select to compare|Selected|เลือกเปรียบเทียบ|เลือกแล้ว):/ });

test.beforeEach(async ({ page }, testInfo) => {
  const size = VIEWPORTS[testInfo.project.name];
  if (size) {
    await page.setViewportSize(size);
  }
});

/** Moves focus with real Tab presses until the target is focused, then checks its focus ring. */
async function tabTo(page: Page, target: Locator, key: 'Tab' | 'Shift+Tab' = 'Tab') {
  for (let presses = 0; presses < 200; presses += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) {
      await expectFocusRing(page);
      return;
    }
    await page.keyboard.press(key);
  }
  throw new Error('The keyboard never reached the target control');
}

/** The focused control (or a radio's label) must show the 2px :focus-visible outline. */
async function expectFocusRing(page: Page): Promise<void> {
  const ring = await page.evaluate(() => {
    const element = document.activeElement;
    if (!(element instanceof HTMLElement) || element === document.body) {
      return null;
    }
    const target =
      element instanceof HTMLInputElement && element.type === 'radio'
        ? (element.closest('label') ?? element)
        : element;
    const style = getComputedStyle(target);
    return {
      focusVisible: element.matches(':focus-visible'),
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
    };
  });
  expect(ring?.focusVisible).toBe(true);
  expect(ring?.outlineStyle).not.toBe('none');
  expect(ring?.outlineWidth ?? 0).toBeGreaterThanOrEqual(2);
}

/** No page-level horizontal scroll; the popup fits the viewport; the table scrolls inside it. */
async function expectContained(page: Page): Promise<{ tableScrolls: boolean }> {
  const layout = await page.evaluate(() => {
    const dialog = document.querySelector<HTMLElement>('[data-comparison-panel]');
    const scroll = document.querySelector<HTMLElement>('[data-comparison-scroll]');
    const rect = dialog?.getBoundingClientRect();
    return {
      pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
      left: rect?.left ?? 0,
      right: rect?.right ?? 0,
      width: window.innerWidth,
      tableScrolls: scroll ? scroll.scrollWidth > scroll.clientWidth + 1 : false,
      scrollStyle: scroll ? getComputedStyle(scroll).overflowX : 'visible',
    };
  });
  expect(layout.pageOverflow).toBeLessThanOrEqual(1);
  expect(layout.left).toBeGreaterThanOrEqual(0);
  expect(layout.right).toBeLessThanOrEqual(layout.width + 1);
  expect(['auto', 'scroll']).toContain(layout.scrollStyle);
  return { tableScrolls: layout.tableScrolls };
}

/** Column order, header associations and each tutor's own values. */
async function expectAligned(page: Page, expected: Tutor[]): Promise<void> {
  const ids = expected.map(({ id }) => id);
  await expect
    .poll(() =>
      panel(page)
        .locator('thead [data-tutor-column]')
        .evaluateAll((cells) => cells.map((cell) => cell.getAttribute('data-tutor-column'))),
    )
    .toEqual(ids);
  const table = panel(page).getByRole('table');
  await expect(table.getByRole('rowheader')).toHaveCount(6);
  await expect(table.getByRole('columnheader')).toHaveCount(expected.length + 1);
  expect(
    await table.locator('tbody td').evaluateAll((cells) =>
      cells.every((cell) => {
        const [rowId, columnId] = cell.getAttribute('headers')?.split(' ') ?? [];
        const row = document.getElementById(rowId ?? '');
        const column = document.getElementById(columnId ?? '');
        return (
          row?.getAttribute('scope') === 'row' &&
          row.parentElement === cell.parentElement &&
          column?.getAttribute('scope') === 'col' &&
          column.getAttribute('data-tutor-column') === cell.getAttribute('data-tutor-column')
        );
      }),
    ),
  ).toBe(true);
  for (const item of expected) {
    await expect(panel(page).locator(`thead [data-tutor-column="${item.id}"]`)).toContainText(
      item.name,
    );
    const cells = panel(page).locator(`tbody [data-tutor-column="${item.id}"]`);
    await expect(cells).toHaveCount(6);
    await expect(cells.nth(1)).toContainText(item.subject);
    await expect(cells.nth(3)).toHaveText(String(item.reviews));
    if (item.slot) {
      await expect(cells.nth(5).locator('time')).toHaveAttribute('datetime', item.slot);
    }
  }
}

async function evidence(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-${name}.png`) });
}

test('keyboard-only journey: select 2, compare, add a third, refuse a fourth, remove, sort all three', async ({
  page,
}, testInfo) => {
  const tutors = [MALI, KIET, PIM, NIRAN];
  await mockApi(page, tutors);
  await page.goto('/tutors');
  await expect(page.locator('article')).toHaveCount(tutors.length);

  // Select two tutors with Enter and Space.
  await tabTo(page, toggle(page, tutors, MALI));
  await page.keyboard.press('Enter');
  await tabTo(page, toggle(page, tutors, KIET));
  await page.keyboard.press('Space');
  await expect(pocket(page)).toHaveAccessibleName('Tutor comparison (2/3)');

  // Compare: open the dock from the keyboard.
  await tabTo(page, pocket(page));
  await page.keyboard.press('Enter');
  await expect(panel(page).locator('[data-comparison-column="ready"]')).toHaveCount(2);
  await expectAligned(page, [KIET, MALI]);
  await expectContained(page);
  await evidence(page, testInfo, '1-compare-two');

  // Close, add a third from the results, and see the fourth refused and announced.
  await page.keyboard.press('Escape');
  await expect(pocket(page)).toBeFocused();
  await tabTo(page, toggle(page, tutors, PIM), 'Shift+Tab');
  await page.keyboard.press('Enter');
  await expect(pocket(page)).toHaveAccessibleName('Tutor comparison (3/3)');
  await expect(page.locator('[data-comparison-selection-status]')).toContainText(
    'Three tutors selected. Remove one to choose another.',
  );
  await expect(toggle(page, tutors, NIRAN)).toBeDisabled();
  await tabTo(page, pocket(page));
  await page.keyboard.press('Enter');
  await expect(panel(page).locator('[data-comparison-column="ready"]')).toHaveCount(3);
  await expectAligned(page, [KIET, MALI, PIM]);
  await expect(panel(page)).toContainText('New tutor');
  await expect(panel(page)).toContainText('No future slots');
  const three = await expectContained(page);
  if (testInfo.project.name === 'mobile-chromium') {
    expect(three.tableScrolls).toBe(true);
  }
  await evidence(page, testInfo, '2-compare-three');

  // Remove Pim from inside the popup.
  await tabTo(page, panel(page).getByRole('button', { name: 'Remove tutor: Teacher Pim' }));
  await page.keyboard.press('Enter');
  await expect(panel(page).locator('[data-comparison-column]')).toHaveCount(2);
  await expect(toggle(page, tutors, NIRAN)).toBeEnabled();

  // Sort by all three priorities with the arrow keys.
  const radio = (value: string) => panel(page).locator(`input[type="radio"][value="${value}"]`);
  await tabTo(page, radio('lowest_price'));
  for (const [sort, order] of [
    ['highest_rating', [MALI, KIET]],
    ['earliest_availability', [MALI, KIET]],
    ['lowest_price', [KIET, MALI]],
  ] as const) {
    await page.keyboard.press('ArrowRight');
    await expect(radio(sort)).toBeChecked();
    await expect(radio(sort)).toBeFocused();
    await expectFocusRing(page);
    await expectAligned(page, [...order]);
    await expectContained(page);
    await evidence(page, testInfo, `3-sorted-${sort}`);
  }
  for (const item of [MALI, KIET]) {
    await expect(toggle(page, tutors, item)).toHaveAttribute('aria-pressed', 'true');
  }
  await page.keyboard.press('Escape');
  await expect(pocket(page)).toBeFocused();
});

for (const language of ['en', 'th'] as const) {
  test(`long names and subjects stay readable and aligned in ${language}`, async ({
    page,
  }, testInfo) => {
    const tutors = [LONG[language], KIET, PIM];
    await mockApi(page, tutors, language);
    await page.goto('/tutors');
    await expect(page.locator('article')).toHaveCount(tutors.length);
    for (const item of tutors) {
      await tabTo(page, toggle(page, tutors, item));
      await page.keyboard.press('Enter');
    }
    await tabTo(page, pocket(page));
    await page.keyboard.press('Enter');
    await expect(panel(page).locator('[data-comparison-column="ready"]')).toHaveCount(3);
    await expectAligned(page, [KIET, PIM, LONG[language]]);
    await expect(panel(page)).toContainText(language === 'th' ? 'ติวเตอร์ใหม่' : 'New tutor');
    await expect(panel(page)).toContainText(
      language === 'th' ? 'ยังไม่มีเวลาว่างในอนาคต' : 'No future slots',
    );
    // Long text wraps inside its own cell instead of being clipped or spilling over.
    const clipped = await panel(page)
      .locator('th, td')
      .evaluateAll((cells) =>
        cells
          .filter((cell) => cell.scrollWidth > cell.clientWidth + 1)
          .map((cell) => cell.textContent?.trim().slice(0, 40)),
      );
    expect(clipped).toEqual([]);
    const header = panel(page).locator(`thead [data-tutor-column="${LONG[language].id}"]`);
    await expect(header).toContainText(LONG[language].name);
    await expectContained(page);
    // On narrow screens, bring the long column into view so the evidence shows it wrapped.
    await header.scrollIntoViewIfNeeded();
    await expect(header).toBeInViewport();
    await expectContained(page);
    await evidence(page, testInfo, `4-long-text-${language}`);
  });
}

test('a tutor hidden before comparing and one network error keep the rest of the selection', async ({
  page,
}, testInfo) => {
  const tutors = [MALI, KIET, NIRAN];
  const state = await mockApi(page, tutors);
  await page.goto('/tutors');
  await expect(page.locator('article')).toHaveCount(tutors.length);
  for (const item of tutors) {
    await tabTo(page, toggle(page, tutors, item));
    await page.keyboard.press('Enter');
  }
  // Hidden between selection and the first comparison; Kiet fails once.
  state.hidden.add(NIRAN.id);
  state.failOnce.add(KIET.id);
  await tabTo(page, pocket(page));
  await page.keyboard.press('Enter');
  await expect(panel(page).locator('[data-comparison-column="ready"]')).toHaveCount(1);
  await expect(panel(page).locator('[data-comparison-column="unavailable"]')).toHaveCount(1);
  await expect(panel(page).locator('[data-comparison-column="error"]')).toHaveCount(1);
  await expect(panel(page)).not.toContainText(NIRAN.name);
  await expect(panel(page).getByRole('link', { name: /Teacher Niran/ })).toHaveCount(0);
  await expectContained(page);
  await evidence(page, testInfo, '5-hidden-and-error');

  await tabTo(page, panel(page).getByRole('button', { name: 'Try again', exact: true }));
  await page.keyboard.press('Enter');
  await expect(panel(page).locator('[data-comparison-column="ready"]')).toHaveCount(2);
  await expect(panel(page).locator('[data-comparison-column="unavailable"]')).toHaveCount(1);
  await expect(panel(page)).not.toContainText(NIRAN.name);
  await expect(pocket(page)).toHaveAccessibleName('Tutor comparison (3/3)');
  for (const item of tutors) {
    await expect(toggle(page, tutors, item)).toHaveAttribute('aria-pressed', 'true');
  }
  await expectContained(page);
  await evidence(page, testInfo, '6-after-retry');
});
