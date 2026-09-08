import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';

import { AppController } from '@/app.controller';
import { AppService } from '@/app.service';
import { CLERK_BEARER_AUTH } from '@/auth/auth.swagger';

import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import type { TestingModule } from '@nestjs/testing';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        { provide: 'CLERK_CLIENT', useValue: {} }, // or a mock client
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });
});

describe('AppController OpenAPI contract', () => {
  let app: INestApplication | undefined;
  let document: OpenAPIObject;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService, { provide: 'CLERK_CLIENT', useValue: {} }],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Test')
        .setVersion('1')
        .addBearerAuth({ scheme: 'bearer', type: 'http' }, CLERK_BEARER_AUTH)
        .build(),
    );
  });

  afterAll(async () => {
    await app?.close();
  });

  it('documents the Clerk bearer-token verification boundary', () => {
    const operation = document.paths['/']?.get;
    const unauthorized = operation?.responses['401'];

    expect(operation?.summary).toBe('Verify a Clerk-authenticated request');
    expect(operation?.security).toContainEqual({ [CLERK_BEARER_AUTH]: [] });
    expect(operation?.responses['200']).toMatchObject({
      content: {
        'application/json': {
          schema: { example: 'Hello World!', type: 'string' },
        },
      },
    });
    expect(unauthorized).toMatchObject({
      content: {
        'application/json': {
          examples: {
            invalidOrExpiredToken: {
              value: {
                message: 'Invalid or expired authentication token',
                statusCode: 401,
              },
            },
            missingToken: {
              value: { message: 'Missing authentication token', statusCode: 401 },
            },
          },
        },
      },
    });
  });
});
