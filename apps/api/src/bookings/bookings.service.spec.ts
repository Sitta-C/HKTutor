import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
} from '@/generated/prisma/enums';

import type { BookingResponseDto } from '@/bookings/bookings.dto';
import type { CreateBookingInput } from '@/bookings/bookings.service';
import type { TestingModule } from '@nestjs/testing';

type DatabaseError = Error & { code: string };

type TransactionCallback = (
  tx: {
    $queryRaw?: jest.Mock;
    booking?: { create: jest.Mock; findFirst: jest.Mock };
    teachingListing?: { findFirst: jest.Mock; findUnique: jest.Mock };
    user?: { findUnique: jest.Mock };
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

      const mockSlot = {
        deletedAt: null,
        endAtUtc: new Date('2026-09-10T10:00:00Z'),
        id: slotId,
        startAtUtc: new Date('2026-09-10T09:00:00Z'),
        tutorProfileId: tutorUserId,
      };

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
            findFirst: jest.fn().mockResolvedValue(mockListing),
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

      const result = await service.create(input);

      expect(result).toEqual<BookingResponseDto>({
        currency: 'THB',
        discountAmount: 0,
        id: bookingId,
        listingId,
        netAmount: pricePerHour,
        slotId,
        status: BookingStatus.PENDING,
        studentUserId,
        subtotalAmount: pricePerHour,
        tutorProfileId: tutorUserId,
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

      const mockSlot = {
        deletedAt: null,
        endAtUtc: new Date('2026-09-10T10:00:00Z'),
        id: slotId,
        startAtUtc: new Date('2026-09-10T09:00:00Z'),
        tutorProfileId: tutorUserId,
      };

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

      const mockSlot = {
        deletedAt: null,
        endAtUtc: new Date('2026-09-10T10:00:00Z'),
        id: slotId,
        startAtUtc: new Date('2026-09-10T09:00:00Z'),
        tutorProfileId: tutorUserId,
      };

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

      const mockSlot = {
        deletedAt: null,
        endAtUtc: new Date('2026-09-10T10:00:00Z'),
        id: slotId,
        startAtUtc: new Date('2026-09-10T09:00:00Z'),
        tutorProfileId: tutorUserId,
      };

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

      const mockSlot = {
        deletedAt: null,
        endAtUtc: new Date('2026-09-10T10:00:00Z'),
        id: slotId,
        startAtUtc: new Date('2026-09-10T09:00:00Z'),
        tutorProfileId: tutorUserId,
      };

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

    it('should throw ForbiddenException when tutor tries to book their own slot', async () => {
      const { listingId, slotId, tutorUserId } = createTestData();
      const pricePerHour = 500;

      const mockSlot = {
        deletedAt: null,
        endAtUtc: new Date('2026-09-10T10:00:00Z'),
        id: slotId,
        startAtUtc: new Date('2026-09-10T09:00:00Z'),
        tutorProfileId: tutorUserId,
      };

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
            findFirst: jest.fn().mockResolvedValue(mockListing),
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
        studentUserId: tutorUserId,
      };

      await expect(service.create(input)).rejects.toThrow(
        new ForbiddenException('Tutors cannot book their own slots.'),
      );
    });

    it('should throw ConflictException when slot does not exist', async () => {
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
        new ConflictException('The selected slot does not exist.'),
      );
    });

    it('should throw ConflictException when slot is unavailable or already booked', async () => {
      const { listingId, slotId, studentUserId, tutorUserId } = createTestData();

      const mockSlot = {
        deletedAt: null,
        endAtUtc: new Date('2026-09-10T10:00:00Z'),
        id: slotId,
        startAtUtc: new Date('2026-09-10T09:00:00Z'),
        tutorProfileId: tutorUserId,
      };

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
        endAtUtc: new Date('2026-09-10T10:00:00Z'),
        id: slotId,
        startAtUtc: new Date('2026-09-10T09:00:00Z'),
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

    it('should throw ConflictException when no published listing exists for tutor', async () => {
      const { slotId, studentUserId, tutorUserId } = createTestData();

      const mockSlot = {
        deletedAt: null,
        endAtUtc: new Date('2026-09-10T10:00:00Z'),
        id: slotId,
        startAtUtc: new Date('2026-09-10T09:00:00Z'),
        tutorProfileId: tutorUserId,
      };

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
            findFirst: jest.fn().mockResolvedValue(null),
          },
          user: {
            findUnique: jest.fn().mockResolvedValue(mockStudent),
          },
        };
        return await callback(tx);
      });

      const input: CreateBookingInput = {
        slotId,
        studentUserId,
      };

      await expect(service.create(input)).rejects.toThrow(
        new ConflictException('No published listing is available for this slot.'),
      );
    });

    it('should throw ConflictException when listing is not available or not published', async () => {
      const { listingId, slotId, studentUserId, tutorUserId } = createTestData();

      const mockSlot = {
        deletedAt: null,
        endAtUtc: new Date('2026-09-10T10:00:00Z'),
        id: slotId,
        startAtUtc: new Date('2026-09-10T09:00:00Z'),
        tutorProfileId: tutorUserId,
      };

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
            findFirst: jest.fn().mockResolvedValue(mockListing),
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

      const mockSlot = {
        deletedAt: null,
        endAtUtc: new Date('2026-09-10T10:00:00Z'),
        id: slotId,
        startAtUtc: new Date('2026-09-10T09:00:00Z'),
        tutorProfileId: tutorUserId,
      };

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
            findFirst: jest.fn().mockResolvedValue(null),
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

    it('should auto-fetch published listing when listingId is not provided', async () => {
      const { bookingId, slotId, studentUserId, tutorUserId } = createTestData();
      const autoFetchedListingId = 'auto-fetched-listing-id';
      const pricePerHour = 500;

      const mockSlot = {
        deletedAt: null,
        endAtUtc: new Date('2026-09-10T10:00:00Z'),
        id: slotId,
        startAtUtc: new Date('2026-09-10T09:00:00Z'),
        tutorProfileId: tutorUserId,
      };

      const mockStudent = {
        accountStatus: AccountStatus.ACTIVE,
        deletedAt: null,
        id: studentUserId,
        role: Role.STUDENT,
      };

      const mockAutoFetchedListing = {
        deletedAt: null,
        id: autoFetchedListingId,
        pricePerHour: pricePerHour,
        publicationStatus: ListingPublicationStatus.PUBLISHED,
        tutorProfileId: tutorUserId,
      };

      const mockBooking = {
        currency: 'THB',
        discountAmount: new Prisma.Decimal(0),
        id: bookingId,
        listingId: autoFetchedListingId,
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
            findFirst: jest.fn().mockResolvedValue(mockAutoFetchedListing),
            findUnique: jest.fn().mockResolvedValue(mockAutoFetchedListing),
          },
          user: {
            findUnique: jest.fn().mockResolvedValue(mockStudent),
          },
        };
        return await callback(tx);
      });

      const input: CreateBookingInput = {
        slotId,
        studentUserId,
      };

      const result = await service.create(input);

      expect(result.listingId).toBe(autoFetchedListingId);
      expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);
    });

    it('should convert Decimal amounts to numbers in response', async () => {
      const { bookingId, listingId, slotId, studentUserId, tutorUserId } =
        createTestData();
      const pricePerHour = 1250.75;

      const mockSlot = {
        deletedAt: null,
        endAtUtc: new Date('2026-09-10T10:00:00Z'),
        id: slotId,
        startAtUtc: new Date('2026-09-10T09:00:00Z'),
        tutorProfileId: tutorUserId,
      };

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
            findFirst: jest.fn().mockResolvedValue(mockListing),
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

      const result = await service.create(input);

      expect(typeof result.subtotalAmount).toBe('number');
      expect(typeof result.discountAmount).toBe('number');
      expect(typeof result.netAmount).toBe('number');
      expect(result.subtotalAmount).toBe(pricePerHour);
      expect(result.netAmount).toBe(pricePerHour);
    });
  });
});