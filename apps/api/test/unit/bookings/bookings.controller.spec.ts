import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';

import { API_GLOBAL_PREFIX } from '@/app.setup';
import { JWT_BEARER_AUTH } from '@/auth/auth.swagger';
import { ROLES_KEY } from '@/auth/roles.decorator';
import { BookingsController } from '@/bookings/bookings.controller';
import { PrismaService } from '@/database/prisma.service';
import { Role } from '@/generated/prisma/client';

import type { AuthenticatedUser } from '@/auth/auth.guard';
import type { BookingResponseDto } from '@/bookings/bookings.dto';
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
    const dto = { slotId: '7a0f9ab0-8f25-4d80-bb00-67b3a0c7d3d5' };
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
              currency: 'THB',
              discountAmount: 0,
              id: '3c54a0d6-e3f3-4a38-bd55-3b4011ee31ae',
              listingId: 'a22c4b4d-4f8e-4de6-9b3d-faae7db5eb6d',
              netAmount: 500,
              slotId: '7a0f9ab0-8f25-4d80-bb00-67b3a0c7d3d5',
              status: 'pending',
              studentUserId: '70e1232d-3c06-4d5d-b3d2-6026df5ff315',
              subtotalAmount: 500,
              tutorProfileId: '6bb01222-1fce-4bc3-a69d-3d90db2fdf57',
            },
          },
        },
      },
    });
    expect(operation?.responses['400']).toBeDefined();
    expect(operation?.responses['401']).toBeDefined();
    expect(operation?.responses['403']).toBeDefined();
    expect(operation?.responses['409']).toBeDefined();
    expect(operation?.security).toEqual([{ [JWT_BEARER_AUTH]: [] }]);
  });

  it('requires slotId in the request body schema and no longer accepts studentUserId', () => {
    const schema = document.components?.schemas?.['CreateBookingDto'] as
      | { properties?: Record<string, unknown>; required?: string[] }
      | undefined;

    expect(schema?.properties?.['slotId']).toBeDefined();
    expect(schema?.required).toContain('slotId');
    expect(schema?.properties?.['studentUserId']).toBeUndefined();
  });
});
