import { expect, test } from '@playwright/test';

import { reviewCopy } from '@/components/reviews/review-copy';

import type { BookingReview, BookingStatus } from '@/lib/api/types';
import type { Page } from '@playwright/test';

const BOOKING_ID = 'review-preview';
const PATH = `/dashboard/bookings/${BOOKING_ID}`;
const NOW = '2026-11-03T10:00:00.000Z';

// API fixtures only: no live account, booking, or database review is created.
async function setup(
  page: Page,
  options: {
    status?: BookingStatus;
    review?: BookingReview | null;
    getReviewStatus?: number;
    postStatus?: number;
    postCode?: string;
    loseResponse?: boolean;
  } = {},
) {
  const state = {
    status: options.status ?? 'COMPLETED',
    review: options.review ?? null,
    posts: [] as unknown[],
    getReviewCalls: 0,
    getReviewStatus: options.getReviewStatus ?? 200,
    postStatus: options.postStatus,
    postCode: options.postCode,
    loseResponse: options.loseResponse ?? false,
    unexpected: [] as string[],
  };
  await page.clock.install({ time: new Date(NOW) });
  await page.addInitScript(() => localStorage.setItem('hktutor-language', 'en'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page
    .context()
    .addCookies([{ name: 'hktutor_refresh', value: 'preview', url: 'http://localhost:3000' }]);
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    if (path.endsWith('/conversations/unread-count')) {
      return route.fulfill({ json: { unreadCount: 0 } });
    }
    if (path === '/notifications') {
      return route.fulfill({ json: { items: [], nextCursor: null, unreadCount: 0 } });
    }
    if (path === '/auth/refresh') {
      return route.fulfill({
        json: {
          accessToken: 'preview',
          user: {
            id: 'student-preview',
            role: 'STUDENT',
            email: 'preview@example.test',
            displayName: 'Preview',
          },
        },
      });
    }
    if (path === '/profiles/me') {
      return route.fulfill({
        json: {
          role: 'STUDENT',
          consentCurrent: true,
          policyVersion: '2026-01',
          profileComplete: true,
          profile: {
            firstName: 'Mint',
            lastName: 'Preview',
            nickname: 'Mint',
            school: 'Demo school',
            gradeLevel: 'Grade 10',
            phone: '0812345678',
          },
        },
      });
    }
    if (path === '/profiles/me/avatar') {
      return route.fulfill({ json: { avatar: null } });
    }
    if (path === '/bookings/me') {
      return route.fulfill({ json: { items: [], total: 0 } });
    }
    if (path === `/bookings/me/${BOOKING_ID}/payments/current`) {
      return route.fulfill({
        json: {
          bookingId: BOOKING_ID,
          paymentStatus: 'PAID',
          paymentPending: false,
          paidAt: NOW,
          reference: null,
          attempt: null,
        },
      });
    }
    if (path === `/bookings/me/${BOOKING_ID}`) {
      return route.fulfill({
        json: {
          id: BOOKING_ID,
          status: state.status,
          tutor: {
            tutorId: 'tutor-preview',
            displayName: 'Teacher Pim',
            verificationStatus: 'VERIFIED',
          },
          listing: {
            id: 'course',
            subjectId: 'math',
            subjectName: 'Mathematics',
            gradeLevelId: 'grade',
            gradeLevelName: 'Grade 10',
            pricePerHour: '500.00',
            description: 'Math',
          },
          slot: {
            id: 'slot',
            startAtUtc: '2026-11-01T08:00:00.000Z',
            endAtUtc: '2026-11-01T09:00:00.000Z',
          },
          subtotalAmount: '500.00',
          discountAmount: '0.00',
          netAmount: '500.00',
          currency: 'THB',
          paymentStatus: 'PAID',
          paidAt: NOW,
          mockReference: 'PREVIEW',
          createdAt: NOW,
          updatedAt: NOW,
        },
      });
    }
    if (path.endsWith('/reschedule-requests/current')) {
      return route.fulfill({ json: { request: null, targetSlot: null, allowedActions: [] } });
    }
    if (path === `/bookings/${BOOKING_ID}/class-details`) {
      return route.fulfill({
        json: {
          bookingId: BOOKING_ID,
          status: state.status,
          paymentStatus: 'PAID',
          startAt: '2026-11-01T08:00:00.000Z',
          endAt: '2026-11-01T09:00:00.000Z',
          subject: { id: 'math', name: 'Mathematics' },
          meetingUrl: null,
          attendance: 'ATTENDED',
          attendanceMarkedAt: NOW,
          participants: {
            tutor: { id: 'tutor-preview', detail: { displayName: 'Teacher Pim' } },
            student: {
              id: 'student-preview',
              detail: { firstName: 'Mint', lastName: 'Preview', nickname: 'Mint' },
            },
          },
        },
      });
    }
    if (path === `/bookings/me/${BOOKING_ID}/review` && request.method() === 'GET') {
      state.getReviewCalls += 1;
      if (state.getReviewStatus !== 200) {
        return route.fulfill({ status: state.getReviewStatus, json: { message: 'Rejected' } });
      }
      return route.fulfill({ json: { review: state.review } });
    }
    if (path === `/bookings/me/${BOOKING_ID}/reviews` && request.method() === 'POST') {
      const body: unknown = request.postDataJSON();
      state.posts.push(body);
      if (state.loseResponse) {
        return route.abort('failed');
      }
      if (state.postStatus) {
        // A concurrent submission becomes visible to the reconciling GET only once the
        // conflicting POST actually lands, matching the real race this recovers from.
        if (state.postCode === 'REVIEW_ALREADY_EXISTS') {
          state.review = {
            id: 'existing-review',
            clarity: 4,
            punctuality: 4,
            preparation: 4,
            overallRating: 4,
            feedback: 'Already submitted earlier',
            createdAt: NOW,
          };
        }
        return route.fulfill({
          status: state.postStatus,
          json: { message: 'Rejected', code: state.postCode },
        });
      }
      const created: BookingReview = {
        id: 'created-review',
        clarity: 5,
        punctuality: 4,
        preparation: 5,
        overallRating: 4.67,
        feedback:
          body && typeof body === 'object' && 'feedback' in body ? String(body.feedback) : '',
        createdAt: NOW,
      };
      state.review = created;
      return route.fulfill({ status: 201, json: { review: created } });
    }
    state.unexpected.push(`${request.method()} ${path}`);
    return route.fulfill({ status: 404, json: { message: 'Unexpected preview request' } });
  });
  await page.goto(PATH);
  const text = reviewCopy.en;
  await expect(page.getByText(text.loading, { exact: true })).toHaveCount(0);
  return { state, text };
}

test('shows the locked message for a booking that is not completed yet', async ({ page }) => {
  const { text } = await setup(page, { status: 'CONFIRMED' });
  await expect(page.getByText(text.locked, { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: text.title })).toHaveCount(0);
});

test('disables submit until all ratings and feedback are valid, then submits successfully', async ({
  page,
}) => {
  const { state, text } = await setup(page);
  const submit = page.getByRole('button', { name: text.submit, exact: true });
  await expect(submit).toBeDisabled();

  await page
    .getByRole('radio', { name: `${text.clarityLegend} 5 ${text.ratingOption}`, exact: true })
    .check();
  await page
    .getByRole('radio', { name: `${text.punctualityLegend} 4 ${text.ratingOption}`, exact: true })
    .check();
  await page
    .getByRole('radio', { name: `${text.preparationLegend} 5 ${text.ratingOption}`, exact: true })
    .check();
  await expect(submit).toBeDisabled();

  const feedback = page.getByLabel(text.feedbackLabel, { exact: true });
  await feedback.fill('Great class, very clear explanations.');
  await expect(submit).toBeEnabled();

  await submit.click();
  await expect(page.getByText(text.savedTitle, { exact: true })).toBeVisible();
  await expect(page.getByText('Great class, very clear explanations.')).toBeVisible();
  await expect(page.getByText('4.67 / 5')).toBeVisible();
  expect(state.posts).toEqual([
    {
      clarity: 5,
      punctuality: 4,
      preparation: 5,
      feedback: 'Great class, very clear explanations.',
    },
  ]);

  await page.reload();
  await expect(page.getByText(text.savedTitle, { exact: true })).toBeVisible();
  await expect(page.getByText('Great class, very clear explanations.')).toBeVisible();
  expect(state.posts).toHaveLength(1);
});

test('arrow keys move the selection within one rating group without crossing into another', async ({
  page,
}) => {
  const { text } = await setup(page);
  const clarity3 = page.getByRole('radio', {
    name: `${text.clarityLegend} 3 ${text.ratingOption}`,
    exact: true,
  });
  await clarity3.focus();
  await clarity3.press('ArrowRight');
  await expect(
    page.getByRole('radio', { name: `${text.clarityLegend} 4 ${text.ratingOption}`, exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole('radio', {
      name: `${text.punctualityLegend} 4 ${text.ratingOption}`,
      exact: true,
    }),
  ).not.toBeChecked();

  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('radio', {
      name: `${text.punctualityLegend} 1 ${text.ratingOption}`,
      exact: true,
    }),
  ).toBeFocused();
});

test('invalid feedback shows an inline error and keeps submit disabled', async ({ page }) => {
  const { text } = await setup(page);
  await page
    .getByRole('radio', { name: `${text.clarityLegend} 5 ${text.ratingOption}`, exact: true })
    .check();
  await page
    .getByRole('radio', { name: `${text.punctualityLegend} 5 ${text.ratingOption}`, exact: true })
    .check();
  await page
    .getByRole('radio', { name: `${text.preparationLegend} 5 ${text.ratingOption}`, exact: true })
    .check();
  const feedback = page.getByLabel(text.feedbackLabel, { exact: true });
  await feedback.fill('   ');
  await feedback.blur();
  await expect(page.getByRole('alert').filter({ hasText: text.feedbackBlank })).toBeVisible();
  await expect(page.getByRole('button', { name: text.submit, exact: true })).toBeDisabled();
});

test('a 403 from the review read shows the forbidden message instead of a crash', async ({
  page,
}) => {
  const { text } = await setup(page, { getReviewStatus: 403 });
  await expect(page.getByText(text.failed, { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: text.title })).toHaveCount(0);
});

test('a duplicate 409 reconciles by reading back the already-saved review', async ({ page }) => {
  const { state, text } = await setup(page, { postStatus: 409, postCode: 'REVIEW_ALREADY_EXISTS' });
  await page
    .getByRole('radio', { name: `${text.clarityLegend} 5 ${text.ratingOption}`, exact: true })
    .check();
  await page
    .getByRole('radio', { name: `${text.punctualityLegend} 5 ${text.ratingOption}`, exact: true })
    .check();
  await page
    .getByRole('radio', { name: `${text.preparationLegend} 5 ${text.ratingOption}`, exact: true })
    .check();
  await page.getByLabel(text.feedbackLabel, { exact: true }).fill('Trying again');
  await page.getByRole('button', { name: text.submit, exact: true }).click();
  await expect(page.getByText(text.savedTitle, { exact: true })).toBeVisible();
  await expect(page.getByText('Already submitted earlier')).toBeVisible();
  expect(state.posts).toHaveLength(1);
});

test('an uncertain (lost response) submission preserves input and does not auto-resend', async ({
  page,
}) => {
  const { state, text } = await setup(page, { loseResponse: true });
  await page
    .getByRole('radio', { name: `${text.clarityLegend} 5 ${text.ratingOption}`, exact: true })
    .check();
  await page
    .getByRole('radio', { name: `${text.punctualityLegend} 5 ${text.ratingOption}`, exact: true })
    .check();
  await page
    .getByRole('radio', { name: `${text.preparationLegend} 5 ${text.ratingOption}`, exact: true })
    .check();
  const feedback = page.getByLabel(text.feedbackLabel, { exact: true });
  await feedback.fill('Network will drop this response');
  await page.getByRole('button', { name: text.submit, exact: true }).click();
  await expect(page.getByText(text.uncertainFailed, { exact: true })).toBeVisible();
  await expect(feedback).toHaveValue('Network will drop this response');
  expect(state.posts).toHaveLength(1);

  state.loseResponse = false;
  await page.getByRole('button', { name: text.submit, exact: true }).click();
  await expect(page.getByText(text.savedTitle, { exact: true })).toBeVisible();
  expect(state.posts).toHaveLength(2);
});
