import { expect, test } from '@playwright/test';

import type {
  TutorRankingPriority,
  TutorRecommendationTag,
  TutorSearchResponse,
  TutorSearchResult,
} from '@/lib/api/types';
import type { Page, Route } from '@playwright/test';

// Isolated preview fixtures; every API request is intercepted, including authentication.
const courses: TutorSearchResult[] = Array.from({ length: 12 }, (_, index) => ({
  recommendationTags: [],
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
    if (path === '/bookings/me') return route.fulfill({ json: { items: [], total: 5 } });
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

const rankingTags: Record<TutorRankingPriority, TutorRecommendationTag> = {
  lowest_price: 'LOWEST_PRICE',
  highest_rating: 'HIGHEST_RATED',
  earliest_availability: 'EARLIEST_AVAILABILITY',
};

for (const language of ['en', 'th'] as const) {
  test(`${language} ranking preserves applied filters, drafts and pagination and displays server reasons`, async ({
    page,
  }, testInfo) => {
    if (testInfo.project.name === 'mobile-chromium') {
      await page.setViewportSize({ width: 320, height: 900 });
    }
    const { calls, unexpected } = await mockSearch(page, {
      language,
      student: true,
      respond: (route, url) => {
        const response = searchPage(url);
        const priority = url.searchParams.get('priority');
        const tag = Object.entries(rankingTags).find(([key]) => key === priority)?.[1];
        response.items = response.items.map((course, index) => ({
          ...course,
          displayName: index === 0 && priority ? `Server first: ${priority}` : course.displayName,
          recommendationTags: [
            ...(url.searchParams.has('maxPrice') ? ['FITS_BUDGET' as const] : []),
            ...(index === 0 && response.page === 1 && tag ? [tag] : []),
          ],
        }));
        return route.fulfill({ json: response });
      },
    });
    await page.goto('/tutors');
    const articles = page.getByRole('article');
    await expect(articles).toHaveCount(10);
    const ranking = page.getByLabel(language === 'th' ? 'เรียงตาม' : 'Sort by', { exact: true });
    await expect(ranking).toHaveValue('');
    await expect(
      page.getByRole('list', { name: /Recommendation reasons|เหตุผลที่แนะนำ/ }),
    ).toHaveCount(0);
    await openFilters(page);
    await page.locator('#tutor-search-subject').selectOption('Mathematics');
    await page.locator('#tutor-search-grade').selectOption('Grade 10');
    await page.locator('#tutor-search-max-price').fill('500.25');
    await page.locator('#tutor-search-min-rating').selectOption('4.5');
    await page
      .getByRole('button', {
        name: language === 'th' ? 'ใช้ตัวกรอง' : 'Apply filters',
        exact: true,
      })
      .click();
    await expect(articles).toHaveCount(10);
    await openFilters(page);
    // Ranking uses the applied query, including when an unsubmitted draft is invalid.
    await page.locator('#tutor-search-max-price').fill('-1');
    const next = page.getByRole('button', {
      name: language === 'th' ? 'ถัดไป' : 'Next',
      exact: true,
    });
    const fitsBudget = language === 'th' ? 'อยู่ในงบ' : 'Fits budget';
    const labels =
      language === 'th'
        ? ['ราคาต่ำสุดในผลลัพธ์นี้', 'คะแนนสูงสุดในผลลัพธ์นี้', 'เวลาว่างเร็วสุดในผลลัพธ์นี้']
        : [
            'Lowest price in these results',
            'Highest rating in these results',
            'Earliest availability in these results',
          ];
    let index = 0;
    for (const priority of ['lowest_price', 'highest_rating', 'earliest_availability'] as const) {
      await next.click();
      await expect(articles).toHaveCount(2);
      await ranking.selectOption(priority);
      await expect(articles).toHaveCount(10);
      expect(Object.fromEntries(calls.at(-1)?.searchParams ?? [])).toEqual({
        priority,
        subject: 'Mathematics',
        grade: 'Grade 10',
        maxPrice: '500.25',
        minimumRating: '4.5',
        page: '1',
        pageSize: '10',
      });
      await expect(articles.first().getByRole('heading', { level: 3 })).toHaveText(
        `Server first: ${priority}`,
      );
      await expect(articles.first().getByRole('list')).toContainText(labels[index] ?? '');
      await expect(articles.first().getByRole('list')).toContainText(fitsBudget);
      await expect(articles.nth(1).getByRole('listitem')).toHaveText([fitsBudget]);
      await expect(articles.nth(1)).toContainText(
        language === 'th' ? 'ยังไม่มีเวลาว่างในอนาคต' : 'No future slots',
      );
      await expect(page.locator('#tutor-search-max-price')).toHaveValue('-1');
      await expect(page.getByText(/500\.25฿/)).toBeVisible();
      await articles.first().screenshot({
        path: testInfo.outputPath(`library-stamp-${language}-${priority}.png`),
        animations: 'disabled',
      });
      index += 1;
    }
    await page.locator('#tutor-search-max-price').fill('600.75');
    await page
      .getByRole('button', {
        name: language === 'th' ? 'ใช้ตัวกรอง' : 'Apply filters',
        exact: true,
      })
      .click();
    await expect(articles).toHaveCount(10);
    await expect(ranking).toHaveValue('earliest_availability');
    expect(calls.at(-1)?.searchParams.get('priority')).toBe('earliest_availability');
    expect(calls.at(-1)?.searchParams.get('maxPrice')).toBe('600.75');
    await openFilters(page);
    await next.click();
    await expect(articles).toHaveCount(2);
    expect(calls.at(-1)?.searchParams.get('priority')).toBe('earliest_availability');
    // A page-local first result does not receive a best-value tag from the UI.
    await expect(articles.first().getByRole('listitem')).toHaveText([fitsBudget]);
    await page
      .getByRole('button', { name: language === 'th' ? 'ล้าง' : 'Clear', exact: true })
      .click();
    await expect(articles).toHaveCount(10);
    expect(Object.fromEntries(calls.at(-1)?.searchParams ?? [])).toEqual({
      priority: 'earliest_availability',
      page: '1',
      pageSize: '10',
    });
    await expect(page.getByText(fitsBudget, { exact: true })).toHaveCount(0);
    await expect(articles.first().getByRole('listitem')).toHaveText([labels[2] ?? '']);
    if (testInfo.project.name === 'mobile-chromium') {
      await page.setViewportSize({ width: 320, height: 900 });
    }
    await ranking.focus();
    await expect(ranking).toBeFocused();
    await expect(ranking).toHaveCSS('outline-style', 'solid');
    await noOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`ranking-${language}.png`),
      fullPage: true,
      animations: 'disabled',
    });
    await ranking.selectOption('');
    await expect(articles.first().getByRole('heading', { level: 3 })).toHaveText('Teacher Anan');
    expect(calls.at(-1)?.searchParams.toString()).toBe('page=1&pageSize=10');
    expect(unexpected).toEqual([]);
  });
}

test('ranking changes discard stale responses and their reasons', async ({ page }) => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { calls } = await mockSearch(page, {
    respond: async (route, url) => {
      const priority = url.searchParams.get('priority');
      if (priority === 'lowest_price') await gate;
      const response = searchPage(url);
      response.items = response.items.slice(0, 1).map((course) => ({
        ...course,
        displayName: priority ?? 'Initial tutor',
        recommendationTags: priority === 'lowest_price' ? ['LOWEST_PRICE'] : [],
      }));
      return route.fulfill({ json: response });
    },
  });
  try {
    await page.goto('/tutors');
    await expect(page.getByRole('article')).toHaveCount(1);
    const ranking = page.getByLabel('Sort by', { exact: true });
    await ranking.selectOption('lowest_price');
    await expect.poll(() => calls.at(-1)?.searchParams.get('priority')).toBe('lowest_price');
    await expect(page.getByRole('article')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 2, name: '— matching courses' })).toBeVisible();
    const canceled = page.waitForEvent('requestfailed', {
      predicate: (request) =>
        new URL(request.url()).searchParams.get('priority') === 'lowest_price',
    });
    await ranking.selectOption('highest_rating');
    await canceled;
    await expect(page.getByRole('article').getByRole('heading', { level: 3 })).toHaveText(
      'highest_rating',
    );
    release();
    await expect(page.getByRole('list', { name: 'Recommendation reasons' })).toHaveCount(0);
    await expect(ranking).toHaveValue('highest_rating');
  } finally {
    release();
  }
});

test('ranking failures and empty results retain selection and filters without stale reasons', async ({
  page,
}) => {
  await mockSearch(page, {
    respond: (route, url) => {
      const priority = url.searchParams.get('priority');
      if (priority === 'highest_rating')
        return route.fulfill({ status: 500, json: { message: 'Unavailable' } });
      if (priority === 'earliest_availability')
        return route.fulfill({
          json: { items: [], page: 1, pageSize: 10, total: 0, totalPages: 0 },
        });
      const response = searchPage(url);
      response.items = response.items.map((course) => ({
        ...course,
        recommendationTags: ['FITS_BUDGET'],
      }));
      return route.fulfill({ json: response });
    },
  });
  await page.goto('/tutors');
  await expect(page.getByRole('article')).toHaveCount(10);
  await openFilters(page);
  await page.locator('#tutor-search-max-price').fill('500');
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(10);
  const ranking = page.getByLabel('Sort by', { exact: true });
  await ranking.selectOption('highest_rating');
  await expect(page.locator('main').getByRole('alert')).toContainText('We could not load tutors');
  await expect(page.getByRole('article')).toHaveCount(0);
  await expect(ranking).toHaveValue('highest_rating');
  await openFilters(page);
  await expect(page.locator('#tutor-search-max-price')).toHaveValue('500');
  await ranking.selectOption('earliest_availability');
  await expect(page.getByText('No exact matches found', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: '0 matching courses' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Recommendation reasons' })).toHaveCount(0);
  await expect(ranking).toHaveValue('earliest_availability');
});

for (const language of ['en', 'th'] as const) {
  test(`${language} Return Slip retries the failed page and applied query while keeping filter drafts`, async ({
    page,
  }, testInfo) => {
    if (testInfo.project.name === 'mobile-chromium') {
      await page.setViewportSize({ width: 320, height: 900 });
    }
    let secondPageReads = 0;
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { calls, unexpected } = await mockSearch(page, {
      language,
      respond: async (route, url) => {
        if (url.searchParams.get('page') === '2') {
          secondPageReads += 1;
          if (secondPageReads === 2) await gate;
          if (secondPageReads <= 2) {
            return route.fulfill({ status: 503, json: { message: 'Temporarily unavailable' } });
          }
        }
        return route.fulfill({ json: searchPage(url) });
      },
    });
    try {
      await page.goto('/tutors');
      await expect(page.getByRole('article')).toHaveCount(10);
      await openFilters(page);
      await page.locator('#tutor-search-subject').selectOption('Mathematics');
      await page.locator('#tutor-search-grade').selectOption('Grade 10');
      await page.locator('#tutor-search-max-price').fill('500');
      await page.locator('#tutor-search-min-rating').selectOption('4');
      await page
        .getByRole('button', {
          name: language === 'th' ? 'ใช้ตัวกรอง' : 'Apply filters',
          exact: true,
        })
        .click();
      await expect(page.getByRole('article')).toHaveCount(10);
      await page.locator('#tutor-search-ranking').selectOption('highest_rating');
      await expect(page.getByRole('article')).toHaveCount(10);
      await openFilters(page);
      await page.locator('#tutor-search-max-price').fill('900');
      await page
        .getByRole('button', { name: language === 'th' ? 'ถัดไป' : 'Next', exact: true })
        .click();
      const retry = page.getByRole('button', {
        name: language === 'th' ? 'ลองใหม่' : 'Try again',
        exact: true,
      });
      const alert = page.locator('main').getByRole('alert');
      await expect(retry).toBeVisible();
      await expect(page.getByRole('article')).toHaveCount(0);
      const failedQuery = calls.at(-1)?.search;
      expect(Object.fromEntries(calls.at(-1)?.searchParams ?? [])).toEqual({
        priority: 'highest_rating',
        subject: 'Mathematics',
        grade: 'Grade 10',
        maxPrice: '500',
        minimumRating: '4',
        page: '2',
        pageSize: '10',
      });
      await alert.locator('..').screenshot({
        path: testInfo.outputPath(`return-slip-${language}.png`),
        animations: 'disabled',
      });
      await noOverflow(page);
      await page.keyboard.press('Tab');
      await retry.focus();
      await expect(retry).toHaveCSS('outline-style', 'solid');
      await page.keyboard.press('Enter');
      await expect(retry).toHaveCount(0);
      await expect(
        page.getByText(language === 'th' ? 'กำลังโหลดข้อมูลติวเตอร์…' : 'Loading tutors…', {
          exact: true,
        }),
      ).toBeVisible();
      expect(secondPageReads).toBe(2);
      expect(calls.at(-1)?.search).toBe(failedQuery);
      release();
      await expect(retry).toBeVisible();
      await expect(retry).toBeFocused();
      await expect(page.locator('#tutor-search-max-price')).toHaveValue('900');
      await retry.click();
      await expect(page.getByRole('article')).toHaveCount(2);
      await expect(
        page.getByRole('heading', {
          level: 2,
          name: language === 'th' ? '12 คอร์สที่ตรงกัน' : '12 matching courses',
        }),
      ).toBeFocused();
      expect(secondPageReads).toBe(3);
      expect(calls.at(-1)?.search).toBe(failedQuery);
      await expect(retry).toHaveCount(0);
      await expect(page.locator('#tutor-search-ranking')).toHaveValue('highest_rating');
      await expect(page.locator('#tutor-search-max-price')).toHaveValue('900');
      expect(unexpected).toEqual([]);
    } finally {
      release();
    }
  });

  test(`${language} View times stays on a single line after a reload at each breakpoint`, async ({
    page,
  }) => {
    await mockSearch(page, { language, student: true });
    await page.goto('/tutors');
    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.reload();
      const action = page
        .getByRole('article')
        .first()
        .getByRole('link', { name: language === 'th' ? 'ดูเวลาว่าง' : 'View times' });
      await expect(action).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const label = action.getByText(language === 'th' ? 'ดูเวลาว่าง' : 'View times', {
        exact: true,
      });
      const lineTops = await label.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return Array.from(range.getClientRects(), (rect) => rect.top);
      });
      expect(new Set(lineTops).size).toBe(1);
      expect(await action.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      await noOverflow(page);
    }
  });
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
      await expect(first).toContainText(
        language === 'th' ? 'ผ่านการตรวจสอบแล้ว' : 'Verified tutor',
      );
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
      const controls = pagination.locator('div').filter({ has: page.getByRole('button') });
      await expect(controls).toHaveCSS('display', 'grid');
      await expect(controls).toHaveCSS('border-top-width', '0px');
      await expect(pagination.getByText('1–10 / 12', { exact: true })).toBeVisible();
      const pageCount = pagination.getByText(language === 'th' ? 'หน้า 1 จาก 2' : 'Page 1 of 2', {
        exact: true,
      });
      await expect(pageCount).toBeVisible();
      for (const button of await pagination.getByRole('button').all()) {
        await expect(button).toHaveCSS('display', 'flex');
        await expect(button).toHaveCSS('border-radius', '8px');
        await expect(button).toHaveCSS('border-left-style', 'solid');
        await expect(button.locator('svg')).toHaveCount(0);
        const bounds = await button.boundingBox();
        expect(bounds?.height).toBeGreaterThanOrEqual(44);
        expect(bounds?.width).toBeGreaterThanOrEqual(44);
      }
      const previousBounds = await pagination.getByRole('button').first().boundingBox();
      const nextBounds = await pagination.getByRole('button').last().boundingBox();
      expect(previousBounds?.y).toBe(nextBounds?.y);
      expect(previousBounds?.x).toBeLessThan(nextBounds?.x ?? 0);
      const countBounds = await pageCount.boundingBox();
      expect(countBounds?.x).toBeGreaterThan(
        (previousBounds?.x ?? 0) + (previousBounds?.width ?? 0),
      );
      expect((countBounds?.x ?? 0) + (countBounds?.width ?? 0)).toBeLessThan(nextBounds?.x ?? 0);
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

test('a tutor who stops being discoverable disappears from a refreshed search without a stale badge', async ({
  page,
}) => {
  // The API never sends a "revoked" status to this page; a tutor who stops being discoverable
  // instead simply stops being returned. This proves a refresh reflects that change cleanly,
  // rather than keeping the previous card, its badge, or its link rendered from the earlier
  // response.
  let revoked = false;
  await mockSearch(page, {
    respond: async (route, url) => {
      const pageNumber = Number(url.searchParams.get('page') ?? 1);
      const visible = revoked
        ? courses.filter((course) => course.tutorId !== 'tutor/shared')
        : courses;
      return route.fulfill({
        json: {
          items: visible.slice((pageNumber - 1) * 10, pageNumber * 10),
          page: pageNumber,
          pageSize: 10,
          total: visible.length,
          totalPages: Math.ceil(visible.length / 10),
        },
      });
    },
  });
  await page.goto('/tutors');
  const main = page.locator('main');
  await expect(main.getByRole('article')).toHaveCount(10);
  await expect(
    main.getByRole('heading', { level: 3, name: 'Teacher Anan', exact: true }),
  ).toHaveCount(2);
  await expect(main.getByRole('article').first()).toContainText('Verified tutor');
  await expect(page.locator('a[href*="tutor%2Fshared"]')).toHaveCount(2);

  revoked = true;
  await page.reload();

  // Both of the revoked tutor's cards are gone, their shared-tutor link along with them; the ten
  // visible cards now belong to other, still-verified tutors, none of them stale leftovers.
  await expect(main.getByRole('article')).toHaveCount(10);
  await expect(
    main.getByRole('heading', { level: 3, name: 'Teacher Anan', exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('a[href*="tutor%2Fshared"]')).toHaveCount(0);
  await expect(main.getByRole('article').first()).toContainText('Verified tutor');
});
