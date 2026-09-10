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
  id: SUBJECT_ID,
  name: 'Mathematics',
};

const gradeLevel = {
  active: true,
  code: 'G10',
  id: GRADE_LEVEL_ID,
  name: 'Grade 10',
  sortOrder: 10,
};

function listing(overrides: Record<string, unknown> = {}) {
  return {
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
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
      findFirst: jest.fn(),
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
          select: expect.objectContaining({
            createdAt: true,
            gradeLevel: {
              select: expect.objectContaining({ sortOrder: true }) as object,
            },
          }) as object,
          where: {
            deletedAt: null,
            publicationStatus: 'PUBLISHED',
            tutorProfileId: USER_ID,
          },
        }),
      );
      expect(result).toEqual([
        {
          createdAt: new Date('2026-08-01T00:00:00.000Z'),
          description: 'Experienced mathematics tutor.',
          gradeLevel,
          id: LISTING_ID,
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

  describe('getListing', () => {
    it('loads one non-deleted listing scoped to the current tutor', async () => {
      const prisma = createPrisma();
      prisma.teachingListing.findFirst.mockResolvedValue(listing());
      const service = new TutorsService(prisma as unknown as PrismaService);

      await expect(service.getListing(USER_ID, LISTING_ID)).resolves.toMatchObject({
        id: LISTING_ID,
        gradeLevel,
        subject,
      });
      expect(prisma.teachingListing.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deletedAt: null, id: LISTING_ID, tutorProfileId: USER_ID },
        }),
      );
    });

    it('returns 404 when the owned listing does not exist', async () => {
      const prisma = createPrisma();
      prisma.teachingListing.findFirst.mockResolvedValue(null);
      const service = new TutorsService(prisma as unknown as PrismaService);

      await expect(service.getListing(USER_ID, LISTING_ID)).rejects.toThrow(
        new NotFoundException('Listing not found'),
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
        id: LISTING_ID,
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
        id: LISTING_ID,
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
        id: LISTING_ID,
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

  describe('updateListingStatus', () => {
    it('archives an owned listing while preserving its publish timestamp', async () => {
      const prisma = createPrisma();
      const publishedAt = new Date('2026-09-10T01:00:00.000Z');
      prisma.teachingListing.update.mockResolvedValue(
        listing({ publicationStatus: 'ARCHIVED', publishedAt }),
      );
      const service = new TutorsService(prisma as unknown as PrismaService);

      await expect(
        service.updateListingStatus(USER_ID, LISTING_ID, 'ARCHIVED'),
      ).resolves.toMatchObject({ id: LISTING_ID, publicationStatus: 'ARCHIVED', publishedAt });
      expect(prisma.teachingListing.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { publicationStatus: 'ARCHIVED' },
          where: { deletedAt: null, id: LISTING_ID, tutorProfileId: USER_ID },
        }),
      );
    });

    it('restores a listing to draft and clears its publish timestamp', async () => {
      const prisma = createPrisma();
      prisma.teachingListing.update.mockResolvedValue(listing());
      const service = new TutorsService(prisma as unknown as PrismaService);

      await service.updateListingStatus(USER_ID, LISTING_ID, 'DRAFT');

      expect(prisma.teachingListing.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { publicationStatus: 'DRAFT', publishedAt: null },
        }),
      );
    });

    it('uses the verified publish flow when the requested status is published', async () => {
      const prisma = createPrisma();
      prisma.tutorProfile.findUnique.mockResolvedValue({ verificationStatus: 'VERIFIED' });
      prisma.teachingListing.update.mockResolvedValue(
        listing({ publicationStatus: 'PUBLISHED', publishedAt: new Date() }),
      );
      const service = new TutorsService(prisma as unknown as PrismaService);

      await service.updateListingStatus(USER_ID, LISTING_ID, 'PUBLISHED');

      expect(prisma.tutorProfile.findUnique).toHaveBeenCalled();
      expect(prisma.teachingListing.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ publicationStatus: 'PUBLISHED' }) as object,
        }),
      );
    });

    it('maps a missing listing to a stable 404', async () => {
      const prisma = createPrisma();
      prisma.teachingListing.update.mockRejectedValue(recordNotFoundError());
      const service = new TutorsService(prisma as unknown as PrismaService);

      await expect(service.updateListingStatus(USER_ID, LISTING_ID, 'ARCHIVED')).rejects.toThrow(
        new NotFoundException('Listing not found'),
      );
    });
  });
});
