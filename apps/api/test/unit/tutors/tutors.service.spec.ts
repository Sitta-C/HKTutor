import { Prisma } from '@/generated/prisma/client';
import { TutorsService } from '@/tutors/tutors.service';

import type { PrismaService } from '@/database/prisma.service';

interface FindManyQuery {
  where: {
    pricePerHour?: unknown;
    subject: { is: { name?: unknown } };
  };
}

describe('TutorsService', () => {
  it('maps matching listings to the public tutor response', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        gradeLevel: { name: 'Grade 10' },
        id: 'listing-1',
        pricePerHour: new Prisma.Decimal('500.00'),
        subject: { name: 'Mathematics' },
        tutorProfile: {
          displayName: 'Anan',
          ratingAverage: new Prisma.Decimal('4.80'),
        },
      },
    ]);
    const service = new TutorsService({
      teachingListing: { findMany },
    } as unknown as PrismaService);

    await expect(service.search({ maxPrice: 500, subject: 'Mathematics' })).resolves.toEqual([
      {
        displayName: 'Anan',
        grade: 'Grade 10',
        id: 'listing-1',
        pricePerHour: 500,
        rating: 4.8,
        subject: 'Mathematics',
      },
    ]);
  });

  it('queries the public listing boundary with inclusive filters', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new TutorsService({
      teachingListing: { findMany },
    } as unknown as PrismaService);

    await service.search({ maxPrice: 500, subject: 'Mathematics' });

    expect(findMany).toHaveBeenCalledWith({
      select: {
        gradeLevel: { select: { name: true } },
        id: true,
        pricePerHour: true,
        subject: { select: { name: true } },
        tutorProfile: {
          select: {
            displayName: true,
            ratingAverage: true,
          },
        },
      },
      where: {
        deletedAt: null,
        pricePerHour: { lte: 500 },
        publicationStatus: 'PUBLISHED',
        subject: {
          is: {
            active: true,
            name: { equals: 'Mathematics', mode: 'insensitive' },
          },
        },
        tutorProfile: {
          is: {
            user: {
              is: {
                accountStatus: 'ACTIVE',
                deletedAt: null,
              },
            },
            verificationStatus: 'VERIFIED',
          },
        },
      },
    });
  });

  it('omits optional filter clauses when no filters are supplied', async () => {
    const findMany = jest.fn<Promise<unknown[]>, [FindManyQuery]>().mockResolvedValue([]);
    const service = new TutorsService({
      teachingListing: { findMany },
    } as unknown as PrismaService);

    await service.search({});

    const query = findMany.mock.calls[0]![0];
    expect(Object.hasOwn(query.where, 'pricePerHour')).toBe(false);
    expect(Object.hasOwn(query.where.subject.is, 'name')).toBe(false);
  });
});
