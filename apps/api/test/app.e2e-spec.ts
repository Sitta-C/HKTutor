import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '@app/app.module';
import { configureApplication } from '@app/app.setup';
import { PrismaService } from '@infrastructure/database/prisma.service';

import type { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import type { App } from 'supertest/types';

describe('AppModule (e2e)', () => {
  let app: INestApplication<App>;
  const previousDatabaseUrl = process.env['DATABASE_URL'];

  beforeAll(async () => {
    process.env['DATABASE_URL'] = 'postgresql://user:password@example.test:5432/hktutor';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({ isHealthy: jest.fn().mockResolvedValue(true) })
      .compile();

    app = moduleFixture.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  it('does not expose the removed scaffold root endpoint', () => {
    return request(app.getHttpServer()).get('/api/v1').expect(404);
  });

  it('keeps the health endpoint public', () => {
    return request(app.getHttpServer()).get('/api/v1/health').expect(200);
  });

  afterAll(async () => {
    await app.close();

    if (previousDatabaseUrl === undefined) {
      delete process.env['DATABASE_URL'];
    } else {
      process.env['DATABASE_URL'] = previousDatabaseUrl;
    }
  });
});
