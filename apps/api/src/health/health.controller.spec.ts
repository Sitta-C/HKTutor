import { ServiceUnavailableException } from '@nestjs/common';

import { HealthController } from '@/health/health.controller';

import type { PrismaService } from '@/database/prisma.service';

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
