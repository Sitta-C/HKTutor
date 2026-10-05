import { expect, test } from '@playwright/test';

import type { TeachingListing, TutorAvailabilitySlot, TutorBookingView } from '@/lib/api/types';
import type { Page, Route } from '@playwright/test';

const now = new Date('2026-10-05T02:00:00Z');

test.beforeEach(async ({ context, baseURL, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await context.addCookies([
    { name: 'hktutor_refresh', value: 'ui-test-session', url: baseURL ?? 'http://localhost:3000' },
  ]);
});
const tutorUser = {
  id: 'tutor-ui',
  email: 'tutor@example.test',
  role: 'TUTOR',
  displayName: 'Anan',
};
const profile = {
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

function booking(
  id: string,
  name: string,
  status: TutorBookingView['status'],
  startAtUtc: string,
): TutorBookingView {
  return {
    id,
    status,
    student: { nickname: name },
    listing: {
      id: 'listing-math',
      subjectId: 'math',
      subjectName: 'Mathematics',
      gradeLevelId: 'g10',
      gradeLevelName: 'Grade 10',
      pricePerHour: '450.00',
      description: 'Mathematics lessons',
    },
    slot: {
      id: `slot-${id}`,
      startAtUtc,
      endAtUtc: new Date(Date.parse(startAtUtc) + 3_600_000).toISOString(),
    },
    subtotalAmount: '450.00',
    discountAmount: '0.00',
    netAmount: '450.00',
    currency: 'THB',
    createdAt: '2026-10-01T00:00:00Z',
  };
}

function listing(
  id: string,
  publicationStatus: TeachingListing['publicationStatus'],
): TeachingListing {
  return {
    id,
    publicationStatus,
    subject: { id: 'math', code: 'MATH', name: 'Mathematics', active: true },
    gradeLevel: { id: 'g10', code: 'G10', name: 'Grade 10', active: true, sortOrder: 10 },
    description: 'Mathematics lessons',
    pricePerHour: 450,
    publishedAt: null,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  };
}

const teachingBookings = [
  booking('pending-early', 'Som', 'PENDING', '2026-10-05T03:00:00Z'),
  booking('confirmed-later', 'Nan', 'CONFIRMED', '2026-10-05T10:00:00Z'),
  booking('past-pending', 'First', 'PENDING', '2026-09-30T06:00:00Z'),
  booking('confirmed-next', 'Korpai', 'CONFIRMED', '2026-10-05T06:00:00Z'),
  booking('future-pending', 'Nan', 'PENDING', '2026-10-06T10:00:00Z'),
];
const listings = [
  listing('listing-math', 'PUBLISHED'),
  listing('draft', 'DRAFT'),
  listing('archived', 'ARCHIVED'),
];
const slots: TutorAvailabilitySlot[] = [
  {
    id: 'reserved',
    state: 'RESERVED',
    startAtUtc: '2026-10-05T10:00:00Z',
    endAtUtc: '2026-10-05T11:00:00Z',
    createdAt: '2026-10-01T00:00:00Z',
  },
  {
    id: 'open',
    state: 'OPEN',
    startAtUtc: '2026-10-05T08:00:00Z',
    endAtUtc: '2026-10-05T09:00:00Z',
    createdAt: '2026-10-01T00:00:00Z',
  },
];

async function mockDashboard(
  page: Page,
  options: {
    empty?: boolean;
    fail?: boolean;
    bookings?: TutorBookingView[];
    listings?: TeachingListing[];
  } = {},
) {
  const calls: string[] = [];
  await page.clock.setFixedTime(now);
  await page.addInitScript(() => window.localStorage.setItem('hktutor-language', 'th'));
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    calls.push(`${request.method()} ${path}`);
    if (path === '/auth/refresh')
      return json(route, { accessToken: 'ui-test-token', user: tutorUser });
    if (path === '/profiles/me') return json(route, profile);
    if (path === '/bookings/tutor') {
      if (options.fail) return json(route, { message: 'Service unavailable' }, 500);
      const items = options.empty ? [] : (options.bookings ?? teachingBookings);
      const params = new URL(request.url()).searchParams;
      const pageNumber = Number(params.get('page') ?? 1);
      const pageSize = Number(params.get('pageSize') ?? 100);
      return json(route, {
        items: items.slice((pageNumber - 1) * pageSize, pageNumber * pageSize),
        total: items.length,
      });
    }
    if (path === '/tutors/me/listings')
      return json(route, options.empty ? [] : (options.listings ?? listings));
    if (path === '/tutors/me/availability') return json(route, options.empty ? [] : slots);
    return json(route, { message: `Unexpected UI request: ${path}` }, 500);
  });
  return calls;
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function expectResponsiveShell(page: Page) {
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(1);
  if ((page.viewportSize()?.width ?? 0) < 1024) {
    await page.getByRole('button', { name: /^(เปิดแถบข้าง|Open sidebar)$/ }).click();
    await expect(page.locator('#dashboard-sidebar')).toBeVisible();
    await page
      .locator('#dashboard-sidebar')
      .getByRole('button', { name: /^(ปิดแถบข้าง|Close sidebar)$/ })
      .click();
  } else {
    const sidebar = await page.locator('#dashboard-sidebar').boundingBox();
    const main = await page.locator('main').boundingBox();
    expect(sidebar).not.toBeNull();
    expect(main).not.toBeNull();
    if (sidebar && main) {
      expect(main.x).toBeGreaterThanOrEqual(sidebar.x + sidebar.width);
    }
  }
}

test('Notebook Focus uses existing data and keeps only contextual management links', async ({
  page,
}, testInfo) => {
  const calls = await mockDashboard(page);
  await page.goto('/dashboard');
  const next = page.getByRole('region', { name: 'คาบถัดไป' });
  await expect(next.getByRole('heading', { name: 'Korpai' })).toBeVisible();
  await expect(next).toContainText('13:00–14:00');
  await expect(next).toContainText('2569');
  await expect(next.getByText('ยืนยันแล้ว', { exact: true })).toBeVisible();
  const requests = page.getByRole('region', { name: 'คำขอจองที่รอตอบ' });
  await expect(requests.getByRole('listitem')).toHaveCount(2);
  await expect(requests.getByRole('heading', { level: 3 }).first()).toHaveText('Som');
  await expect(requests.getByRole('heading', { name: 'First', exact: true })).toHaveCount(0);
  await expect(
    requests.getByRole('switch', { name: 'แสดงคำขอที่วันเรียนผ่านแล้ว' }),
  ).not.toBeChecked();
  await expect(requests.getByRole('button')).toHaveCount(0);
  const availability = page.getByRole('region', { name: 'วันนี้ · เวลาตามกรุงเทพฯ' });
  await expect(availability.getByRole('listitem').first()).toContainText('15:00–16:00');
  await expect(availability.getByText('ว่าง', { exact: true })).toBeVisible();
  await expect(availability.getByText('ถูกจอง', { exact: true })).toBeVisible();
  const analytics = page.getByRole('region', { name: 'ภาพรวมการสอน', exact: true });
  await expect(analytics.locator('dl').first().locator('dd > span:first-child')).toHaveText([
    '2',
    '2',
    '฿900.00',
    '—',
  ]);
  await expect(analytics.getByText('ยังไม่มีข้อมูลรีวิว', { exact: true })).toBeVisible();
  const courses = page.getByRole('region', { name: 'ภาพรวมรายคอร์ส', exact: true });
  await expect(
    courses.getByRole('group', { name: 'วิชาของคอร์ส' }).getByRole('button'),
  ).toHaveCount(1);
  await expect(courses.locator('dd')).toHaveCount(0);
  await expect(courses.getByRole('listitem')).toHaveCount(3);
  await courses.getByRole('listitem').first().getByRole('button').click();
  await expect(courses.getByRole('listitem')).toHaveCount(3);
  await expect(courses.locator('dd')).toHaveText(['2', '2', '2', '฿900.00']);
  const main = page.locator('main');
  await expect(main.getByRole('link', { name: 'สร้างคอร์สใหม่', exact: true })).toHaveCount(0);
  await expect(main.getByRole('heading', { name: 'คอร์สของฉัน', exact: true })).toHaveCount(0);
  await expect(main.getByRole('link', { name: 'จัดการตารางว่าง' })).toHaveCount(1);
  await expect(main.getByText('เมนูลัด')).toHaveCount(0);
  await expect(main.getByText('รายได้ที่ได้รับแล้ว', { exact: true })).toBeVisible();
  await expect(main.getByText('ความสมบูรณ์โปรไฟล์')).toHaveCount(0);
  await expect(main.getByRole('searchbox')).toHaveCount(0);
  await expect(page.locator('header').getByRole('link')).toHaveCount(0);
  expect([...new Set(calls)].sort()).toEqual([
    'GET /bookings/tutor',
    'GET /profiles/me',
    'GET /tutors/me/availability',
    'GET /tutors/me/listings',
    'POST /auth/refresh',
  ]);
  await expectResponsiveShell(page);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: testInfo.outputPath('tutor-dashboard-th.png'),
    fullPage: true,
    animations: 'disabled',
    scale: 'css',
  });
  await page.getByRole('button', { name: 'เปลี่ยนภาษาเป็นภาษาอังกฤษ' }).click();
  await expect(page.getByRole('heading', { name: 'Next session' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Booking requests' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Course performance', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Teaching insights', exact: true })).toBeVisible();
});

test('pending-only requests never appear as a confirmed next session', async ({ page }) => {
  await mockDashboard(page, {
    bookings: teachingBookings.filter((item) => item.status === 'PENDING'),
  });
  await page.goto('/dashboard');
  await expect(page.getByRole('region', { name: 'คาบถัดไป' })).toContainText(
    'ยังไม่มีคาบที่ยืนยันแล้วกำลังจะมาถึง',
  );
  await expect(
    page.getByRole('region', { name: 'คำขอจองที่รอตอบ' }).getByRole('listitem'),
  ).toHaveCount(2);
});

test('bookmark switch reveals past requests without making another API request', async ({
  page,
}, testInfo) => {
  const calls = await mockDashboard(page);
  await page.goto('/dashboard');
  const requests = page.getByRole('region', { name: 'คำขอจองที่รอตอบ' });
  const toggle = requests.getByRole('switch', { name: 'แสดงคำขอที่วันเรียนผ่านแล้ว' });
  await expect(toggle).not.toBeChecked();
  await expect(requests.getByRole('listitem')).toHaveCount(2);
  const callCount = calls.length;
  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(toggle).toBeChecked();
  await expect(requests.getByRole('listitem')).toHaveCount(3);
  const pastRow = requests.getByRole('listitem').filter({ hasText: 'First' });
  await expect(pastRow.getByText('วันเรียนผ่านแล้ว')).toBeVisible();
  expect(calls.length).toBe(callCount);
  await page.keyboard.press('Tab');
  await page.evaluate(() => document.fonts.ready);
  await requests.evaluate((element) => {
    window.scrollTo({ top: window.scrollY + element.getBoundingClientRect().top - 100 });
  });
  await requests.screenshot({
    path: testInfo.outputPath('tutor-requests-bookmark.png'),
    animations: 'disabled',
    scale: 'css',
  });
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await page.screenshot({
    path: testInfo.outputPath('tutor-dashboard-past-visible.png'),
    fullPage: true,
    animations: 'disabled',
    scale: 'css',
  });
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(requests.getByRole('listitem')).toHaveCount(2);
  await expect(pastRow).toHaveCount(0);
  await page.getByRole('button', { name: 'เปลี่ยนภาษาเป็นภาษาอังกฤษ' }).click();
  const englishToggle = page.getByRole('switch', { name: 'Include past lesson requests' });
  await englishToggle.click();
  await expect(englishToggle).toBeChecked();
  await expect(page.getByText('Lesson date has passed')).toBeVisible();
});

test('past-only requests stay recoverable from the note switch', async ({ page }) => {
  await mockDashboard(page, {
    bookings: [booking('past-only', 'First', 'PENDING', '2026-09-30T06:00:00Z')],
  });
  await page.goto('/dashboard');
  const requests = page.getByRole('region', { name: 'คำขอจองที่รอตอบ' });
  await expect(requests.getByText('ไม่มีคำขอจองสำหรับคาบที่กำลังจะมาถึง')).toBeVisible();
  await expect(requests.getByRole('listitem')).toHaveCount(0);
  await requests.getByRole('switch', { name: 'แสดงคำขอที่วันเรียนผ่านแล้ว' }).click();
  await expect(requests.getByRole('listitem')).toHaveCount(1);
  await expect(requests.getByRole('heading', { name: 'First', exact: true })).toBeVisible();
});

test('empty dashboard presents honest empty states with working existing routes', async ({
  page,
}, testInfo) => {
  await mockDashboard(page, { empty: true });
  await page.goto('/dashboard');
  await expect(page.getByText('ยังไม่มีคาบที่ยืนยันแล้วกำลังจะมาถึง')).toBeVisible();
  await expect(page.getByText('ไม่มีคำขอจองที่รอการตอบรับ')).toBeVisible();
  await expect(page.getByText('คุณยังไม่ได้สร้างคอร์สสอน')).toBeVisible();
  await expect(page.getByText('ไม่มีสล็อตเวลาว่างที่กำหนดไว้สำหรับวันนี้')).toBeVisible();
  await expect(page.locator('main').getByRole('link', { name: 'สร้างคอร์สใหม่' })).toHaveAttribute(
    'href',
    '/dashboard/listings/new',
  );
  await expect(page.locator('main').getByRole('link', { name: 'จัดการตารางว่าง' })).toHaveAttribute(
    'href',
    '/dashboard/availability',
  );
  await expectResponsiveShell(page);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: testInfo.outputPath('tutor-dashboard-empty.png'),
    fullPage: true,
    animations: 'disabled',
    scale: 'css',
  });
});

test('unavailable data shows an error instead of empty or zero dashboard summaries', async ({
  page,
}) => {
  await mockDashboard(page, { fail: true });
  await page.goto('/dashboard');
  await expect(page.locator('main').getByRole('alert')).toHaveText(
    'ไม่สามารถโหลดข้อมูลสรุปแดชบอร์ดได้',
  );
  await expect(page.getByRole('heading', { name: 'คาบถัดไป' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'คำขอจองที่รอตอบ' })).toHaveCount(0);
});

test('all subject courses remain visible independently of request pagination and month changes', async ({
  page,
}, testInfo) => {
  const manyBookings = Array.from({ length: 102 }, (_, index) =>
    booking(
      `request-${index}`,
      `Student ${String(index + 1).padStart(3, '0')}`,
      'PENDING',
      new Date(Date.UTC(2026, 9, 5 + index, 3)).toISOString(),
    ),
  );
  manyBookings.push(booking('past', 'Past student', 'PENDING', '2026-09-30T06:00:00Z'));
  const manyListings = Array.from({ length: 7 }, (_, index) => ({
    ...listing(`course-${index}`, 'PUBLISHED'),
    gradeLevel: {
      id: `grade-${index}`,
      code: `G${index}`,
      name: `Grade ${index + 1}`,
      active: true,
      sortOrder: index,
    },
  }));
  const calls = await mockDashboard(page, { bookings: manyBookings, listings: manyListings });
  await page.goto('/dashboard');
  const requests = page.getByRole('region', { name: 'คำขอจองที่รอตอบ' });
  await expect(requests.getByRole('listitem')).toHaveCount(5);
  await expect(requests.getByRole('heading', { level: 2 })).toContainText('102');
  const requestPages = requests.getByRole('navigation', { name: 'หน้าคำขอจอง' });
  await requestPages.getByRole('button', { name: 'ถัดไป', exact: true }).click();
  await expect(requests.getByRole('heading', { level: 3 }).first()).toHaveText('Student 006');
  const courses = page.getByRole('region', { name: 'ภาพรวมรายคอร์ส', exact: true });
  await expect(courses.getByRole('listitem')).toHaveCount(7);
  await expect(courses.getByRole('navigation')).toHaveCount(0);
  await expect(requestPages).toContainText('หน้า 2 จาก 21');
  await courses.getByRole('listitem').last().getByRole('button').click();
  await expect(courses.getByRole('button', { pressed: true }).last()).toContainText('Grade 7');
  await expect(courses.locator('dd')).toHaveCount(4);
  await requests.getByRole('switch').click();
  await expect(requests.getByRole('heading', { level: 3 }).first()).toHaveText('Past student');
  await expect(requestPages).toContainText('หน้า 1 จาก 21');
  await expect(courses.getByRole('listitem')).toHaveCount(7);
  const callCount = calls.length;
  await page
    .getByRole('group', { name: 'เดือนของภาพรวมการสอน' })
    .getByRole('button', { name: 'กันยายน 2569', exact: true })
    .click();
  await expect(courses.getByRole('button', { pressed: true }).last()).toContainText('Grade 7');
  await expect(courses.locator('dd')).toHaveText(['0', '0', '0', '฿0.00']);
  await expect(requests.getByRole('switch')).toBeChecked();
  await page
    .getByRole('group', { name: 'เดือนของภาพรวมการสอน' })
    .getByRole('button', { name: 'ตุลาคม 2569', exact: true })
    .click();
  expect(calls.length).toBe(callCount);
  await expectResponsiveShell(page);
  await page.evaluate(() => document.fonts.ready);
  await courses.screenshot({
    path: testInfo.outputPath('tutor-course-index-all-courses.png'),
    style: 'header { visibility: hidden !important; }',
    animations: 'disabled',
    scale: 'css',
  });
  await page.setViewportSize({ width: 320, height: 840 });
  await expect(courses.getByRole('listitem')).toHaveCount(7);
  await expectResponsiveShell(page);
});

test('switching analytics months updates real booking totals and leaves earnings and reviews unavailable', async ({
  page,
}, testInfo) => {
  await mockDashboard(page);
  await page.goto('/dashboard');
  const analytics = page.getByRole('region', { name: 'ภาพรวมการสอน', exact: true });
  await expect(analytics.locator('dl').first().locator('dd > span:first-child')).toHaveText([
    '2',
    '2',
    '฿900.00',
    '—',
  ]);
  await page
    .getByRole('group', { name: 'เดือนของภาพรวมการสอน' })
    .getByRole('button', { name: 'กันยายน 2569', exact: true })
    .click();
  await expect(analytics.locator('dl').first().locator('dd > span:first-child')).toHaveText([
    '0',
    '0',
    '฿0.00',
    '—',
  ]);
  await expect(analytics.getByText('ยังไม่มีคาบที่ยืนยันในเดือนนี้')).toBeVisible();
  await expect(analytics.getByText('ยังไม่มีข้อมูลรีวิว')).toBeVisible();
  await page
    .getByRole('group', { name: 'เดือนของภาพรวมการสอน' })
    .getByRole('button', { name: 'ตุลาคม 2569', exact: true })
    .click();
  await expect(analytics.locator('dl').first().locator('dd > span:first-child')).toHaveText([
    '2',
    '2',
    '฿900.00',
    '—',
  ]);
  const courses = page.getByRole('region', { name: 'ภาพรวมรายคอร์ส', exact: true });
  await courses.getByRole('listitem').first().getByRole('button').click();
  await page.evaluate(() => document.fonts.ready);
  await analytics.screenshot({
    path: testInfo.outputPath('tutor-analytics.png'),
    style: 'header { visibility: hidden !important; }',
    animations: 'disabled',
    scale: 'css',
  });
});

test('subject index groups many subjects with stable colors and supports repeated keyboard selection', async ({
  page,
}, testInfo) => {
  const otherSubjects = ['Physics', 'Chemistry', 'Biology', 'English', 'Computer', 'History'];
  const additionalListings = otherSubjects.flatMap((name) =>
    Array.from({ length: name === 'Physics' ? 6 : 1 }, (_, index) => ({
      ...listing(`${name}-${index}`, index === 0 ? 'DRAFT' : 'PUBLISHED'),
      subject: { id: name.toLowerCase(), code: name.toUpperCase(), name, active: true },
      gradeLevel: {
        id: `g${index}`,
        code: `G${index}`,
        name: `Grade ${index + 1}`,
        active: true,
        sortOrder: index,
      },
    })),
  );
  const calls = await mockDashboard(page, { listings: [...listings, ...additionalListings] });
  await page.goto('/dashboard');
  const courses = page.getByRole('region', { name: 'ภาพรวมรายคอร์ส', exact: true });
  const subjects = courses.getByRole('group', { name: 'วิชาของคอร์ส' });
  await expect(subjects.getByRole('button')).toHaveCount(7);
  const math = subjects.getByRole('button', { name: 'Mathematics 3', exact: true });
  const physics = subjects.getByRole('button', { name: 'Physics 6', exact: true });
  const callCount = calls.length;
  await math.click();
  await courses.getByRole('listitem').first().getByRole('button').click();
  await expect(courses.locator('dd')).toHaveText(['2', '2', '2', '฿900.00']);
  const mathColor = await math.evaluate((element) => getComputedStyle(element).borderLeftColor);
  const physicsColor = await physics.evaluate(
    (element) => getComputedStyle(element).borderLeftColor,
  );
  expect(mathColor).not.toBe(physicsColor);
  await physics.focus();
  await page.keyboard.press('Enter');
  await expect(physics).toHaveAttribute('aria-pressed', 'true');
  await expect(courses.locator('dd')).toHaveCount(0);
  await expect(courses.getByRole('listitem')).toHaveCount(6);
  const choices = courses.getByRole('list', { name: 'คอร์สวิชา Physics' }).getByRole('button');
  await choices.first().focus();
  await page.keyboard.press('End');
  await expect(choices.last()).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(courses.locator('dd')).toHaveText(['0', '0', '0', '฿0.00']);
  await expect(choices.last()).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Home');
  await page.keyboard.press('Space');
  await expect(choices.first()).toHaveAttribute('aria-pressed', 'true');
  await expect(courses.getByRole('listitem')).toHaveCount(6);
  await subjects.getByRole('button', { name: 'History 1', exact: true }).click();
  await expect(courses.getByRole('listitem')).toHaveCount(1);
  await physics.click();
  await expect(courses.getByRole('listitem')).toHaveCount(6);
  expect(await physics.evaluate((element) => getComputedStyle(element).borderLeftColor)).toBe(
    physicsColor,
  );
  await choices.first().click();
  await page
    .getByRole('group', { name: 'เดือนของภาพรวมการสอน' })
    .getByRole('button', { name: 'กันยายน 2569', exact: true })
    .click();
  await expect(physics).toHaveAttribute('aria-pressed', 'true');
  await expect(choices.first()).toHaveAttribute('aria-pressed', 'true');
  await expect(courses.locator('dd')).toHaveCount(4);
  expect(calls.length).toBe(callCount);
  await expectResponsiveShell(page);
  await page.evaluate(() => document.fonts.ready);
  await courses.screenshot({
    path: testInfo.outputPath('tutor-subject-index.png'),
    style: 'header { visibility: hidden !important; }',
    animations: 'disabled',
    scale: 'css',
  });
  await page.setViewportSize({ width: 320, height: 840 });
  await expectResponsiveShell(page);
  await page.getByRole('button', { name: 'เปลี่ยนภาษาเป็นภาษาอังกฤษ' }).click();
  await expect(page.getByRole('group', { name: 'Course subjects' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Physics courses' })).toBeVisible();
  await expectResponsiveShell(page);
});

test('course summary expands beneath its own row with repeat toggles, keyboard and reduced motion', async ({
  page,
}) => {
  const calls = await mockDashboard(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/dashboard');
  const courses = page.getByRole('region', { name: 'ภาพรวมรายคอร์ส', exact: true });
  const choices = courses.getByRole('listitem').getByRole('button');
  await choices.first().click();
  const toggle = choices.first();
  const detailsId = await toggle.getAttribute('aria-controls');
  expect(detailsId).not.toBeNull();
  const details = page.locator(`[id="${detailsId}"]`);
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(details.locator('dl')).toBeVisible();
  const firstRow = courses.getByRole('listitem').first();
  await expect(firstRow.locator(`[id="${detailsId}"]`)).toHaveCount(1);
  const placement = await details.evaluate((element) => ({
    isBelowTrigger: element.previousElementSibling?.getAttribute('aria-controls') === element.id,
    isInsideRow: element.parentElement?.tagName === 'LI',
  }));
  expect(placement).toEqual({ isBelowTrigger: true, isInsideRow: true });
  const expandedHeight = await details.evaluate((element) => {
    for (const animation of element.getAnimations()) animation.finish();
    return element.getBoundingClientRect().height;
  });
  expect(expandedHeight).toBeGreaterThan(40);
  const callCount = calls.length;
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(details).toHaveAttribute('inert', '');
  await expect(details).toHaveAttribute('aria-hidden', 'true');
  const halfwayHeight = await details.evaluate((element) => {
    const animation = element.getAnimations()[0];
    if (!animation) return null;
    animation.pause();
    animation.currentTime = 110;
    const height = element.getBoundingClientRect().height;
    animation.finish();
    return height;
  });
  expect(halfwayHeight).not.toBeNull();
  expect(halfwayHeight).toBeGreaterThan(0);
  expect(halfwayHeight).toBeLessThan(expandedHeight);
  await expect(details.locator('dl')).not.toBeVisible();
  await expect
    .poll(() => details.evaluate((element) => element.getBoundingClientRect().height))
    .toBe(0);
  await expect(toggle).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(details.locator('dl')).toBeVisible();
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  const lastToggle = choices.last();
  await lastToggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(lastToggle).toHaveAttribute('aria-expanded', 'true');
  const lastPanelId = await lastToggle.getAttribute('aria-controls');
  const lastDetails = courses.getByRole('listitem').last().locator(`[id="${lastPanelId}"]`);
  await expect(lastDetails.locator('dd')).toHaveText(['0', '0', '0', '฿0.00']);
  await expect(courses.getByRole('region')).toHaveCount(1);
  await expect(courses.getByRole('listitem')).toHaveCount(3);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await lastToggle.click();
  await expect(lastDetails).toHaveCSS('transition-property', 'none');
  await expect
    .poll(() => lastDetails.evaluate((element) => element.getBoundingClientRect().height))
    .toBe(0);
  await lastToggle.click();
  await expect(lastDetails.locator('dl')).toBeVisible();
  await expect(lastDetails).toHaveAttribute('aria-hidden', 'false');
  expect(calls.length).toBe(callCount);
  await page.setViewportSize({ width: 320, height: 840 });
  await expectResponsiveShell(page);
});

test('month ruler selects after scrolling, handles dragging and keyboard, and extends its bounded range', async ({
  page,
}, testInfo) => {
  const calls = await mockDashboard(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/dashboard');
  const ruler = page.getByRole('group', { name: 'เดือนของภาพรวมการสอน' });
  const status = ruler.getByRole('status');
  const track = page.locator('[data-month-track]');
  await expect(status).toHaveText('ตุลาคม 2569');
  await expect(ruler.getByRole('button')).toHaveCount(25);
  const initialBounds = await ruler.boundingBox();
  expect(initialBounds?.height).toBeLessThanOrEqual(72);
  await page.evaluate(() => document.fonts.ready);
  await ruler.screenshot({
    path: testInfo.outputPath('tutor-month-ruler-th.png'),
    style: 'header { visibility: hidden !important; }',
    animations: 'disabled',
    scale: 'css',
  });
  const callCount = calls.length;
  await ruler.getByRole('button', { pressed: true }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(status).toHaveText('กันยายน 2569');
  await expect(ruler.getByRole('button', { pressed: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(status).toHaveText('ตุลาคม 2569');
  const isCentered = () =>
    track.evaluate((element) => {
      const selected = element.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
      if (!selected) return false;
      return (
        Math.abs(
          selected.offsetLeft +
            selected.offsetWidth / 2 -
            element.scrollLeft -
            element.clientWidth / 2,
        ) <= 1
      );
    });
  await expect.poll(isCentered).toBe(true);
  await track.hover();
  // Interrupt programmatic centering as a real horizontal wheel gesture would.
  await page.mouse.wheel(92, 0);
  await expect(status).toHaveText('พฤศจิกายน 2569');
  await expect.poll(isCentered).toBe(true);
  const bounds = await track.boundingBox();
  expect(bounds).not.toBeNull();
  if (bounds) {
    const x = bounds.x + bounds.width * 0.7;
    const y = bounds.y + bounds.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 92, y, { steps: 8 });
    await page.waitForTimeout(250);
    await expect(status).toHaveText('พฤศจิกายน 2569');
    await page.mouse.up();
    await expect(status).toHaveText('ธันวาคม 2569');
    await expect.poll(isCentered).toBe(true);
  }
  await ruler.getByRole('button', { pressed: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(status).toHaveText('มกราคม 2570');
  await page.keyboard.press('PageDown');
  await expect(status).toHaveText('มกราคม 2571');
  await expect(ruler.getByRole('button')).toHaveCount(25);
  await expect(ruler.getByRole('button', { pressed: true })).toBeFocused();
  await expect.poll(isCentered).toBe(true);
  await page.keyboard.press('PageDown');
  await expect(status).toHaveText('มกราคม 2572');
  await expect(ruler.getByRole('button')).toHaveCount(25);
  await expect.poll(isCentered).toBe(true);
  expect(calls.length).toBe(callCount);
  await page.getByRole('button', { name: 'เปลี่ยนภาษาเป็นภาษาอังกฤษ' }).click();
  const english = page.getByRole('group', { name: 'Analytics month' });
  await expect(english.getByRole('status')).toHaveText('January 2029');
  await expect(english.getByRole('button', { pressed: true })).toHaveAccessibleName('January 2029');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await english.getByRole('button', { pressed: true }).focus();
  await page.keyboard.press('PageUp');
  await expect(english.getByRole('status')).toHaveText('January 2028');
  await expect.poll(isCentered).toBe(true);
  await page.setViewportSize({ width: 320, height: 840 });
  await expectResponsiveShell(page);
  await expect.poll(isCentered).toBe(true);
  await english.screenshot({
    path: testInfo.outputPath('tutor-month-ruler.png'),
    style: 'header { visibility: hidden !important; }',
    animations: 'disabled',
    scale: 'css',
  });
});
