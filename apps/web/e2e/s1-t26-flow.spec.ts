import { expect, test } from '@playwright/test';

import type { Route } from '@playwright/test';

const tutorId = '11111111-1111-4111-8111-111111111111';
const listingId = '22222222-2222-4222-8222-222222222222';
const slotId = '33333333-3333-4333-8333-333333333333';
const bookingId = '44444444-4444-4444-8444-444444444444';
const startAtUtc = '2099-09-20T03:00:00.000Z';
const endAtUtc = '2099-09-20T04:00:00.000Z';

const studentUser = {
  id: 'student-e2e',
  email: 'student@example.test',
  role: 'STUDENT' as const,
  displayName: 'Mali',
};
const studentProfile = {
  firstName: 'Mali',
  lastName: 'Sukjai',
  nickname: 'Mali',
  school: 'Bangkok School',
  gradeLevel: 'Grade 10',
  phone: '0812345678',
};
const tutorProfile = {
  firstName: 'Anan',
  lastName: 'Dee',
  nickname: 'Anan',
  displayName: 'Teacher Anan',
  bio: 'Patient mathematics tutor for secondary school students.',
  experienceYears: 5,
  verificationStatus: 'PENDING' as const,
  ratingAverage: null,
  reviewCount: 0,
};
const listing = {
  id: listingId,
  subject: { id: 'subject-math', code: 'MATH', name: 'Mathematics', active: true },
  gradeLevel: {
    id: 'grade-10',
    code: 'GRADE_10',
    name: 'Grade 10',
    active: true,
    sortOrder: 10,
  },
  pricePerHour: 500,
  description: 'Algebra and geometry lessons tailored to the student.',
  publicationStatus: 'PUBLISHED' as const,
  publishedAt: '2099-09-01T00:00:00.000Z',
  createdAt: '2099-09-01T00:00:00.000Z',
  updatedAt: '2099-09-01T00:00:00.000Z',
};
const bookingListing = {
  id: listingId,
  subjectId: 'subject-math',
  subjectName: 'Mathematics',
  gradeLevelId: 'grade-10',
  gradeLevelName: 'Grade 10',
  pricePerHour: '500.00',
  description: listing.description,
};
const bookingSlot = { id: slotId, startAtUtc, endAtUtc };

test('guest slot selection returns through login and onboarding to booking confirmation', async ({
  page,
}) => {
  let authenticated = false;
  let profileComplete = false;

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1', '');

    if (request.method() === 'POST' && path === '/auth/refresh') {
      if (!authenticated) return unauthorized(route);
      return json(route, authResponse(studentUser));
    }
    if (request.method() === 'POST' && path === '/auth/login') {
      authenticated = true;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'set-cookie': 'hktutor_refresh=e2e; Path=/; HttpOnly; SameSite=Lax' },
        body: JSON.stringify(authResponse(studentUser)),
      });
    }
    if (request.method() === 'GET' && path === `/tutors/${tutorId}`) {
      return json(route, {
        tutor: {
          tutorId,
          displayName: tutorProfile.displayName,
          bio: tutorProfile.bio,
          experienceYears: tutorProfile.experienceYears,
          verificationStatus: tutorProfile.verificationStatus,
          ratingAverage: null,
          reviewCount: 0,
        },
        listings: [
          {
            listingId,
            subject: listing.subject.name,
            grade: listing.gradeLevel.name,
            pricePerHour: listing.pricePerHour,
            description: listing.description,
          },
        ],
      });
    }
    if (request.method() === 'GET' && path === `/tutors/${tutorId}/availability`) {
      return json(route, [bookingSlot]);
    }
    if (request.method() === 'GET' && path === '/profiles/me') {
      return json(route, {
        role: studentUser.role,
        consentCurrent: true,
        policyVersion: '2026-01',
        profileComplete,
        profile: profileComplete ? studentProfile : null,
      });
    }
    if (request.method() === 'PUT' && path === '/profiles/me/student') {
      profileComplete = true;
      return json(route, studentProfile);
    }
    if (request.method() === 'GET' && path === '/bookings/quote') {
      return json(route, {
        tutor: {
          tutorId,
          displayName: tutorProfile.displayName,
          verificationStatus: tutorProfile.verificationStatus,
        },
        listing: bookingListing,
        slot: bookingSlot,
        subtotalAmount: '500.00',
        discountAmount: '0.00',
        netAmount: '500.00',
        currency: 'THB',
      });
    }
    if (request.method() === 'POST' && path === '/bookings') {
      return json(route, {
        id: bookingId,
        status: 'PENDING',
        listingId,
        slotId,
        subtotalAmount: '500.00',
        discountAmount: '0.00',
        netAmount: '500.00',
        currency: 'THB',
        createdAt: '2099-09-14T00:00:00.000Z',
      });
    }
    return unhandled(route, request.method(), path);
  });

  await page.goto(`/tutors/${tutorId}?listingId=${listingId}`);
  await page.getByRole('button', { name: 'Sign in to choose this time' }).click();

  await expect(page).toHaveURL((url) => {
    return (
      url.pathname === '/' &&
      url.searchParams.get('returnTo') ===
        `/dashboard/bookings/new?listingId=${listingId}&slotId=${slotId}`
    );
  });

  await page.locator('#email').fill(studentUser.email);
  await page.locator('#password').fill('student-pass-123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  await expect(page).toHaveURL((url) => {
    return (
      url.pathname === '/onboarding/profile' &&
      url.searchParams.get('returnTo') ===
        `/dashboard/bookings/new?listingId=${listingId}&slotId=${slotId}`
    );
  });

  await page.locator('#firstName').fill(studentProfile.firstName);
  await page.locator('#lastName').fill(studentProfile.lastName);
  await page.locator('#nickname').fill(studentProfile.nickname);
  await page.locator('#school').fill(studentProfile.school);
  await page.locator('#gradeLevel').fill(studentProfile.gradeLevel);
  await page.locator('#phone').fill(studentProfile.phone);
  await page.getByRole('button', { name: 'Save and continue' }).click();

  await expect(page).toHaveURL((url) => {
    return (
      url.pathname === '/dashboard/bookings/new' &&
      url.searchParams.get('listingId') === listingId &&
      url.searchParams.get('slotId') === slotId
    );
  });
  await expect(page.getByRole('heading', { name: 'Review your lesson request' })).toBeVisible();
  await expect(page.getByText('TUTOR VERIFICATION PENDING')).toBeVisible();
  await page.getByRole('button', { name: 'Send booking request' }).click();
  await expect(page.getByRole('heading', { name: 'Booking request sent' })).toBeVisible();
  await expect(page.getByText('Your request was created as PENDING.')).toBeVisible();
});

function authResponse(user: typeof studentUser) {
  return { accessToken: 'e2e-access-token', expiresIn: 900, user };
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function unauthorized(route: Route) {
  return json(route, { message: 'Unauthorized' }, 401);
}

function unhandled(route: Route, method: string, path: string) {
  return json(route, { message: `Unhandled E2E request: ${method} ${path}` }, 500);
}
