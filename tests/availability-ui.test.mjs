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
  const dateTime = await read('apps/web/src/lib/date-time.ts');
  const datePicker = await read('apps/web/src/components/date-time/localized-date-picker.tsx');
  const navigation = await read('apps/web/src/lib/dashboard-navigation.ts');
  const dashboard = await read('apps/web/src/components/dashboard/tutor-dashboard.tsx');

  assert.match(api, /BANGKOK_UTC_OFFSET_HOURS = 7/);
  assert.match(api, /Date\.UTC\(year, month - 1, day, hour - BANGKOK_UTC_OFFSET_HOURS/);
  assert.match(dateTime, /Asia\/Bangkok/);
  assert.match(dateTime, /en-GB-u-ca-gregory/);
  assert.match(dateTime, /th-TH-u-ca-buddhist/);
  assert.match(dateTime, /getBangkokToday/);
  assert.match(dateTime, /formatUtcDateTime/);
  assert.match(page, /bangkokDateTimeToUtc/);
  assert.match(page, /formatBangkokTime/);
  assert.match(page, /LocalizedDatePicker/);
  assert.doesNotMatch(page, /type="date"/);
  assert.match(datePicker, /type="hidden"/);
  assert.match(datePicker, /role="dialog"/);
  assert.match(datePicker, /role="grid"/);
  assert.match(datePicker, /aria-selected/);
  assert.match(navigation, /href: '\/dashboard\/availability'/);
  assert.match(dashboard, /href="\/dashboard\/availability"/);
});

test('keeps availability refreshes race-safe and dashboard states structurally valid', async () => {
  const page = await read('apps/web/src/components/availability/tutor-availability-page.tsx');

  assert.doesNotMatch(page, /function loadAvailability/);
  assert.doesNotMatch(page, /await loadAvailability\(\)/);
  assert.doesNotMatch(page, /<main/);
  assert.doesNotMatch(page, /#[\da-fA-F]{3,8}/);
  assert.match(
    page,
    /profileDisplayName \? \{ \.\.\.user, displayName: profileDisplayName \} : user/,
  );
  assert.match(page, /onAction=\{refreshAvailability\}/);
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
