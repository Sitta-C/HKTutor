import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { BookingsService } from '@/bookings/bookings.service';
import { PrismaService } from '@/database/prisma.service';
import { Prisma } from '@/generated/prisma/client';
import {
  AccountStatus,
  BookingStatus,
  ListingPublicationStatus,
  Role,
  TutorVerificationStatus,
} from '@/generated/prisma/enums';

import type { BookingResponseDto } from '@/bookings/bookings.dto';
import type { CreateBookingInput } from '@/bookings/bookings.service';
import type { TestingModule } from '@nestjs/testing';

type DatabaseError = Error & { code: string };

type TransactionCallback = (
  tx: {
    $queryRaw?: jest.Mock;
    booking?: { create?: jest.Mock; findFirst?: jest.Mock };
    teachingListing?: { findUnique?: jest.Mock };
    tutorProfile?: { findUnique?: jest.Mock };
    user?: { findUnique?: jest.Mock };
  },
) => Promise<unknown>;

const createDatabaseError = (message: string, code: string): DatabaseError => {
  const error = new Error(message) as DatabaseError;
  error.code = code;
  return error;
};

describe('BookingsService', () => {
  let service: BookingsService;

  const mockPrismaService = {
    $transaction: jest.fn(),
    availabilitySlot: { findUnique: jest.fn() },
    booking: { count: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
    teachingListing: { findUnique: jest.fn() },
    tutorProfile: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
  };

  const createTestData = () => {
    const studentUserId = '6bb01222-1fce-4bc3-a69d-3d90db2fdf57';
    const tutorUserId = '1772b6be-ebb5-40b7-b5bd-1c1fcfe26857';
    const slotId = '7a0f9ab0-8f25-4d80-bb00-67b3a0c7d3d5';
    const listingId = 'a22c4b4d-4f8e-4de6-9b3d-faae7db5eb6d';
    const bookingId = '3c54a0d6-e3f3-4a38-bd55-3b4011ee31ae';

    return { bookingId, listingId, slotId, studentUserId, tutorUserId };
  };

  const futureSlot = (slotId: string, tutorUserId: string) => ({
    deletedAt: null,
    endAtUtc: new Date(Date.now() + 2 * 60 * 60 * 1000),
    id: slotId,
    startAtUtc: new Date(Date.now() + 60 * 60 * 1000),
    tutorProfileId: tutorUserId,
  });

  const verifiedTutorProfile = {
    verificationStatus: TutorVerificationStatus.VERIFIED,
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingsService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<BookingsService>(BookingsService);
  });

  describe('create', () => {
    it('should create a booking successfully when student is active and slot is available', async () => {
      const { bookingId, listingId, slotId, studentUserId, tutorUserId } =
        createTestData();
      const pricePerHour = 500;
      const createdAt = new Date('2026-09-10T09:04:31.001Z');

      const mockSlot = futureSlot(slotId, tutorUserId);

      const mockStudent = {
        accountStatus: AccountStatus.ACTIVE,
        deletedAt: null,
        id: studentUserId,
        role: Role.STUDENT,
      };

      const mockListing = {
        deletedAt: null,
        id: listingId,
        pricePerHour: pricePerHour,
        publicationStatus: ListingPublicationStatus.PUBLISHED,
        tutorProfileId: tutorUserId,
      };

      const mockBooking = {
        createdAt,
        currency: 'THB',
        discountAmount: new Prisma.Decimal(0),
        id: bookingId,
        listingId,
        netAmount: new Prisma.Decimal(pricePerHour),
        slotId,
        status: BookingStatus.PENDING,
        studentUserId,
        subtotalAmount: new Prisma.Decimal(pricePerHour),
        tutorProfileId: tutorUserId,
      };

      mockPrismaService.$transaction.mockImplementation(async (callback: TransactionCallback) => {
        const tx = {
          $queryRaw: jest.fn().mockResolvedValue([mockSlot]),
          booking: {
            create: jest.fn().mockResolvedValue(mockBooking),
            findFirst: jest.fn().mockResolvedValue(null),
          },
          teachingListing: {
            findUnique: jest.fn().mockResolvedValue(mockListing),
          },
          tutorProfile: {
            findUnique: jest.fn().mockResolvedValue(verifiedTutorProfile),
          },
          user: {
            findUnique: jest.fn().mockResolvedValue(mockStudent),
          },
        };
        return await callback(tx);
      });

      const input: CreateBookingInput = {
        listingId,
        slotId,
        studentUserId,
      };

      const result = await service.create(input);

      expect(result).toEqual<BookingResponseDto>({
        createdAt: createdAt.toISOString(),
        currency: 'THB',
        discountAmount: '0.00',
        id: bookingId,
        listingId,
        netAmount: '500.00',
        slotId,
        status: BookingStatus.PENDING,
        subtotalAmount: '500.00',
      });

      expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);
    });

    it('should throw BadRequestException when studentUserId is missing', async () => {
      const { listingId, slotId } = createTestData();

      const input: CreateBookingInput = {
        listingId,
        slotId,
        studentUserId: '',
      };

      await expect(service.create(input)).rejects.toThrow(
        new BadRequestException('studentUserId is required to create a booking'),
      );
    });

    it('should throw ForbiddenException when student does not exist', async () => {
      const { listingId, slotId, studentUserId, tutorUserId } = createTestData();

      const mockSlot = futureSlot(slotId, tutorUserId);

      mockPrismaService.$transaction.mockImplementation(async (callback: TransactionCallback) => {
        const tx = {
          $queryRaw: jest.fn().mockResolvedValue([mockSlot]),
          booking: {
            findFirst: jest.fn().mockResolvedValue(null),
          },
          user: {
            findUnique: jest.fn().mockResolvedValue(null),
          },
        };
        return await callback(tx);
      });

      const input: CreateBookingInput = {
        listingId,
        slotId,
        studentUserId,
      };

      await expect(service.create(input)).rejects.toThrow(
        new ForbiddenException('Only active students can create bookings.'),
      );
    });

    it('should throw ForbiddenException when student role is not STUDENT', async () => {
      const { listingId, slotId, studentUserId, tutorUserId } = createTestData();

      const mockSlot = futureSlot(slotId, tutorUserId);

      const mockStudent = {
        accountStatus: AccountStatus.ACTIVE,
        deletedAt: null,
        id: studentUserId,
        role: Role.TUTOR,
      };

      mockPrismaService.$transaction.mockImplementation(async (callback: TransactionCallback) => {
        const tx = {
          $queryRaw: jest.fn().mockResolvedValue([mockSlot]),
          booking: {
            findFirst: jest.fn().mockResolvedValue(null),
          },
          user: {
            findUnique: jest.fn().mockResolvedValue(mockStudent),
          },
        };
        return await callback(tx);
      });

      const input: CreateBookingInput = {
        listingId,
        slotId,
        studentUserId,
      };

      await expect(service.create(input)).rejects.toThrow(
        new ForbiddenException('Only active students can create bookings.'),
      );
    });

    it('should throw ForbiddenException when student accountStatus is not ACTIVE', async () => {
      const { listingId, slotId, studentUserId, tutorUserId } = createTestData();

      const mockSlot = futureSlot(slotId, tutorUserId);

      const mockStudent = {
        accountStatus: AccountStatus.SUSPENDED,
        deletedAt: null,
        id: studentUserId,
        role: Role.STUDENT,
      };

      mockPrismaService.$transaction.mockImplementation(async (callback: TransactionCallback) => {
        const tx = {
          $queryRaw: jest.fn().mockResolvedValue([mockSlot]),
          booking: {
            findFirst: jest.fn().mockResolvedValue(null),
          },
          user: {
            findUnique: jest.fn().mockResolvedValue(mockStudent),
          },
        };
        return await callback(tx);
      });

      const input: CreateBookingInput = {
        listingId,
        slotId,
        studentUserId,
      };

      await expect(service.create(input)).rejects.toThrow(
        new ForbiddenException('Only active students can create bookings.'),
      );
    });

    it('should throw ForbiddenException when student is soft deleted', async () => {
      const { listingId, slotId, studentUserId, tutorUserId } = createTestData();

      const mockSlot = futureSlot(slotId, tutorUserId);

      const mockStudent = {
        accountStatus: AccountStatus.ACTIVE,
        deletedAt: new Date('2026-09-01T00:00:00Z'),
        id: studentUserId,
        role: Role.STUDENT,
      };

      mockPrismaService.$transaction.mockImplementation(async (callback: TransactionCallback) => {
        const tx = {
          $queryRaw: jest.fn().mockResolvedValue([mockSlot]),
          booking: {
            findFirst: jest.fn().mockResolvedValue(null),
          },
          user: {
            findUnique: jest.fn().mockResolvedValue(mockStudent),
          },
        };
        return await callback(tx);
      });

      const input: CreateBookingInput = {
        listingId,
        slotId,
        studentUserId,
      };

      await expect(service.create(input)).rejects.toThrow(
        new ForbiddenException('Only active students can create bookings.'),
      );
    });

    it('should throw BadRequestException when the slot has already started', async () => {
      const { listingId, slotId, studentUserId, tutorUserId } = createTestData();

      const mockSlot = {
        deletedAt: null,
        endAtUtc: new Date(Date.now() - 30 * 60 * 1000),
        id: slotId,
        startAtUtc: new Date(Date.now() - 60 * 60 * 1000),
        tutorProfileId: tutorUserId,
      };

      mockPrismaService.$transaction.mockImplementation(async (callback: TransactionCallback) => {
        const tx = {
          $queryRaw: jest.fn().mockResolvedValue([mockSlot]),
        };
        return await callback(tx);
      });

      const input: CreateBookingInput = {
        listingId,
        slotId,
        studentUserId,
      };

      await expect(service.create(input)).rejects.toThrow(
        new BadRequestException('The selected slot has already started or is in the past.'),
      );
    });

    it('should throw BadRequestException when a tutor tries to book their own slot', async () => {
      const { listingId, slotId, tutorUserId } = createTestData();
      const pricePerHour = 500;

      const mockSlot = futureSlot(slotId, tutorUserId);

      const mockStudent = {
        accountStatus: AccountStatus.ACTIVE,
        deletedAt: null,
        id: tutorUserId,
        role: Role.STUDENT,
      };

      const mockListing = {
        deletedAt: null,
        id: listingId,
        pricePerHour: pricePerHour,
        publicationStatus: ListingPublicationStatus.PUBLISHED,
        tutorProfileId: tutorUserId,
      };

      mockPrismaService.$transaction.mockImplementation(async (callback: TransactionCallback) => {
        const tx = {
          $queryRaw: jest.fn().mockResolvedValue([mockSlot]),
          booking: {
            findFirst: jest.fn().mockResolvedValue(null),
          },
          teachingListing: {
            findUnique: jest.fn().mockResolvedValue(mockListing),
          },
          tutorProfile: {
            findUnique: jest.fn().mockResolvedValue(verifiedTutorProfile),
          },
          user: {
            findUnique: jest.fn().mockResolvedValue(mockStudent),
          },
        };
        return await callback(tx);
      });

      const input: CreateBookingInput = {
        listingId,
        slotId,
        studentUserId: tutorUserId,
      };

      await expect(service.create(input)).rejects.toThrow(
        new BadRequestException('Tutors cannot book their own slots.'),
      );
    });

    it('should throw NotFoundException when slot does not exist', async () => {
      const { listingId, slotId, studentUserId } = createTestData();

      mockPrismaService.$transaction.mockImplementation(async (callback: TransactionCallback) => {
        const tx = {
          $queryRaw: jest.fn().mockResolvedValue([]),
        };
        return await callback(tx);
      });

      const input: CreateBookingInput = {
        listingId,
        slotId,
        studentUserId,
      };

      await expect(service.create(input)).rejects.toThrow(
        new NotFoundException('The selected slot does not exist.'),
      );
    });

    it('should throw ConflictException when slot is unavailable or already booked', async () => {
      const { listingId, slotId, studentUserId, tutorUserId } = createTestData();

      const mockSlot = futureSlot(slotId, tutorUserId);

      const mockExistingBooking = {
        id: 'existing-booking-id',
      };

      mockPrismaService.$transaction.mockImplementation(async (callback: TransactionCallback) => {
        const tx = {
          $queryRaw: jest.fn().mockResolvedValue([mockSlot]),
          booking: {
            findFirst: jest.fn().mockResolvedValue(mockExistingBooking),
          },
        };
        return await callback(tx);
      });

      const input: CreateBookingInput = {
        listingId,
        slotId,
        studentUserId,
      };

      await expect(service.create(input)).rejects.toThrow(
        new ConflictException('The selected slot is already booked.'),
      );
    });

    it('should throw ConflictException when slot is deleted', async () => {
      const { listingId, slotId, studentUserId, tutorUserId } = createTestData();

      const mockSlot = {
        deletedAt: new Date('2026-09-01T00:00:00Z'),
        endAtUtc: new Date(Date.now() + 2 * 60 * 60 * 1000),
        id: slotId,
        startAtUtc: new Date(Date.now() + 60 * 60 * 1000),
        tutorProfileId: tutorUserId,
      };

      mockPrismaService.$transaction.mockImplementation(async (callback: TransactionCallback) => {
        const tx = {
          $queryRaw: jest.fn().mockResolvedValue([mockSlot]),
        };
        return await callback(tx);
      });

      const input: CreateBookingInput = {
        listingId,
        slotId,
        studentUserId,
      };

      await expect(service.create(input)).rejects.toThrow(
        new ConflictException('The selected slot is no longer available.'),
      );
    });

    it('should throw NotFoundException when listing does not exist', async () => {
      const { listingId, slotId, studentUserId, tutorUserId } = createTestData();

      const mockSlot = futureSlot(slotId, tutorUserId);

      const mockStudent = {
        accountStatus: AccountStatus.ACTIVE,
        deletedAt: null,
        id: studentUserId,
        role: Role.STUDENT,
      };

      mockPrismaService.$transaction.mockImplementation(async (callback: TransactionCallback) => {
        const tx = {
          $queryRaw: jest.fn().mockResolvedValue([mockSlot]),
          booking: {
            findFirst: jest.fn().mockResolvedValue(null),
          },
          teachingListing: {
            findUnique: jest.fn().mockResolvedValue(null),
          },
          user: {
            findUnique: jest.fn().mockResolvedValue(mockStudent),
          },
        };
        return await callback(tx);
      });

      const input: CreateBookingInput = {
        listingId,
        slotId,
        studentUserId,
      };

      await expect(service.create(input)).rejects.toThrow(
        new NotFoundException('The selected listing does not exist.'),
      );
    });

    it('should throw ConflictException when listing is not available or not published', async () => {
      const { listingId, slotId, studentUserId, tutorUserId } = createTestData();

      const mockSlot = futureSlot(slotId, tutorUserId);

      const mockStudent = {
        accountStatus: AccountStatus.ACTIVE,
        deletedAt: null,
        id: studentUserId,
        role: Role.STUDENT,
      };

      const mockListing = {
        deletedAt: new Date('2026-09-01T00:00:00Z'),
        id: listingId,
        pricePerHour: 500,
        publicationStatus: ListingPublicationStatus.PUBLISHED,
        tutorProfileId: tutorUserId,
      };

      mockPrismaService.$transaction.mockImplementation(async (callback: TransactionCallback) => {
        const tx = {
          $queryRaw: jest.fn().mockResolvedValue([mockSlot]),
          booking: {
            findFirst: jest.fn().mockResolvedValue(null),
          },
          teachingListing: {
            findUnique: jest.fn().mockResolvedValue(mockListing),
          },
          user: {
            findUnique: jest.fn().mockResolvedValue(mockStudent),
          },
        };
        return await callback(tx);
      });

      const input: CreateBookingInput = {
        listingId,
        slotId,
        studentUserId,
      };

      await expect(service.create(input)).rejects.toThrow(
        new ConflictException('The selected listing is no longer available.'),
      );
    });

    it('should throw ConflictException when slot does not belong to listing tutor', async () => {
      const { listingId, slotId, studentUserId, tutorUserId } = createTestData();
      const differentTutorId = '0000b6be-ebb5-40b7-b5bd-1c1fcfe26857';

      const mockSlot = futureSlot(slotId, tutorUserId);

      const mockStudent = {
        accountStatus: AccountStatus.ACTIVE,
        deletedAt: null,
        id: studentUserId,
        role: Role.STUDENT,
      };

      const mockListing = {
        deletedAt: null,
        id: listingId,
        pricePerHour: 500,
        publicationStatus: ListingPublicationStatus.PUBLISHED,
        tutorProfileId: differentTutorId,
      };

      mockPrismaService.$transaction.mockImplementation(async (callback: TransactionCallback) => {
        const tx = {
          $queryRaw: jest.fn().mockResolvedValue([mockSlot]),
          booking: {
            findFirst: jest.fn().mockResolvedValue(null),
          },
          teachingListing: {
            findUnique: jest.fn().mockResolvedValue(mockListing),
          },
          user: {
            findUnique: jest.fn().mockResolvedValue(mockStudent),
          },
        };
        return await callback(tx);
      });

      const input: CreateBookingInput = {
        listingId,
        slotId,
        studentUserId,
      };

      await expect(service.create(input)).rejects.toThrow(
        new ConflictException('The selected slot does not belong to the selected listing.'),
      );
    });

    it('should throw ConflictException when the tutor is not verified', async () => {
      const { listingId, slotId, studentUserId, tutorUserId } = createTestData();

      const mockSlot = futureSlot(slotId, tutorUserId);

      const mockStudent = {
        accountStatus: AccountStatus.ACTIVE,
        deletedAt: null,
        id: studentUserId,
        role: Role.STUDENT,
      };

      const mockListing = {
        deletedAt: null,
        id: listingId,
        pricePerHour: 500,
        publicationStatus: ListingPublicationStatus.PUBLISHED,
        tutorProfileId: tutorUserId,
      };

      mockPrismaService.$transaction.mockImplementation(async (callback: TransactionCallback) => {
        const tx = {
          $queryRaw: jest.fn().mockResolvedValue([mockSlot]),
          booking: {
            findFirst: jest.fn().mockResolvedValue(null),
          },
          teachingListing: {
            findUnique: jest.fn().mockResolvedValue(mockListing),
          },
          tutorProfile: {
            findUnique: jest.fn().mockResolvedValue({
              verificationStatus: TutorVerificationStatus.PENDING,
            }),
          },
          user: {
            findUnique: jest.fn().mockResolvedValue(mockStudent),
          },
        };
        return await callback(tx);
      });

      const input: CreateBookingInput = {
        listingId,
        slotId,
        studentUserId,
      };

      await expect(service.create(input)).rejects.toThrow(
        new ConflictException('The selected listing is not currently available for booking.'),
      );
    });

    it('should throw ConflictException on unique constraint violation (P2002)', async () => {
      const { listingId, slotId, studentUserId } = createTestData();

      const databaseError = createDatabaseError(
        'Unique constraint failed on the fields: (`studentUserId`,`slotId`)',
        '23505',
      );

      mockPrismaService.$transaction.mockRejectedValue(databaseError);

      const input: CreateBookingInput = {
        listingId,
        slotId,
        studentUserId,
      };

      await expect(service.create(input)).rejects.toThrow(ConflictException);
      await expect(service.create(input)).rejects.toThrow(
        'Unique constraint failed on the fields: (`studentUserId`,`slotId`)',
      );
    });

    it('should throw error and rollback transaction on unexpected database error', async () => {
      const { listingId, slotId, studentUserId } = createTestData();

      const unexpectedError = new Error('Unexpected database error');

      mockPrismaService.$transaction.mockRejectedValue(unexpectedError);

      const input: CreateBookingInput = {
        listingId,
        slotId,
        studentUserId,
      };

      await expect(service.create(input)).rejects.toThrow('Unexpected database error');
    });

    it('should format Decimal amounts as fixed-2 decimal strings in the response', async () => {
      const { bookingId, listingId, slotId, studentUserId, tutorUserId } =
        createTestData();
      const pricePerHour = 1250.75;
      const createdAt = new Date('2026-09-10T09:04:31.001Z');

      const mockSlot = futureSlot(slotId, tutorUserId);

      const mockStudent = {
        accountStatus: AccountStatus.ACTIVE,
        deletedAt: null,
        id: studentUserId,
        role: Role.STUDENT,
      };

      const mockListing = {
        deletedAt: null,
        id: listingId,
        pricePerHour: pricePerHour,
        publicationStatus: ListingPublicationStatus.PUBLISHED,
        tutorProfileId: tutorUserId,
      };

      const mockBooking = {
        createdAt,
        currency: 'THB',
        discountAmount: new Prisma.Decimal(0),
        id: bookingId,
        listingId,
        netAmount: new Prisma.Decimal(pricePerHour),
        slotId,
        status: BookingStatus.PENDING,
        studentUserId,
        subtotalAmount: new Prisma.Decimal(pricePerHour),
        tutorProfileId: tutorUserId,
      };

      mockPrismaService.$transaction.mockImplementation(async (callback: TransactionCallback) => {
        const tx = {
          $queryRaw: jest.fn().mockResolvedValue([mockSlot]),
          booking: {
            create: jest.fn().mockResolvedValue(mockBooking),
            findFirst: jest.fn().mockResolvedValue(null),
          },
          teachingListing: {
            findUnique: jest.fn().mockResolvedValue(mockListing),
          },
          tutorProfile: {
            findUnique: jest.fn().mockResolvedValue(verifiedTutorProfile),
          },
          user: {
            findUnique: jest.fn().mockResolvedValue(mockStudent),
          },
        };
        return await callback(tx);
      });

      const input: CreateBookingInput = {
        listingId,
        slotId,
        studentUserId,
      };

      const result = await service.create(input);

      expect(typeof result.subtotalAmount).toBe('string');
      expect(typeof result.discountAmount).toBe('string');
      expect(typeof result.netAmount).toBe('string');
      expect(result.subtotalAmount).toBe('1250.75');
      expect(result.netAmount).toBe('1250.75');
      expect(result.discountAmount).toBe('0.00');
      expect(result.createdAt).toBe(createdAt.toISOString());
    });
  });

  describe('getQuote', () => {
    const mockSlotResult = (slotId: string, tutorUserId: string) => ({
      deletedAt: null,
      endAtUtc: new Date(Date.now() + 2 * 60 * 60 * 1000),
      id: slotId,
      startAtUtc: new Date(Date.now() + 60 * 60 * 1000),
      tutorProfileId: tutorUserId,
    });

    const mockStudentResult = (studentUserId: string) => ({
      accountStatus: AccountStatus.ACTIVE,
      deletedAt: null,
      id: studentUserId,
      role: Role.STUDENT,
    });

    const mockListingResult = (listingId: string, tutorUserId: string, pricePerHour: number) => ({
      deletedAt: null,
      description: 'One-on-one algebra and calculus tutoring.',
      gradeLevel: { id: 'grade-id', name: 'Grade 10' },
      id: listingId,
      pricePerHour: new Prisma.Decimal(pricePerHour),
      publicationStatus: ListingPublicationStatus.PUBLISHED,
      subject: { id: 'subject-id', name: 'Mathematics' },
      tutorProfileId: tutorUserId,
    });

    it('returns the authoritative quote for a valid listing and a free slot', async () => {
      const { listingId, slotId, studentUserId, tutorUserId } = createTestData();
      const pricePerHour = 450;

      mockPrismaService.availabilitySlot.findUnique.mockResolvedValue(
        mockSlotResult(slotId, tutorUserId),
      );
      mockPrismaService.booking.findFirst.mockResolvedValue(null);
      mockPrismaService.user.findUnique.mockResolvedValue(mockStudentResult(studentUserId));
      mockPrismaService.teachingListing.findUnique.mockResolvedValue(
        mockListingResult(listingId, tutorUserId, pricePerHour),
      );
      mockPrismaService.tutorProfile.findUnique.mockResolvedValue({
        displayName: 'Anan Suksawat',
        verificationStatus: TutorVerificationStatus.VERIFIED,
      });

      const result = await service.getQuote({ listingId, slotId, studentUserId });

      expect(result.tutor).toEqual({ displayName: 'Anan Suksawat', tutorId: tutorUserId });
      expect(result.listing).toEqual({
        description: 'One-on-one algebra and calculus tutoring.',
        gradeLevelId: 'grade-id',
        gradeLevelName: 'Grade 10',
        id: listingId,
        pricePerHour: '450.00',
        subjectId: 'subject-id',
        subjectName: 'Mathematics',
      });
      expect(result.slot.id).toBe(slotId);
      expect(result.subtotalAmount).toBe('450.00');
      expect(result.discountAmount).toBe('0.00');
      expect(result.netAmount).toBe('450.00');
      expect(result.currency).toBe('THB');
    });

    it('creates no Booking row', async () => {
      const { listingId, slotId, studentUserId, tutorUserId } = createTestData();

      mockPrismaService.availabilitySlot.findUnique.mockResolvedValue(
        mockSlotResult(slotId, tutorUserId),
      );
      mockPrismaService.booking.findFirst.mockResolvedValue(null);
      mockPrismaService.user.findUnique.mockResolvedValue(mockStudentResult(studentUserId));
      mockPrismaService.teachingListing.findUnique.mockResolvedValue(
        mockListingResult(listingId, tutorUserId, 450),
      );
      mockPrismaService.tutorProfile.findUnique.mockResolvedValue({
        displayName: 'Anan Suksawat',
        verificationStatus: TutorVerificationStatus.VERIFIED,
      });

      await service.getQuote({ listingId, slotId, studentUserId });

      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
      expect(mockPrismaService.booking.findFirst).toHaveBeenCalledTimes(1);
      // getQuote never calls booking.create — asserting the mock has no such call proves
      // this path performs no write.
      expect((mockPrismaService.booking as { create?: jest.Mock }).create).toBeUndefined();
    });

    it('throws NotFoundException when the slot does not exist', async () => {
      const { listingId, slotId, studentUserId } = createTestData();

      mockPrismaService.availabilitySlot.findUnique.mockResolvedValue(null);

      await expect(service.getQuote({ listingId, slotId, studentUserId })).rejects.toThrow(
        new NotFoundException('The selected slot does not exist.'),
      );
    });

    it('throws ConflictException when the slot is already booked (unavailable)', async () => {
      const { listingId, slotId, studentUserId, tutorUserId } = createTestData();

      mockPrismaService.availabilitySlot.findUnique.mockResolvedValue(
        mockSlotResult(slotId, tutorUserId),
      );
      mockPrismaService.booking.findFirst.mockResolvedValue({ id: 'existing-booking-id' });

      await expect(service.getQuote({ listingId, slotId, studentUserId })).rejects.toThrow(
        new ConflictException('The selected slot is already booked.'),
      );
    });

    it('throws NotFoundException when the listing does not exist', async () => {
      const { listingId, slotId, studentUserId, tutorUserId } = createTestData();

      mockPrismaService.availabilitySlot.findUnique.mockResolvedValue(
        mockSlotResult(slotId, tutorUserId),
      );
      mockPrismaService.booking.findFirst.mockResolvedValue(null);
      mockPrismaService.user.findUnique.mockResolvedValue(mockStudentResult(studentUserId));
      mockPrismaService.teachingListing.findUnique.mockResolvedValue(null);

      await expect(service.getQuote({ listingId, slotId, studentUserId })).rejects.toThrow(
        new NotFoundException('The selected listing does not exist.'),
      );
    });

    it('throws ConflictException when listing and slot belong to different tutors', async () => {
      const { listingId, slotId, studentUserId, tutorUserId } = createTestData();
      const differentTutorId = '0000b6be-ebb5-40b7-b5bd-1c1fcfe26857';

      mockPrismaService.availabilitySlot.findUnique.mockResolvedValue(
        mockSlotResult(slotId, tutorUserId),
      );
      mockPrismaService.booking.findFirst.mockResolvedValue(null);
      mockPrismaService.user.findUnique.mockResolvedValue(mockStudentResult(studentUserId));
      mockPrismaService.teachingListing.findUnique.mockResolvedValue(
        mockListingResult(listingId, differentTutorId, 450),
      );

      await expect(service.getQuote({ listingId, slotId, studentUserId })).rejects.toThrow(
        new ConflictException('The selected slot does not belong to the selected listing.'),
      );
    });

    it('throws ConflictException when the tutor is not verified', async () => {
      const { listingId, slotId, studentUserId, tutorUserId } = createTestData();

      mockPrismaService.availabilitySlot.findUnique.mockResolvedValue(
        mockSlotResult(slotId, tutorUserId),
      );
      mockPrismaService.booking.findFirst.mockResolvedValue(null);
      mockPrismaService.user.findUnique.mockResolvedValue(mockStudentResult(studentUserId));
      mockPrismaService.teachingListing.findUnique.mockResolvedValue(
        mockListingResult(listingId, tutorUserId, 450),
      );
      mockPrismaService.tutorProfile.findUnique.mockResolvedValue({
        displayName: 'Anan Suksawat',
        verificationStatus: TutorVerificationStatus.PENDING,
      });

      await expect(service.getQuote({ listingId, slotId, studentUserId })).rejects.toThrow(
        new ConflictException('The selected listing is not currently available for booking.'),
      );
    });

    it('throws ForbiddenException when the requester is not an active student', async () => {
      const { listingId, slotId, studentUserId, tutorUserId } = createTestData();

      mockPrismaService.availabilitySlot.findUnique.mockResolvedValue(
        mockSlotResult(slotId, tutorUserId),
      );
      mockPrismaService.booking.findFirst.mockResolvedValue(null);
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.getQuote({ listingId, slotId, studentUserId })).rejects.toThrow(
        new ForbiddenException('Only active students can request a quote.'),
      );
    });
  });

  describe('getMyBookings', () => {
    const mockBookingRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
      createdAt: new Date('2026-09-10T09:04:31.001Z'),
      currency: 'THB',
      discountAmount: new Prisma.Decimal(0),
      id: '3c54a0d6-e3f3-4a38-bd55-3b4011ee31ae',
      listing: {
        description: 'One-on-one algebra and calculus tutoring.',
        gradeLevel: { id: 'grade-id', name: 'Grade 10' },
        id: 'a22c4b4d-4f8e-4de6-9b3d-faae7db5eb6d',
        pricePerHour: new Prisma.Decimal(450),
        subject: { id: 'subject-id', name: 'Mathematics' },
      },
      netAmount: new Prisma.Decimal(450),
      slot: {
        endAtUtc: new Date('2026-09-15T11:04:06.784Z'),
        id: '7a0f9ab0-8f25-4d80-bb00-67b3a0c7d3d5',
        startAtUtc: new Date('2026-09-15T10:04:06.784Z'),
      },
      status: BookingStatus.PENDING,
      subtotalAmount: new Prisma.Decimal(450),
      tutorProfile: { displayName: 'Anan Suksawat', userId: '1772b6be-ebb5-40b7-b5bd-1c1fcfe26857' },
      ...overrides,
    });

    it('throws BadRequestException when studentUserId is missing', async () => {
      await expect(service.getMyBookings({ studentUserId: '' })).rejects.toThrow(
        new BadRequestException('studentUserId is required to list bookings'),
      );
    });

    it('throws BadRequestException when from is later than to', async () => {
      const { studentUserId } = createTestData();

      await expect(
        service.getMyBookings({
          from: '2026-09-30T00:00:00.000Z',
          studentUserId,
          to: '2026-09-01T00:00:00.000Z',
        }),
      ).rejects.toThrow(new BadRequestException('from must not be later than to'));
    });

    it('scopes the query to the authenticated student and returns items and total', async () => {
      const { studentUserId } = createTestData();
      const row = mockBookingRow();

      mockPrismaService.booking.findMany.mockResolvedValue([row]);
      mockPrismaService.booking.count.mockResolvedValue(1);

      const result = await service.getMyBookings({ studentUserId });

      expect(mockPrismaService.booking.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { studentUserId } }),
      );
      expect(mockPrismaService.booking.count).toHaveBeenCalledWith({ where: { studentUserId } });
      expect(result.total).toBe(1);
      expect(result.items).toEqual([
        {
          createdAt: row.createdAt.toISOString(),
          currency: 'THB',
          discountAmount: '0.00',
          id: row.id,
          listing: {
            description: 'One-on-one algebra and calculus tutoring.',
            gradeLevelId: 'grade-id',
            gradeLevelName: 'Grade 10',
            id: row.listing.id,
            pricePerHour: '450.00',
            subjectId: 'subject-id',
            subjectName: 'Mathematics',
          },
          netAmount: '450.00',
          slot: {
            endAtUtc: row.slot.endAtUtc.toISOString(),
            id: row.slot.id,
            startAtUtc: row.slot.startAtUtc.toISOString(),
          },
          status: BookingStatus.PENDING,
          subtotalAmount: '450.00',
          tutor: { displayName: 'Anan Suksawat', tutorId: row.tutorProfile.userId },
        },
      ]);
    });

    it('combines the status filter with the where clause', async () => {
      const { studentUserId } = createTestData();

      mockPrismaService.booking.findMany.mockResolvedValue([]);
      mockPrismaService.booking.count.mockResolvedValue(0);

      await service.getMyBookings({ status: BookingStatus.CONFIRMED, studentUserId });

      expect(mockPrismaService.booking.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: BookingStatus.CONFIRMED, studentUserId },
        }),
      );
    });

    it('combines the from/to date range filter with the where clause', async () => {
      const { studentUserId } = createTestData();

      mockPrismaService.booking.findMany.mockResolvedValue([]);
      mockPrismaService.booking.count.mockResolvedValue(0);

      await service.getMyBookings({
        from: '2026-09-01T00:00:00.000Z',
        studentUserId,
        to: '2026-09-30T23:59:59.999Z',
      });

      expect(mockPrismaService.booking.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            slot: {
              startAtUtc: {
                gte: new Date('2026-09-01T00:00:00.000Z'),
                lte: new Date('2026-09-30T23:59:59.999Z'),
              },
            },
            studentUserId,
          },
        }),
      );
    });

    it('returns an empty result when the student has no bookings', async () => {
      const { studentUserId } = createTestData();

      mockPrismaService.booking.findMany.mockResolvedValue([]);
      mockPrismaService.booking.count.mockResolvedValue(0);

      const result = await service.getMyBookings({ studentUserId });

      expect(result).toEqual({ items: [], total: 0 });
    });
  });
});
