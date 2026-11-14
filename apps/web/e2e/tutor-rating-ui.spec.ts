import { expect, test } from '@playwright/test';

import type { TutorProfile, TutorSearchResult } from '@/lib/api/types';
import type { Locator } from '@playwright/test';

const profile: TutorProfile = {
  firstName: 'Anna',
  lastName: 'Example',
  nickname: 'Anna',
  displayName: 'Teacher Anna',
  bio: 'Clear explanations with guided practice.',
  experienceYears: 5,
  verificationStatus: 'VERIFIED',
  ratingAverage: '4.33',
  reviewCount: 2,
};

const course: TutorSearchResult = {
  tutorId: 'rating-tutor',
  listingId: 'rating-course',
  displayName: profile.displayName,
  description: 'Clear explanations with guided practice.',
  experienceYears: 5,
  verificationStatus: 'VERIFIED',
  subject: 'Mathematics',
  grade: 'Grade 10',
  pricePerHour: 450,
  ratingAverage: 4.33,
  reviewCount: 2,
  recommendationTags: [],
  nextAvailableAt: null,
};

async function expectFits(summary: Locator): Promise<void> {
  const fits = await summary.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return (
      rect.left >= 0 &&
      rect.right <= window.innerWidth &&
      element.scrollWidth <= element.clientWidth &&
      [...element.querySelectorAll('*')].every((child) => {
        const childRect = child.getBoundingClientRect();
        return childRect.width === 0 || childRect.right <= rect.right + 1;
      })
    );
  });
  expect(fits).toBe(true);
}

for (const width of [320, 768, 1440]) {
  for (const language of ['th', 'en'] as const) {
    test(`Margin Score uses persisted metadata across surfaces (${language}, ${width}px)`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(60_000);
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.context().addCookies([
        {
          name: 'hktutor_refresh',
          value: 'rating-preview-session',
          url: 'http://localhost:3000',
        },
      ]);
      await page.addInitScript(
        (value) => localStorage.setItem('hktutor-language', value),
        language,
      );

      let fresh = false;
      const unexpectedWrites: string[] = [];
      // Synthetic UI fixtures only; no request reaches a project database.
      await page.route('**/api/v1/**', async (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname.replace('/api/v1', '');
        if (request.method() !== 'GET' && path !== '/auth/refresh') {
          unexpectedWrites.push(`${request.method()} ${path}`);
        }
        const metadata = fresh
          ? { ratingAverage: null, reviewCount: 0 }
          : { ratingAverage: 4.33, reviewCount: 2 };
        let body: unknown;
        if (path === '/auth/refresh') {
          body = {
            accessToken: 'rating-preview-token',
            user: {
              id: 'rating-tutor',
              email: 'rating@example.test',
              role: 'TUTOR',
              displayName: profile.displayName,
            },
          };
        } else if (path === '/profiles/me') {
          body = {
            role: 'TUTOR',
            consentCurrent: true,
            profileComplete: true,
            policyVersion: '2026-01',
            profile: {
              ...profile,
              ratingAverage: fresh ? null : '4.33',
              reviewCount: metadata.reviewCount,
            },
          };
        } else if (path === '/subjects') {
          body = { items: [{ id: 'math', code: 'MATH', name: 'Mathematics', active: true }] };
        } else if (path === '/grade-levels') {
          body = {
            items: [{ id: 'g10', code: 'G10', name: 'Grade 10', active: true, sortOrder: 1 }],
          };
        } else if (path === '/tutors') {
          body = {
            items: [{ ...course, ...metadata }],
            total: 1,
            page: 1,
            pageSize: 10,
            totalPages: 1,
          };
        } else if (path === '/tutors/rating-tutor') {
          body = { tutor: { ...course, ...metadata, bio: profile.bio }, listings: [course] };
        } else if (path === '/tutors/rating-tutor/availability') {
          body = [];
        } else if (path === '/tutors/rating-tutor/reviews') {
          body = { items: [], nextCursor: null };
        } else if (path === '/conversations/unread-count') {
          body = { unreadCount: 0 };
        } else if (path === '/notifications/unread-count') {
          body = { unreadCount: 0 };
        } else if (path === '/notifications') {
          body = { items: [], nextCursor: null, unreadCount: 0 };
        } else {
          return route.fulfill({ status: 404, json: { message: 'Not found' } });
        }
        return route.fulfill({ json: body });
      });

      for (const path of [
        '/tutors',
        '/tutors/rating-tutor',
        '/dashboard/profile',
        '/dashboard/listings/new',
      ]) {
        fresh = false;
        await page.goto(path);
        const summaries = page.locator('main [data-tutor-rating]');
        await expect(summaries).toHaveCount(path === '/dashboard/profile' ? 2 : 1);
        for (const summary of await summaries.all()) {
          await expect(summary).toHaveAttribute('data-tutor-rating', 'rated');
          await expect(summary.getByRole('img')).toHaveAccessibleName(
            language === 'th' ? 'คะแนน 4.33 จาก 5' : 'Rated 4.33 out of 5',
          );
          await expect(
            summary.getByText(language === 'th' ? '2 รีวิว' : '2 reviews'),
          ).toBeVisible();
          await expectFits(summary);
        }
        if (language === 'th' && (width === 320 || width === 1440)) {
          await page.screenshot({
            path: testInfo.outputPath(`margin-score-${path.replaceAll('/', '-')}-${width}.png`),
            fullPage: true,
          });
        }

        fresh = true;
        await page.reload();
        await expect(summaries).toHaveCount(path === '/dashboard/profile' ? 2 : 1);
        for (const summary of await summaries.all()) {
          await expect(summary).toHaveAttribute('data-tutor-rating', 'new');
          await expect(
            summary.getByText(language === 'th' ? 'ติวเตอร์ใหม่' : 'New tutor'),
          ).toBeVisible();
          await expect(
            summary.getByText(language === 'th' ? '0 รีวิว' : '0 reviews'),
          ).toBeVisible();
          await expect(summary.getByRole('img')).toHaveCount(0);
          await expect(summary).not.toContainText('0.00');
          await expectFits(summary);
        }
      }
      expect(unexpectedWrites).toEqual([]);
    });
  }
}
