import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';

import { API_GLOBAL_PREFIX } from '@/app.setup';
import { JWT_BEARER_AUTH } from '@/auth/auth.swagger';
import { OWNERSHIP_KEY } from '@/auth/ownership.decorator';
import { ROLES_KEY } from '@/auth/roles.decorator';
import { PrismaService } from '@/database/prisma.service';
import { AuthExampleController } from '@/examples/auth-example.controller';
import { Role } from '@/generated/prisma/client';

import type { AuthenticatedUser } from '@/auth/auth.guard';
import type { OwnershipRule } from '@/auth/ownership.decorator';
import type { INestApplication, Type } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';

describe('AuthExampleController', () => {
  it('returns the current user attached by JwtAuthGuard', () => {
    const controller = new AuthExampleController();
    const user: AuthenticatedUser = {
      email: 'tutor@example.com',
      id: 'user-1',
      role: Role.TUTOR,
      sessionId: 'session-1',
    };

    expect(controller.getProtectedExample(user)).toEqual({
      email: user.email,
      message: 'Authenticated tutor/admin request accepted',
      role: user.role,
      userId: user.id,
    });
  });

  it('declares tutor and admin as the allowed roles', () => {
    const handler = Object.getOwnPropertyDescriptor(
      AuthExampleController.prototype,
      'getProtectedExample',
    )?.value as object | undefined;
    const roles = handler
      ? (Reflect.getMetadata(ROLES_KEY, handler) as Role[] | undefined)
      : undefined;

    expect(roles).toEqual([Role.TUTOR, Role.ADMIN]);
  });

  it('returns the owner-scoped listing example after all guards pass', () => {
    const controller = new AuthExampleController();
    const user: AuthenticatedUser = {
      email: 'tutor@example.com',
      id: '20000000-0000-4000-8000-000000000001',
      role: Role.TUTOR,
      sessionId: 'session-1',
    };
    const listingId = '10000000-0000-4000-8000-000000000001';

    expect(controller.getOwnedListingExample(listingId, user)).toEqual({
      listingId,
      message: 'Private listing access accepted',
      requesterId: user.id,
      role: Role.TUTOR,
    });
  });

  it('declares the role and ownership policy for the private listing example', () => {
    const handler = Object.getOwnPropertyDescriptor(
      AuthExampleController.prototype,
      'getOwnedListingExample',
    )?.value as object | undefined;
    const roles = handler
      ? (Reflect.getMetadata(ROLES_KEY, handler) as Role[] | undefined)
      : undefined;
    const ownership = handler
      ? (Reflect.getMetadata(OWNERSHIP_KEY, handler) as OwnershipRule | undefined)
      : undefined;

    expect(roles).toEqual([Role.TUTOR, Role.ADMIN]);
    expect(ownership).toEqual({
      resource: 'teachingListing',
      idParam: 'listingId',
      allowAdmin: true,
    });
  });
});

describe('AuthExampleController OpenAPI contract', () => {
  const previousDatabaseUrl = process.env['DATABASE_URL'];
  let app: INestApplication | undefined;
  let document: OpenAPIObject;

  beforeAll(async () => {
    process.env['DATABASE_URL'] = 'postgresql://user:password@example.test:5432/hktutor';
    const { AppModule } = jest.requireActual<{ AppModule: Type<unknown> }>('@/app.module');

    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({})
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

  it('documents bearer authentication and authorization failures', () => {
    const operation = document.paths['/api/v1/examples/protected']?.get;

    expect(operation?.summary).toBe(
      'Example of a JWT-protected endpoint restricted to tutors and admins',
    );
    expect(operation?.security).toEqual([{ [JWT_BEARER_AUTH]: [] }]);
    expect(operation?.responses['200']).toBeDefined();
    expect(operation?.responses['401']).toBeDefined();
    expect(operation?.responses['403']).toBeDefined();
  });

  it('documents the private listing ownership example and its 404 response', () => {
    const operation = document.paths['/api/v1/examples/private-listings/{listingId}']?.get;

    expect(operation?.summary).toBe('Example of owner-scoped access to a private teaching listing');
    expect(operation?.security).toEqual([{ [JWT_BEARER_AUTH]: [] }]);
    expect(operation?.responses['200']).toBeDefined();
    expect(operation?.responses['401']).toBeDefined();
    expect(operation?.responses['403']).toBeDefined();
    expect(operation?.responses['404']).toBeDefined();
  });
});
