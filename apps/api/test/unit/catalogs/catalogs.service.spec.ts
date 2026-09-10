import { CatalogsService } from '@/catalogs/catalogs.service';

import type { PrismaService } from '@/database/prisma.service';

describe('CatalogsService', () => {
  it('returns active subjects in a stable order', async () => {
    const items = [{ id: 'subject-id', code: 'math', name: 'Mathematics', active: true }];
    const prisma = { subject: { findMany: jest.fn().mockResolvedValue(items) } };
    const service = new CatalogsService(prisma as unknown as PrismaService);

    await expect(service.getSubjects()).resolves.toEqual({ items });
    expect(prisma.subject.findMany).toHaveBeenCalledWith({
      where: { active: true },
      select: { id: true, code: true, name: true, active: true },
      orderBy: [{ name: 'asc' }, { code: 'asc' }],
    });
  });

  it('returns active grade levels by display order', async () => {
    const items = [
      { id: 'grade-id', code: 'grade-10', name: 'Grade 10', active: true, sortOrder: 10 },
    ];
    const prisma = { gradeLevel: { findMany: jest.fn().mockResolvedValue(items) } };
    const service = new CatalogsService(prisma as unknown as PrismaService);

    await expect(service.getGradeLevels()).resolves.toEqual({ items });
    expect(prisma.gradeLevel.findMany).toHaveBeenCalledWith({
      where: { active: true },
      select: { id: true, code: true, name: true, active: true, sortOrder: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  });
});
