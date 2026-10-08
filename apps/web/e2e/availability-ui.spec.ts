import { expect, test } from '@playwright/test';

import type { CreateAvailabilityPayload, TutorAvailabilitySlot } from '@/lib/api/types';
import type { Page } from '@playwright/test';

const initialSlots: TutorAvailabilitySlot[] = [
  {
    id: 'past-slot',
    startAtUtc: '2026-10-05T00:00:00.000Z',
    endAtUtc: '2026-10-05T01:00:00.000Z',
    createdAt: '2026-10-01T00:00:00.000Z',
    state: 'OPEN',
  },
  {
    id: 'ongoing-slot',
    startAtUtc: '2026-10-05T01:30:00.000Z',
    endAtUtc: '2026-10-05T02:30:00.000Z',
    createdAt: '2026-10-01T00:00:00.000Z',
    state: 'OPEN',
  },
  {
    id: 'reserved-slot',
    startAtUtc: '2026-10-05T03:00:00.000Z',
    endAtUtc: '2026-10-05T04:00:00.000Z',
    createdAt: '2026-10-01T00:00:00.000Z',
    state: 'RESERVED',
  },
  {
    id: 'open-slot',
    startAtUtc: '2026-10-08T10:00:00.000Z',
    endAtUtc: '2026-10-08T11:00:00.000Z',
    createdAt: '2026-10-01T00:00:00.000Z',
    state: 'OPEN',
  },
  {
    id: 'overnight-slot',
    startAtUtc: '2026-10-08T15:00:00.000Z',
    endAtUtc: '2026-10-09T18:00:00.000Z',
    createdAt: '2026-10-01T00:00:00.000Z',
    state: 'OPEN',
  },
];

async function mockAvailability(
  page: Page,
  options: {
    createConflict?: boolean;
    deleteConflict?: boolean;
    deleted?: string[];
    slots?: TutorAvailabilitySlot[];
    additionalSlots?: TutorAvailabilitySlot[];
    availabilityGate?: Promise<void>;
    loadError?: boolean;
    requestedUntil?: string[];
  } = {},
) {
  const created: CreateAvailabilityPayload[] = [];
  const slots = [...(options.slots ?? initialSlots), ...(options.additionalSlots ?? [])];
  await page.clock.setFixedTime(new Date('2026-10-05T02:00:00.000Z'));
  await page.addInitScript(() => window.localStorage.setItem('hktutor-language', 'th'));
  await page
    .context()
    .addCookies([
      { name: 'hktutor_refresh', value: 'ui-test-session', url: 'http://localhost:3000' },
    ]);
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1', '');
    let body: unknown;
    let status = 200;
    if (path === '/auth/refresh') {
      body = {
        accessToken: 'ui-test-token',
        user: { id: 'tutor-ui', email: 'tutor@example.test', role: 'TUTOR', displayName: 'Anan' },
      };
    } else if (path === '/profiles/me') {
      body = {
        role: 'TUTOR',
        consentCurrent: true,
        profileComplete: true,
        policyVersion: '2026-01',
        profile: {
          firstName: 'Anan',
          lastName: 'Dee',
          nickname: 'Anan',
          displayName: 'Anan',
          bio: 'Mathematics tutor',
          experienceYears: 5,
          verificationStatus: 'VERIFIED',
          ratingAverage: null,
          reviewCount: 0,
        },
      };
    } else if (path === '/tutors/me/availability' && request.method() === 'POST') {
      const payload: CreateAvailabilityPayload = request.postDataJSON();
      created.push(payload);
      if (options.createConflict) {
        status = 409;
        body = { message: 'Availability slot overlaps an existing slot' };
      } else {
        const slot: TutorAvailabilitySlot = {
          id: 'created-slot',
          startAtUtc: payload.startAt,
          endAtUtc: payload.endAt,
          createdAt: '2026-10-05T02:00:00.000Z',
          state: 'OPEN',
        };
        slots.push(slot);
        body = { ...slot, tutorProfileId: 'tutor-ui' };
      }
    } else if (path === '/tutors/me/availability' && request.method() === 'GET') {
      await options.availabilityGate;
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      if (to) options.requestedUntil?.push(to);
      body = slots.filter(
        (slot) =>
          (from === null ||
            (url.searchParams.get('rangeMode') === 'overlap'
              ? slot.endAtUtc > from
              : slot.startAtUtc >= from)) &&
          (to === null || slot.startAtUtc < to),
      );
      if (options.loadError) {
        status = 503;
        body = { message: 'Availability unavailable' };
      }
    } else if (path.startsWith('/tutors/me/availability/') && request.method() === 'DELETE') {
      const id = decodeURIComponent(path.split('/').at(-1) ?? '');
      options.deleted?.push(id);
      if (options.deleteConflict) {
        status = 409;
        body = { message: 'Reserved slots cannot be deleted' };
      } else {
        const index = slots.findIndex((slot) => slot.id === id);
        if (index >= 0) slots.splice(index, 1);
        status = 204;
      }
    } else {
      status = 500;
      body = { message: `Unexpected request: ${request.method()} ${path}` };
    }
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: status === 204 ? '' : JSON.stringify(body),
    });
  });
  await page.goto('/dashboard/availability');
  await expect(page.getByRole('heading', { name: 'เพิ่มช่วงเวลาว่าง' })).toBeVisible();
  return created;
}

test('ledger summary keeps weekly counts, one timezone label, and bilingual responsive content', async ({
  page,
}, testInfo) => {
  await mockAvailability(page);
  const summary = page.locator('[data-availability-summary]');
  await expect(summary).toHaveAttribute('aria-busy', 'false');
  const metrics = summary.locator('dl > div');
  await expect(metrics).toHaveCount(2);
  await expect(metrics.nth(0).getByRole('term')).toHaveText('ช่วงเวลาว่าง');
  await expect(metrics.nth(1).getByRole('term')).toHaveText('ช่วงเวลาที่ถูกจอง');
  await expect(metrics.nth(0).getByRole('definition').first()).toHaveText('4ช่วง');
  await expect(metrics.nth(1).getByRole('definition').first()).toHaveText('1ช่วง');
  await expect(page.getByText('เวลาไทย · UTC+7', { exact: true })).toHaveCount(1);
  await expect(summary.getByText('เขตเวลา · Asia/Bangkok', { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(1);
  await summary.screenshot({ path: testInfo.outputPath('availability-ledger-th.png') });
  await page.locator('[data-week="2026-10-12"]').click();
  await expect(metrics.nth(0).getByRole('definition').first()).toHaveText('0ช่วง');
  await expect(metrics.nth(1).getByRole('definition').first()).toHaveText('0ช่วง');
  await page.getByRole('button', { name: 'เปลี่ยนภาษาเป็นภาษาอังกฤษ' }).click();
  await expect(metrics.nth(0).getByRole('term')).toHaveText('Open slots');
  await expect(metrics.nth(1).getByRole('term')).toHaveText('Reserved slots');
  await expect(metrics.nth(0).getByRole('definition').first()).toHaveText('0slots');
  await expect(summary.getByText('Asia/Bangkok · UTC+7', { exact: true })).toBeVisible();
});

test('ledger waits for real counts while availability loads', async ({ page }) => {
  let releaseAvailability = () => {};
  const availabilityGate = new Promise<void>((resolve) => {
    releaseAvailability = resolve;
  });
  await mockAvailability(page, { availabilityGate });
  const summary = page.locator('[data-availability-summary]');
  try {
    await expect(summary).toHaveAttribute('aria-busy', 'true');
    await expect(summary.locator('dl > div > dd:first-of-type')).toHaveText(['—', '—']);
  } finally {
    releaseAvailability();
  }
  await expect(summary).toHaveAttribute('aria-busy', 'false');
  await expect(summary.locator('dl > div > dd:first-of-type')).toHaveText(['4ช่วง', '1ช่วง']);
});

test('ledger does not report zero counts when availability fails to load', async ({ page }) => {
  await mockAvailability(page, { loadError: true });
  const summary = page.locator('[data-availability-summary]');
  await expect(summary).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByRole('button', { name: 'ลองใหม่', exact: true })).toBeVisible();
  await expect(summary.locator('dl > div > dd:first-of-type')).toHaveText(['—', '—']);
});

test('vertical wheels unfold gently, wrap values, and support mouse and keyboard', async ({
  page,
}) => {
  await mockAvailability(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const form = page.locator('form');
  const start = form.getByRole('button', { name: /^เวลาเริ่ม / });
  await expect(form.getByRole('spinbutton')).toHaveCount(0);
  await start.click();
  const panel = form.getByRole('group', { name: 'เวลาเริ่ม', exact: true });
  const hour = panel.getByRole('spinbutton', { name: 'ชั่วโมง', exact: true });
  const minute = panel.getByRole('spinbutton', { name: 'นาที', exact: true });
  const animationHeight = await panel.evaluate((element) => {
    const animation = element.getAnimations().find((item) => item instanceof CSSAnimation);
    if (!animation) return null;
    animation.pause();
    animation.currentTime = 100;
    const halfway = element.getBoundingClientRect().height;
    animation.finish();
    return halfway;
  });
  expect(animationHeight).not.toBeNull();
  expect(animationHeight).toBeGreaterThan(0);
  expect(animationHeight).toBeLessThan(
    await panel.evaluate((element) => element.getBoundingClientRect().height),
  );
  await expect(hour).toBeFocused();
  await expect(hour).toHaveAttribute('aria-valuenow', '18');
  await expect(hour).toHaveCSS('height', '132px');
  const visibleRows = await hour.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return Array.from(element.querySelectorAll('[data-wheel-value]')).filter((option) => {
      const row = option.getBoundingClientRect();
      const middle = row.top + row.height / 2;
      return middle > bounds.top && middle < bounds.bottom;
    }).length;
  });
  expect(visibleRows).toBe(3);
  await expect(hour).toHaveCSS('touch-action', 'pan-y');
  await expect(hour).toHaveCSS('overflow-x', 'hidden');
  // Emulated mobile rescales wheel deltas delivered to the manual diagonal-axis handler.
  const wheelScale = await page.evaluate(() => window.devicePixelRatio);
  await hour.hover();
  await page.mouse.wheel(132, 0);
  await expect(hour).toHaveAttribute('aria-valuenow', '18');
  await page.mouse.wheel(80 * wheelScale, 44 * wheelScale);
  await expect(hour).toHaveAttribute('aria-valuenow', '19');
  await minute.hover();
  await page.mouse.wheel(0, -44);
  await expect(minute).toHaveAttribute('aria-valuenow', '59');
  const bounds = await hour.boundingBox();
  if (!bounds) throw new Error('Hour wheel has no bounds');
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 50, bounds.y + bounds.height / 2 - 88, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(hour).toHaveAttribute('aria-valuenow', '21');
  expect(await hour.evaluate((element) => element.scrollLeft)).toBe(0);
  await hour.focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowUp');
  await expect(hour).toHaveAttribute('aria-valuenow', '23');
  await minute.focus();
  await page.keyboard.press('ArrowDown');
  await expect(minute).toHaveAttribute('aria-valuenow', '0');
  await page.keyboard.press('Enter');
  await expect(start).toHaveAttribute('aria-expanded', 'false');
  await expect(start).toContainText('23:00');
  await expect(start).toBeFocused();
  await expect(form.locator('[data-open]').first()).toHaveCSS('display', 'none');
  const closedGap = await form.evaluate((element) => {
    const time = element.querySelector('input[name="startTime"]')?.nextElementSibling;
    const endTitle = element.querySelector('#availability-end-title');
    return time && endTitle
      ? endTitle.getBoundingClientRect().top - time.getBoundingClientRect().bottom
      : null;
  });
  expect(closedGap).not.toBeNull();
  expect(closedGap).toBeGreaterThanOrEqual(0);
  expect(closedGap).toBe(16);
  await expect(form.getByRole('spinbutton')).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await start.click();
  await expect(panel).toHaveCSS('animation-name', 'none');
  await page.keyboard.press('Escape');
  await expect(start).toHaveAttribute('aria-expanded', 'false');
  await start.click();
  await hour.evaluate((element) => {
    element.scrollTop += 88;
  });
  await minute.evaluate((element) => {
    element.scrollTop -= 44;
  });
  await expect(form.getByRole('button', { name: 'เสร็จ', exact: true })).toHaveCount(0);
  await start.click();
  await expect(start).toContainText('01:59');
});

test('touch gestures stay vertical without moving the page sideways', async ({
  page,
}, testInfo) => {
  test.skip(
    !testInfo.project.use.hasTouch,
    'Native touch coverage requires a touch-enabled viewport',
  );
  await mockAvailability(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page
    .locator('form')
    .getByRole('button', { name: /^เวลาเริ่ม / })
    .click();
  const hour = page.locator('form').getByRole('spinbutton', { name: 'ชั่วโมง' });
  const bounds = await hour.boundingBox();
  if (!bounds) throw new Error('Hour wheel has no bounds');
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  const session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let step = 1; step <= 6; step++) {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x + step * 10, y }],
    });
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(hour).toHaveAttribute('aria-valuenow', '18');
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let step = 1; step <= 8; step++) {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x + step * 3, y: y - step * 11 }],
    });
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(hour).not.toHaveAttribute('aria-valuenow', '18');
  expect(await hour.evaluate((element) => element.scrollLeft)).toBe(0);
  expect(await page.evaluate(() => window.scrollX)).toBe(0);
  await session.detach();
});

test('outside clicks open the next field or save the visible time in one click', async ({
  page,
}) => {
  const created = await mockAvailability(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const form = page.locator('form');
  const start = form.getByRole('button', { name: /^เวลาเริ่ม / });
  const end = form.getByRole('button', { name: /^เวลาสิ้นสุด / });
  await start.click();
  await end.click();
  await expect(start).toHaveAttribute('aria-expanded', 'false');
  await expect(end).toHaveAttribute('aria-expanded', 'true');
  await form.getByRole('spinbutton', { name: 'นาที' }).evaluate((element) => {
    element.scrollTop += 88;
  });
  await form.getByRole('button', { name: 'เพิ่มเวลา', exact: true }).click();
  await expect(page.getByText('เพิ่มช่วงเวลาว่างแล้ว', { exact: true })).toBeVisible();
  await expect(end).toHaveAttribute('aria-expanded', 'false');
  expect(created).toEqual([
    { startAt: '2026-10-05T11:00:00.000Z', endAt: '2026-10-05T12:02:00.000Z' },
  ]);
});

test('creates an overnight slot with separate dates, removes durations/reset, and preserves reservations', async ({
  page,
}, testInfo) => {
  const created = await mockAvailability(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const form = page.locator('form');
  await expect(page.getByRole('button', { name: 'รีเซ็ต' })).toHaveCount(0);
  await expect(page.getByText('ชั่วโมงสอน', { exact: true })).toHaveCount(0);
  await expect(form.getByText('ตัวอย่างเวลาตามกรุงเทพฯ')).toHaveCount(0);
  await expect(form.getByText(/จัดเก็บเป็น/)).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText(/\d+ ชั่วโมง/);
  const reserved = page.locator('[data-availability-slot="reserved-slot"]');
  await expect(reserved.getByRole('button')).toHaveCount(0);
  await expect(reserved.getByText('มีการจอง', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'ถูกจองแล้ว' })).toHaveCount(0);
  const overnight = page.locator('[data-availability-slot="overnight-slot"]').first();
  await expect(overnight).toContainText('8 ต.ค. 2569');
  await expect(overnight).toContainText('10 ต.ค. 2569');
  await form.getByRole('button', { name: /^วันที่จบ / }).click();
  await form.getByRole('gridcell', { name: 'วันอังคารที่ 6 ตุลาคม 2569', exact: true }).click();
  await form.getByRole('button', { name: /^เวลาสิ้นสุด / }).click();
  const endPanel = form.getByRole('group', { name: 'เวลาสิ้นสุด', exact: true });
  await endPanel.getByRole('spinbutton', { name: 'ชั่วโมง' }).focus();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await form.getByRole('button', { name: /^เวลาสิ้นสุด / }).click();
  await expect(form.locator('input[name="startDate"]')).toHaveValue('2026-10-05');
  await expect(form.locator('input[name="endDate"]')).toHaveValue('2026-10-06');
  await expect(form.locator('input[name="endTime"]')).toHaveValue('16:00');
  await form.getByRole('button', { name: 'เพิ่มเวลา', exact: true }).click();
  await expect(page.getByText('เพิ่มช่วงเวลาว่างแล้ว', { exact: true })).toBeVisible();
  expect(created).toEqual([
    { startAt: '2026-10-05T11:00:00.000Z', endAt: '2026-10-06T09:00:00.000Z' },
  ]);
  const createdBar = page.locator('[data-availability-slot="created-slot"]');
  await expect(createdBar).toHaveCount(1);
  await expect(createdBar).toHaveAttribute('data-availability-day', '2026-10-05');
  await expect(createdBar).toHaveAttribute('data-availability-end-day', '2026-10-06');
  await expect(createdBar.locator('strong')).toHaveText(['18:00', '16:00']);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(1);
  await form.getByRole('button', { name: /^เวลาเริ่ม / }).click();
  await page.evaluate(() => document.fonts.ready);
  await form.screenshot({
    path: testInfo.outputPath('availability-wheels-th.png'),
    animations: 'disabled',
    style: 'header { visibility: hidden !important; }',
  });
  await page.getByRole('button', { name: 'เปลี่ยนภาษาเป็นภาษาอังกฤษ' }).click();
  await expect(form.getByRole('button', { name: /^Start date / })).toBeVisible();
  await expect(form.getByRole('button', { name: /^End date / })).toBeVisible();
});

test('rejects reversed same-day times and reports an API overlap without losing the selected range', async ({
  page,
}) => {
  const created = await mockAvailability(page, { createConflict: true });
  const form = page.locator('form');
  await form.getByRole('button', { name: /^เวลาสิ้นสุด / }).click();
  const end = form.getByRole('group', { name: 'เวลาสิ้นสุด', exact: true });
  await end.getByRole('spinbutton', { name: 'ชั่วโมง' }).focus();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await form.getByRole('button', { name: /^เวลาสิ้นสุด / }).click();
  await form.getByRole('button', { name: 'เพิ่มเวลา', exact: true }).click();
  await expect(form.getByRole('alert')).toHaveText('วันเวลาจบต้องอยู่หลังวันเวลาเริ่ม');
  await expect(page.locator('[data-notebook-toast="error"]')).toHaveText(
    'วันเวลาจบต้องอยู่หลังวันเวลาเริ่ม',
  );
  expect(created).toEqual([]);
  await form.getByRole('button', { name: /^วันที่จบ / }).click();
  await form.getByRole('gridcell', { name: 'วันอังคารที่ 6 ตุลาคม 2569', exact: true }).click();
  await form.getByRole('button', { name: 'เพิ่มเวลา', exact: true }).click();
  await expect(form.getByRole('alert')).toHaveText('ช่วงเวลานี้ซ้อนกับช่วงเวลาที่มีอยู่แล้ว');
  await expect(
    page
      .locator('[data-notebook-toast="error"]')
      .filter({ hasText: 'ช่วงเวลานี้ซ้อนกับช่วงเวลาที่มีอยู่แล้ว' }),
  ).toHaveCount(1);
  await expect(form.getByRole('button', { name: /^เวลาสิ้นสุด / })).toContainText('16:00');
});

test('notebook rows distinguish ended times and require confirmation before deleting', async ({
  page,
}, testInfo) => {
  const deleted: string[] = [];
  await mockAvailability(page, { deleted });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const past = page.locator('[data-availability-slot="past-slot"]');
  const ongoing = page.locator('[data-availability-slot="ongoing-slot"]');
  const overnight = page.locator('[data-availability-slot="overnight-slot"]').first();
  await expect(past.getByText('ผ่านไปแล้ว', { exact: true })).toBeVisible();
  await expect(past).toHaveAttribute('data-state', 'past');
  await expect(past.getByRole('button')).toHaveCount(0);
  await expect(past).toHaveCSS('pointer-events', 'none');
  await expect(past.locator('button, a, input, [tabindex]')).toHaveCount(0);
  expect(
    await past.evaluate((element) => ({
      opacity: getComputedStyle(element, '::after').opacity,
      pointerEvents: getComputedStyle(element, '::after').pointerEvents,
    })),
  ).toEqual({ opacity: '0.22', pointerEvents: 'none' });
  await expect(ongoing.getByText('ว่าง', { exact: true })).toBeVisible();
  await expect(overnight.getByText('ว่าง', { exact: true })).toBeVisible();
  expect(
    await overnight.getByText('ว่าง', { exact: true }).evaluate((element) => {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) return false;
      context.fillStyle = getComputedStyle(element).color;
      context.fillRect(0, 0, 1, 1);
      const [red = 0, green = 0, blue = 0] = context.getImageData(0, 0, 1, 1).data;
      return green > red && green > blue;
    }),
  ).toBe(true);
  const remove = overnight.getByRole('button', { name: /^ลบช่วงเวลา / });
  const target = await remove.boundingBox();
  expect(target).not.toBeNull();
  if (testInfo.project.use.hasTouch) {
    expect(target?.height).toBeGreaterThanOrEqual(44);
    expect(target?.width).toBeGreaterThanOrEqual(44);
  }
  await remove.click();
  const dialog = page.getByRole('alertdialog', { name: 'ลบช่วงเวลานี้?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#availability-delete-time time')).toHaveText([
    '8 ต.ค. 2569',
    '22:00',
    '10 ต.ค. 2569',
    '01:00',
  ]);
  await expect(dialog.locator('#availability-delete-time dt')).toHaveText(['เริ่ม', 'จบ']);
  const overflow = await dialog.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return Array.from(element.querySelectorAll('button, time, h2')).some((child) => {
      const rect = child.getBoundingClientRect();
      return (
        rect.left < bounds.left ||
        rect.right > bounds.right ||
        child.scrollWidth > child.clientWidth + 1
      );
    });
  });
  expect(overflow).toBe(false);
  await expect(dialog.getByRole('button', { name: 'เก็บไว้', exact: true })).toBeFocused();
  await dialog.screenshot({
    path: testInfo.outputPath('availability-delete-confirmation-th.png'),
    animations: 'disabled',
  });
  expect(deleted).toEqual([]);
  await dialog.getByRole('button', { name: 'เก็บไว้', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(remove).toBeFocused();
  expect(deleted).toEqual([]);
  await remove.click();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(deleted).toEqual([]);
  await remove.click();
  await dialog.getByRole('button', { name: 'ลบช่วงเวลา', exact: true }).click();
  await expect(page.getByText('ลบช่วงเวลาว่างแล้ว', { exact: true })).toBeVisible();
  await expect(page.locator('[data-availability-slot="overnight-slot"]')).toHaveCount(0);
  await expect(dialog).toBeHidden();
  expect(deleted).toEqual(['overnight-slot']);
  await page.clock.setFixedTime(new Date('2026-10-05T02:30:00.000Z'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(ongoing.getByText('ผ่านไปแล้ว', { exact: true })).toBeVisible();
  await expect(ongoing.getByRole('button')).toHaveCount(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(1);
  await page.evaluate(() => document.fonts.ready);
  await page.locator('[aria-labelledby="availability-week-title"]').screenshot({
    path: testInfo.outputPath('availability-notebook-rows-th.png'),
    animations: 'disabled',
    style: 'header { visibility: hidden !important; }',
  });
  await page.getByRole('button', { name: 'เปลี่ยนภาษาเป็นภาษาอังกฤษ' }).click();
  await expect(past.getByText('Ended', { exact: true })).toBeVisible();
  await expect(past.getByRole('button')).toHaveCount(0);
  await expect(
    page.locator('[data-availability-slot="reserved-slot"]').getByText('Has a booking', {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .locator('[data-availability-slot="open-slot"]')
    .getByRole('button', { name: /^Delete time range / })
    .click();
  const translatedDialog = page.getByRole('alertdialog', { name: 'Delete this time range?' });
  await expect(translatedDialog).toBeVisible();
  await expect(translatedDialog.locator('#availability-delete-time time')).toHaveText([
    '8 Oct 2026',
    '17:00',
    '8 Oct 2026',
    '18:00',
  ]);
  await expect(translatedDialog.locator('#availability-delete-time dt')).toHaveText([
    'Start',
    'End',
  ]);
  await page.getByRole('button', { name: 'Keep it', exact: true }).click();
  expect(deleted).toEqual(['overnight-slot']);
});

test('expiration blocks stale delete clicks and closes an open confirmation without a request', async ({
  page,
}) => {
  const deleted: string[] = [];
  await mockAvailability(page, { deleted });
  const ongoing = page.locator('[data-availability-slot="ongoing-slot"]');
  await ongoing.getByRole('button', { name: /^ลบช่วงเวลา / }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  // Keep the rendered clock unchanged to exercise the check immediately before sending DELETE.
  await page.clock.setFixedTime(new Date('2026-10-05T02:30:00.000Z'));
  await dialog.getByRole('button', { name: 'ลบช่วงเวลา', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(ongoing.getByRole('button')).toHaveCount(0);
  await expect(ongoing).toHaveAttribute('data-state', 'past');
  expect(deleted).toEqual([]);

  const future = page.locator('[data-availability-slot="open-slot"]');
  await future.getByRole('button', { name: /^ลบช่วงเวลา / }).click();
  await expect(dialog).toBeVisible();
  await page.clock.setFixedTime(new Date('2026-10-08T11:00:00.000Z'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(dialog).toBeHidden();
  await expect(future.getByRole('button')).toHaveCount(0);
  expect(deleted).toEqual([]);
});

test('status and delete actions stay at the top right without overlapping times', async ({
  page,
}, testInfo) => {
  await mockAvailability(page);
  const verifyActions = async () => {
    for (const id of ['open-slot', 'overnight-slot']) {
      const row = page.locator(`[data-availability-slot="${id}"]`);
      const actions = row.getByRole('button').locator('..');
      const bounds = await row.boundingBox();
      const controls = await actions.boundingBox();
      const time = await row.locator('strong').first().boundingBox();
      if (!bounds || !controls || !time) throw new Error('Availability controls have no bounds');
      expect(controls.y - bounds.y).toBeLessThanOrEqual(22);
      expect(bounds.x + bounds.width - controls.x - controls.width).toBeLessThanOrEqual(18);
      const overlapX =
        Math.min(time.x + time.width, controls.x + controls.width) - Math.max(time.x, controls.x);
      const overlapY =
        Math.min(time.y + time.height, controls.y + controls.height) - Math.max(time.y, controls.y);
      expect(overlapX <= 0 || overlapY <= 0).toBe(true);
    }
  };
  await verifyActions();
  await page.evaluate(() => document.fonts.ready);
  await page.locator('[aria-labelledby="availability-week-title"]').screenshot({
    path: testInfo.outputPath('availability-top-right-actions-th.png'),
    animations: 'disabled',
    style: 'header { visibility: hidden !important; }',
  });
  await page.setViewportSize({ width: 500, height: 900 });
  await verifyActions();
  await page.getByRole('button', { name: 'เปลี่ยนภาษาเป็นภาษาอังกฤษ' }).click();
  await verifyActions();
});

test('retains a slot when a booking race rejects the confirmed deletion', async ({ page }) => {
  const deleted: string[] = [];
  await mockAvailability(page, { deleted, deleteConflict: true });
  const overnight = page.locator('[data-availability-slot="overnight-slot"]').first();
  await overnight.getByRole('button', { name: /^ลบช่วงเวลา / }).click();
  await page.getByRole('button', { name: 'ลบช่วงเวลา', exact: true }).click();
  await expect(page.getByText('ไม่สามารถลบช่วงเวลาที่ถูกจองแล้ว', { exact: true })).toBeVisible();
  await expect(overnight).toBeVisible();
  await expect(page.getByRole('alertdialog')).toBeHidden();
  expect(deleted).toEqual(['overnight-slot']);
});

test('one continuous cross-day bar spans all occupied date rows on every screen', async ({
  page,
}, testInfo) => {
  await mockAvailability(page);
  const overnight = page.locator('[data-availability-slot="overnight-slot"]');
  await expect(overnight).toHaveCount(1);
  await expect(overnight).toHaveAttribute('data-spanning', 'true');
  await expect(overnight).toHaveAttribute('data-availability-day', '2026-10-08');
  await expect(overnight).toHaveAttribute('data-availability-end-day', '2026-10-10');
  await expect(overnight.locator('strong')).toHaveText(['22:00', '01:00']);
  await expect(overnight.locator('p')).toHaveText(['8 ต.ค. 2569', '10 ต.ค. 2569']);
  await expect(overnight.getByText('ว่าง', { exact: true })).toHaveCount(1);
  await expect(overnight.getByRole('button')).toHaveCount(1);
  await expect(page.locator('[data-availability-slot="open-slot"]').locator('strong')).toHaveText(
    '17:00–18:00',
  );
  const barBounds = await overnight.boundingBox();
  const middleDay = await page.locator('[data-availability-date="2026-10-09"]').boundingBox();
  const endDay = await page.locator('[data-availability-date="2026-10-10"]').boundingBox();
  const earlier = await page.locator('[data-availability-slot="open-slot"]').boundingBox();
  if (!barBounds || !middleDay || !endDay || !earlier) throw new Error('Week grid has no bounds');
  expect(barBounds.y).toBeGreaterThanOrEqual(earlier.y + earlier.height);
  expect(barBounds.y).toBeLessThan(middleDay.y);
  expect(barBounds.y + barBounds.height).toBeGreaterThan(endDay.y + endDay.height);
  const grid = await overnight.evaluate((element) => {
    const style = getComputedStyle(element);
    return { start: Number(style.gridRowStart), end: Number(style.gridRowEnd) };
  });
  expect(grid.end - grid.start).toBe(5);
  for (const element of await overnight.locator('strong, p, button').all()) {
    expect(
      await element.evaluate((element) => {
        const row = element.closest('[data-availability-slot]');
        return row
          ? element.getBoundingClientRect().right <= row.getBoundingClientRect().right
          : false;
      }),
    ).toBe(true);
  }
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(1);
  await page.evaluate(() => document.fonts.ready);
  await page.locator('[aria-labelledby="availability-week-title"]').screenshot({
    path: testInfo.outputPath('availability-continuous-cross-day-th.png'),
    animations: 'disabled',
    style: 'header { visibility: hidden !important; }',
  });
  await page.getByRole('button', { name: 'เปลี่ยนภาษาเป็นภาษาอังกฤษ' }).click();
  await expect(overnight.locator('strong')).toHaveText(['22:00', '01:00']);
  await expect(overnight.locator('p')).toHaveText(['8 Oct 2026', '10 Oct 2026']);
  await expect(overnight.locator('p').first()).toBeVisible();
  await expect(overnight.locator('p').last()).toBeVisible();
});

test('a booking across dates 6 and 7 is a single bar covering the day divider', async ({
  page,
}, testInfo) => {
  await mockAvailability(page, {
    additionalSlots: [
      {
        id: 'cross-day-reserved',
        startAtUtc: '2026-10-06T11:00:00.000Z',
        endAtUtc: '2026-10-07T12:00:00.000Z',
        createdAt: '2026-10-01T00:00:00.000Z',
        state: 'RESERVED',
      },
    ],
  });
  const bar = page.locator('[data-availability-slot="cross-day-reserved"]');
  await expect(bar).toHaveCount(1);
  await expect(bar.locator('strong')).toHaveText(['18:00', '19:00']);
  await expect(bar.locator('p')).toHaveText(['6 ต.ค. 2569', '7 ต.ค. 2569']);
  await expect(bar.getByText('มีการจอง', { exact: true })).toHaveCount(1);
  await expect(bar.getByRole('button')).toHaveCount(0);
  const first = await page.locator('[data-availability-date="2026-10-06"]').boundingBox();
  const second = await page.locator('[data-availability-date="2026-10-07"]').boundingBox();
  const bounds = await bar.boundingBox();
  if (!first || !second || !bounds) throw new Error('Cross-day bar has no bounds');
  expect(bounds.y).toBeLessThanOrEqual(first.y);
  expect(bounds.y + bounds.height).toBeGreaterThan(second.y + second.height);
  await bar.scrollIntoViewIfNeeded();
  const coveredDivider = await bar.evaluate((element) => {
    const style = getComputedStyle(element);
    const start = Number(style.gridRowStart);
    const end = Number(style.gridRowEnd);
    const divider = Array.from(element.parentElement?.children ?? []).find((child) => {
      const row = Number(getComputedStyle(child).gridRowStart);
      return child.getAttribute('aria-hidden') === 'true' && row > start && row < end;
    });
    if (!divider) return false;
    const y = divider.getBoundingClientRect().top;
    const x = element.getBoundingClientRect().left + 10;
    return element.contains(document.elementFromPoint(x, y));
  });
  expect(coveredDivider).toBe(true);
  await page.evaluate(() => document.fonts.ready);
  await page.locator('[aria-labelledby="availability-week-title"]').screenshot({
    path: testInfo.outputPath('availability-continuous-booking-th.png'),
    animations: 'disabled',
    style: 'header { visibility: hidden !important; }',
  });
  const detail = await bar.boundingBox();
  const date = await page.locator('[data-availability-date="2026-10-06"]').boundingBox();
  const scroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
  if (!detail || !date) throw new Error('Booking detail has no bounds');
  await page.screenshot({
    path: testInfo.outputPath('availability-continuous-booking-detail-th.png'),
    fullPage: true,
    animations: 'disabled',
    style: 'header { visibility: hidden !important; }',
    clip: {
      x: date.x + scroll.x - 8,
      y: detail.y + scroll.y - 12,
      width: detail.x + detail.width - date.x + 16,
      height: detail.height + 24,
    },
  });
});

test('weekly views carry earlier slots and deleting a spanning bar removes the whole range', async ({
  page,
}) => {
  const queries: URLSearchParams[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/v1/tutors/me/availability') queries.push(url.searchParams);
  });
  const deleted: string[] = [];
  await mockAvailability(page, {
    deleted,
    additionalSlots: [
      {
        id: 'incoming-slot',
        startAtUtc: '2026-10-04T16:00:00.000Z',
        endAtUtc: '2026-10-05T00:00:00.000Z',
        createdAt: '2026-10-01T00:00:00.000Z',
        state: 'OPEN',
      },
    ],
  });
  const incoming = page.locator('[data-availability-slot="incoming-slot"]');
  await expect(incoming).toHaveAttribute('data-availability-day', '2026-10-05');
  await expect(incoming.locator('strong')).toHaveText('00:00–07:00');
  expect(queries.length).toBeGreaterThan(0);
  expect(
    queries.every(
      (query) => query.get('rangeMode') === 'overlap' && query.has('from') && query.has('to'),
    ),
  ).toBe(true);
  expect(queries[0]?.get('from')).toBe('2026-10-04T17:00:00.000Z');
  expect(queries[0]?.get('to')).toBe('2026-10-11T17:00:00.000Z');
  await expect(incoming.locator('p')).toHaveText('ต่อเนื่อง · 4–5 ต.ค. 2569');
  await page.locator('[data-week="2026-09-28"]').click();
  await expect(incoming).toHaveAttribute('data-availability-day', '2026-10-04');
  await expect(incoming.locator('strong')).toHaveText('23:00–24:00');
  await page.locator('[data-week="2026-10-05"]').click();
  await expect(incoming).toHaveAttribute('data-availability-day', '2026-10-05');
  const continuation = page.locator(
    '[data-availability-slot="overnight-slot"][data-availability-end-day="2026-10-10"]',
  );
  await continuation.getByRole('button', { name: /^ลบช่วงเวลา / }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('ช่วงเวลานี้จะถูกนำออกจากทุกวันที่แสดงในตารางของคุณ');
  await expect(dialog.locator('#availability-delete-time time')).toHaveText([
    '8 ต.ค. 2569',
    '22:00',
    '10 ต.ค. 2569',
    '01:00',
  ]);
  await dialog.getByRole('button', { name: 'ลบช่วงเวลา', exact: true }).click();
  await expect(page.locator('[data-availability-slot="overnight-slot"]')).toHaveCount(0);
  expect(deleted).toEqual(['overnight-slot']);
  await expect(incoming).toBeVisible();
});

test('a continuous multi-week bar clearly marks clipped endpoints without adding midnight rows', async ({
  page,
}) => {
  await mockAvailability(page, {
    slots: [
      {
        id: 'multi-week-slot',
        startAtUtc: '2026-10-01T00:00:00.000Z',
        endAtUtc: '2026-10-12T20:00:00.000Z',
        createdAt: '2026-10-01T00:00:00.000Z',
        state: 'OPEN',
      },
    ],
  });
  const bar = page.locator('[data-availability-slot="multi-week-slot"]');
  await expect(bar).toHaveCount(1);
  await expect(bar.locator('strong')).toHaveText(['00:00', '24:00']);
  await expect(bar.getByText('ต่อเนื่อง', { exact: true })).toBeVisible();
  await expect(bar.getByText('ต่อไป', { exact: true })).toBeVisible();
  await expect(page.locator('[data-availability-date]')).toHaveCount(7);
  await expect(bar.locator('p')).toHaveText(['5 ต.ค. 2569', '11 ต.ค. 2569']);
  await page.locator('[data-week="2026-10-12"]').click();
  await expect(bar).toHaveCount(1);
  await expect(bar.locator('strong')).toHaveText(['00:00', '03:00']);
  await expect(bar.getByText('ต่อเนื่อง', { exact: true })).toBeVisible();
  await expect(bar.getByText('จบ', { exact: true })).toBeVisible();
  await expect(page.locator('[data-availability-date]')).toHaveCount(2);
  await page.getByRole('button', { name: 'เปลี่ยนภาษาเป็นภาษาอังกฤษ' }).click();
  await expect(bar.getByText('Continued', { exact: true })).toBeVisible();
  await expect(bar.getByText('End', { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(1);
});

test('compact week reel changes the existing API range with scrolling, dragging, keyboard, and reset', async ({
  page,
  hasTouch,
}, testInfo) => {
  const requestedUntil: string[] = [];
  await mockAvailability(page, { requestedUntil });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const ruler = page.getByRole('group', { name: 'เลือกสัปดาห์', exact: true });
  const track = ruler.locator('[data-week-track]');
  const selected = ruler.getByRole('button', { pressed: true });
  await expect(selected).toHaveAttribute('data-week', '2026-10-05');
  await expect(ruler.getByRole('button')).toHaveCount(25);
  expect((await ruler.boundingBox())?.height).toBeLessThanOrEqual(72);
  expect((await ruler.boundingBox())?.width).toBeLessThanOrEqual(416);
  const isCentered = () =>
    track.evaluate((element) => {
      const button = element.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
      return button
        ? Math.abs(
            button.offsetLeft +
              button.offsetWidth / 2 -
              element.scrollLeft -
              element.clientWidth / 2,
          ) <= 1
        : false;
    });
  await ruler.locator('[data-week="2026-09-28"]').click();
  await expect(selected).toHaveAttribute('data-week', '2026-09-28');
  await expect(ruler.getByRole('status')).toContainText('กันยายน');
  await expect(ruler.getByRole('status')).toContainText('ตุลาคม');
  await expect.poll(() => requestedUntil.at(-1)).toBe('2026-10-04T17:00:00.000Z');
  await page.getByRole('button', { name: 'สัปดาห์นี้', exact: true }).click();
  await expect(selected).toHaveAttribute('data-week', '2026-10-05');
  await expect.poll(() => requestedUntil.at(-1)).toBe('2026-10-11T17:00:00.000Z');
  await selected.focus();
  await page.keyboard.press('ArrowRight');
  await expect(selected).toHaveAttribute('data-week', '2026-10-12');
  await expect(selected).toBeFocused();
  await expect.poll(isCentered).toBe(true);
  await track.hover();
  await page.mouse.wheel(128, 0);
  await expect(selected).toHaveAttribute('data-week', '2026-10-19');
  await expect.poll(isCentered).toBe(true);
  const bounds = await track.boundingBox();
  expect(bounds).not.toBeNull();
  if (bounds) {
    const x = bounds.x + bounds.width * 0.7;
    const y = bounds.y + bounds.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 128, y, { steps: 8 });
    await page.waitForTimeout(250);
    await expect(selected).toHaveAttribute('data-week', '2026-10-19');
    await page.mouse.up();
    await expect(selected).toHaveAttribute('data-week', '2026-10-26');
    await expect.poll(isCentered).toBe(true);
  }
  await selected.focus();
  for (let index = 0; index < 3; index++) await page.keyboard.press('PageDown');
  await expect(selected).toHaveAttribute('data-week', '2027-01-18');
  await expect(ruler.getByRole('button')).toHaveCount(25);
  await expect(selected).toBeFocused();
  await expect.poll(isCentered).toBe(true);
  await ruler.locator('[data-week="2026-12-28"]').click();
  await expect(ruler.getByRole('status')).toContainText('2569');
  await expect(ruler.getByRole('status')).toContainText('2570');
  expect(
    await selected
      .locator('span')
      .last()
      .evaluate((span) => span.scrollWidth <= span.clientWidth),
  ).toBe(true);
  await page.getByRole('button', { name: 'สัปดาห์นี้', exact: true }).click();
  await expect(selected).toHaveAttribute('data-week', '2026-10-05');
  if (hasTouch) {
    await expect.poll(isCentered).toBe(true);
    const touchBounds = await track.boundingBox();
    expect(touchBounds).not.toBeNull();
    if (touchBounds) {
      const client = await page.context().newCDPSession(page);
      const x = touchBounds.x + touchBounds.width * 0.75;
      const y = touchBounds.y + touchBounds.height / 2;
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x, y }],
      });
      for (let step = 1; step <= 8; step++) {
        await client.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: x - step * 16, y }],
        });
        await page.waitForTimeout(32);
      }
      await page.waitForTimeout(100);
      await expect(selected).toHaveAttribute('data-week', '2026-10-05');
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect(selected).toHaveAttribute('data-week', '2026-10-12');
      await expect.poll(isCentered).toBe(true);
      await client.detach();
      await page.getByRole('button', { name: 'สัปดาห์นี้', exact: true }).click();
      await expect(selected).toHaveAttribute('data-week', '2026-10-05');
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await selected.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(selected).toHaveAttribute('data-week', '2026-09-28');
  await expect.poll(isCentered).toBe(true);
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect.poll(isCentered).toBe(true);
    await expect(selected).toHaveAttribute('data-week', '2026-09-28');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    expect((await ruler.boundingBox())?.height).toBeLessThanOrEqual(72);
    await page.locator('[aria-labelledby="availability-week-title"]').screenshot({
      path: testInfo.outputPath(`week-reel-th-${width}.png`),
      animations: 'disabled',
    });
  }
  await page.getByRole('button', { name: 'เปลี่ยนภาษาเป็นภาษาอังกฤษ' }).click();
  const english = page.getByRole('group', { name: 'Choose a week', exact: true });
  await expect(english.getByRole('status')).toContainText('September');
  await expect(english.getByRole('status')).toContainText('October');
  await expect(english.getByRole('status')).toContainText('2026');
  await page.getByRole('button', { name: 'This week', exact: true }).click();
  await expect(english.getByRole('button', { pressed: true })).toHaveAttribute(
    'data-week',
    '2026-10-05',
  );
  await expect(page.locator('[data-availability-slot="open-slot"]')).toBeVisible();
});
