import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { TutorsService } from '@/tutors/tutors.service';

import type { PrismaService } from '@/database/prisma.service';

const USER_ID = '20000000-0000-4000-8000-000000000001';
const LISTING_ID = '10000000-0000-4000-8000-000000000001';
const SUBJECT_ID = '30000000-0000-4000-8000-000000000001';
const GRADE_LEVEL_ID = '40000000-0000-4000-8000-000000000001';

const subject = {
  id: SUBJECT_ID,
  code: 'MATH',
  name: 'Mathematics',
  active: true,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-02T00:00:00.000Z'),
};

const gradeLevel = {
  id: GRADE_LEVEL_ID,
  code: 'G10',
  name: 'Grade 10',
  active: true,
  createdAt: new Date('2026-08-03T00:00:00.000Z'),
  updatedAt: new Date('2026-08-04T00:00:00.000Z'),
};

function listing(overrides: Record<string, unknown> = {}) {
  return {
    id: LISTING_ID,
    tutorProfileId: USER_ID,
    subjectId: SUBJECT_ID,
    gradeLevelId: GRADE_LEVEL_ID,
    subject,
    gradeLevel,
    pricePerHour: { toNumber: () => 450.5 },
    description: 'Experienced mathematics tutor.',
    publicationStatus: 'DRAFT',
    publishedAt: null,
    createdAt: new Date('2026-08-04T00:00:00.000Z'),
    updatedAt: new Date('2026-08-05T00:00:00.000Z'),
    ...overrides,
  };
}

function createPrisma() {
  return {
    subject: {
      count: jest.fn(),
      findFirstOrThrow: jest.fn(),
    },
    gradeLevel: {
      count: jest.fn(),
      findFirstOrThrow: jest.fn(),
    },
    teachingListing: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    tutorProfile: {
      findFirst: jest.fn(),
    },
  };
}

describe('TutorsService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  describe('getListings', () => {
    it('scopes listings to the owner and optional publication status, then maps Prisma values', async () => {
      const prisma = createPrisma();
      const publishedAt = new Date('2026-08-06T00:00:00.000Z');
      prisma.teachingListing.findMany.mockResolvedValue([
        listing({ publicationStatus: 'PUBLISHED', publishedAt }),
      ]);
      const service = new TutorsService(prisma as unknown as PrismaService);

      const result = await service.getListings(USER_ID, { publicationStatus: 'PUBLISHED' });

      expect(prisma.teachingListing.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tutorProfileId: USER_ID,
            deletedAt: null,
            publicationStatus: 'PUBLISHED',
          },
        }),
      );
      expect(result).toEqual([
        {
          listingId: LISTING_ID,
          subject,
          gradeLevel,
          pricePerHour: 450.5,
          description: 'Experienced mathematics tutor.',
          publicationStatus: 'PUBLISHED',
          publishedAt,
          createdAt: new Date('2026-08-04T00:00:00.000Z'),
          updatedAt: new Date('2026-08-05T00:00:00.000Z'),
        },
      ]);
    });

    it('omits the publication filter and returns an empty array when no listings exist', async () => {
      const prisma = createPrisma();
      prisma.teachingListing.findMany.mockResolvedValue([]);
      const service = new TutorsService(prisma as unknown as PrismaService);

      await expect(service.getListings(USER_ID, {})).resolves.toEqual([]);
      expect(prisma.teachingListing.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tutorProfileId: USER_ID, deletedAt: null } }),
      );
    });
  });

  describe('getListing', () => {
    it('returns one live listing owned by the tutor', async () => {
      const prisma = createPrisma();
      prisma.teachingListing.findFirst.mockResolvedValue(listing());
      const service = new TutorsService(prisma as unknown as PrismaService);

      await expect(service.getListing(USER_ID, LISTING_ID)).resolves.toMatchObject({
        listingId: LISTING_ID,
        publicationStatus: 'DRAFT',
      });
      expect(prisma.teachingListing.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: LISTING_ID, tutorProfileId: USER_ID, deletedAt: null },
        }),
      );
    });

    it('does not reveal a missing or unowned listing', async () => {
      const prisma = createPrisma();
      prisma.teachingListing.findFirst.mockResolvedValue(null);
      const service = new TutorsService(prisma as unknown as PrismaService);

      await expect(service.getListing(USER_ID, LISTING_ID)).rejects.toThrow(
        new NotFoundException('absent/not owned/deleted listing'),
      );
    });
  });

  describe('postListing', () => {
    const request = {
      subjectId: SUBJECT_ID,
      gradeLevelId: GRADE_LEVEL_ID,
      pricePerHour: 450.5,
      description: 'Experienced mathematics tutor.',
    };

    it('rejects an absent request', async () => {
      const service = new TutorsService(createPrisma() as unknown as PrismaService);

      await expect(service.postListing(USER_ID, undefined!)).rejects.toThrow(
        new NotFoundException('Catalog value absent'),
      );
    });

    it('rejects an unknown subject without checking the grade level', async () => {
      const prisma = createPrisma();
      prisma.subject.count.mockResolvedValue(0);
      const service = new TutorsService(prisma as unknown as PrismaService);

      await expect(service.postListing(USER_ID, request)).rejects.toThrow(
        new BadRequestException('subjectId is invalid'),
      );
      expect(prisma.gradeLevel.count).not.toHaveBeenCalled();
      expect(prisma.teachingListing.create).not.toHaveBeenCalled();
    });

    it('rejects an unknown grade level', async () => {
      const prisma = createPrisma();
      prisma.subject.count.mockResolvedValue(1);
      prisma.gradeLevel.count.mockResolvedValue(0);
      const service = new TutorsService(prisma as unknown as PrismaService);

      await expect(service.postListing(USER_ID, request)).rejects.toThrow(
        new BadRequestException('gradeLevelId is invalid'),
      );
      expect(prisma.teachingListing.create).not.toHaveBeenCalled();
    });

    it('creates an owned draft listing and returns its id', async () => {
      const prisma = createPrisma();
      prisma.subject.count.mockResolvedValue(1);
      prisma.gradeLevel.count.mockResolvedValue(1);
      prisma.teachingListing.create.mockResolvedValue({ id: LISTING_ID });
      const service = new TutorsService(prisma as unknown as PrismaService);

      await expect(service.postListing(USER_ID, request)).resolves.toBe(LISTING_ID);
      expect(prisma.teachingListing.create).toHaveBeenCalledWith({
        data: {
          tutorProfileId: USER_ID,
          ...request,
        },
      });
    });
  });

  describe('patchListing', () => {
    it('validates a supplied subject before updating', async () => {
      const prisma = createPrisma();
      prisma.subject.count.mockResolvedValue(0);
      const service = new TutorsService(prisma as unknown as PrismaService);

      await expect(
        service.patchListing(USER_ID, LISTING_ID, { subjectId: SUBJECT_ID }),
      ).rejects.toThrow(new BadRequestException('subjectId is invalid'));
      expect(prisma.teachingListing.update).not.toHaveBeenCalled();
    });

    it('validates a supplied grade level before updating', async () => {
      const prisma = createPrisma();
      prisma.gradeLevel.count.mockResolvedValue(0);
      const service = new TutorsService(prisma as unknown as PrismaService);

      await expect(
        service.patchListing(USER_ID, LISTING_ID, { gradeLevelId: GRADE_LEVEL_ID }),
      ).rejects.toThrow(new BadRequestException('gradeLevelId is invalid'));
      expect(prisma.teachingListing.update).not.toHaveBeenCalled();
    });

    it('updates only supplied fields on a live owned listing and returns the mapped listing', async () => {
      const prisma = createPrisma();
      prisma.teachingListing.update.mockResolvedValue(
        listing({ description: 'Updated mathematics tutoring description.' }),
      );
      prisma.subject.findFirstOrThrow.mockResolvedValue(subject);
      prisma.gradeLevel.findFirstOrThrow.mockResolvedValue(gradeLevel);
      const service = new TutorsService(prisma as unknown as PrismaService);

      const result = await service.patchListing(USER_ID, LISTING_ID, {
        pricePerHour: 500,
        description: 'Updated mathematics tutoring description.',
      });

      expect(prisma.subject.count).not.toHaveBeenCalled();
      expect(prisma.gradeLevel.count).not.toHaveBeenCalled();
      expect(prisma.teachingListing.update).toHaveBeenCalledWith({
        where: { tutorProfileId: USER_ID, id: LISTING_ID, deletedAt: null },
        data: {
          pricePerHour: 500,
          description: 'Updated mathematics tutoring description.',
        },
      });
      expect(result).toMatchObject({
        listingId: LISTING_ID,
        subject,
        gradeLevel,
        pricePerHour: 450.5,
        description: 'Updated mathematics tutoring description.',
        publishedAt: null,
      });
    });

    it('reports a listing not found when the update returns no row', async () => {
      const prisma = createPrisma();
      prisma.teachingListing.update.mockResolvedValue(null);
      const service = new TutorsService(prisma as unknown as PrismaService);

      await expect(service.patchListing(USER_ID, LISTING_ID, {})).rejects.toThrow(
        new NotFoundException('absent/not owned/deleted listing'),
      );
    });
  });

  describe('postPublishListing', () => {
    it.each([null, { verificationStatus: 'PENDING' }])(
      'rejects an absent or unverified tutor profile (%p)',
      async (profile) => {
        const prisma = createPrisma();
        prisma.tutorProfile.findFirst.mockResolvedValue(profile);
        const service = new TutorsService(prisma as unknown as PrismaService);

        await expect(service.postPublishListing(USER_ID, LISTING_ID)).rejects.toThrow(
          new ForbiddenException('Tutor is unverified'),
        );
        expect(prisma.teachingListing.update).not.toHaveBeenCalled();
      },
    );

    it('publishes a verified tutor listing and returns the mapped listing', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-10T01:00:00.000Z'));
      const prisma = createPrisma();
      const publishedAt = new Date('2026-09-10T01:00:00.000Z');
      prisma.tutorProfile.findFirst.mockResolvedValue({ verificationStatus: 'VERIFIED' });
      prisma.teachingListing.update.mockResolvedValue(
        listing({ publicationStatus: 'PUBLISHED', publishedAt }),
      );
      prisma.subject.findFirstOrThrow.mockResolvedValue(subject);
      prisma.gradeLevel.findFirstOrThrow.mockResolvedValue(gradeLevel);
      const service = new TutorsService(prisma as unknown as PrismaService);

      const result = await service.postPublishListing(USER_ID, LISTING_ID);

      expect(prisma.tutorProfile.findFirst).toHaveBeenCalledWith({
        select: { verificationStatus: true },
        where: { userId: USER_ID },
      });
      expect(prisma.teachingListing.update).toHaveBeenCalledWith({
        where: { tutorProfileId: USER_ID, id: LISTING_ID },
        data: { publicationStatus: 'PUBLISHED', publishedAt },
      });
      expect(result).toMatchObject({
        listingId: LISTING_ID,
        publicationStatus: 'PUBLISHED',
        publishedAt,
      });
    });

    it('reports a verified tutor listing not found when the update returns no row', async () => {
      const prisma = createPrisma();
      prisma.tutorProfile.findFirst.mockResolvedValue({ verificationStatus: 'VERIFIED' });
      prisma.teachingListing.update.mockResolvedValue(null);
      const service = new TutorsService(prisma as unknown as PrismaService);

      await expect(service.postPublishListing(USER_ID, LISTING_ID)).rejects.toThrow(
        new NotFoundException('absent/not-owned listing'),
      );
    });
  });

  describe('updateListingStatus', () => {
    it('archives an owned listing while retaining publication history', async () => {
      const prisma = createPrisma();
      const publishedAt = new Date('2026-09-01T00:00:00.000Z');
      prisma.teachingListing.update.mockResolvedValue(
        listing({ publicationStatus: 'ARCHIVED', publishedAt }),
      );
      prisma.subject.findFirstOrThrow.mockResolvedValue(subject);
      prisma.gradeLevel.findFirstOrThrow.mockResolvedValue(gradeLevel);
      const service = new TutorsService(prisma as unknown as PrismaService);

      await expect(
        service.updateListingStatus(USER_ID, LISTING_ID, 'ARCHIVED'),
      ).resolves.toMatchObject({
        listingId: LISTING_ID,
        publicationStatus: 'ARCHIVED',
        publishedAt,
      });
      expect(prisma.teachingListing.update).toHaveBeenCalledWith({
        where: { tutorProfileId: USER_ID, id: LISTING_ID, deletedAt: null },
        data: { publicationStatus: 'ARCHIVED' },
      });
    });

    it('uses the verified publication flow for PUBLISHED', async () => {
      const prisma = createPrisma();
      prisma.tutorProfile.findFirst.mockResolvedValue({ verificationStatus: 'VERIFIED' });
      prisma.teachingListing.update.mockResolvedValue(
        listing({ publicationStatus: 'PUBLISHED', publishedAt: new Date() }),
      );
      prisma.subject.findFirstOrThrow.mockResolvedValue(subject);
      prisma.gradeLevel.findFirstOrThrow.mockResolvedValue(gradeLevel);
      const service = new TutorsService(prisma as unknown as PrismaService);

      await expect(
        service.updateListingStatus(USER_ID, LISTING_ID, 'PUBLISHED'),
      ).resolves.toMatchObject({ publicationStatus: 'PUBLISHED' });
    });
  });
});
