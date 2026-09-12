import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const read = (filePath) => fs.readFile(filePath, 'utf8');

test('wires the tutor availability page to the private availability API', async () => {
  const route = await read('apps/web/src/app/dashboard/availability/page.tsx');
  const page = await read('apps/web/src/components/availability/tutor-availability-page.tsx');
  const api = await read('apps/web/src/lib/api/availability.ts');

  assert.match(route, /TutorAvailabilityPage/);
  assert.match(page, /getTutorAvailability/);
  assert.match(page, /createTutorAvailability/);
  assert.match(page, /deleteTutorAvailability/);
  assert.match(api, /\/tutors\/me\/availability/);
  assert.match(api, /method: 'POST'/);
  assert.match(api, /method: 'DELETE'/);
  assert.match(page, /user\.role !== 'TUTOR'/);
});

test('keeps availability display and input explicitly in Bangkok time', async () => {
  const page = await read('apps/web/src/components/availability/tutor-availability-page.tsx');
  const api = await read('apps/web/src/lib/api/availability.ts');
  const navigation = await read('apps/web/src/lib/dashboard-navigation.ts');
  const dashboard = await read('apps/web/src/components/dashboard/tutor-dashboard.tsx');

  assert.match(api, /Asia\/Bangkok/);
  assert.match(api, /BANGKOK_UTC_OFFSET_HOURS = 7/);
  assert.match(api, /Date\.UTC\(year, month - 1, day, hour - BANGKOK_UTC_OFFSET_HOURS/);
  assert.match(page, /bangkokDateTimeToUtc/);
  assert.match(page, /formatBangkokTime/);
  assert.match(navigation, /href: '\/dashboard\/availability'/);
  assert.match(dashboard, /href="\/dashboard\/availability"/);
});

test('protects reserved slots and exposes the required availability states', async () => {
  const page = await read('apps/web/src/components/availability/tutor-availability-page.tsx');
  const types = await read('apps/web/src/lib/api/types.ts');

  assert.match(types, /export type AvailabilityState = 'OPEN' \| 'RESERVED'/);
  assert.match(page, /slot\.state !== 'OPEN'/);
  assert.match(page, /caught\.status === 409/);
  assert.match(page, /availabilityCopy\.reservedError/);
  assert.match(page, /role="alert"/);
  assert.match(page, /role="status"/);
});
