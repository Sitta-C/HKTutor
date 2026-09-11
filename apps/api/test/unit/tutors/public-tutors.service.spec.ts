import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { TutorsService } from '@/tutors/tutors.service';

import type { PrismaService } from '@/database/prisma.service';

const TUTOR_ID = '20000000-0000-4000-8000-000000000001';
const LISTING_ID = '10000000-0000-4000-8000-000000000001';
const SUBJECT_ID = '30000000-0000-4000-8000-000000000001';
const GRADE_ID = '40000000-0000-4000-8000-000000000001';

const subject = { active: true, code: 'MATH', id: SUBJECT_ID, name: 'Mathematics' };
const gradeLevel = {
  active: true,
  code: 'G10',
  id: GRADE_ID,
  name: 'Grade 10',
  sortOrder: 10,
};

const decimal = (value: number) => ({ toNumber: () => value });

function createPrisma() {
  return {
    gradeLevel: { findFirst: jest.fn(), findMany: jest.fn() },
    subject: { findFirst: jest.fn(), findMany: jest.fn() },
    teachingListing: { findMany: jest.fn() },
    tutorProfile: { findFirst: jest.fn() },
  };
}

type SearchCall = {
  select: {
    tutorProfile: {
      select: {
        availabilitySlots: {
          where: {
            startAtUtc: { gt: Date };
          };
        };
      };
    };
  };
  where: {
    gradeLevelId?: string;
    pricePerHour?: { lte: number };
    subjectId?: string;
    tutorProfile: { ratingAverage?: { gte: number } };
  };
};

function getSearchCall(prisma: ReturnType<typeof createPrisma>, index = 0): SearchCall {
  const calls = prisma.teachingListing.findMany.mock.calls as unknown as Array<unknown[]>;
  const args = calls[index]?.[0];
  if (args === undefined) throw new Error(`Missing findMany call at index ${index}`);
  return args as SearchCall;
}

function publicSearchListing(overrides: Record<string, unknown> = {}) {
  return {
    description: 'Experienced mathematics tutor.',
    gradeLevel: { name: gradeLevel.name },
    id: LISTING_ID,
    pricePerHour: decimal(500),
    subject: { name: subject.name },
    tutorProfile: {
      availabilitySlots: [{ startAtUtc: new Date('2026-09-12T02:00:00.000Z') }],
      displayName: 'Kru Anan',
      experienceYears: 5,
      ratingAverage: decimal(4),
      reviewCount: 24,
      userId: TUTOR_ID,
    },
    ...overrides,
  };
}

function publicTutor(overrides: Record<string, unknown> = {}) {
  return {
    bio: 'Experienced mathematics tutor.',
    displayName: 'Kru Anan',
    experienceYears: 5,
    listings: [
      {
        description: 'Experienced mathematics tutor.',
        gradeLevel: { name: gradeLevel.name },
        id: LISTING_ID,
        pricePerHour: decimal(500),
        subject: { name: subject.name },
      },
    ],
    ratingAverage: decimal(4),
    reviewCount: 24,
    userId: TUTOR_ID,
    verificationStatus: 'VERIFIED',
    ...overrides,
  };
}

function expectNoPrivateFields(value: unknown): void {
  const forbidden = new Set([
    'accountStatus',
    'consentAcceptedAt',
    'deletedAt',
    'documentUrl',
    'email',
    'firstName',
    'lastName',
    'nickname',
    'passwordHash',
    'phone',
    'policyVersion',
    'verificationDocumentUrl',
  ]);

  if (Array.isArray(value)) {
    value.forEach(expectNoPrivateFields);
  } else if (typeof value === 'object' && value !== null) {
    Object.entries(value).forEach(([key, nested]) => {
      expect(forbidden.has(key)).toBe(false);
      expectNoPrivateFields(nested);
    });
  }
}

describe('TutorsService public discovery APIs', () => {
  it('returns only public fields for published search results', async () => {
    const prisma = createPrisma();
    prisma.teachingListing.findMany.mockResolvedValue([publicSearchListing()]);
    const service = new TutorsService(prisma as unknown as PrismaService);

    await expect(service.searchPublicTutors({})).resolves.toEqual([
      {
        description: 'Experienced mathematics tutor.',
        displayName: 'Kru Anan',
        experienceYears: 5,
        grade: 'Grade 10',
        listingId: LISTING_ID,
        nextAvailableAt: new Date('2026-09-12T02:00:00.000Z'),
        pricePerHour: 500,
        ratingAverage: 4,
        reviewCount: 24,
        subject: 'Mathematics',
        tutorId: TUTOR_ID,
      },
    ]);

    const result = await service.searchPublicTutors({});
    expect(result[0]?.listingId).not.toBe(result[0]?.tutorId);
    expectNoPrivateFields(result);
    expect(prisma.teachingListing.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: null,
          publicationStatus: 'PUBLISHED',
          tutorProfile: expect.objectContaining({
            verificationStatus: 'VERIFIED',
            user: { accountStatus: 'ACTIVE', deletedAt: null, role: 'TUTOR' },
          }) as object,
        }) as object,
      }),
    );
  });

  it('applies each optional filter independently', async () => {
    const prisma = createPrisma();
    prisma.subject.findFirst.mockResolvedValue({ id: SUBJECT_ID });
    prisma.gradeLevel.findFirst.mockResolvedValue({ id: GRADE_ID });
    prisma.teachingListing.findMany.mockResolvedValue([]);
    const service = new TutorsService(prisma as unknown as PrismaService);
    const cases: Array<[Record<string, string | number>, object]> = [
      [{ subject: 'Mathematics' }, { subjectId: SUBJECT_ID }],
      [{ grade: 'Grade 10' }, { gradeLevelId: GRADE_ID }],
      [{ maxPrice: 500 }, { pricePerHour: { lte: 500 } }],
      [{ minimumRating: 4 }, { tutorProfile: { ratingAverage: { gte: 4 } } }],
    ];

    for (const [query, expectedWhere] of cases) {
      await service.searchPublicTutors(query);
      expect(
        getSearchCall(prisma, prisma.teachingListing.findMany.mock.calls.length - 1).where,
      ).toMatchObject(expectedWhere);
    }
  });

  it('uses exact case-insensitive catalog matches and rejects unsupported values', async () => {
    const prisma = createPrisma();
    prisma.subject.findFirst.mockResolvedValue({ id: SUBJECT_ID });
    prisma.teachingListing.findMany.mockResolvedValue([]);
    const service = new TutorsService(prisma as unknown as PrismaService);

    await expect(service.searchPublicTutors({ subject: 'mathematics' })).resolves.toEqual([]);
    expect(prisma.subject.findFirst).toHaveBeenCalledWith({
      select: { id: true },
      where: { active: true, name: { equals: 'mathematics', mode: 'insensitive' } },
    });

    prisma.subject.findFirst.mockResolvedValue(null);
    await expect(service.searchPublicTutors({ subject: 'Math' })).rejects.toThrow(
      new BadRequestException('subject is not a supported active catalog value'),
    );
    expect(prisma.teachingListing.findMany).toHaveBeenCalledTimes(1);
  });

  it('does not turn a partial subject into a match and rejects unsupported grades', async () => {
    const prisma = createPrisma();
    prisma.subject.findFirst.mockResolvedValue(null);
    const service = new TutorsService(prisma as unknown as PrismaService);

    await expect(service.searchPublicTutors({ subject: 'Math' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.teachingListing.findMany).not.toHaveBeenCalled();

    prisma.subject.findFirst.mockResolvedValue({ id: SUBJECT_ID });
    prisma.gradeLevel.findFirst.mockResolvedValue(null);
    await expect(service.searchPublicTutors({ grade: 'Grade 1' })).rejects.toThrow(
      new BadRequestException('grade is not a supported active catalog value'),
    );
  });

  it('combines all filters with AND semantics and inclusive boundaries', async () => {
    const prisma = createPrisma();
    prisma.subject.findFirst.mockResolvedValue({ id: SUBJECT_ID });
    prisma.gradeLevel.findFirst.mockResolvedValue({ id: GRADE_ID });
    prisma.teachingListing.findMany.mockResolvedValue([]);
    const service = new TutorsService(prisma as unknown as PrismaService);

    await expect(
      service.searchPublicTutors({
        grade: 'Grade 10',
        maxPrice: 500,
        minimumRating: 4,
        subject: 'Mathematics',
      }),
    ).resolves.toEqual([]);

    const call = getSearchCall(prisma);
    expect(call.where).toMatchObject({
      gradeLevelId: GRADE_ID,
      pricePerHour: { lte: 500 },
      subjectId: SUBJECT_ID,
      tutorProfile: { ratingAverage: { gte: 4 } },
    });
  });

  it('keeps null ratings out of minimum-rating searches but allows them without that filter', async () => {
    const prisma = createPrisma();
    prisma.teachingListing.findMany.mockResolvedValue([]);
    const service = new TutorsService(prisma as unknown as PrismaService);

    await service.searchPublicTutors({ minimumRating: 4 });
    const ratedWhere = getSearchCall(prisma).where;
    expect(ratedWhere.tutorProfile.ratingAverage).toEqual({ gte: 4 });

    await service.searchPublicTutors({});
    const unrestrictedWhere = getSearchCall(prisma, 1).where;
    expect(unrestrictedWhere.tutorProfile).not.toHaveProperty('ratingAverage');
  });

  it('uses only future, non-deleted slots without pending or confirmed bookings', async () => {
    const prisma = createPrisma();
    prisma.teachingListing.findMany.mockResolvedValue([]);
    const service = new TutorsService(prisma as unknown as PrismaService);

    await service.searchPublicTutors({});
    const select = getSearchCall(prisma).select;
    const availability = select.tutorProfile.select.availabilitySlots;
    expect(availability).toMatchObject({
      orderBy: { startAtUtc: 'asc' },
      take: 1,
      where: {
        bookings: { none: { status: { in: ['PENDING', 'CONFIRMED'] } } },
        deletedAt: null,
      },
    });
    expect(availability.where.startAtUtc.gt).toBeInstanceOf(Date);
  });

  it('returns a public Tutor detail with zero or more published listings only', async () => {
    const prisma = createPrisma();
    prisma.tutorProfile.findFirst.mockResolvedValue(publicTutor({ listings: [] }));
    const service = new TutorsService(prisma as unknown as PrismaService);

    await expect(service.getPublicTutor(TUTOR_ID)).resolves.toEqual({
      listings: [],
      tutor: {
        bio: 'Experienced mathematics tutor.',
        displayName: 'Kru Anan',
        experienceYears: 5,
        ratingAverage: 4,
        reviewCount: 24,
        tutorId: TUTOR_ID,
        verificationStatus: 'VERIFIED',
      },
    });
    expect(prisma.tutorProfile.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: TUTOR_ID,
          verificationStatus: 'VERIFIED',
          user: { accountStatus: 'ACTIVE', deletedAt: null, role: 'TUTOR' },
        }) as object,
      }),
    );
    expectNoPrivateFields(await service.getPublicTutor(TUTOR_ID));
  });

  it('does not expose an unavailable Tutor', async () => {
    const prisma = createPrisma();
    prisma.tutorProfile.findFirst.mockResolvedValue(null);
    const service = new TutorsService(prisma as unknown as PrismaService);

    await expect(service.getPublicTutor(TUTOR_ID)).rejects.toThrow(
      new NotFoundException('Tutor not found'),
    );
  });

  it('returns active catalogs in deterministic order and preserves empty results', async () => {
    const prisma = createPrisma();
    prisma.subject.findMany.mockResolvedValue([subject]);
    prisma.gradeLevel.findMany.mockResolvedValue([gradeLevel]);
    const service = new TutorsService(prisma as unknown as PrismaService);

    await expect(service.getActiveSubjects()).resolves.toEqual({ items: [subject] });
    await expect(service.getActiveGradeLevels()).resolves.toEqual({ items: [gradeLevel] });
    expect(prisma.subject.findMany).toHaveBeenCalledWith({
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: { active: true, code: true, id: true, name: true },
      where: { active: true },
    });
    expect(prisma.gradeLevel.findMany).toHaveBeenCalledWith({
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: { active: true, code: true, id: true, name: true, sortOrder: true },
      where: { active: true },
    });

    prisma.subject.findMany.mockResolvedValue([]);
    prisma.gradeLevel.findMany.mockResolvedValue([]);
    await expect(service.getActiveSubjects()).resolves.toEqual({ items: [] });
    await expect(service.getActiveGradeLevels()).resolves.toEqual({ items: [] });
  });

  it('maps catalog database outages to 503 without hiding unknown errors', async () => {
    const prisma = createPrisma();
    prisma.subject.findMany.mockRejectedValue(
      Object.assign(new Error('database down'), { code: 'P1001' }),
    );
    prisma.gradeLevel.findMany.mockRejectedValue(new Error('programming failure'));
    const service = new TutorsService(prisma as unknown as PrismaService);

    await expect(service.getActiveSubjects()).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(service.getActiveGradeLevels()).rejects.toThrow('programming failure');
  });
});
