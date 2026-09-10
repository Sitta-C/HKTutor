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
});
