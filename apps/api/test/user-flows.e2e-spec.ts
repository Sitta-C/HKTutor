import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import request from 'supertest';

import { configureApplication } from '@/app.setup';
import { CURRENT_PRIVACY_POLICY_VERSION } from '@/auth/auth.constants';
import { AuthController } from '@/auth/auth.controller';
import { JwtAuthGuard } from '@/auth/auth.guard';
import { AuthService } from '@/auth/auth.service';
import { JwtTokenService } from '@/auth/jwt.service';
import { ResourceOwnershipGuard } from '@/auth/ownership.guard';
import { RolesGuard } from '@/auth/roles.guard';
import { BookingsController } from '@/bookings/bookings.controller';
import { BookingsService } from '@/bookings/bookings.service';
import { AuthConfigService } from '@/config/auth.config';
import { PrismaService } from '@/database/prisma.service';
import {
  BookingStatus,
  ListingPublicationStatus,
  Role,
  TutorVerificationStatus,
} from '@/generated/prisma/client';
import { ProfilesController } from '@/profiles/profiles.controller';
import { ProfilesService } from '@/profiles/profiles.service';
import { CatalogController } from '@/tutors/catalog.controller';
import { TutorsPrivateController } from '@/tutors/tutors-private.controller';
import { TutorsPublicController } from '@/tutors/tutors-public.controller';
import { TutorsService } from '@/tutors/tutors.service';

import type { AuthenticatedRequest, AuthenticatedUser } from '@/auth/auth.guard';
import type { ExecutionContext, INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import type { App } from 'supertest/types';

describe('End-to-End User Flow Verification (Student & Tutor)', () => {
  let app: INestApplication<App>;
  let currentUser: AuthenticatedUser | null = null;

  // Mock services
  const authService = {
    acceptPrivacyNotice: jest.fn(),
    login: jest.fn(),
    logout: jest.fn(),
    refresh: jest.fn(),
    register: jest.fn(),
    resendVerification: jest.fn(),
    verifyEmail: jest.fn(),
  };

  const profilesService = {
    getMine: jest.fn(),
    saveStudent: jest.fn(),
    saveTutor: jest.fn(),
  };

  const tutorsService = {
    deleteAvailability: jest.fn(),
    getActiveGradeLevels: jest.fn(),
    getActiveSubjects: jest.fn(),
    getAvailabilityPrivate: jest.fn(),
    getAvailabilityPublic: jest.fn(),
    getListing: jest.fn(),
    getListings: jest.fn(),
    getPublicTutor: jest.fn(),
    patchListing: jest.fn(),
    postAvailability: jest.fn(),
    postListing: jest.fn(),
    postPublishListing: jest.fn(),
    searchPublicTutors: jest.fn(),
    updateListingStatus: jest.fn(),
  };

  const bookingsService = {
    create: jest.fn(),
    getMyBookingById: jest.fn(),
    getMyBookings: jest.fn(),
    getQuote: jest.fn(),
    getTutorBookings: jest.fn(),
  };

  const prismaMock = {
    authSession: { findUnique: jest.fn() },
    availabilitySlot: { findFirst: jest.fn() },
    booking: { findFirst: jest.fn() },
    teachingListing: { findFirst: jest.fn() },
    user: { findUnique: jest.fn() },
  };

  const authConfig = {
    refreshCookieOptions: {
      httpOnly: true,
      maxAge: 60_000,
      path: '/',
      sameSite: 'lax' as const,
      secure: false,
    },
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [
        AuthController,
        ProfilesController,
        CatalogController,
        TutorsPrivateController,
        TutorsPublicController,
        BookingsController,
      ],
      providers: [
        RolesGuard,
        ResourceOwnershipGuard,
        { provide: BookingsService, useValue: bookingsService },
        { provide: ProfilesService, useValue: profilesService },
        { provide: TutorsService, useValue: tutorsService },
        { provide: AuthConfigService, useValue: authConfig },
        { provide: PrismaService, useValue: prismaMock },
        { provide: AuthService, useValue: authService },
        {
          provide: JwtTokenService,
          useValue: {
            verifyAccessToken: jest.fn().mockImplementation(() => {
              if (!currentUser) return null;
              return { sub: currentUser.id, sid: currentUser.sessionId };
            }),
          },
        },
      ],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          if (!currentUser) return false;
          const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
          req.auth = currentUser;
          return true;
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    jest.resetAllMocks();
    currentUser = null;
  });

  describe('Student Flow: auth -> search -> book', () => {
    const studentId = '11111111-1111-4111-8111-111111111111';
    const tutorId = '22222222-2222-4222-8222-222222222222';
    const listingId = '33333333-3333-4333-8333-333333333333';
    const slotId = '44444444-4444-4444-8444-444444444444';
    const bookingId = '55555555-5555-4555-8555-555555555555';

    it('successfully executes the entire student journey', async () => {
      // Step 1: Auth - Register
      authService.register.mockResolvedValue({ message: 'Verification email sent' });
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: 'student@example.com',
          password: 'Password123!',
          role: 'student',
          consent: true,
          policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
        })
        .expect(201);
      expect(authService.register).toHaveBeenCalledWith({
        email: 'student@example.com',
        password: 'Password123!',
        role: 'student',
        consent: true,
        policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
      });

      // Step 2: Auth - Login
      authService.login.mockResolvedValue({
        accessToken: 'student-access-token',
        expiresIn: 900,
        refreshToken: 'student-refresh-token',
        user: { id: studentId, email: 'student@example.com', role: Role.STUDENT },
      });
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'student@example.com', password: 'Password123!' })
        .expect(200);
      expect(loginRes.body).toMatchObject({
        accessToken: 'student-access-token',
        user: { id: studentId, role: Role.STUDENT },
      });

      // Authenticate session as student
      currentUser = {
        id: studentId,
        email: 'student@example.com',
        role: Role.STUDENT,
        sessionId: 'student-session-1',
      };

      // Step 3: Auth - Student Profile Onboarding
      profilesService.saveStudent.mockResolvedValue({
        firstName: 'Somchai',
        lastName: 'Student',
        nickname: 'Chai',
        school: 'Triam Udom',
        gradeLevel: 'Grade 10',
        phone: '0812345678',
      });
      const profileRes = await request(app.getHttpServer())
        .put('/api/v1/profiles/me/student')
        .send({
          firstName: 'Somchai',
          lastName: 'Student',
          nickname: 'Chai',
          school: 'Triam Udom',
          gradeLevel: 'Grade 10',
          phone: '0812345678',
        })
        .expect(200);
      const profileBody = profileRes.body as { nickname: string };
      expect(profileBody.nickname).toBe('Chai');
      expect(profilesService.saveStudent).toHaveBeenCalledWith(studentId, {
        firstName: 'Somchai',
        lastName: 'Student',
        nickname: 'Chai',
        school: 'Triam Udom',
        gradeLevel: 'Grade 10',
        phone: '0812345678',
      });

      // Step 4: Search - Find published tutors
      tutorsService.searchPublicTutors.mockResolvedValue([
        {
          description: 'Experienced calculus and algebra tutor.',
          displayName: 'Kru Anan',
          experienceYears: 6,
          grade: 'Grade 10',
          listingId,
          nextAvailableAt: new Date('2026-09-20T10:00:00.000Z'),
          pricePerHour: 500,
          ratingAverage: 4.9,
          reviewCount: 15,
          subject: 'Mathematics',
          tutorId,
        },
      ]);
      const searchRes = await request(app.getHttpServer())
        .get('/api/v1/tutors')
        .query({ subject: 'Mathematics', grade: 'Grade 10', maxPrice: '600', minimumRating: '4.5' })
        .expect(200);
      const searchResults = searchRes.body as Array<{ tutorId: string; pricePerHour: number }>;
      expect(searchResults).toHaveLength(1);
      expect(searchResults[0]?.tutorId).toBe(tutorId);
      expect(searchResults[0]?.pricePerHour).toBe(500);

      // Step 5: Search - View tutor detail & public availability
      tutorsService.getPublicTutor.mockResolvedValue({
        tutor: {
          bio: 'Top maths tutor in Bangkok',
          displayName: 'Kru Anan',
          experienceYears: 6,
          ratingAverage: 4.9,
          reviewCount: 15,
          tutorId,
          verificationStatus: TutorVerificationStatus.VERIFIED,
        },
        listings: [
          {
            description: 'Experienced calculus and algebra tutor.',
            grade: 'Grade 10',
            listingId,
            pricePerHour: 500,
            subject: 'Mathematics',
          },
        ],
      });
      const tutorDetailRes = await request(app.getHttpServer())
        .get(`/api/v1/tutors/${tutorId}`)
        .expect(200);
      const tutorDetail = tutorDetailRes.body as { tutor: { displayName: string } };
      expect(tutorDetail.tutor.displayName).toBe('Kru Anan');

      tutorsService.getAvailabilityPublic.mockResolvedValue([
        {
          id: slotId,
          startAtUtc: '2026-09-20T10:00:00.000Z',
          endAtUtc: '2026-09-20T12:00:00.000Z',
        },
      ]);
      const slotsRes = await request(app.getHttpServer())
        .get(`/api/v1/tutors/${tutorId}/availability`)
        .expect(200);
      const slotsList = slotsRes.body as Array<{ id: string }>;
      expect(slotsList).toHaveLength(1);
      expect(slotsList[0]?.id).toBe(slotId);

      // Step 6: Search/Quote - Get booking quote before confirming
      bookingsService.getQuote.mockResolvedValue({
        currency: 'THB',
        discountAmount: '0.00',
        subtotalAmount: '1000.00',
        netAmount: '1000.00',
        listing: {
          id: listingId,
          subjectId: 'sub-1',
          subjectName: 'Mathematics',
          gradeLevelId: 'grd-1',
          gradeLevelName: 'Grade 10',
          pricePerHour: '500.00',
          description: 'Experienced calculus and algebra tutor.',
        },
        slot: {
          id: slotId,
          startAtUtc: '2026-09-20T10:00:00.000Z',
          endAtUtc: '2026-09-20T12:00:00.000Z',
        },
        tutor: {
          tutorId,
          displayName: 'Kru Anan',
        },
      });
      const quoteRes = await request(app.getHttpServer())
        .get('/api/v1/bookings/quote')
        .query({ listingId, slotId })
        .expect(200);
      const quoteBody = quoteRes.body as { netAmount: string };
      expect(quoteBody.netAmount).toBe('1000.00');

      // Step 7: Book - Create booking
      bookingsService.create.mockResolvedValue({
        id: bookingId,
        listingId,
        slotId,
        status: BookingStatus.PENDING,
        subtotalAmount: '1000.00',
        discountAmount: '0.00',
        netAmount: '1000.00',
        currency: 'THB',
        createdAt: new Date().toISOString(),
      });
      const bookRes = await request(app.getHttpServer())
        .post('/api/v1/bookings')
        .send({ listingId, slotId })
        .expect(201);
      const bookBody = bookRes.body as { id: string; status: string; netAmount: string };
      expect(bookBody.id).toBe(bookingId);
      expect(bookBody.status).toBe(BookingStatus.PENDING);
      expect(bookBody.netAmount).toBe('1000.00');

      // Step 8: Book - View My Bookings
      bookingsService.getMyBookings.mockResolvedValue({
        items: [
          {
            id: bookingId,
            status: BookingStatus.PENDING,
            subtotalAmount: '1000.00',
            discountAmount: '0.00',
            netAmount: '1000.00',
            currency: 'THB',
            createdAt: new Date().toISOString(),
            listing: {
              id: listingId,
              subjectId: 'sub-1',
              subjectName: 'Mathematics',
              gradeLevelId: 'grd-1',
              gradeLevelName: 'Grade 10',
              pricePerHour: '500.00',
              description: 'Experienced calculus and algebra tutor.',
            },
            slot: {
              id: slotId,
              startAtUtc: '2026-09-20T10:00:00.000Z',
              endAtUtc: '2026-09-20T12:00:00.000Z',
            },
            tutor: {
              tutorId,
              displayName: 'Kru Anan',
            },
          },
        ],
        total: 1,
      });
      const myBookingsRes = await request(app.getHttpServer())
        .get('/api/v1/bookings/me')
        .expect(200);
      const myBookingsBody = myBookingsRes.body as { items: Array<{ id: string }> };
      expect(myBookingsBody.items).toHaveLength(1);
      expect(myBookingsBody.items[0]?.id).toBe(bookingId);

      // Step 9: Book - View specific booking detail
      prismaMock.booking.findFirst.mockResolvedValue({ id: bookingId });
      bookingsService.getMyBookingById.mockResolvedValue({
        id: bookingId,
        status: BookingStatus.PENDING,
        subtotalAmount: '1000.00',
        discountAmount: '0.00',
        netAmount: '1000.00',
        currency: 'THB',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        listing: {
          id: listingId,
          subjectId: 'sub-1',
          subjectName: 'Mathematics',
          gradeLevelId: 'grd-1',
          gradeLevelName: 'Grade 10',
          pricePerHour: '500.00',
          description: 'Experienced calculus and algebra tutor.',
        },
        slot: {
          id: slotId,
          startAtUtc: '2026-09-20T10:00:00.000Z',
          endAtUtc: '2026-09-20T12:00:00.000Z',
        },
        tutor: {
          tutorId,
          displayName: 'Kru Anan',
        },
      });
      const bookingDetailRes = await request(app.getHttpServer())
        .get(`/api/v1/bookings/me/${bookingId}`)
        .expect(200);
      const bookingDetail = bookingDetailRes.body as { id: string; tutor: { displayName: string } };
      expect(bookingDetail.id).toBe(bookingId);
      expect(bookingDetail.tutor.displayName).toBe('Kru Anan');
    });
  });

  describe('Tutor Flow: auth -> create listing -> create availability slot', () => {
    const tutorId = '22222222-2222-4222-8222-222222222222';
    const subjectId = '66666666-6666-4666-8666-666666666666';
    const gradeLevelId = '77777777-7777-4777-8777-777777777777';
    const listingId = '88888888-8888-4888-8888-888888888888';
    const slotId = '99999999-9999-4999-8999-999999999999';

    it('successfully executes the entire tutor journey', async () => {
      // Step 1: Auth - Register Tutor
      authService.register.mockResolvedValue({ message: 'Verification email sent' });
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: 'tutor@example.com',
          password: 'Password123!',
          role: 'tutor',
          consent: true,
          policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
        })
        .expect(201);
      expect(authService.register).toHaveBeenCalledWith({
        email: 'tutor@example.com',
        password: 'Password123!',
        role: 'tutor',
        consent: true,
        policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
      });

      // Step 2: Auth - Login Tutor
      authService.login.mockResolvedValue({
        accessToken: 'tutor-access-token',
        expiresIn: 900,
        refreshToken: 'tutor-refresh-token',
        user: { id: tutorId, email: 'tutor@example.com', role: Role.TUTOR },
      });
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'tutor@example.com', password: 'Password123!' })
        .expect(200);
      const loginBody = loginRes.body as { user: { role: string } };
      expect(loginBody.user.role).toBe(Role.TUTOR);

      // Authenticate session as tutor
      currentUser = {
        id: tutorId,
        email: 'tutor@example.com',
        role: Role.TUTOR,
        sessionId: 'tutor-session-1',
      };

      // Step 3: Auth - Complete Tutor Profile Onboarding
      profilesService.saveTutor.mockResolvedValue({
        firstName: 'Anan',
        lastName: 'Teacher',
        nickname: 'Nan',
        displayName: 'Kru Anan',
        bio: 'Experienced physics and math tutor',
        experienceYears: 7,
        verificationStatus: TutorVerificationStatus.PENDING,
      });
      const profileRes = await request(app.getHttpServer())
        .put('/api/v1/profiles/me/tutor')
        .send({
          firstName: 'Anan',
          lastName: 'Teacher',
          nickname: 'Nan',
          displayName: 'Kru Anan',
          bio: 'Experienced physics and math tutor',
          experienceYears: 7,
        })
        .expect(200);
      const profileBody = profileRes.body as { displayName: string };
      expect(profileBody.displayName).toBe('Kru Anan');

      // Step 4: Create Listing - Create draft teaching listing
      tutorsService.postListing.mockResolvedValue({
        id: listingId,
        subject: { id: subjectId, code: 'PHYSICS', name: 'Physics', active: true },
        gradeLevel: { id: gradeLevelId, code: 'G11', name: 'Grade 11', sortOrder: 1, active: true },
        pricePerHour: 600,
        description: 'Comprehensive physics course for high school students.',
        publicationStatus: ListingPublicationStatus.DRAFT,
        publishedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const createListingRes = await request(app.getHttpServer())
        .post('/api/v1/tutors/me/listings')
        .send({
          subjectId,
          gradeLevelId,
          pricePerHour: 600,
          description: 'Comprehensive physics course for high school students.',
        })
        .expect(201);
      const createListingBody = createListingRes.body as {
        id: string;
        publicationStatus: string;
        pricePerHour: number;
      };
      expect(createListingBody.id).toBe(listingId);
      expect(createListingBody.publicationStatus).toBe(ListingPublicationStatus.DRAFT);
      expect(createListingBody.pricePerHour).toBe(600);

      // Step 5: Create Listing - Publish listing
      prismaMock.teachingListing.findFirst.mockResolvedValue({ id: listingId });
      tutorsService.postPublishListing.mockResolvedValue({
        id: listingId,
        subject: { id: subjectId, code: 'PHYSICS', name: 'Physics', active: true },
        gradeLevel: { id: gradeLevelId, code: 'G11', name: 'Grade 11', sortOrder: 1, active: true },
        pricePerHour: 600,
        description: 'Comprehensive physics course for high school students.',
        publicationStatus: ListingPublicationStatus.PUBLISHED,
        publishedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const publishRes = await request(app.getHttpServer())
        .post(`/api/v1/tutors/me/listings/${listingId}/publish`)
        .expect(200);
      const publishBody = publishRes.body as { publicationStatus: string };
      expect(publishBody.publicationStatus).toBe(ListingPublicationStatus.PUBLISHED);

      // Step 6: Create Listing - Get Tutor Listings
      tutorsService.getListings.mockResolvedValue([
        {
          id: listingId,
          subject: { id: subjectId, code: 'PHYSICS', name: 'Physics', active: true },
          gradeLevel: {
            id: gradeLevelId,
            code: 'G11',
            name: 'Grade 11',
            sortOrder: 1,
            active: true,
          },
          pricePerHour: 600,
          description: 'Comprehensive physics course for high school students.',
          publicationStatus: ListingPublicationStatus.PUBLISHED,
          publishedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      const myListingsRes = await request(app.getHttpServer())
        .get('/api/v1/tutors/me/listings')
        .expect(200);
      const myListingsBody = myListingsRes.body as Array<{ id: string }>;
      expect(myListingsBody).toHaveLength(1);
      expect(myListingsBody[0]?.id).toBe(listingId);

      // Step 7: Create Availability Slot - Post new time slot
      const startAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const endAt = new Date(Date.now() + 26 * 60 * 60 * 1000).toISOString();
      tutorsService.postAvailability.mockResolvedValue({
        id: slotId,
        tutorProfileId: tutorId,
        startAtUtc: new Date(startAt),
        endAtUtc: new Date(endAt),
      });
      const createSlotRes = await request(app.getHttpServer())
        .post('/api/v1/tutors/me/availability')
        .send({ startAt, endAt })
        .expect(201);
      const createSlotBody = createSlotRes.body as { id: string };
      expect(createSlotBody.id).toBe(slotId);
      expect(tutorsService.postAvailability).toHaveBeenCalledWith(tutorId, {
        startAt: new Date(startAt),
        endAt: new Date(endAt),
      });

      // Step 8: View Tutor Availability Slots
      tutorsService.getAvailabilityPrivate.mockResolvedValue([
        {
          id: slotId,
          startAtUtc: new Date(startAt),
          endAtUtc: new Date(endAt),
          createdAt: new Date(),
          state: 'OPEN',
        },
      ]);
      const getSlotsRes = await request(app.getHttpServer())
        .get('/api/v1/tutors/me/availability')
        .expect(200);
      const slotsBody = getSlotsRes.body as Array<{ state: string }>;
      expect(slotsBody).toHaveLength(1);
      expect(slotsBody[0]?.state).toBe('OPEN');

      // Step 9: View Tutor Bookings
      bookingsService.getTutorBookings.mockResolvedValue({
        items: [],
        total: 0,
      });
      const tutorBookingsRes = await request(app.getHttpServer())
        .get('/api/v1/bookings/tutor')
        .expect(200);
      const tutorBookingsBody = tutorBookingsRes.body as { items: unknown[]; total: number };
      expect(tutorBookingsBody.items).toEqual([]);
      expect(tutorBookingsBody.total).toBe(0);
    });
  });
});
