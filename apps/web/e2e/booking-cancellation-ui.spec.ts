import { expect, test } from '@playwright/test';

import type { Page } from '@playwright/test';

// All API traffic is intercepted. These tests never change a real booking.
async function setup(
  page: Page,
  role: 'STUDENT' | 'TUTOR',
  responseStatus = 200,
  responseGate?: Promise<void>,
  language: 'en' | 'th' = 'en',
) {
  let status = 'PENDING';
  const requests: unknown[] = [];
  const booking = {
    id: 'cancel-preview',
    status,
    student: { nickname: 'Mint' },
    tutor: { tutorId: 'tutor-preview', displayName: 'Praew', verificationStatus: 'VERIFIED' },
    listing: {
      id: 'listing',
      subjectId: 'math',
      subjectName: 'Mathematics',
      gradeLevelId: 'grade',
      gradeLevelName: 'Grade 10',
      pricePerHour: '500.00',
      description: '',
    },
    slot: { id: 'slot', startAtUtc: '2099-10-15T03:00:00Z', endAtUtc: '2099-10-15T04:00:00Z' },
    subtotalAmount: '500.00',
    discountAmount: '0.00',
    netAmount: '500.00',
    currency: 'THB',
    createdAt: '2026-10-14T03:00:00Z',
    updatedAt: '2026-10-14T03:00:00Z',
  };
  await page.addInitScript((value) => localStorage.setItem('hktutor-language', value), language);
  await page
    .context()
    .addCookies([{ name: 'hktutor_refresh', value: 'preview', url: 'http://localhost:3000' }]);
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    if (path === '/auth/refresh') {
      return route.fulfill({
        json: {
          accessToken: 'preview',
          user: { id: 'user', email: 'preview@example.test', role, displayName: 'Mint' },
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
            firstName: 'Mint',
            lastName: 'Preview',
            nickname: 'Mint',
            school: 'School',
            gradeLevel: 'Grade 10',
            phone: '0812345678',
            displayName: 'Mint',
            bio: 'Tutor',
            experienceYears: 5,
            verificationStatus: 'VERIFIED',
            ratingAverage: null,
            reviewCount: 0,
          },
        },
      });
    }
    if (path === '/profiles/me/avatar') {
      return route.fulfill({ json: { avatar: null } });
    }
    if (path === '/bookings/cancel-preview/cancel') {
      requests.push(route.request().postDataJSON());
      await responseGate;
      if (responseStatus !== 200) {
        return route.fulfill({
          status: responseStatus,
          json: { code: 'BOOKING_ALREADY_PAID', message: 'paid' },
        });
      }
      status = 'CANCELED';
      return route.fulfill({
        json: { bookingId: booking.id, status, canceledAt: '2026-10-14T03:00:00Z' },
      });
    }
    if (path === '/bookings/me/cancel-preview') {
      return route.fulfill({ json: { ...booking, status } });
    }
    if (path === '/bookings/me' || path === '/bookings/tutor') {
      const filter = url.searchParams.get('status');
      const items = !filter || filter === status ? [{ ...booking, status }] : [];
      return route.fulfill({ json: { items, total: items.length } });
    }
    return route.fulfill({ status: 404, json: { message: 'Unexpected preview request' } });
  });
  await page.goto(
    role === 'STUDENT' ? '/dashboard/bookings/cancel-preview' : '/dashboard/bookings',
  );
  return requests;
}

test('Thai cancellation remains usable at 320px', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 740 });
  const requests = await setup(page, 'STUDENT', 200, undefined, 'th');
  await page.getByRole('button', { name: 'ยกเลิกคลาส', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('เหตุผลในการยกเลิก')).toBeVisible();
  await dialog.getByRole('button', { name: 'ยืนยันยกเลิกคลาส', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('กรุณาระบุเหตุผลในการยกเลิก');
  expect(requests).toHaveLength(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath('cancellation-thai-mobile.png') });
});

for (const role of ['STUDENT', 'TUTOR'] as const) {
  test(`${role} cannot dismiss or submit again while cancellation is pending`, async ({ page }) => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const requests = await setup(page, role, 200, gate);
    await page.getByRole('button', { name: 'Cancel class', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Reason for cancellation').fill('Schedule conflict');
    await dialog.getByRole('button', { name: 'Confirm cancellation' }).click();
    await expect(dialog.getByRole('button', { name: 'Canceling…' })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Keep class' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await expect.poll(() => requests.length).toBe(1);
    release();
    await expect(dialog).not.toBeVisible();
  });

  test(`${role} supplies a reason, confirms cancellation and sees the persisted result`, async ({
    page,
  }) => {
    const requests = await setup(page, role);
    const action = page.getByRole('button', { name: 'Cancel class', exact: true });
    await action.click();
    const dialog = page.getByRole('dialog');
    const bounds = await dialog.boundingBox();
    expect(bounds?.width).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
    await expect(dialog.getByRole('button', { name: 'Keep class' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(action).toBeFocused();
    expect(requests).toHaveLength(0);
    await action.click();
    await dialog.getByLabel('Reason for cancellation').fill('   ');
    await dialog.getByRole('button', { name: 'Confirm cancellation' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Enter a reason for cancellation.');
    expect(requests).toHaveLength(0);
    await dialog.getByLabel('Reason for cancellation').fill('  Schedule conflict  ');
    await dialog.getByRole('button', { name: 'Confirm cancellation' }).click();
    await expect(dialog).not.toBeVisible();
    expect(requests).toEqual([{ reason: 'Schedule conflict' }]);
    if (role === 'STUDENT') {
      await expect(
        page.getByText('This class has already been canceled.', { exact: true }),
      ).toBeVisible();
      await expect(action).toBeDisabled();
    } else {
      await expect(page.getByRole('article')).toHaveCount(0);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });

  test(`${role} explains paid-booking conflicts and prevents an unrefreshed retry`, async ({
    page,
  }) => {
    const requests = await setup(page, role, 409);
    await page.getByRole('button', { name: 'Cancel class', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Reason for cancellation').fill('Schedule conflict');
    await dialog.getByRole('button', { name: 'Confirm cancellation' }).click();
    await expect(dialog.getByRole('alert')).toHaveText(
      'This booking has already been paid and cannot be canceled.',
    );
    await expect(dialog.getByRole('button', { name: 'Confirm cancellation' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Refresh booking' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Keep class' }).click();
    await expect(page.getByRole('button', { name: 'Cancel class', exact: true })).toBeDisabled();
    expect(requests).toHaveLength(1);
    await page.getByRole('button', { name: 'Refresh booking', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Cancel class', exact: true })).toBeEnabled();
  });
}
