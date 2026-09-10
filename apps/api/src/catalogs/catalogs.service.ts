import { Injectable } from '@nestjs/common';

import { PrismaService } from '@/database/prisma.service';

@Injectable()
export class CatalogsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSubjects() {
    const items = await this.prisma.subject.findMany({
      where: { active: true },
      select: { id: true, code: true, name: true, active: true },
      orderBy: [{ name: 'asc' }, { code: 'asc' }],
    });

    return { items };
  }

  async getGradeLevels() {
    const items = await this.prisma.gradeLevel.findMany({
      where: { active: true },
      select: { id: true, code: true, name: true, active: true, sortOrder: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    return { items };
  }
}
