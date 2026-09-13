import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const read = (filePath) => fs.readFile(filePath, 'utf8');

test('centralizes localized calendar presentation without changing ISO and UTC contracts', async () => {
  const dateTime = await read('apps/web/src/lib/date-time.ts');
  const availabilityApi = await read('apps/web/src/lib/api/availability.ts');

  assert.match(dateTime, /en-GB-u-ca-gregory/);
  assert.match(dateTime, /th-TH-u-ca-buddhist/);
  assert.match(dateTime, /Asia\/Bangkok/);
  assert.match(dateTime, /parseIsoDate/);
  assert.match(availabilityApi, /toISOString\(\)/);
  assert.match(availabilityApi, /BANGKOK_UTC_OFFSET_HOURS = 7/);
});

test('uses the shared localized formatter across every production date surface', async () => {
  const availability = await read(
    'apps/web/src/components/availability/tutor-availability-page.tsx',
  );
  const listings = await read('apps/web/src/components/listings/tutor-listings-page.tsx');
  const search = await read('apps/web/src/components/tutors/tutor-search-page.tsx');
  const authShell = await read('apps/web/src/components/auth-shell.tsx');
  const dashboardShell = await read('apps/web/src/components/dashboard/dashboard-shell.tsx');
  const about = await read('apps/web/src/app/about-me/page.tsx');

  assert.match(availability, /formatBangkokWeekRange/);
  assert.match(listings, /formatBangkokShortDate/);
  assert.match(search, /formatBangkokDateTime/);
  for (const footer of [authShell, dashboardShell, about]) {
    assert.match(footer, /formatBangkokYear/);
    assert.doesNotMatch(footer, /getFullYear\(\)/);
  }
});

test('uses an accessible localized date picker backed by a Gregorian ISO value', async () => {
  const picker = await read('apps/web/src/components/date-time/localized-date-picker.tsx');
  const availability = await read(
    'apps/web/src/components/availability/tutor-availability-page.tsx',
  );

  assert.match(availability, /LocalizedDatePicker/);
  assert.doesNotMatch(availability, /type="date"/);
  assert.match(picker, /type="hidden"/);
  assert.match(picker, /role="dialog"/);
  assert.match(picker, /role="grid"/);
  assert.match(picker, /role="row"/);
  assert.match(picker, /role="gridcell"/);
  assert.match(picker, /ArrowLeft/);
  assert.match(picker, /PageDown/);
  assert.match(picker, /aria-selected/);
});
