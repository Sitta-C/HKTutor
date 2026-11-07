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
    saveBeforeResponseLoss?: boolean;
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
    saveBeforeResponseLoss: options.saveBeforeResponseLoss ?? false,
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
      if (state.loseResponse && !state.saveBeforeResponseLoss) {
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
      if (state.loseResponse) {
        return route.abort('failed');
      }
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

for (const status of ['PENDING', 'CONFIRMED', 'CANCELED', 'EXPIRED'] as const) {
  test(`keeps the review form locked for a ${status} booking`, async ({ page }) => {
    const { state, text } = await setup(page, { status });
    await expect(page.getByText(text.locked, { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: text.title })).toHaveCount(0);
    expect(state.getReviewCalls).toBe(0);
    expect(state.posts).toEqual([]);
  });
}

test('shows validation errors for missing ratings and feedback on submit, then submits successfully', async ({
  page,
}) => {
  const { state, text } = await setup(page);
  const submit = page.getByRole('button', { name: text.submit, exact: true });
  await expect(submit).toBeEnabled();

  // Clicking with nothing filled in surfaces both field-level errors rather than doing nothing.
  await submit.click();
  await expect(page.getByText(text.ratingsRequired, { exact: true })).toBeVisible();
  await expect(page.getByText(text.feedbackBlank, { exact: true })).toBeVisible();
  expect(state.posts).toEqual([]);

  await page
    .getByRole('radio', { name: `${text.clarityLegend} 5 ${text.ratingOption}`, exact: true })
    .check();
  await page
    .getByRole('radio', { name: `${text.punctualityLegend} 4 ${text.ratingOption}`, exact: true })
    .check();
  await page
    .getByRole('radio', { name: `${text.preparationLegend} 5 ${text.ratingOption}`, exact: true })
    .check();
  await expect(page.getByText(text.ratingsRequired, { exact: true })).toHaveCount(0);
  expect(state.posts).toEqual([]);

  const feedback = page.getByLabel(text.feedbackLabel, { exact: true });
  await feedback.fill('Great class, very clear explanations.');
  await expect(page.getByText(text.feedbackBlank, { exact: true })).toHaveCount(0);

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

test('invalid feedback shows an inline error and blocks submission', async ({ page }) => {
  const { state, text } = await setup(page);
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

  await page.getByRole('button', { name: text.submit, exact: true }).click();
  expect(state.posts).toEqual([]);
  await expect(page.getByRole('alert').filter({ hasText: text.feedbackBlank })).toBeVisible();
});

test('rejects 1001 astral code points and sends exactly 1000 after trimming', async ({ page }) => {
  const { state, text } = await setup(page);
  await selectRatings(page);
  const feedback = page.getByLabel(text.feedbackLabel, { exact: true });
  const limit = '😀'.repeat(1000);
  await feedback.fill(limit + '😀');
  await feedback.blur();
  await expect(page.getByRole('alert').filter({ hasText: text.feedbackTooLong })).toBeVisible();
  const submit = page.getByRole('button', { name: text.submit, exact: true });
  await submit.click();
  expect(state.posts).toEqual([]);

  await feedback.fill(`  ${limit}  `);
  await submit.click();
  await expect(page.getByText(text.savedTitle, { exact: true })).toBeVisible();
  expect(state.posts).toEqual([{ clarity: 5, punctuality: 4, preparation: 5, feedback: limit }]);
});

test('a 403 from the review read shows the forbidden message instead of a crash', async ({
  page,
}) => {
  const { text } = await setup(page, { getReviewStatus: 403 });
  await expect(page.getByText(text.forbidden, { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: text.title })).toHaveCount(0);
});

test('a 404 from the review read shows the not-found message instead of a crash', async ({
  page,
}) => {
  const { text } = await setup(page, { getReviewStatus: 404 });
  await expect(page.getByText(text.notFound, { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: text.title })).toHaveCount(0);
});

test('an initial load error offers retry, which recovers without resubmitting', async ({
  page,
}) => {
  const { state, text } = await setup(page, { getReviewStatus: 503 });
  await expect(page.getByText(text.loadFailed, { exact: true })).toBeVisible();
  const callsBeforeRetry = state.getReviewCalls;
  state.getReviewStatus = 200;
  await page.getByRole('button', { name: text.retry, exact: true }).click();
  await expect(page.getByRole('heading', { name: text.title })).toBeVisible();
  expect(state.getReviewCalls).toBeGreaterThan(callsBeforeRetry);
  expect(state.posts).toHaveLength(0);
});

test('a confirmed saved review survives a failed reconciliation GET', async ({ page }) => {
  const { state, text } = await setup(page);
  await page
    .getByRole('radio', { name: `${text.clarityLegend} 5 ${text.ratingOption}`, exact: true })
    .check();
  await page
    .getByRole('radio', { name: `${text.punctualityLegend} 5 ${text.ratingOption}`, exact: true })
    .check();
  await page
    .getByRole('radio', { name: `${text.preparationLegend} 5 ${text.ratingOption}`, exact: true })
    .check();
  await page.getByLabel(text.feedbackLabel, { exact: true }).fill('Submitted just before a 503');
  // The reconciling GET fired by onSaved sees this 503, not the 200 the mount GET already saw.
  state.getReviewStatus = 503;
  await page.getByRole('button', { name: text.submit, exact: true }).click();
  await expect(page.getByText(text.savedTitle, { exact: true })).toBeVisible();
  await expect(page.getByText('Submitted just before a 503')).toBeVisible();
  await expect(page.getByText(text.loadFailed, { exact: true })).toHaveCount(0);
});

test('a wrong-owner 403 on submit shows the forbidden message and preserves the input', async ({
  page,
}) => {
  const { state, text } = await setup(page, { postStatus: 403 });
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
  await feedback.fill('Written by the wrong student');
  await page.getByRole('button', { name: text.submit, exact: true }).click();
  // Scoped to the form's own region: the same text also appears in a transient toast.
  await expect(
    page.getByRole('region', { name: text.title }).getByText(text.forbidden, { exact: true }),
  ).toBeVisible();
  await expect(feedback).toHaveValue('Written by the wrong student');
  await expect(page.getByText(text.savedTitle, { exact: true })).toHaveCount(0);
  expect(state.posts).toHaveLength(1);
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
  state.getReviewStatus = 503;
  await page.getByRole('button', { name: text.submit, exact: true }).click();
  await expect(page.getByText(text.uncertainFailed, { exact: true })).toBeVisible();
  await expect(feedback).toHaveValue('Network will drop this response');
  expect(state.posts).toHaveLength(1);

  state.loseResponse = false;
  state.getReviewStatus = 200;
  await page.getByRole('button', { name: text.submit, exact: true }).click();
  await expect(page.getByText(text.savedTitle, { exact: true })).toBeVisible();
  expect(state.posts).toHaveLength(2);
  expect(state.posts[1]).toEqual(state.posts[0]);
});

test('a lost response after saving shows canonical feedback as inert text without resending', async ({
  page,
}) => {
  const { state, text } = await setup(page, { loseResponse: true, saveBeforeResponseLoss: true });
  await selectRatings(page);
  const markup =
    '<img data-review-probe src="/missing-review-image" onerror="document.body.dataset.reviewExecuted=1">';
  await page.getByLabel(text.feedbackLabel, { exact: true }).fill(markup);
  const callsBeforeSubmit = state.getReviewCalls;
  await page.getByRole('button', { name: text.submit, exact: true }).click();

  await expect(page.getByText(text.savedTitle, { exact: true })).toBeVisible();
  await expect(page.getByText(markup, { exact: true })).toBeVisible();
  await expect(page.locator('img[data-review-probe], body[data-review-executed]')).toHaveCount(0);
  expect(state.getReviewCalls).toBeGreaterThan(callsBeforeSubmit);
  expect(state.posts).toEqual([{ clarity: 5, punctuality: 4, preparation: 5, feedback: markup }]);
});

async function selectRatings(page: Page): Promise<void> {
  const text = reviewCopy.en;
  for (const [legend, rating] of [
    [text.clarityLegend, 5],
    [text.punctualityLegend, 4],
    [text.preparationLegend, 5],
  ]) {
    await page
      .getByRole('radio', { name: `${legend} ${rating} ${text.ratingOption}`, exact: true })
      .check();
  }
}
