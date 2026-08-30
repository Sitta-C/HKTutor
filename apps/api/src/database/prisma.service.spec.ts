import { ConfigService } from '@nestjs/config';

import { PrismaService } from '@/database/prisma.service';

const createService = () =>
  new PrismaService(
    new ConfigService({
      DATABASE_URL: 'postgresql://user:password@example.test:5432/postgres?sslmode=require',
    }),
  );

describe('PrismaService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('connects when the Nest module initializes', async () => {
    const service = createService();
    const connect = jest.spyOn(service, '$connect').mockResolvedValue();

    await service.onModuleInit();

    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('disconnects when the Nest module is destroyed', async () => {
    const service = createService();
    const disconnect = jest.spyOn(service, '$disconnect').mockResolvedValue();

    await service.onModuleDestroy();

    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('reports healthy after a successful database probe', async () => {
    const service = createService();
    jest.spyOn(service, '$queryRaw').mockResolvedValue([{ connected: 1 }]);

    await expect(service.isHealthy()).resolves.toBe(true);
  });

  it('reports unhealthy instead of exposing a database error', async () => {
    const service = createService();
    jest
      .spyOn(service, '$queryRaw')
      .mockRejectedValue(new Error('postgresql://user:do-not-print@example.test/postgres'));

    await expect(service.isHealthy()).resolves.toBe(false);
  });
});
