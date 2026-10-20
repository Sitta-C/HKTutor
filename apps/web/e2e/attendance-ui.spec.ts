import { expect, test } from '@playwright/test';

import { classDetailsCopy } from '@/components/bookings/class-details-copy';

import type { AttendanceStatus, BookingClassDetails, BookingStatus } from '@/lib/api/types';
import type { Page } from '@playwright/test';

const BOOKING_ID = 'attendance-preview';
const PATH = `/dashboard/bookings/${BOOKING_ID}`;
const NOW = '2026-10-17T10:00:00.000Z';
const ORIGINAL_RECEIPT = '2026-10-17T09:30:00.000Z';

// API fixtures only: no live account, booking, or database attendance is modified.
async function setup(
  page: Page,
  options: {
    language?: 'en' | 'th';
    role?: 'STUDENT' | 'TUTOR';
    status?: BookingStatus;
    paymentStatus?: 'PAID' | 'UNPAID';
    attendance?: AttendanceStatus | null;
    owner?: boolean;
    endAt?: string;
    writeFailure?: number;
  } = {},
) {
  const role = options.role ?? 'TUTOR';
  const text = classDetailsCopy[options.language ?? 'en'];
  const details: BookingClassDetails = {
    bookingId: BOOKING_ID,
    status: options.status ?? 'CONFIRMED',
    paymentStatus: options.paymentStatus ?? 'PAID',
    startAt: '2026-10-17T08:00:00.000Z',
    endAt: options.endAt ?? '2026-10-17T09:00:00.000Z',
    subject: { id: 'math', name: 'Mathematics' },
    meetingUrl: 'https://meet.example.test/attendance',
    attendance: options.attendance ?? null,
    attendanceMarkedAt: options.attendance ? ORIGINAL_RECEIPT : null,
    participants: {
      tutor: {
        id: options.owner === false ? 'other-tutor' : 'tutor-preview',
        detail: { displayName: 'Teacher Pim' },
      },
      student: {
        id: 'student-preview',
        detail: { firstName: 'Mint', lastName: 'Preview', nickname: 'Mint' },
      },
    },
  };
  const state = {
    details,
    serverNow: new Date(NOW).getTime(),
    reads: 0,
    readFailure: 0,
    failure: options.writeFailure ?? 0,
    failureCode: '',
    mutations: 0,
    puts: [] as unknown[],
    replayFlags: [] as boolean[],
    gate: undefined as Promise<void> | undefined,
    meetingGate: undefined as Promise<void> | undefined,
    meetingWrites: 0,
    loseResponse: false,
    competingAttendance: null as AttendanceStatus | null,
    unexpected: [] as string[],
  };
  await page.clock.install({ time: new Date(NOW) });
  await page.addInitScript(
    (language) => localStorage.setItem('hktutor-language', language),
    options.language ?? 'en',
  );
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
    if (path === '/notifications' && request.method() === 'GET') {
      return route.fulfill({ json: { items: [], nextCursor: null, unreadCount: 0 } });
    }
    if (path === '/auth/refresh') {
      return route.fulfill({
        json: {
          accessToken: 'preview',
          user: {
            id: `${role.toLowerCase()}-preview`,
            role,
            email: 'preview@example.test',
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
          profile: {
            firstName: 'Pim',
            lastName: 'Preview',
            nickname: 'Pim',
            displayName: 'Teacher Pim',
            bio: 'Tutor',
            experienceYears: 5,
            verificationStatus: 'VERIFIED',
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
    if (path === `/bookings/me/${BOOKING_ID}/payments/current`) {
      return route.fulfill({
        json: {
          bookingId: BOOKING_ID,
          paymentStatus: state.details.paymentStatus,
          paymentPending: false,
          paidAt: null,
          reference: null,
          attempt: null,
        },
      });
    }
    if (path === `/bookings/me/${BOOKING_ID}`) {
      return route.fulfill({
        json: {
          id: BOOKING_ID,
          status: details.status,
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
          slot: { id: 'slot', startAtUtc: details.startAt, endAtUtc: details.endAt },
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
      state.reads += 1;
      // Match the participant GET, including the original saved attendance timestamp.
      return route.fulfill({
        status: state.readFailure || 200,
        json: state.readFailure ? { message: 'Unavailable' } : details,
      });
    }
    if (path === `/bookings/tutor/${BOOKING_ID}/attendance` && request.method() === 'PUT') {
      const body: unknown = request.postDataJSON();
      state.puts.push(body);
      await state.gate;
      if (state.failure) {
        return route.fulfill({
          status: state.failure,
          json: { message: 'Rejected', code: state.failureCode },
        });
      }
      if (role !== 'TUTOR' || details.participants.tutor.id !== 'tutor-preview') {
        return route.fulfill({ status: 403, json: { message: 'Forbidden' } });
      }
      if (state.competingAttendance) {
        details.attendance = state.competingAttendance;
        details.status = 'COMPLETED';
        state.details.attendanceMarkedAt = ORIGINAL_RECEIPT;
        state.competingAttendance = null;
      }
      if (
        !body ||
        typeof body !== 'object' ||
        !('attendance' in body) ||
        (body.attendance !== 'ATTENDED' && body.attendance !== 'ABSENT')
      ) {
        return route.fulfill({ status: 400, json: { message: 'Invalid attendance' } });
      }
      if (
        !['CONFIRMED', 'COMPLETED'].includes(details.status) ||
        new Date(details.endAt).getTime() > state.serverNow ||
        (details.attendance !== null && details.attendance !== body.attendance)
      ) {
        return route.fulfill({ status: 409, json: { message: 'State conflict' } });
      }
      const replay = details.status === 'COMPLETED';
      if (!replay) {
        details.attendance = body.attendance;
        details.status = 'COMPLETED';
        state.details.attendanceMarkedAt = NOW;
        state.mutations += 1;
      }
      state.replayFlags.push(replay);
      if (state.loseResponse) {
        return route.abort('failed');
      }
      return route.fulfill({
        json: {
          bookingId: BOOKING_ID,
          attendance: details.attendance,
          attendanceMarkedAt: state.details.attendanceMarkedAt,
          status: details.status,
          idempotentReplay: replay,
        },
      });
    }
    if (path === `/bookings/tutor/${BOOKING_ID}/meeting-link`) {
      state.meetingWrites += 1;
      await state.meetingGate;
      return route.fulfill({
        json: { bookingId: BOOKING_ID, meetingUrl: details.meetingUrl, updatedAt: NOW },
      });
    }
    state.unexpected.push(`${request.method()} ${path}`);
    return route.fulfill({ status: 404, json: { message: 'Unexpected preview request' } });
  });
  await page.goto(PATH);
  const panel = page.getByRole('region', { name: text.title });
  await expect(panel).toBeVisible();
  await expect(panel.getByText(text.loading, { exact: true })).toHaveCount(0);
  return { state, text, panel };
}

for (const language of ['en', 'th'] as const) {
  test(`${language}: choosing attendance requires a separate deliberate submission`, async ({
    page,
  }) => {
    const { state, panel, text } = await setup(page, { language });
    const attended = panel.getByRole('radio', { name: text.attended, exact: true });
    const absent = panel.getByRole('radio', { name: text.absent, exact: true });
    const record = panel.getByRole('button', { name: text.recordAttendance, exact: true });
    await expect(attended).not.toBeChecked();
    await expect(absent).not.toBeChecked();
    await expect(record).toBeDisabled();
    await expect(panel.getByText(text.attendanceFinality, { exact: true })).toBeVisible();

    await absent.check();
    await attended.focus();
    await attended.press('Space');
    await expect(attended).toBeChecked();
    await expect(absent).not.toBeChecked();
    await attended.press('ArrowRight');
    await expect(absent).toBeChecked();
    expect(state.puts).toEqual([]);
    expect(state.details.status).toBe('CONFIRMED');
    expect(state.details.attendance).toBeNull();

    await absent.press('Tab');
    await expect(record).toBeFocused();
    await record.press('Enter');
    await expect(
      panel.getByRole('region', { name: text.attendanceTitle }).locator('time'),
    ).toHaveAttribute('datetime', NOW);
    await expect(panel.getByRole('region', { name: text.attendanceTitle })).toContainText(
      text.absent,
    );
    expect(state.puts).toEqual([{ attendance: 'ABSENT' }]);
    expect(state.mutations).toBe(1);
  });

  for (const attendance of ['ATTENDED', 'ABSENT'] as const) {
    test(`${language} ${attendance}: saves once, refreshes status, and retains the persisted time after reload`, async ({
      page,
    }, testInfo) => {
      if (testInfo.project.name === 'mobile-chromium') {
        await page.setViewportSize({ width: 320, height: 800 });
      }
      const { state, panel, text } = await setup(page, { language });
      const reads = state.reads;
      await panel
        .getByRole('radio', {
          name: attendance === 'ATTENDED' ? text.attended : text.absent,
          exact: true,
        })
        .check();
      expect(state.puts).toEqual([]);
      await panel.getByRole('button', { name: text.recordAttendance, exact: true }).click();
      const summary = panel.getByRole('region', { name: text.attendanceTitle });
      await expect(summary).toContainText(attendance === 'ATTENDED' ? text.attended : text.absent);
      await expect(summary.locator('time')).toHaveAttribute('datetime', NOW);
      await expect(summary.locator('time')).toContainText('17:00');
      await expect(panel).toContainText(text.completed);
      await expect(panel.getByRole('button', { name: text.refresh })).toBeEnabled();
      expect(state.reads).toBeGreaterThan(reads);
      expect(state.puts).toEqual([{ attendance }]);
      expect(state.mutations).toBe(1);
      await page.reload();
      await expect(summary.locator('time')).toHaveAttribute('datetime', NOW);
      await expect(summary.locator('time')).toContainText('17:00');
      expect(state.replayFlags).toEqual([false]);
      expect(state.mutations).toBe(1);
      await page.screenshot({
        path: testInfo.outputPath(`attendance-${attendance}-${language}.png`),
        fullPage: true,
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect(state.unexpected).toEqual([]);
    });
  }
}

for (const attendance of ['ATTENDED', 'ABSENT'] as const) {
  test(`opening and reloading saved ${attendance} only reads its timestamp`, async ({ page }) => {
    const { state, panel, text } = await setup(page, {
      status: 'COMPLETED',
      attendance,
      writeFailure: 503,
    });
    const summary = panel.getByRole('region', { name: text.attendanceTitle });
    await expect(summary.locator('time')).toHaveAttribute('datetime', ORIGINAL_RECEIPT);
    await expect(summary).toContainText(attendance === 'ATTENDED' ? text.attended : text.absent);
    await expect(panel.getByRole('alert')).toHaveCount(0);
    await page.reload();
    await expect(summary.locator('time')).toHaveAttribute('datetime', ORIGINAL_RECEIPT);
    expect(state.puts).toEqual([]);
    expect(state.mutations).toBe(0);
  });
}

for (const [options, reason] of [
  [{ status: 'PENDING' }, 'attendancePending'],
  [{ paymentStatus: 'UNPAID' }, 'paymentRequired'],
  [{ status: 'CANCELED' }, 'attendanceUnavailable'],
  [{ status: 'EXPIRED' }, 'attendanceUnavailable'],
  [{ status: 'COMPLETED' }, 'attendanceUnavailable'],
  [{ endAt: '2026-10-17T11:00:00.000Z' }, 'attendanceFuture'],
  [{ owner: false }, 'attendanceOwner'],
] as const) {
  test(`disables attendance for ${JSON.stringify(options)}`, async ({ page }) => {
    const { state, panel, text } = await setup(page, options);
    await expect(panel.getByRole('radio', { name: text.attended, exact: true })).toBeDisabled();
    await expect(panel.getByRole('radio', { name: text.absent, exact: true })).toBeDisabled();
    await expect(panel).toContainText(text[reason]);
    await expect(panel.getByText(text.attendanceHelp, { exact: true })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: text.recordAttendance })).toBeDisabled();
    expect(state.puts).toEqual([]);
  });
}

test('student cannot record attendance or request a saved receipt', async ({ page }) => {
  const { state, panel, text } = await setup(page, {
    role: 'STUDENT',
    status: 'COMPLETED',
    attendance: 'ATTENDED',
  });
  await expect(panel.getByRole('radio', { name: text.attended, exact: true })).toHaveCount(0);
  await expect(panel.getByRole('radio', { name: text.absent, exact: true })).toHaveCount(0);
  expect(state.puts).toEqual([]);
});

test('an open future class becomes eligible when its end time passes', async ({ page }) => {
  const { state, panel, text } = await setup(page, { endAt: '2026-10-17T10:01:00.000Z' });
  await expect(panel.getByRole('radio', { name: text.attended, exact: true })).toBeDisabled();
  state.serverNow += 120_000;
  await page.clock.fastForward(120_000);
  await expect(panel.getByRole('radio', { name: text.attended, exact: true })).toBeEnabled();
  await panel.getByRole('radio', { name: text.attended, exact: true }).check();
  await panel.getByRole('button', { name: text.recordAttendance, exact: true }).click();
  await expect(
    panel.getByRole('region', { name: text.attendanceTitle }).locator('time'),
  ).toBeVisible();
});

test('attendance becomes eligible when a fresh read finishes around the class end', async ({
  page,
}) => {
  const { state, panel, text } = await setup(page, { endAt: '2026-10-17T11:00:00.000Z' });
  const initialReads = state.reads;
  let millisecondsUntilEnd = 1;
  await page.route(`**/api/v1/bookings/${BOOKING_ID}/class-details`, async (route) => {
    state.reads += 1;
    const currentTime = await page.evaluate(() => Date.now());
    state.details.endAt = new Date(currentTime + millisecondsUntilEnd).toISOString();
    await route.fulfill({ json: state.details });
  });

  // Exercise reads just before the deadline, including a deadline crossed during rendering.
  for (const delay of [1, 3, 5, 8, 12, 20, 30, 50]) {
    millisecondsUntilEnd = delay;
    await panel.getByRole('button', { name: text.refresh }).click();
    await expect(panel.getByText(text.loading, { exact: true })).toHaveCount(0);
    await expect(panel.getByRole('radio', { name: text.attended, exact: true })).toBeEnabled();
    await expect(panel.getByRole('radio', { name: text.absent, exact: true })).toBeEnabled();
    await expect(panel.getByText(text.attendanceFuture, { exact: true })).toHaveCount(0);
  }

  expect(state.reads).toBe(initialReads + 8);
  expect(state.puts).toEqual([]);
  expect(state.unexpected).toEqual([]);
});

test('same-value race is a success and preserves the original UTC receipt in Bangkok time', async ({
  page,
}) => {
  const { state, panel, text } = await setup(page);
  state.competingAttendance = 'ATTENDED';
  await panel.getByRole('radio', { name: text.attended, exact: true }).check();
  await panel.getByRole('button', { name: text.recordAttendance, exact: true }).click();
  await expect(page.getByText(text.attendanceReplay, { exact: true })).toBeVisible();
  const time = panel.getByRole('region', { name: text.attendanceTitle }).locator('time');
  await expect(time).toHaveAttribute('datetime', ORIGINAL_RECEIPT);
  await expect(time).toContainText('17 Oct 2026, 16:30');
  expect(state.mutations).toBe(0);
  expect(state.replayFlags).toEqual([true]);
});

test('different-value race shows 409, locks stale choices, and refreshes the persisted value', async ({
  page,
}) => {
  const { state, panel, text } = await setup(page);
  state.competingAttendance = 'ATTENDED';
  await panel.getByRole('radio', { name: text.absent, exact: true }).check();
  await panel.getByRole('button', { name: text.recordAttendance, exact: true }).click();
  await expect(panel.getByRole('alert')).toHaveText(text.attendanceConflict);
  await expect(panel.getByRole('radio', { name: text.attended, exact: true })).toBeDisabled();
  await expect(panel.getByRole('radio', { name: text.absent, exact: true })).toBeDisabled();
  await panel.getByRole('button', { name: text.refresh }).click();
  const summary = panel.getByRole('region', { name: text.attendanceTitle });
  await expect(summary).toContainText(text.attended);
  await expect(summary.locator('time')).toHaveAttribute('datetime', ORIGINAL_RECEIPT);
  expect(state.mutations).toBe(0);
  expect(state.puts).toEqual([{ attendance: 'ABSENT' }]);
});

for (const status of [400, 403, 404, 409, 500]) {
  test(`attendance ${status} does not show an optimistic result and requires a fresh read`, async ({
    page,
  }) => {
    const { state, panel, text } = await setup(page);
    state.failure = status;
    await panel.getByRole('radio', { name: text.absent, exact: true }).check();
    await panel.getByRole('button', { name: text.recordAttendance, exact: true }).click();
    await expect(panel.getByRole('alert')).toHaveText(
      status === 403
        ? text.attendanceOwner
        : status === 404
          ? text.notFound
          : status === 409
            ? text.attendanceConflict
            : text.attendanceFailed,
    );
    await expect(panel.getByRole('radio', { name: text.absent, exact: true })).toBeDisabled();
    expect(state.details.attendance).toBeNull();
    expect(state.mutations).toBe(0);
    state.failure = 0;
    await panel.getByRole('button', { name: text.refresh }).click();
    await expect(panel.getByRole('radio', { name: text.absent, exact: true })).toBeEnabled();
  });
}

for (const [status, code, message] of [
  [409, 'CLASS_NOT_ENDED', 'attendanceFuture'],
  [409, 'BOOKING_NOT_CONFIRMED_OR_COMPLETED', 'attendanceUnavailable'],
  [409, 'BOOKING_NOT_PAID', 'paymentRequired'],
  // US4-2: a booking that is still pending answers 400 with the same code.
  [400, 'BOOKING_NOT_CONFIRMED_OR_COMPLETED', 'attendanceUnavailable'],
] as const) {
  test(`server ${status} ${code} explains the stale eligibility and locks the form`, async ({
    page,
  }) => {
    const { state, panel, text } = await setup(page);
    state.failure = status;
    state.failureCode = code;
    await panel.getByRole('radio', { name: text.attended, exact: true }).check();
    await panel.getByRole('button', { name: text.recordAttendance, exact: true }).click();
    await expect(panel.getByRole('alert')).toHaveText(text[message]);
    await expect(panel.getByRole('radio', { name: text.attended, exact: true })).toBeDisabled();
    await expect(panel.getByRole('radio', { name: text.absent, exact: true })).toBeDisabled();
    expect(state.mutations).toBe(0);
  });
}

test('pending attendance locks both choices, meeting-link saving and refresh', async ({ page }) => {
  const { state, panel, text } = await setup(page);
  const gate = Promise.withResolvers<void>();
  state.gate = gate.promise;
  await panel.getByRole('radio', { name: text.absent, exact: true }).check();
  await panel.getByRole('button', { name: text.recordAttendance, exact: true }).click();
  await expect(
    panel.getByRole('button', { name: text.attendanceSaving, exact: true }),
  ).toBeDisabled();
  await expect(panel.getByRole('radio', { name: text.absent, exact: true })).toBeDisabled();
  await expect(panel.getByRole('button', { name: text.save, exact: true })).toBeDisabled();
  await expect(panel.getByRole('button', { name: text.refresh })).toBeDisabled();
  expect(state.puts).toHaveLength(1);
  expect(state.mutations).toBe(0);
  gate.resolve();
  await expect(
    panel.getByRole('region', { name: text.attendanceTitle }).locator('time'),
  ).toBeVisible();
  await expect(panel.getByRole('button', { name: text.refresh })).toBeEnabled();
});

test('meeting-link save locks attendance until its refresh completes', async ({ page }) => {
  const { state, panel, text } = await setup(page);
  const gate = Promise.withResolvers<void>();
  state.meetingGate = gate.promise;
  await panel.getByRole('button', { name: text.save, exact: true }).click();
  await expect(panel.getByRole('radio', { name: text.attended, exact: true })).toBeDisabled();
  await expect(panel.getByRole('radio', { name: text.absent, exact: true })).toBeDisabled();
  gate.resolve();
  await expect(panel.getByRole('radio', { name: text.attended, exact: true })).toBeEnabled();
  expect(state.puts).toEqual([]);
});

test('lost attendance response is reconciled after refresh without another first write', async ({
  page,
}) => {
  const { state, panel, text } = await setup(page);
  state.loseResponse = true;
  await panel.getByRole('radio', { name: text.attended, exact: true }).check();
  await panel.getByRole('button', { name: text.recordAttendance, exact: true }).click();
  await expect(panel.getByRole('alert')).toHaveText(text.attendanceFailed);
  await expect(panel.getByRole('radio', { name: text.attended, exact: true })).toBeDisabled();
  expect(state.mutations).toBe(1);
  state.loseResponse = false;
  await panel.getByRole('button', { name: text.refresh }).click();
  await expect(
    panel.getByRole('region', { name: text.attendanceTitle }).locator('time'),
  ).toHaveAttribute('datetime', NOW);
  expect(state.replayFlags).toEqual([false]);
  expect(state.mutations).toBe(1);
});

test('failed status refresh after save hides the stale form and recovers the saved summary', async ({
  page,
}) => {
  const { state, panel, text } = await setup(page);
  state.readFailure = 500;
  await panel.getByRole('radio', { name: text.attended, exact: true }).check();
  await panel.getByRole('button', { name: text.recordAttendance, exact: true }).click();
  await expect(panel.getByRole('alert')).toHaveText(text.failed);
  await expect(panel.getByRole('radio', { name: text.absent, exact: true })).toHaveCount(0);
  state.readFailure = 0;
  await panel.getByRole('button', { name: text.refresh }).click();
  await expect(
    panel.getByRole('region', { name: text.attendanceTitle }).locator('time'),
  ).toHaveAttribute('datetime', NOW);
  expect(state.mutations).toBe(1);
});

test('a saved value without a timestamp remains readable without replaying a write', async ({
  page,
}) => {
  const { state, panel, text } = await setup(page);
  state.details.attendance = 'ABSENT';
  state.details.status = 'COMPLETED';
  state.details.attendanceMarkedAt = null;
  state.failure = 503;
  await panel.getByRole('button', { name: text.refresh }).click();
  const summary = panel.getByRole('region', { name: text.attendanceTitle });
  await expect(summary).toContainText(text.absent);
  await expect(summary.locator('time')).toHaveCount(0);
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: text.refresh })).toBeEnabled();
  expect(state.puts).toEqual([]);
  expect(state.mutations).toBe(0);
});
