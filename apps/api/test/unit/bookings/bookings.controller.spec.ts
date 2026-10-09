import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';

import { API_GLOBAL_PREFIX } from '@app/app.setup';
import { Role } from '@generated/prisma/client';
import { BookingStatus } from '@generated/prisma/enums';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { JWT_BEARER_AUTH } from '@modules/auth/auth.swagger';
import { OWNERSHIP_KEY } from '@modules/auth/ownership.decorator';
import { ROLES_KEY } from '@modules/auth/roles.decorator';
import { BookingsController } from '@modules/bookings/bookings.controller';

import type { AuthenticatedUser } from '@modules/auth/auth.guard';
import type { OwnershipRule } from '@modules/auth/ownership.decorator';
import type {
  BookingDetailResponseDto,
  BookingQuoteResponseDto,
  BookingResponseDto,
  MockPaymentResponseDto,
  MyBookingsResponseDto,
  TutorBookingActionResponseDto,
  TutorBookingsResponseDto,
} from '@modules/bookings/bookings.dto';
import type { BookingsService } from '@modules/bookings/bookings.service';
import type { INestApplication, Type } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';

describe('BookingsController', () => {
  it('derives studentUserId from the authenticated user rather than the request body', async () => {
    const create = jest.fn();
    const bookingsService = { create } as unknown as BookingsService;
    const controller = new BookingsController(bookingsService);
    const user: AuthenticatedUser = {
      email: 'student@example.com',
      id: '70e1232d-3c06-4d5d-b3d2-6026df5ff315',
      role: Role.STUDENT,
      sessionId: 'session-1',
    };
    const dto = {
      listingId: 'a22c4b4d-4f8e-4de6-9b3d-faae7db5eb6d',
      slotId: '7a0f9ab0-8f25-4d80-bb00-67b3a0c7d3d5',
    };
    const expected = {} as BookingResponseDto;
    create.mockResolvedValue(expected);

    const result = await controller.create(dto, user);

    expect(create).toHaveBeenCalledWith({ ...dto, studentUserId: user.id });
    expect(result).toBe(expected);
  });

  it('restricts booking creation to students', () => {
    const handler = Object.getOwnPropertyDescriptor(BookingsController.prototype, 'create')
      ?.value as object | undefined;
    const roles = handler
      ? (Reflect.getMetadata(ROLES_KEY, handler) as Role[] | undefined)
      : undefined;

    expect(roles).toEqual([Role.STUDENT]);
  });

  it('derives studentUserId for a quote from the authenticated user, not the query', async () => {
    const getQuote = jest.fn();
    const bookingsService = { getQuote } as unknown as BookingsService;
    const controller = new BookingsController(bookingsService);
    const user: AuthenticatedUser = {
      email: 'student@example.com',
      id: '70e1232d-3c06-4d5d-b3d2-6026df5ff315',
      role: Role.STUDENT,
      sessionId: 'session-1',
    };
    const query = {
      listingId: 'a22c4b4d-4f8e-4de6-9b3d-faae7db5eb6d',
      slotId: '7a0f9ab0-8f25-4d80-bb00-67b3a0c7d3d5',
    };
    const expected = {} as BookingQuoteResponseDto;
    getQuote.mockResolvedValue(expected);

    const result = await controller.getQuote(query, user);

    expect(getQuote).toHaveBeenCalledWith({ ...query, studentUserId: user.id });
    expect(result).toBe(expected);
  });

  it('restricts the quote endpoint to students', () => {
    const handler = Object.getOwnPropertyDescriptor(BookingsController.prototype, 'getQuote')
      ?.value as object | undefined;
    const roles = handler
      ? (Reflect.getMetadata(ROLES_KEY, handler) as Role[] | undefined)
      : undefined;

    expect(roles).toEqual([Role.STUDENT]);
  });

  it('derives studentUserId for listing own bookings from the authenticated user, not the query', async () => {
    const getMyBookings = jest.fn();
    const bookingsService = { getMyBookings } as unknown as BookingsService;
    const controller = new BookingsController(bookingsService);
    const user: AuthenticatedUser = {
      email: 'student@example.com',
      id: '70e1232d-3c06-4d5d-b3d2-6026df5ff315',
      role: Role.STUDENT,
      sessionId: 'session-1',
    };
    const query = { status: BookingStatus.CONFIRMED };
    const expected = {} as MyBookingsResponseDto;
    getMyBookings.mockResolvedValue(expected);

    const result = await controller.getMyBookings(query, user);

    expect(getMyBookings).toHaveBeenCalledWith({ ...query, studentUserId: user.id });
    expect(result).toBe(expected);
  });

  it('restricts the own-bookings endpoint to students', () => {
    const handler = Object.getOwnPropertyDescriptor(BookingsController.prototype, 'getMyBookings')
      ?.value as object | undefined;
    const roles = handler
      ? (Reflect.getMetadata(ROLES_KEY, handler) as Role[] | undefined)
      : undefined;

    expect(roles).toEqual([Role.STUDENT]);
  });

  it('derives studentUserId for a booking detail lookup from the authenticated user', async () => {
    const getMyBookingById = jest.fn();
    const bookingsService = { getMyBookingById } as unknown as BookingsService;
    const controller = new BookingsController(bookingsService);
    const user: AuthenticatedUser = {
      email: 'student@example.com',
      id: '70e1232d-3c06-4d5d-b3d2-6026df5ff315',
      role: Role.STUDENT,
      sessionId: 'session-1',
    };
    const bookingId = '3c54a0d6-e3f3-4a38-bd55-3b4011ee31ae';
    const expected = {} as BookingDetailResponseDto;
    getMyBookingById.mockResolvedValue(expected);

    const result = await controller.getMyBookingById(bookingId, user);

    expect(getMyBookingById).toHaveBeenCalledWith({ bookingId, studentUserId: user.id });
    expect(result).toBe(expected);
  });

  it('restricts the booking-detail endpoint to students and enforces booking ownership', () => {
    const handler = Object.getOwnPropertyDescriptor(
      BookingsController.prototype,
      'getMyBookingById',
    )?.value as object | undefined;
    const roles = handler
      ? (Reflect.getMetadata(ROLES_KEY, handler) as Role[] | undefined)
      : undefined;
    const ownership = handler
      ? (Reflect.getMetadata(OWNERSHIP_KEY, handler) as OwnershipRule | undefined)
      : undefined;

    expect(roles).toEqual([Role.STUDENT]);
    expect(ownership).toEqual({ resource: 'booking', idParam: 'bookingId' });
  });

  it('derives tutorUserId for listing assigned bookings from the authenticated user, not the query', async () => {
    const getTutorBookings = jest.fn();
    const bookingsService = { getTutorBookings } as unknown as BookingsService;
    const controller = new BookingsController(bookingsService);
    const user: AuthenticatedUser = {
      email: 'tutor@example.com',
      id: '1772b6be-ebb5-40b7-b5bd-1c1fcfe26857',
      role: Role.TUTOR,
      sessionId: 'session-1',
    };
    const query = { status: BookingStatus.CONFIRMED };
    const expected = {} as TutorBookingsResponseDto;
    getTutorBookings.mockResolvedValue(expected);

    const result = await controller.getTutorBookings(query, user);

    expect(getTutorBookings).toHaveBeenCalledWith({ ...query, tutorUserId: user.id });
    expect(result).toBe(expected);
  });

  it('derives the acting tutor for confirm and reject from the authenticated user', async () => {
    const confirmTutorBooking = jest.fn();
    const rejectTutorBooking = jest.fn();
    const bookingsService = {
      confirmTutorBooking,
      rejectTutorBooking,
    } as unknown as BookingsService;
    const controller = new BookingsController(bookingsService);
    const user: AuthenticatedUser = {
      email: 'tutor@example.com',
      id: '1772b6be-ebb5-40b7-b5bd-1c1fcfe26857',
      role: Role.TUTOR,
      sessionId: 'session-1',
    };
    const bookingId = '3c54a0d6-e3f3-4a38-bd55-3b4011ee31ae';
    const confirmed = {} as TutorBookingActionResponseDto;
    const rejected = {} as TutorBookingActionResponseDto;
    confirmTutorBooking.mockResolvedValue(confirmed);
    rejectTutorBooking.mockResolvedValue(rejected);

    await expect(
      controller.confirmTutorBooking(bookingId, { note: 'See you' }, user),
    ).resolves.toBe(confirmed);
    await expect(
      controller.rejectTutorBooking(bookingId, { reason: 'Double booked' }, user),
    ).resolves.toBe(rejected);

    expect(confirmTutorBooking).toHaveBeenCalledWith({
      bookingId,
      note: 'See you',
      tutorUserId: user.id,
    });
    expect(rejectTutorBooking).toHaveBeenCalledWith({
      bookingId,
      reason: 'Double booked',
      tutorUserId: user.id,
    });
  });

  it.each(['confirmTutorBooking', 'rejectTutorBooking'] as const)(
    'restricts %s to tutors and separates a foreign booking from a missing one',
    (method) => {
      const handler = Object.getOwnPropertyDescriptor(BookingsController.prototype, method)
        ?.value as object | undefined;
      const roles = handler
        ? (Reflect.getMetadata(ROLES_KEY, handler) as Role[] | undefined)
        : undefined;
      const ownership = handler
        ? (Reflect.getMetadata(OWNERSHIP_KEY, handler) as OwnershipRule | undefined)
        : undefined;

      expect(roles).toEqual([Role.TUTOR]);
      // The card answers a wrong tutor with 403 instead of the guard's ownership-safe 404, so the
      // rule carries both outcome bodies.
      expect(ownership).toEqual({
        errors: {
          foreignOwner: {
            code: 'BOOKING_NOT_OWNED',
            message: 'This booking belongs to another tutor',
          },
          missing: { code: 'BOOKING_NOT_FOUND', message: 'Booking not found' },
        },
        idParam: 'bookingId',
        resource: 'booking',
      });
    },
  );

  it('derives the paying student from the authenticated user', async () => {
    const createMockPayment = jest.fn();
    const bookingsService = { createMockPayment } as unknown as BookingsService;
    const controller = new BookingsController(bookingsService);
    const user: AuthenticatedUser = {
      email: 'student@example.com',
      id: '6bb01222-1fce-4bc3-a69d-3d90db2fdf57',
      role: Role.STUDENT,
      sessionId: 'session-1',
    };
    const bookingId = '3c54a0d6-e3f3-4a38-bd55-3b4011ee31ae';
    const paid = {} as MockPaymentResponseDto;
    createMockPayment.mockResolvedValue(paid);

    await expect(
      controller.createMockPayment(bookingId, { amount: '450.00', reference: 'DEMO-7F3A91' }, user),
    ).resolves.toBe(paid);

    expect(createMockPayment).toHaveBeenCalledWith({
      amount: '450.00',
      bookingId,
      reference: 'DEMO-7F3A91',
      studentUserId: user.id,
    });
  });

  it('restricts the mock payment to the owning student and separates 403 from 404', () => {
    const handler = Object.getOwnPropertyDescriptor(
      BookingsController.prototype,
      'createMockPayment',
    )?.value as object | undefined;
    const roles = handler
      ? (Reflect.getMetadata(ROLES_KEY, handler) as Role[] | undefined)
      : undefined;
    const ownership = handler
      ? (Reflect.getMetadata(OWNERSHIP_KEY, handler) as OwnershipRule | undefined)
      : undefined;

    expect(roles).toEqual([Role.STUDENT]);
    expect(ownership).toEqual({
      errors: {
        foreignOwner: {
          code: 'BOOKING_NOT_OWNED',
          message: 'This booking belongs to another student',
        },
        missing: { code: 'BOOKING_NOT_FOUND', message: 'Booking not found' },
      },
      idParam: 'bookingId',
      resource: 'booking',
    });
  });

  it('restricts the tutor-bookings endpoint to tutors', () => {
    const handler = Object.getOwnPropertyDescriptor(
      BookingsController.prototype,
      'getTutorBookings',
    )?.value as object | undefined;
    const roles = handler
      ? (Reflect.getMetadata(ROLES_KEY, handler) as Role[] | undefined)
      : undefined;

    expect(roles).toEqual([Role.TUTOR]);
  });
});

describe('BookingsController OpenAPI contract', () => {
  const testEnvironment = {
    DATABASE_URL: 'postgresql://user:password@example.test:5432/hktutor',
    SUPABASE_URL: 'https://storage.example.test',
    SUPABASE_SECRET_KEY: 'sb_secret_unit_test',
    SUPABASE_AVATAR_BUCKET: 'test-avatars',
    SUPABASE_DOCUMENT_BUCKET: 'test-documents',
  };
  const previousEnvironment = Object.fromEntries(
    Object.keys(testEnvironment).map((key) => [key, process.env[key]]),
  );
  let app: INestApplication | undefined;
  let document: OpenAPIObject;

  beforeAll(async () => {
    Object.assign(process.env, testEnvironment);
    const { AppModule } = jest.requireActual<{ AppModule: Type<unknown> }>('@app/app.module');

    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ $transaction: jest.fn(), teachingListing: { findMany: jest.fn() } })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(API_GLOBAL_PREFIX);
    await app.init();
    document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Test')
        .setVersion('1')
        .addBearerAuth({ type: 'http', scheme: 'bearer' }, JWT_BEARER_AUTH)
        .build(),
    );
  });

  afterAll(async () => {
    await app?.close();

    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('publishes the create-booking contract', () => {
    const operation = document.paths[`/${API_GLOBAL_PREFIX}/bookings`]?.post;

    expect(operation?.summary).toBe('Create booking');
    expect(operation?.responses['201']).toMatchObject({
      content: {
        'application/json': {
          schema: {
            allOf: [{ $ref: '#/components/schemas/BookingResponseDto' }],
            example: {
              createdAt: '2026-09-10T09:04:31.001Z',
              currency: 'THB',
              discountAmount: '0.00',
              id: '3c54a0d6-e3f3-4a38-bd55-3b4011ee31ae',
              listingId: 'a22c4b4d-4f8e-4de6-9b3d-faae7db5eb6d',
              netAmount: '450.00',
              slotId: '7a0f9ab0-8f25-4d80-bb00-67b3a0c7d3d5',
              status: 'PENDING',
              subtotalAmount: '450.00',
            },
          },
        },
      },
    });
    expect(operation?.responses['400']).toBeDefined();
    expect(operation?.responses['401']).toBeDefined();
    expect(operation?.responses['403']).toBeDefined();
    expect(operation?.responses['404']).toBeDefined();
    expect(operation?.responses['409']).toBeDefined();
    expect(operation?.security).toEqual([{ [JWT_BEARER_AUTH]: [] }]);
  });

  it('requires listingId and slotId in the request body schema and no longer accepts studentUserId', () => {
    const schema = document.components?.schemas?.['CreateBookingDto'] as
      { properties?: Record<string, unknown>; required?: string[] } | undefined;

    expect(schema?.properties?.['slotId']).toBeDefined();
    expect(schema?.properties?.['listingId']).toBeDefined();
    expect(schema?.required).toContain('slotId');
    expect(schema?.required).toContain('listingId');
    expect(schema?.properties?.['studentUserId']).toBeUndefined();
  });

  it('publishes the booking-quote contract', () => {
    const operation = document.paths[`/${API_GLOBAL_PREFIX}/bookings/quote`]?.get;

    expect(operation?.summary).toBe('Get an authoritative booking quote');
    expect(operation?.responses['200']).toMatchObject({
      content: {
        'application/json': {
          schema: {
            allOf: [{ $ref: '#/components/schemas/BookingQuoteResponseDto' }],
          },
        },
      },
    });
    expect(operation?.responses['400']).toBeDefined();
    expect(operation?.responses['401']).toBeDefined();
    expect(operation?.responses['403']).toBeDefined();
    expect(operation?.responses['404']).toBeDefined();
    expect(operation?.responses['409']).toBeDefined();
    expect(operation?.security).toEqual([{ [JWT_BEARER_AUTH]: [] }]);
    expect(operation?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'listingId', required: true }),
        expect.objectContaining({ name: 'slotId', required: true }),
      ]),
    );
  });

  it('publishes the my-bookings contract', () => {
    const operation = document.paths[`/${API_GLOBAL_PREFIX}/bookings/me`]?.get;

    expect(operation?.summary).toBe("List the authenticated student's bookings");
    expect(operation?.responses['200']).toMatchObject({
      content: {
        'application/json': {
          schema: { allOf: [{ $ref: '#/components/schemas/MyBookingsResponseDto' }] },
        },
      },
    });
    expect(operation?.responses['400']).toBeDefined();
    expect(operation?.responses['401']).toBeDefined();
    expect(operation?.responses['403']).toBeDefined();
    expect(operation?.security).toEqual([{ [JWT_BEARER_AUTH]: [] }]);
    expect(operation?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'status', required: false }),
        expect.objectContaining({ name: 'from', required: false }),
        expect.objectContaining({ name: 'to', required: false }),
        expect.objectContaining({ name: 'page', required: false }),
        expect.objectContaining({ name: 'pageSize', required: false }),
      ]),
    );
  });

  it('publishes the booking-detail contract', () => {
    const operation = document.paths[`/${API_GLOBAL_PREFIX}/bookings/me/{bookingId}`]?.get;

    expect(operation?.summary).toBe("Get one of the authenticated student's bookings by ID");
    expect(operation?.responses['200']).toMatchObject({
      content: {
        'application/json': {
          schema: { allOf: [{ $ref: '#/components/schemas/BookingDetailResponseDto' }] },
        },
      },
    });
    expect(operation?.responses['400']).toBeDefined();
    expect(operation?.responses['401']).toBeDefined();
    expect(operation?.responses['403']).toBeDefined();
    expect(operation?.responses['404']).toBeDefined();
    expect(operation?.security).toEqual([{ [JWT_BEARER_AUTH]: [] }]);
    expect(operation?.parameters).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'bookingId', required: true })]),
    );
  });

  it('publishes the tutor-bookings contract', () => {
    const operation = document.paths[`/${API_GLOBAL_PREFIX}/bookings/tutor`]?.get;

    expect(operation?.summary).toBe("List the authenticated tutor's assigned bookings");
    expect(operation?.responses['200']).toMatchObject({
      content: {
        'application/json': {
          schema: { allOf: [{ $ref: '#/components/schemas/TutorBookingsResponseDto' }] },
        },
      },
    });
    expect(operation?.responses['400']).toBeDefined();
    expect(operation?.responses['401']).toBeDefined();
    expect(operation?.responses['403']).toBeDefined();
    expect(operation?.security).toEqual([{ [JWT_BEARER_AUTH]: [] }]);
    expect(operation?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'status', required: false }),
        expect.objectContaining({ name: 'from', required: false }),
        expect.objectContaining({ name: 'to', required: false }),
        expect.objectContaining({ name: 'page', required: false }),
        expect.objectContaining({ name: 'pageSize', required: false }),
      ]),
    );

    const studentSchema = document.components?.schemas?.['TutorBookingStudentDto'] as
      { properties?: { nickname?: { nullable?: boolean; type?: string } } } | undefined;
    expect(studentSchema?.properties?.nickname).toMatchObject({ type: 'string' });
    expect(studentSchema?.properties?.nickname?.nullable).toBe(true);
  });

  it.each([
    ['confirm', 'Confirm'],
    ['reject', 'Reject'],
  ])('publishes the tutor %s action contract', (action, summaryVerb) => {
    const operation =
      document.paths[`/${API_GLOBAL_PREFIX}/bookings/tutor/{bookingId}/${action}`]?.post;

    expect(operation?.summary).toBe(
      `${summaryVerb} one of the authenticated tutor's pending bookings`,
    );
    expect(operation?.responses['200']).toMatchObject({
      content: {
        'application/json': {
          schema: { allOf: [{ $ref: '#/components/schemas/TutorBookingActionResponseDto' }] },
        },
      },
    });
    for (const status of ['400', '401', '403', '404', '409']) {
      expect(operation?.responses[status]).toBeDefined();
    }
    expect(operation?.security).toEqual([{ [JWT_BEARER_AUTH]: [] }]);
    expect(operation?.parameters).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'bookingId', required: true })]),
    );
    expect(operation?.requestBody).toMatchObject({ required: false });
  });

  it('keeps the tutor action response schema aligned with the card', () => {
    const schema = document.components?.schemas?.['TutorBookingActionResponseDto'] as
      { properties?: Record<string, unknown>; required?: string[] } | undefined;

    expect(Object.keys(schema?.properties ?? {}).sort()).toEqual([
      'bookingId',
      'canceledAt',
      'slotStatus',
      'status',
    ]);
    expect(schema?.properties?.['slotStatus']).toMatchObject({ enum: ['AVAILABLE', 'RESERVED'] });
  });
  it('publishes the mock-payment contract', () => {
    const operation =
      document.paths[`/${API_GLOBAL_PREFIX}/bookings/me/{bookingId}/mock-payment`]?.post;

    expect(operation?.summary).toBe(
      "Record the demo payment for one of the authenticated student's confirmed bookings",
    );
    expect(operation?.responses['200']).toMatchObject({
      content: {
        'application/json': {
          schema: {
            allOf: [{ $ref: '#/components/schemas/MockPaymentResponseDto' }],
            example: {
              amount: '450.00',
              bookingId: '3c54a0d6-e3f3-4a38-bd55-3b4011ee31ae',
              paidAt: '2026-10-09T09:04:31.001Z',
              paymentStatus: 'PAID',
              reference: 'DEMO-7F3A91',
            },
          },
        },
      },
    });
    for (const status of ['400', '401', '403', '404', '409']) {
      expect(operation?.responses[status]).toBeDefined();
    }
    expect(operation?.security).toEqual([{ [JWT_BEARER_AUTH]: [] }]);
  });

  it('accepts only an amount and a reference, never payment instrument fields', () => {
    const schema = document.components?.schemas?.['CreateMockPaymentDto'] as
      { properties?: Record<string, unknown>; required?: string[] } | undefined;

    expect(Object.keys(schema?.properties ?? {}).sort()).toEqual(['amount', 'reference']);
    expect(schema?.required?.sort()).toEqual(['amount', 'reference']);
  });
});
