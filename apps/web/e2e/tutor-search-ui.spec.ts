import { expect, test } from '@playwright/test';

import type { TutorSearchResponse, TutorSearchResult } from '@/lib/api/types';
import type { Page, Route } from '@playwright/test';

// Isolated preview fixtures; every API request is intercepted, including authentication.
const courses: TutorSearchResult[] = Array.from({ length: 12 }, (_, index) => ({
  listingId: `course/${index + 1}`,
  tutorId: index < 2 ? 'tutor/shared' : `tutor-${index}`,
  displayName: index < 2 ? 'Teacher Anan' : `Teacher ${index + 1}`,
  subject: index === 1 ? 'Science' : 'Mathematics',
  grade: 'Grade 10',
  description: 'Build understanding through clear examples and practice at your own pace.',
  experienceYears: 5,
  pricePerHour: 450.5,
  ratingAverage: index === 1 ? null : 4.8,
  reviewCount: index === 1 ? 0 : 24,
  verificationStatus: 'VERIFIED',
  nextAvailableAt: index === 1 ? null : '2099-09-20T03:00:00.000Z',
}));

function searchPage(url: URL): TutorSearchResponse {
  const page = Number(url.searchParams.get('page') ?? 1);
  return {
    items: courses.slice((page - 1) * 10, page * 10),
    page,
    pageSize: 10,
    total: 12,
    totalPages: 2,
  };
}

async function mockSearch(
  page: Page,
  options: {
    language?: 'en' | 'th';
    student?: boolean;
    catalogGate?: Promise<void>;
    catalogError?: boolean;
    respond?: (route: Route, url: URL) => Promise<unknown>;
  } = {},
) {
  const calls: URL[] = [];
  const unexpected: string[] = [];
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(
    (language) => localStorage.setItem('hktutor-language', language),
    options.language ?? 'en',
  );
  if (options.student) {
    await page
      .context()
      .addCookies([
        { name: 'hktutor_refresh', value: 'search-preview-session', url: 'http://localhost:3000' },
      ]);
  }
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    if (path === '/auth/refresh') {
      return route.fulfill(
        options.student
          ? {
              json: {
                accessToken: 'search-preview-token',
                user: {
                  id: 'student-search',
                  email: 'student@example.test',
                  role: 'STUDENT',
                  displayName: 'Nan',
                },
              },
            }
          : { status: 401, json: { message: 'Unauthorized' } },
      );
    }
    if (path === '/profiles/me') {
      return route.fulfill({
        json: {
          role: 'STUDENT',
          consentCurrent: true,
          profileComplete: true,
          policyVersion: '2026-01',
          profile: {
            firstName: 'Nan',
            lastName: 'Dee',
            nickname: 'Nan',
            school: 'Example school',
            gradeLevel: 'Grade 10',
            phone: '0812345678',
          },
        },
      });
    }
    if (path === '/subjects' || path === '/grade-levels') {
      await options.catalogGate;
      return route.fulfill(
        options.catalogError
          ? { status: 500, json: { message: 'Unavailable' } }
          : {
              json: {
                items:
                  path === '/subjects'
                    ? [
                        { id: 'math', code: 'MATH', name: 'Mathematics', active: true },
                        { id: 'science', code: 'SCIENCE', name: 'Science', active: true },
                      ]
                    : [{ id: 'g10', code: 'G10', name: 'Grade 10', active: true, sortOrder: 10 }],
              },
            },
      );
    }
    if (path === '/tutors') {
      calls.push(url);
      if (options.respond) {
        return options.respond(route, url);
      }
      return route.fulfill({ json: searchPage(url) });
    }
    unexpected.push(`${route.request().method()} ${path}`);
    return route.fulfill({ status: 500, json: { message: `Unexpected search request: ${path}` } });
  });
  return { calls, unexpected };
}

async function openFilters(page: Page) {
  const toggle = page.getByRole('button', { name: /^(Show filters|เปิดตัวกรอง)/ });
  if (await toggle.isVisible()) {
    await toggle.click();
  }
}

async function noOverflow(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
}

for (const language of ['en', 'th'] as const) {
  for (const student of [false, true]) {
    test(`${language} ${student ? 'student' : 'guest'} course index preserves listing anatomy and links`, async ({
      page,
    }, testInfo) => {
      const { unexpected } = await mockSearch(page, {
        language,
        student,
        respond: (route, url) => {
          const response = searchPage(url);
          const third = response.items[2];
          if (third) {
            response.items[2] = {
              ...third,
              displayName:
                language === 'th'
                  ? 'อาจารย์ผู้สอนคณิตศาสตร์และวิทยาศาสตร์เพื่อเตรียมสอบเข้ามหาวิทยาลัย'
                  : 'MathematicsAndSciencePreparationWithAVeryLongUnbrokenDisplayName',
              subject:
                language === 'th'
                  ? 'คณิตศาสตร์ประยุกต์และวิทยาศาสตร์สำหรับการเตรียมสอบ'
                  : 'AdvancedMathematicsAndScientificReasoning',
              grade:
                language === 'th'
                  ? 'ระดับมัธยมศึกษาตอนปลายเตรียมเข้ามหาวิทยาลัย'
                  : 'UniversityEntrancePreparation',
              description: 'Long description '.repeat(50),
            };
          }
          return route.fulfill({ json: response });
        },
      });
      await page.goto('/tutors');
      const main = page.locator('main');
      await expect(main.getByRole('article')).toHaveCount(10);
      await expect(main.getByRole('heading', { level: 1 })).toHaveText(
        language === 'th' ? 'ค้นหาคอร์สที่ตรงกับคุณ' : 'Find the course for you',
      );
      await expect(
        main.getByRole('heading', { level: 3, name: 'Teacher Anan', exact: true }),
      ).toHaveCount(2);
      const first = main.getByRole('article').first();
      await expect(first).toContainText(language === 'th' ? 'ยืนยันแล้ว' : 'Verified');
      await expect(first).toContainText('Grade 10');
      await expect(first).toContainText('450.5 ฿');
      await expect(first).toContainText('4.8');
      await expect(first).toContainText('10:00');
      const second = main.getByRole('article').nth(1);
      await expect(second).toContainText(language === 'th' ? 'ติวเตอร์ใหม่' : 'New tutor');
      await expect(second).toContainText(
        language === 'th' ? 'ยังไม่มีเวลาว่างในอนาคต' : 'No future slots',
      );
      await expect(first.getByRole('link')).toHaveAttribute(
        'href',
        '/tutors/tutor%2Fshared?listingId=course%2F1',
      );
      await expect(second.getByRole('link')).toHaveAttribute(
        'href',
        '/tutors/tutor%2Fshared?listingId=course%2F2',
      );
      await expect(page.locator('header a[href="/tutors"]')).toHaveCount(0);
      await expect(page.locator('header a[href="/dashboard/bookings"]')).toHaveCount(0);
      if (student) {
        await expect(page.locator('header a[href="/"]')).toHaveCount(0);
      } else {
        await expect(page.locator('header a[href="/"]')).toBeVisible();
      }
      if ((page.viewportSize()?.width ?? 0) < 768) {
        const toggle = page.locator('button[aria-controls="tutor-search-filter-fields"]');
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(page.locator('#tutor-search-subject')).toBeHidden();
        await toggle.focus();
        await page.keyboard.press('Enter');
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        await page.keyboard.press('Space');
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      } else {
        const filters = await page.locator('#tutor-search-filters').boundingBox();
        const result = await first.boundingBox();
        expect(filters?.x).toBeLessThan(result?.x ?? 0);
      }
      await page.evaluate(() => document.fonts.ready);
      await openFilters(page);
      const apply = page.getByRole('button', {
        name: language === 'th' ? 'ใช้ตัวกรอง' : 'Apply filters',
        exact: true,
      });
      const clear = page.getByRole('button', {
        name: language === 'th' ? 'ล้าง' : 'Clear',
        exact: true,
      });
      const applyBounds = await apply.boundingBox();
      const clearBounds = await clear.boundingBox();
      expect(applyBounds).not.toBeNull();
      expect(clearBounds).not.toBeNull();
      expect(applyBounds?.y).toBe(clearBounds?.y);
      expect((applyBounds?.x ?? 0) + (applyBounds?.width ?? 0)).toBeLessThanOrEqual(
        clearBounds?.x ?? 0,
      );
      for (const action of [apply, clear, first.getByRole('link')]) {
        const bounds = await action.boundingBox();
        expect(bounds?.height).toBeGreaterThanOrEqual(44);
        expect(bounds?.width).toBeGreaterThanOrEqual(44);
        expect(await action.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
          true,
        );
        await action.focus();
        await expect(action).toBeFocused();
        await expect(action).toHaveCSS('outline-style', 'solid');
      }
      await page.locator('#tutor-search-filters').screenshot({
        path: testInfo.outputPath(
          `filter-actions-${language}-${student ? 'student' : 'guest'}.png`,
        ),
        animations: 'disabled',
      });
      await first.screenshot({
        path: testInfo.outputPath(`course-action-${language}-${student ? 'student' : 'guest'}.png`),
        animations: 'disabled',
      });
      await noOverflow(page);
      const pagination = main.getByRole('navigation');
      await expect(pagination.getByRole('button').first()).toBeDisabled();
      const tickets = pagination.locator('div').filter({ has: page.getByRole('button') });
      await expect(tickets).toHaveCSS('display', 'grid');
      await expect(tickets).toHaveCSS('border-top-width', '1px');
      await expect(pagination.getByRole('button').last()).toHaveCSS('border-left-style', 'dashed');
      for (const button of await pagination.getByRole('button').all()) {
        await expect(button).toHaveCSS('display', 'flex');
        const bounds = await button.boundingBox();
        expect(bounds?.height).toBeGreaterThanOrEqual(44);
        expect(bounds?.width).toBeGreaterThanOrEqual(44);
      }
      const previousBounds = await pagination.getByRole('button').first().boundingBox();
      const nextBounds = await pagination.getByRole('button').last().boundingBox();
      expect(previousBounds?.y).toBe(nextBounds?.y);
      expect(previousBounds?.x).toBeLessThan(nextBounds?.x ?? 0);
      await pagination.screenshot({
        path: testInfo.outputPath(`pagination-${language}-${student ? 'student' : 'guest'}.png`),
        animations: 'disabled',
      });
      await page.screenshot({
        path: testInfo.outputPath(`search-${language}-${student ? 'student' : 'guest'}.png`),
        fullPage: true,
        animations: 'disabled',
      });
      expect(unexpected).toEqual([]);
    });
  }
}

test('filters retain drafts, validate, apply explicitly and paginate the applied query', async ({
  page,
}, testInfo) => {
  const { calls } = await mockSearch(page);
  await page.goto('/tutors');
  await expect(page.getByRole('article')).toHaveCount(10);
  await openFilters(page);
  const initialCalls = calls.length;
  await page.locator('#tutor-search-subject').selectOption('Mathematics');
  await page.locator('#tutor-search-grade').selectOption('Grade 10');
  await page.locator('#tutor-search-max-price').fill('500.25');
  await page.locator('#tutor-search-min-rating').selectOption('4.5');
  const hide = page.getByRole('button', { name: /Hide filters/ });
  if (await hide.isVisible()) {
    await hide.click();
    await openFilters(page);
    await expect(page.locator('#tutor-search-max-price')).toHaveValue('500.25');
  }
  expect(calls).toHaveLength(initialCalls);
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect.poll(() => calls.at(-1)?.searchParams.get('maxPrice')).toBe('500.25');
  await expect(page.getByRole('article')).toHaveCount(10);
  if ((page.viewportSize()?.width ?? 0) < 768) {
    await expect(page.locator('button[aria-controls="tutor-search-filter-fields"]')).toBeFocused();
  }
  await openFilters(page);
  await page.locator('#tutor-search-subject').selectOption('');
  const next = page.getByRole('button', { name: 'Next', exact: true });
  await next.focus();
  await expect(next).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('article')).toHaveCount(2);
  expect(Object.fromEntries(calls.at(-1)?.searchParams ?? new URLSearchParams())).toEqual({
    subject: 'Mathematics',
    grade: 'Grade 10',
    maxPrice: '500.25',
    minimumRating: '4.5',
    page: '2',
    pageSize: '10',
  });
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  await expect(page.getByRole('article').first().getByRole('link')).toHaveAttribute(
    'href',
    '/tutors/tutor-10?listingId=course%2F11',
  );
  await noOverflow(page);
  await page
    .locator('main')
    .getByRole('navigation')
    .screenshot({
      path: testInfo.outputPath('pagination-last-page.png'),
      animations: 'disabled',
    });
  const previous = page.getByRole('button', { name: 'Previous', exact: true });
  await previous.focus();
  await expect(previous).toBeFocused();
  await page
    .locator('main')
    .getByRole('navigation')
    .screenshot({
      path: testInfo.outputPath('pagination-keyboard-focus.png'),
      animations: 'disabled',
    });
  await page.keyboard.press('Space');
  await expect(page.getByRole('article')).toHaveCount(10);
  expect(calls.at(-1)?.searchParams.get('page')).toBe('1');
  expect(calls.at(-1)?.searchParams.get('subject')).toBe('Mathematics');
  await expect(previous).toBeDisabled();
  await expect(next).toBeEnabled();
  await page.locator('#tutor-search-max-price').fill('-1');
  const beforeInvalid = calls.length;
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect(page.locator('#tutor-search-max-price')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#tutor-search-max-price')).toBeFocused();
  await expect(page.getByRole('article')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 2, name: '— matching courses' })).toBeVisible();
  expect(calls).toHaveLength(beforeInvalid);
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(10);
  expect(calls.at(-1)?.searchParams.toString()).toBe('page=1&pageSize=10');
  await expect(page.locator('#tutor-search-max-price')).toHaveValue('');
  await expect(page.locator('#tutor-search-min-rating')).toHaveValue('');
  await noOverflow(page);
});

for (const fail of [false, true]) {
  test(`loading retains shell and unavailable count before ${fail ? 'error' : 'empty'}`, async ({
    page,
  }, testInfo) => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await mockSearch(page, {
      respond: async (route) => {
        await gate;
        return route.fulfill(
          fail
            ? { status: 500, json: { message: 'Unavailable' } }
            : { json: { items: [], page: 1, pageSize: 10, total: 0, totalPages: 0 } },
        );
      },
    });
    try {
      await page.goto('/tutors');
      await expect(
        page.getByRole('heading', { level: 2, name: '— matching courses' }),
      ).toBeVisible();
      await expect(page.locator('header')).toBeVisible();
      await expect(page.getByText('No exact matches found')).toHaveCount(0);
      await page.screenshot({
        path: testInfo.outputPath('search-result-loading.png'),
        fullPage: true,
        animations: 'disabled',
      });
      release();
      await expect(
        page.getByRole('heading', { level: 2, name: `${fail ? '—' : '0'} matching courses` }),
      ).toBeVisible();
      if (fail) {
        await expect(page.locator('main').getByRole('alert')).toContainText(
          'We could not load tutors',
        );
      } else {
        await expect(
          page.getByRole('button', { name: 'Clear all filters', exact: true }),
        ).toBeVisible();
      }
      await noOverflow(page);
      await page.screenshot({
        path: testInfo.outputPath(`search-result-${fail ? 'error' : 'empty'}.png`),
        fullPage: true,
        animations: 'disabled',
      });
    } finally {
      release();
    }
  });
}

test('catalog loading and errors preserve disabled dropdowns while results remain usable', async ({
  page,
}, testInfo) => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await mockSearch(page, { catalogGate: gate, catalogError: true });
  try {
    await page.goto('/tutors');
    await expect(page.getByRole('article')).toHaveCount(10);
    await openFilters(page);
    await expect(page.getByText('Loading subjects and grade levels…')).toBeVisible();
    await expect(page.locator('#tutor-search-subject')).toBeDisabled();
    await expect(page.locator('#tutor-search-grade')).toBeDisabled();
    release();
    await expect(page.locator('main').getByRole('alert')).toContainText(
      'Subject and grade options are temporarily unavailable.',
    );
    await expect(page.locator('#tutor-search-subject')).toBeDisabled();
    await expect(page.locator('#tutor-search-min-rating')).toBeEnabled();
    await expect(page.getByRole('article')).toHaveCount(10);
    await noOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath('search-catalog-error.png'),
      fullPage: true,
      animations: 'disabled',
    });
  } finally {
    release();
  }
});

test('clearing during an in-flight filtered search keeps the newest results', async ({ page }) => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { calls } = await mockSearch(page, {
    respond: async (route, url) => {
      if (url.searchParams.has('maxPrice')) {
        await gate;
        return route.fulfill({
          json: {
            items: courses
              .slice(0, 1)
              .map((course) => ({ ...course, displayName: 'Stale response tutor' })),
            page: 1,
            pageSize: 10,
            total: 1,
            totalPages: 1,
          },
        });
      }
      return route.fulfill({ json: searchPage(url) });
    },
  });
  try {
    await page.goto('/tutors');
    await expect(page.getByRole('article')).toHaveCount(10);
    await openFilters(page);
    await page.locator('#tutor-search-max-price').fill('400');
    await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
    await expect.poll(() => calls.at(-1)?.searchParams.get('maxPrice')).toBe('400');
    await openFilters(page);
    await expect(page.getByRole('button', { name: 'Apply filters', exact: true })).toBeDisabled();
    const cancelled = page.waitForEvent('requestfailed', {
      predicate: (request) => new URL(request.url()).searchParams.get('maxPrice') === '400',
    });
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await cancelled;
    await expect(page.getByRole('article')).toHaveCount(10);
    release();
    await expect(
      page.getByRole('heading', { level: 2, name: '12 matching courses' }),
    ).toBeVisible();
    await expect(page.getByText('Stale response tutor')).toHaveCount(0);
    expect(calls.at(-1)?.searchParams.toString()).toBe('page=1&pageSize=10');
  } finally {
    release();
  }
});
