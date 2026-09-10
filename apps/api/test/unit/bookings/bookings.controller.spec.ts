import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';

import { API_GLOBAL_PREFIX } from '@/app.setup';
import { JWT_BEARER_AUTH } from '@/auth/auth.swagger';
import { OWNERSHIP_KEY } from '@/auth/ownership.decorator';
import { ROLES_KEY } from '@/auth/roles.decorator';
import { BookingsController } from '@/bookings/bookings.controller';
import { PrismaService } from '@/database/prisma.service';
import { Role } from '@/generated/prisma/client';
import { BookingStatus } from '@/generated/prisma/enums';

import type { AuthenticatedUser } from '@/auth/auth.guard';
import type { OwnershipRule } from '@/auth/ownership.decorator';
import type {
  BookingDetailResponseDto,
  BookingQuoteResponseDto,
  BookingResponseDto,
  MyBookingsResponseDto,
  TutorBookingsResponseDto,
} from '@/bookings/bookings.dto';
import type { BookingsService } from '@/bookings/bookings.service';
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
  const previousDatabaseUrl = process.env['DATABASE_URL'];
  let app: INestApplication | undefined;
  let document: OpenAPIObject;

  beforeAll(async () => {
    process.env['DATABASE_URL'] = 'postgresql://user:password@example.test:5432/hktutor';
    const { AppModule } = jest.requireActual<{ AppModule: Type<unknown> }>('@/app.module');

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

    if (previousDatabaseUrl === undefined) {
      delete process.env['DATABASE_URL'];
    } else {
      process.env['DATABASE_URL'] = previousDatabaseUrl;
    }
  });

  it('publishes the create-booking contract', () => {
    const operation = document.paths[`/${API_GLOBAL_PREFIX}/bookings`]?.post;

    expect(operation?.summary).toBe('Create booking');
    expect(operation?.responses['201']).toMatchObject({
      content: {
        'application/json': {
          schema: {
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
      | { properties?: Record<string, unknown>; required?: string[] }
      | undefined;

    expect(schema?.properties?.['slotId']).toBeDefined();
    expect(schema?.properties?.['listingId']).toBeDefined();
    expect(schema?.required).toContain('slotId');
    expect(schema?.required).toContain('listingId');
    expect(schema?.properties?.['studentUserId']).toBeUndefined();
  });

  it('publishes the booking-quote contract', () => {
    const operation = document.paths[`/${API_GLOBAL_PREFIX}/bookings/quote`]?.get;

    expect(operation?.summary).toBe('Get an authoritative booking quote');
    expect(operation?.responses['200']).toBeDefined();
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
    expect(operation?.responses['200']).toBeDefined();
    expect(operation?.responses['400']).toBeDefined();
    expect(operation?.responses['401']).toBeDefined();
    expect(operation?.responses['403']).toBeDefined();
    expect(operation?.security).toEqual([{ [JWT_BEARER_AUTH]: [] }]);
    expect(operation?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'status', required: false }),
        expect.objectContaining({ name: 'from', required: false }),
        expect.objectContaining({ name: 'to', required: false }),
      ]),
    );
  });

  it('publishes the booking-detail contract', () => {
    const operation = document.paths[`/${API_GLOBAL_PREFIX}/bookings/me/{bookingId}`]?.get;

    expect(operation?.summary).toBe("Get one of the authenticated student's bookings by ID");
    expect(operation?.responses['200']).toBeDefined();
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
    expect(operation?.responses['200']).toBeDefined();
    expect(operation?.responses['400']).toBeDefined();
    expect(operation?.responses['401']).toBeDefined();
    expect(operation?.responses['403']).toBeDefined();
    expect(operation?.security).toEqual([{ [JWT_BEARER_AUTH]: [] }]);
    expect(operation?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'status', required: false }),
        expect.objectContaining({ name: 'from', required: false }),
        expect.objectContaining({ name: 'to', required: false }),
      ]),
    );
  });
});
