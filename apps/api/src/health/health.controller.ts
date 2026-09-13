import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';

import { PrismaService } from '@/database/prisma.service';
import { GetHealthDoc, HealthControllerDoc } from '@/health/health.swagger';

@HealthControllerDoc()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @GetHealthDoc()
  async getHealth(): Promise<{ database: 'connected' }> {
    let databaseIsHealthy = false;

    try {
      databaseIsHealthy = await this.prisma.isHealthy();
    } catch {
      databaseIsHealthy = false;
    }

    if (!databaseIsHealthy) {
      throw new ServiceUnavailableException({ database: 'disconnected' });
    }

    return { database: 'connected' };
  }
}
