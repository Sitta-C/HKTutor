import { expect, test } from '@playwright/test';

import { classDetailsCopy } from '@/components/bookings/class-details-copy';

import type { BookingClassDetails, BookingStatus } from '@/lib/api/types';
import type { Page } from '@playwright/test';

const BOOKING_ID = 'classroom-preview';
const PATH = `/dashboard/bookings/${BOOKING_ID}`;
const OLD_URL = 'https://meet.google.com/old-classroom';
const NEW_URL = 'https://meet.google.com/new-classroom';

// All API requests are intercepted; no live booking, database or account is changed.
async function setup(
  page: Page,
  options: {
    role?: 'STUDENT' | 'TUTOR';
    language?: 'th' | 'en';
    status?: BookingStatus;
    meetingUrl?: string | null;
    gate?: Promise<void>;
  } = {},
) {
  const role = options.role ?? 'TUTOR';
  const details: BookingClassDetails = {
    bookingId: BOOKING_ID,
    status: options.status ?? 'CONFIRMED',
    startAt: '2026-10-18T17:30:00.000Z',
    endAt: '2026-10-18T18:30:00.000Z',
    subject: { id: 'math', name: 'Mathematics' },
    meetingUrl: options.meetingUrl === undefined ? OLD_URL : options.meetingUrl,
    attendance: null,
    participants: {
      tutor: { id: 'tutor-preview', detail: { displayName: 'Teacher Pim' } },
      student: {
        id: 'student-preview',
        detail: { firstName: 'Mint', lastName: 'Preview', nickname: 'Mint' },
      },
    },
  };
  const state = {
    details,
    reads: 0,
    writes: [] as unknown[],
    readFailure: 0,
    saveFailure: 0,
    loseResponse: false,
    unexpected: [] as string[],
  };
  await page.addInitScript(
    (language) => localStorage.setItem('hktutor-language', language),
    options.language ?? 'en',
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page
    .context()
    .addCookies([{ name: 'hktutor_refresh', value: 'preview-only', url: 'http://localhost:3000' }]);
  const listing = {
    id: 'listing-preview',
    subjectId: 'math',
    subjectName: 'Mathematics',
    gradeLevelId: 'grade-10',
    gradeLevelName: 'Grade 10',
    pricePerHour: '500.00',
    description: 'Math lesson',
  };
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    if (path === '/auth/refresh') {
      return route.fulfill({
        json: {
          accessToken: 'preview',
          user: {
            id: `${role.toLowerCase()}-preview`,
            role,
            email: 'user@example.test',
            displayName: 'Preview',
          },
        },
      });
    }
    if (path === '/profiles/me') {
      return route.fulfill({
        json: {
          role,
          consentCurrent: true,
          policyVersion: '2026-01',
          profileComplete: true,
          profile:
            role === 'TUTOR'
              ? {
                  firstName: 'Pim',
                  lastName: 'Preview',
                  nickname: 'Pim',
                  displayName: 'Teacher Pim',
                  bio: 'Math tutor',
                  experienceYears: 5,
                  verificationStatus: 'VERIFIED',
                }
              : {
                  firstName: 'Mint',
                  lastName: 'Preview',
                  nickname: 'Mint',
                  school: 'Demo',
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
    if (path === `/bookings/me/${BOOKING_ID}`) {
      return route.fulfill({
        json: {
          id: BOOKING_ID,
          status: state.details.status,
          tutor: {
            tutorId: 'tutor-preview',
            displayName: 'Teacher Pim',
            verificationStatus: 'VERIFIED',
          },
          listing,
          slot: {
            id: 'slot-preview',
            startAtUtc: state.details.startAt,
            endAtUtc: state.details.endAt,
          },
          subtotalAmount: '500.00',
          discountAmount: '0.00',
          netAmount: '500.00',
          currency: 'THB',
          paymentStatus: 'PAID',
          paidAt: '2026-10-17T08:00:00.000Z',
          mockReference: 'PREVIEW',
          createdAt: '2026-10-17T08:00:00.000Z',
          updatedAt: '2026-10-17T08:00:00.000Z',
        },
      });
    }
    if (path === `/bookings/${BOOKING_ID}/reschedule-requests/current`) {
      return route.fulfill({ json: { request: null, targetSlot: null, allowedActions: [] } });
    }
    if (path === `/bookings/${BOOKING_ID}/class-details`) {
      state.reads += 1;
      const status = state.readFailure || 200;
      return route.fulfill({
        status,
        json:
          status === 200
            ? {
                ...state.details,
                meetingUrl: ['CONFIRMED', 'COMPLETED'].includes(state.details.status)
                  ? state.details.meetingUrl
                  : null,
              }
            : { message: 'Unavailable' },
      });
    }
    if (path === `/bookings/tutor/${BOOKING_ID}/meeting-link` && request.method() === 'PUT') {
      const body: unknown = request.postDataJSON();
      state.writes.push(body);
      await options.gate;
      const failure =
        state.saveFailure || (['CONFIRMED', 'COMPLETED'].includes(state.details.status) ? 0 : 409);
      if (failure) {
        return route.fulfill({ status: failure, json: { message: 'Rejected' } });
      }
      if (
        typeof body !== 'object' ||
        body === null ||
        !('meetingUrl' in body) ||
        typeof body.meetingUrl !== 'string'
      ) {
        throw new Error('Invalid meeting payload');
      }
      state.details.meetingUrl = body.meetingUrl;
      if (state.loseResponse) {
        return route.abort('failed');
      }
      return route.fulfill({
        json: {
          bookingId: BOOKING_ID,
          meetingUrl: body.meetingUrl,
          updatedAt: '2026-10-17T09:00:00.000Z',
        },
      });
    }
    state.unexpected.push(`${request.method()} ${path}`);
    return route.fulfill({ status: 404, json: { message: 'Unexpected preview request' } });
  });
  return state;
}

for (const language of ['th', 'en'] as const) {
  const text = classDetailsCopy[language];
  test(`${language}: tutor validates, saves once, and reloads the persisted link`, async ({
    page,
  }) => {
    let release = () => {};
    const state = await setup(page, {
      language,
      meetingUrl: null,
      gate: new Promise<void>((resolve) => {
        release = resolve;
      }),
    });
    await page.goto(PATH);
    const panel = page.getByRole('region', { name: text.title });
    await expect(panel.getByText(text.missing)).toBeVisible();
    await expect(panel).toContainText('Teacher Pim');
    await expect(panel).toContainText('Mathematics');
    await expect(panel).toContainText('00:30');
    await expect(panel).toContainText('01:30');
    await expect(panel.locator('time').first()).toHaveAttribute('datetime', state.details.startAt);
    await expect(panel).toContainText(language === 'th' ? '2569' : '2026');
    await expect(panel.locator('time').first()).toContainText('19');
    const input = panel.getByLabel(text.label, { exact: true });
    await input.fill('javascript:alert(1)');
    await panel.getByRole('button', { name: text.save, exact: true }).click();
    await expect(panel.getByRole('alert')).toHaveText(text.invalid);
    await expect(input).toBeFocused();
    expect(state.writes).toHaveLength(0);
    await input.fill(`  ${NEW_URL}  `);
    await panel.getByRole('button', { name: text.save, exact: true }).click();
    await expect(panel.getByRole('button', { name: text.saving })).toBeDisabled();
    await expect(panel.getByRole('button', { name: text.refresh })).toBeDisabled();
    expect(state.writes).toEqual([{ meetingUrl: NEW_URL }]);
    await expect(panel.getByRole('link')).toHaveCount(0);
    release();
    const link = panel.getByRole('link', { name: text.join });
    await expect(link).toHaveAttribute('href', NEW_URL);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(page.getByText(text.success, { exact: true })).toBeVisible();
    await page.reload();
    await expect(link).toHaveAttribute('href', NEW_URL);
    expect(state.writes).toHaveLength(1);
    expect(state.unexpected).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
  test(`${language}: student reads completed class links without an editor`, async ({ page }) => {
    const state = await setup(page, { language, role: 'STUDENT', status: 'COMPLETED' });
    await page.goto(PATH);
    const panel = page.getByRole('region', { name: text.title });
    await expect(panel.getByRole('link', { name: text.join })).toHaveAttribute('href', OLD_URL);
    await expect(panel).toContainText(text.completed);
    await expect(panel.getByLabel(text.label, { exact: true })).toHaveCount(0);
    expect(state.writes).toHaveLength(0);
    expect(state.unexpected).toEqual([]);
  });
}

for (const role of ['STUDENT', 'TUTOR'] as const) {
  for (const status of ['PENDING', 'CANCELED', 'EXPIRED'] as const) {
    test(`${role} reads class details but hides stored links for ${status}`, async ({ page }) => {
      const state = await setup(page, { role, status });
      await page.goto(PATH);
      const panel = page.getByRole('region', { name: 'Classroom details' });
      await expect(panel).toContainText(classDetailsCopy.en.hidden);
      await expect(panel.getByRole('link')).toHaveCount(0);
      await expect(panel).toContainText('Mathematics');
      await expect(panel).toContainText('Teacher Pim');
      await expect(panel).toContainText('00:30');
      await expect(panel.getByLabel(classDetailsCopy.en.label, { exact: true })).toHaveCount(0);
      expect(state.reads).toBeGreaterThan(0);
      expect(state.writes).toHaveLength(0);
    });
  }
}
for (const failure of [403, 404, 409, 500]) {
  test(`locks after save ${failure}, clears the old link and refreshes before another save`, async ({
    page,
  }) => {
    const state = await setup(page);
    await page.goto(PATH);
    const panel = page.getByRole('region', { name: 'Classroom details' });
    await expect(panel.getByRole('link')).toHaveAttribute('href', OLD_URL);
    state.saveFailure = failure;
    await panel.getByLabel('Meeting link', { exact: true }).fill(NEW_URL);
    await panel.getByRole('button', { name: 'Save meeting link', exact: true }).click();
    await expect(panel.getByRole('alert')).toBeVisible();
    await expect(panel.getByRole('link')).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Save meeting link', exact: true })).toHaveCount(
      0,
    );
    expect(state.details.meetingUrl).toBe(OLD_URL);
    state.readFailure = 500;
    await panel.getByRole('button', { name: 'Load latest class details' }).click();
    await expect(panel.getByRole('alert')).toContainText(classDetailsCopy.en.failed);
    await expect(panel.getByLabel('Meeting link', { exact: true })).toHaveCount(0);
    state.readFailure = 0;
    state.details.status = 'CANCELED';
    await panel.getByRole('button', { name: 'Load latest class details' }).click();
    await expect(panel).toContainText(classDetailsCopy.en.hidden);
    await expect(panel).toContainText('Mathematics');
    await expect(panel.getByRole('link')).toHaveCount(0);
    await expect(panel.getByLabel('Meeting link', { exact: true })).toHaveCount(0);
    expect(state.writes).toHaveLength(1);
  });
}
test('lost save response hides the stale link until the persisted result is read', async ({
  page,
}) => {
  const state = await setup(page);
  state.loseResponse = true;
  await page.goto(PATH);
  const panel = page.getByRole('region', { name: 'Classroom details' });
  await panel.getByLabel('Meeting link', { exact: true }).fill(NEW_URL);
  await panel.getByRole('button', { name: 'Save meeting link', exact: true }).click();
  await expect(panel.getByRole('alert')).toHaveText(classDetailsCopy.en.uncertain);
  await expect(panel.getByRole('link')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Load latest class details' }).click();
  await expect(panel.getByRole('link')).toHaveAttribute('href', NEW_URL);
  expect(state.writes).toHaveLength(1);
});

test('a booking canceled during save keeps the persisted URL and hides stale actions', async ({
  page,
}) => {
  let release = () => {};
  const state = await setup(page, {
    gate: new Promise<void>((resolve) => {
      release = resolve;
    }),
  });
  await page.goto(PATH);
  const panel = page.getByRole('region', { name: classDetailsCopy.en.title });
  await panel.getByLabel(classDetailsCopy.en.label, { exact: true }).fill(NEW_URL);
  await panel.getByRole('button', { name: classDetailsCopy.en.save, exact: true }).click();
  await expect(panel.getByRole('button', { name: classDetailsCopy.en.saving })).toBeDisabled();
  state.details.status = 'CANCELED';
  release();
  await expect(panel.getByRole('alert')).toBeVisible();
  await expect(panel.getByRole('link')).toHaveCount(0);
  await expect(panel.getByLabel(classDetailsCopy.en.label, { exact: true })).toHaveCount(0);
  expect(state.details.meetingUrl).toBe(OLD_URL);
  await panel.getByRole('button', { name: classDetailsCopy.en.refresh }).click();
  await expect(panel).toContainText(classDetailsCopy.en.hidden);
  await expect(panel).toContainText('Mathematics');
  expect(state.writes).toEqual([{ meetingUrl: NEW_URL }]);
});

for (const status of [403, 404, 409]) {
  test(`shows initial ${status} without classroom contents`, async ({ page }) => {
    const state = await setup(page);
    state.readFailure = status;
    await page.goto(PATH);
    const panel = page.getByRole('region', { name: 'Classroom details' });
    await expect(panel.getByRole('alert')).toHaveText(
      status === 403
        ? classDetailsCopy.en.forbidden
        : status === 404
          ? classDetailsCopy.en.notFound
          : classDetailsCopy.en.hidden,
    );
    await expect(panel.getByRole('link')).toHaveCount(0);
    await expect(panel.getByLabel('Meeting link', { exact: true })).toHaveCount(0);
  });
}
test('does not render an unsafe stored URL as a link', async ({ page }) => {
  await setup(page, { meetingUrl: 'javascript:alert(1)' });
  await page.goto(PATH);
  const panel = page.getByRole('region', { name: 'Classroom details' });
  await expect(panel).toContainText(classDetailsCopy.en.invalid);
  await expect(panel.getByRole('link')).toHaveCount(0);
});

test('student sees a missing link in a confirmed class', async ({ page }) => {
  await setup(page, { role: 'STUDENT', meetingUrl: null });
  await page.goto(PATH);
  const panel = page.getByRole('region', { name: 'Classroom details' });
  await expect(panel).toContainText(classDetailsCopy.en.missing);
  await expect(panel.getByLabel('Meeting link', { exact: true })).toHaveCount(0);
});

test('tutor reads and updates completed meeting links using the existing API', async ({ page }) => {
  const state = await setup(page, { status: 'COMPLETED' });
  await page.goto(PATH);
  const panel = page.getByRole('region', { name: 'Classroom details' });
  await expect(panel.getByRole('link')).toHaveAttribute('href', OLD_URL);
  await panel.getByLabel('Meeting link', { exact: true }).fill(NEW_URL);
  await panel.getByRole('button', { name: 'Save meeting link', exact: true }).click();
  await expect(panel.getByRole('link')).toHaveAttribute('href', NEW_URL);
  expect(state.details.status).toBe('COMPLETED');
  expect(state.writes).toEqual([{ meetingUrl: NEW_URL }]);
});

test('server validation errors retain the draft and focus the input', async ({ page }) => {
  const state = await setup(page);
  state.saveFailure = 400;
  await page.goto(PATH);
  const panel = page.getByRole('region', { name: 'Classroom details' });
  const input = panel.getByLabel('Meeting link', { exact: true });
  await input.fill(NEW_URL);
  await panel.getByRole('button', { name: 'Save meeting link', exact: true }).click();
  await expect(panel.getByRole('alert')).toHaveText(classDetailsCopy.en.invalid);
  await expect(input).toHaveValue(NEW_URL);
  await expect(input).toBeFocused();
  await expect(panel.getByRole('link')).toHaveAttribute('href', OLD_URL);
  state.saveFailure = 0;
  await panel.getByRole('button', { name: 'Save meeting link', exact: true }).click();
  await expect(panel.getByRole('link')).toHaveAttribute('href', NEW_URL);
  expect(state.writes).toHaveLength(2);
});

test('a failed read after a successful save hides the old link until recovery', async ({
  page,
}) => {
  const state = await setup(page);
  await page.goto(PATH);
  const panel = page.getByRole('region', { name: 'Classroom details' });
  await panel.getByLabel('Meeting link', { exact: true }).fill(NEW_URL);
  state.readFailure = 500;
  await panel.getByRole('button', { name: 'Save meeting link', exact: true }).click();
  await expect(panel.getByRole('alert')).toHaveText(classDetailsCopy.en.failed);
  await expect(panel.getByRole('link')).toHaveCount(0);
  await expect(panel.getByLabel('Meeting link', { exact: true })).toHaveCount(0);
  state.readFailure = 0;
  await panel.getByRole('button', { name: 'Load latest class details' }).click();
  await expect(panel.getByRole('link')).toHaveAttribute('href', NEW_URL);
  expect(state.writes).toHaveLength(1);
});

test('Thai editor fits a 320px screen with a long meeting URL', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await setup(page, { language: 'th', meetingUrl: `https://example.test/${'meeting'.repeat(30)}` });
  await page.goto(PATH);
  const panel = page.getByRole('region', { name: classDetailsCopy.th.title });
  await expect(panel.getByLabel(classDetailsCopy.th.label, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath('classroom-320.png'), fullPage: true });
});
