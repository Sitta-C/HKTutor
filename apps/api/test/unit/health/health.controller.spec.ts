import { ServiceUnavailableException } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';

import { PrismaService } from '@/database/prisma.service';
import { HealthController } from '@/health/health.controller';

import type { INestApplication } from '@nestjs/common';

describe('HealthController', () => {
  const isHealthy = jest.fn<Promise<boolean>, []>();
  const controller = new HealthController({ isHealthy } as unknown as PrismaService);

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('returns connected when the database probe succeeds', async () => {
    isHealthy.mockResolvedValue(true);

    await expect(controller.getHealth()).resolves.toEqual({ database: 'connected' });
  });

  it('throws a sanitized unavailable response when the database probe fails', async () => {
    isHealthy.mockResolvedValue(false);

    await expectUnavailableResponse(controller.getHealth());
  });

  it('does not expose an unexpected database error', async () => {
    isHealthy.mockRejectedValue(
      new Error('postgresql://user:do-not-print@example.test:5432/postgres'),
    );

    try {
      await controller.getHealth();
      throw new Error('Expected health check to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect(JSON.stringify((error as ServiceUnavailableException).getResponse())).not.toContain(
        'do-not-print',
      );
    }
  });
});

describe('HealthController OpenAPI contract', () => {
  it('documents the connected and disconnected response bodies', async () => {
    const moduleFixture = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: PrismaService, useValue: { isHealthy: jest.fn() } }],
    }).compile();
    const app: INestApplication = moduleFixture.createNestApplication();
    await app.init();

    try {
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('Test').setVersion('1').build(),
      );
      const operation = document.paths['/api/health']?.get;
      const responses = operation?.responses;

      expect(operation?.summary).toBe('Check database connectivity');
      expect(responses?.['200']).toMatchObject({
        content: {
          'application/json': {
            schema: { example: { database: 'connected' } },
          },
        },
      });
      expect(responses?.['503']).toMatchObject({
        content: {
          'application/json': {
            schema: { example: { database: 'disconnected' } },
          },
        },
      });
    } finally {
      await app.close();
    }
  });
});

async function expectUnavailableResponse(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
    throw new Error('Expected health check to reject');
  } catch (error) {
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getStatus()).toBe(503);
    expect((error as ServiceUnavailableException).getResponse()).toEqual({
      database: 'disconnected',
    });
  }
}
