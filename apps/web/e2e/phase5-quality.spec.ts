import { expect, test } from '@playwright/test';

import type { Page, Route } from '@playwright/test';

const tutorId = '11111111-1111-4111-8111-111111111111';
const listingId = '22222222-2222-4222-8222-222222222222';

test('tutor search has a responsive and accessible page shell', async ({ page }) => {
  await mockTutorSearch(page);
  await page.goto('/tutors');

  await expect(page.getByRole('heading', { level: 1, name: 'Find an exact match' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Filters' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View times' })).toBeVisible();
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveCount(1);

  const duplicateIds = await page.locator('[id]').evaluateAll((elements) => {
    const ids = elements.map((element) => element.id).filter(Boolean);
    return ids.filter((id, index) => ids.indexOf(id) !== index);
  });
  expect(duplicateIds).toEqual([]);

  const unnamedControls = await page
    .locator('a[href], button, input:not([type="hidden"]), select, textarea')
    .evaluateAll((elements) => {
      const getAccessibleName = (element: Element) => {
        const ariaLabel = element.getAttribute('aria-label')?.trim();
        if (ariaLabel) return ariaLabel;

        const labelledBy = element.getAttribute('aria-labelledby');
        if (labelledBy) {
          const label = labelledBy
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
            .join(' ')
            .trim();
          if (label) return label;
        }

        if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement) {
          const label = Array.from(element.labels ?? [])
            .map((item) => item.textContent?.trim() ?? '')
            .join(' ')
            .trim();
          if (label) return label;
        }

        return (
          element.getAttribute('alt')?.trim() ||
          element.textContent?.trim() ||
          element.getAttribute('title')?.trim() ||
          ''
        );
      };

      return elements
        .filter((element) => !element.hasAttribute('hidden'))
        .filter((element) => !getAccessibleName(element))
        .map((element) => element.outerHTML.slice(0, 180));
    });
  expect(unnamedControls).toEqual([]);

  await expect
    .poll(() =>
      page.evaluate(() => {
        const root = document.scrollingElement ?? document.documentElement;
        return root.scrollWidth - root.clientWidth;
      }),
    )
    .toBeLessThanOrEqual(1);

  await page.keyboard.press('Tab');
  await expect.poll(() => page.evaluate(() => document.activeElement !== document.body)).toBe(true);

  await page.getByRole('button', { name: 'Switch language to Thai' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'th');
  await expect(
    page.getByRole('heading', { level: 1, name: 'ค้นหาติวเตอร์ที่ตรงกับคุณ' }),
  ).toBeVisible();
});

async function mockTutorSearch(page: Page) {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');

    if (request.method() === 'POST' && path === '/auth/refresh') {
      return json(route, { message: 'Unauthorized' }, 401);
    }
    if (request.method() === 'GET' && path === '/subjects') {
      return json(route, {
        items: [{ id: 'subject-math', code: 'MATH', name: 'Mathematics', active: true }],
      });
    }
    if (request.method() === 'GET' && path === '/grade-levels') {
      return json(route, {
        items: [
          {
            id: 'grade-10',
            code: 'GRADE_10',
            name: 'Grade 10',
            active: true,
            sortOrder: 10,
          },
        ],
      });
    }
    if (request.method() === 'GET' && path === '/tutors') {
      return json(route, [
        {
          listingId,
          tutorId,
          displayName: 'Teacher Anan',
          description: 'Algebra and geometry lessons tailored to the student.',
          experienceYears: 5,
          subject: 'Mathematics',
          grade: 'Grade 10',
          pricePerHour: 500,
          ratingAverage: 4.8,
          reviewCount: 24,
          verificationStatus: 'VERIFIED',
          nextAvailableAt: '2099-09-20T03:00:00.000Z',
        },
      ]);
    }

    return json(route, { message: `Unhandled quality request: ${request.method()} ${path}` }, 500);
  });
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}
