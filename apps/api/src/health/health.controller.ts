import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { PrismaService } from '@/database/prisma.service';
import { ApiHealthCheck } from '@/health/health.swagger';

@ApiTags('health')
@Controller('api/health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiHealthCheck()
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
