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

  beforeAll(async () => {
    Object.assign(process.env, testEnvironment);
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

    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
});
