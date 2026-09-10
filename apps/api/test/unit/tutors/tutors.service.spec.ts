import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { TutorsService } from '@/tutors/tutors.service';

import type { PrismaService } from '@/database/prisma.service';

const USER_ID = '20000000-0000-4000-8000-000000000001';
const LISTING_ID = '10000000-0000-4000-8000-000000000001';
const SUBJECT_ID = '30000000-0000-4000-8000-000000000001';
const GRADE_LEVEL_ID = '40000000-0000-4000-8000-000000000001';

const subject = {
  active: true,
  code: 'MATH',
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  id: SUBJECT_ID,
  name: 'Mathematics',
  updatedAt: new Date('2026-08-02T00:00:00.000Z'),
};

const gradeLevel = {
  active: true,
  code: 'G10',
  createdAt: new Date('2026-08-03T00:00:00.000Z'),
  id: GRADE_LEVEL_ID,
  name: 'Grade 10',
  updatedAt: new Date('2026-08-04T00:00:00.000Z'),
};

function listing(overrides: Record<string, unknown> = {}) {
  return {
    description: 'Experienced mathematics tutor.',
    gradeLevel,
    id: LISTING_ID,
    pricePerHour: { toNumber: () => 450.5 },
    publicationStatus: 'DRAFT',
    publishedAt: null,
    subject,
    updatedAt: new Date('2026-08-05T00:00:00.000Z'),
    ...overrides,
  };
}

function createPrisma() {
  return {
    gradeLevel: { findFirst: jest.fn() },
    subject: { findFirst: jest.fn() },
    teachingListing: {
      create: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    tutorProfile: { findUnique: jest.fn() },
  };
}

function recordNotFoundError() {
  return Object.assign(new Error('Record not found'), { code: 'P2025' });
}

describe('TutorsService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  describe('getListings', () => {
    it('scopes, filters, and orders the current tutor listings', async () => {
      const prisma = createPrisma();
      const publishedAt = new Date('2026-08-06T00:00:00.000Z');
      prisma.teachingListing.findMany.mockResolvedValue([
        listing({ publicationStatus: 'PUBLISHED', publishedAt }),
      ]);
      const service = new TutorsService(prisma as unknown as PrismaService);

      const result = await service.getListings(USER_ID, { publicationStatus: 'PUBLISHED' });

      expect(prisma.teachingListing.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { updatedAt: 'desc' },
          where: {
            deletedAt: null,
            publicationStatus: 'PUBLISHED',
            tutorProfileId: USER_ID,
          },
        }),
      );
      expect(result).toEqual([
        {
          description: 'Experienced mathematics tutor.',
          gradeLevel,
          listingId: LISTING_ID,
          pricePerHour: 450.5,
          publicationStatus: 'PUBLISHED',
          publishedAt,
          subject,
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
        expect.objectContaining({ where: { deletedAt: null, tutorProfileId: USER_ID } }),
      );
    });
  });

  describe('postListing', () => {
    const dto = {
      description: 'Experienced mathematics tutor.',
      gradeLevelId: GRADE_LEVEL_ID,
      pricePerHour: 450.5,
      subjectId: SUBJECT_ID,
    };

    it('rejects an unknown or inactive subject', async () => {
      const prisma = createPrisma();
      prisma.subject.findFirst.mockResolvedValue(null);
      prisma.gradeLevel.findFirst.mockResolvedValue({ id: GRADE_LEVEL_ID });
      const service = new TutorsService(prisma as unknown as PrismaService);

      await expect(service.postListing(USER_ID, dto)).rejects.toThrow(
        new BadRequestException('subjectId is invalid'),
      );
      expect(prisma.teachingListing.create).not.toHaveBeenCalled();
    });

    it('rejects an unknown or inactive grade level', async () => {
      const prisma = createPrisma();
      prisma.subject.findFirst.mockResolvedValue({ id: SUBJECT_ID });
      prisma.gradeLevel.findFirst.mockResolvedValue(null);
      const service = new TutorsService(prisma as unknown as PrismaService);

      await expect(service.postListing(USER_ID, dto)).rejects.toThrow(
        new BadRequestException('gradeLevelId is invalid'),
      );
      expect(prisma.teachingListing.create).not.toHaveBeenCalled();
    });

    it('creates an owned draft and returns the complete listing', async () => {
      const prisma = createPrisma();
      prisma.subject.findFirst.mockResolvedValue({ id: SUBJECT_ID });
      prisma.gradeLevel.findFirst.mockResolvedValue({ id: GRADE_LEVEL_ID });
      prisma.teachingListing.create.mockResolvedValue(listing());
      const service = new TutorsService(prisma as unknown as PrismaService);

      await expect(service.postListing(USER_ID, dto)).resolves.toMatchObject({
        listingId: LISTING_ID,
        subject,
        gradeLevel,
      });
      expect(prisma.teachingListing.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            description: dto.description,
            gradeLevelId: GRADE_LEVEL_ID,
            pricePerHour: 450.5,
            subjectId: SUBJECT_ID,
            tutorProfileId: USER_ID,
          },
        }),
      );
    });
  });

  describe('patchListing', () => {
    it('updates only supplied fields and returns the joined listing from one write', async () => {
      const prisma = createPrisma();
      prisma.teachingListing.update.mockResolvedValue(
        listing({ description: 'Updated mathematics tutoring description.' }),
      );
      const service = new TutorsService(prisma as unknown as PrismaService);
      const dto = {
        description: 'Updated mathematics tutoring description.',
        pricePerHour: 500,
      };

      const result = await service.patchListing(USER_ID, LISTING_ID, dto);

      expect(prisma.subject.findFirst).not.toHaveBeenCalled();
      expect(prisma.gradeLevel.findFirst).not.toHaveBeenCalled();
      expect(prisma.teachingListing.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: dto,
          where: { deletedAt: null, id: LISTING_ID, tutorProfileId: USER_ID },
        }),
      );
      expect(result).toMatchObject({
        description: dto.description,
        gradeLevel,
        listingId: LISTING_ID,
        subject,
      });
    });

    it('maps Prisma record-not-found errors to a stable 404', async () => {
      const prisma = createPrisma();
      prisma.teachingListing.update.mockRejectedValue(recordNotFoundError());
      const service = new TutorsService(prisma as unknown as PrismaService);

      await expect(service.patchListing(USER_ID, LISTING_ID, {})).rejects.toThrow(
        new NotFoundException('Listing not found'),
      );
    });
  });

  describe('postPublishListing', () => {
    it.each([null, { verificationStatus: 'PENDING' }])(
      'rejects an absent or unverified tutor profile (%p)',
      async (profile) => {
        const prisma = createPrisma();
        prisma.tutorProfile.findUnique.mockResolvedValue(profile);
        const service = new TutorsService(prisma as unknown as PrismaService);

        await expect(service.postPublishListing(USER_ID, LISTING_ID)).rejects.toThrow(
          new ForbiddenException('Tutor is not verified'),
        );
        expect(prisma.teachingListing.update).not.toHaveBeenCalled();
      },
    );

    it('publishes a verified tutor listing and returns the updated record', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-10T01:00:00.000Z'));
      const prisma = createPrisma();
      const publishedAt = new Date('2026-09-10T01:00:00.000Z');
      prisma.tutorProfile.findUnique.mockResolvedValue({ verificationStatus: 'VERIFIED' });
      prisma.teachingListing.update.mockResolvedValue(
        listing({ publicationStatus: 'PUBLISHED', publishedAt }),
      );
      const service = new TutorsService(prisma as unknown as PrismaService);

      const result = await service.postPublishListing(USER_ID, LISTING_ID);

      expect(prisma.tutorProfile.findUnique).toHaveBeenCalledWith({
        select: { verificationStatus: true },
        where: { userId: USER_ID },
      });
      expect(prisma.teachingListing.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { publicationStatus: 'PUBLISHED', publishedAt },
          where: { deletedAt: null, id: LISTING_ID, tutorProfileId: USER_ID },
        }),
      );
      expect(result).toMatchObject({
        listingId: LISTING_ID,
        publicationStatus: 'PUBLISHED',
        publishedAt,
      });
    });

    it('maps a missing listing to a stable 404', async () => {
      const prisma = createPrisma();
      prisma.tutorProfile.findUnique.mockResolvedValue({ verificationStatus: 'VERIFIED' });
      prisma.teachingListing.update.mockRejectedValue(recordNotFoundError());
      const service = new TutorsService(prisma as unknown as PrismaService);

      await expect(service.postPublishListing(USER_ID, LISTING_ID)).rejects.toThrow(
        new NotFoundException('Listing not found'),
      );
    });
  });
});
