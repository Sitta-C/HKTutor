import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';

import { JWT_BEARER_AUTH } from '@/auth/auth.swagger';
import { ROLES_KEY } from '@/auth/roles.decorator';
import { PrismaService } from '@/database/prisma.service';
import { AuthExampleController } from '@/examples/auth-example.controller';
import { Role } from '@/generated/prisma/client';

import type { AuthenticatedUser } from '@/auth/auth.guard';
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
    const operation = document.paths['/api/examples/protected']?.get;

    expect(operation?.summary).toBe(
      'Example of a JWT-protected endpoint restricted to tutors and admins',
    );
    expect(operation?.security).toEqual([{ [JWT_BEARER_AUTH]: [] }]);
    expect(operation?.responses['200']).toBeDefined();
    expect(operation?.responses['401']).toBeDefined();
    expect(operation?.responses['403']).toBeDefined();
  });
});
