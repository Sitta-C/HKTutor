import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';

import { PrismaService } from '@/database/prisma.service';

import type { INestApplication, Type } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';

describe('TutorsController OpenAPI contract', () => {
  const previousDatabaseUrl = process.env['DATABASE_URL'];
  let app: INestApplication | undefined;
  let document: OpenAPIObject;

  beforeAll(async () => {
    process.env['DATABASE_URL'] = 'postgresql://user:password@example.test:5432/hktutor';
    const { AppModule } = jest.requireActual<{ AppModule: Type<unknown> }>('@/app.module');

    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ teachingListing: { findMany: jest.fn() } })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Test').setVersion('1').build(),
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

  it('publishes the tutor search contract', () => {
    const operation = document.paths['/api/tutors']?.get;

    expect(operation?.summary).toBe('Search public tutors');
    expect(operation?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          in: 'query',
          name: 'subject',
          required: false,
          schema: { example: 'Mathematics', type: 'string' },
        }),
        expect.objectContaining({
          in: 'query',
          name: 'maxPrice',
          required: false,
          schema: { example: 500, minimum: 0, type: 'number' },
        }),
      ]),
    );
    expect(operation?.responses['200']).toMatchObject({
      content: {
        'application/json': {
          schema: {
            example: [
              {
                displayName: 'Anan',
                grade: 'Grade 10',
                id: 'listing-1',
                pricePerHour: 500,
                rating: 4.8,
                subject: 'Mathematics',
              },
            ],
            type: 'array',
          },
        },
      },
    });
    expect(operation?.responses['400']).toBeDefined();
  });
});
