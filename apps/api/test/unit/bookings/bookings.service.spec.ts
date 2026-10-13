import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { Prisma } from '@generated/prisma/client';
import {
  AccountStatus,
  AttendanceStatus,
  BookingStatus,
  ListingPublicationStatus,
  PaymentStatus,
  Role,
  TutorVerificationStatus,
} from '@generated/prisma/enums';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { BookingSlotStatus } from '@modules/bookings/bookings.dto';
import { BookingsService } from '@modules/bookings/bookings.service';

import type { BookingResponseDto } from '@modules/bookings/bookings.dto';
import type { CreateBookingInput } from '@modules/bookings/bookings.service';
import type { TestingModule } from '@nestjs/testing';

type DatabaseError = Error & { code: string; meta?: { code?: string } };

type TransactionCallback = (tx: {
  $queryRaw?: jest.Mock;
  booking?: {
    count?: jest.Mock;
    create?: jest.Mock;
    findFirst?: jest.Mock;
    findUnique?: jest.Mock;
    findUniqueOrThrow?: jest.Mock;
    update?: jest.Mock;
    updateMany?: jest.Mock;
  };
  teachingListing?: { findUnique?: jest.Mock };
  tutorProfile?: { findFirst?: jest.Mock };
  user?: { findUnique?: jest.Mock };
}) => Promise<unknown>;

const createDatabaseError = (
  message: string,
  code: string,
  meta?: { code?: string },
): DatabaseError => {
  const error = new Error(message) as DatabaseError;
  error.code = code;
  if (meta) error.meta = meta;
  return error;
};

describe('BookingsService', () => {
  let service: BookingsService;

  const mockPrismaService = {
    $transaction: jest.fn(),
    availabilitySlot: { findUnique: jest.fn() },
    booking: {
      count: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    studentProfile: { findFirst: jest.fn() },
    teachingListing: { findUnique: jest.fn() },
    tutorProfile: { findFirst: jest.fn() },
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
    it('creates a booking for a verified tutor when the student is active and the slot is available', async () => {
      const verificationStatus = TutorVerificationStatus.VERIFIED;
      const { bookingId, listingId, slotId, studentUserId, tutorUserId } = createTestData();
      const pricePerHour = 500;
      const createdAt = new Date('2026-09-10T09:04:31.001Z');
      const startAtUtc = new Date(Date.now() + 60 * 60 * 1000);
      const expectedAmount = 750;
      const mockSlot = {
        ...futureSlot(slotId, tutorUserId),
        startAtUtc,
        endAtUtc: new Date(startAtUtc.getTime() + 90 * 60 * 1000),
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
        createdAt,
        currency: 'THB',
        discountAmount: new Prisma.Decimal(0),
        id: bookingId,
        listingId,
        netAmount: new Prisma.Decimal(expectedAmount),
        slotId,
        status: BookingStatus.PENDING,
        studentUserId,
        subtotalAmount: new Prisma.Decimal(expectedAmount),
        tutorProfileId: tutorUserId,
      };

      const bookingCreate = jest.fn().mockResolvedValue(mockBooking);
      const tutorFindFirst = jest.fn().mockResolvedValue({ verificationStatus });
      mockPrismaService.$transaction.mockImplementation(async (callback: TransactionCallback) => {
        const tx = {
          $queryRaw: jest.fn().mockResolvedValue([mockSlot]),
          booking: {
            create: bookingCreate,
            findFirst: jest.fn().mockResolvedValue(null),
          },
          teachingListing: {
            findUnique: jest.fn().mockResolvedValue(mockListing),
          },
          tutorProfile: {
            findFirst: tutorFindFirst,
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
        netAmount: '750.00',
        slotId,
        status: BookingStatus.PENDING,
        subtotalAmount: '750.00',
      });

      expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);
      expect(tutorFindFirst).toHaveBeenCalledWith({
        select: { displayName: true, verificationStatus: true },
        where: {
          user: { accountStatus: 'ACTIVE', deletedAt: null, role: 'TUTOR' },
          userId: tutorUserId,
          verificationStatus: 'VERIFIED',
        },
      });
      expect(bookingCreate).toHaveBeenCalledWith({
        data: {
          currency: 'THB',
          discountAmount: new Prisma.Decimal(0),
          listingId,
          netAmount: new Prisma.Decimal(expectedAmount),
          slotId,
          status: BookingStatus.PENDING,
          studentUserId,
          subtotalAmount: new Prisma.Decimal(expectedAmount),
          tutorProfileId: tutorUserId,
        },
      });
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

    it('rejects a tutor booking their own slot at the student role guard', async () => {
      const { listingId, slotId, tutorUserId } = createTestData();

      const mockSlot = futureSlot(slotId, tutorUserId);

      const mockStudent = {
        accountStatus: AccountStatus.ACTIVE,
        deletedAt: null,
        id: tutorUserId,
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
        studentUserId: tutorUserId,
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

    it('should require a completed student profile before creating a booking', async () => {
      const { listingId, slotId, studentUserId, tutorUserId } = createTestData();
      const mockSlot = futureSlot(slotId, tutorUserId);

      mockPrismaService.$transaction.mockImplementation(async (callback: TransactionCallback) => {
        const tx = {
          $queryRaw: jest.fn().mockResolvedValue([mockSlot]),
          booking: { findFirst: jest.fn().mockResolvedValue(null) },
          user: {
            findUnique: jest.fn().mockResolvedValue({
              accountStatus: AccountStatus.ACTIVE,
              deletedAt: null,
              id: studentUserId,
              role: Role.STUDENT,
              studentProfile: null,
            }),
          },
        };
        return await callback(tx);
      });

      await expect(service.create({ listingId, slotId, studentUserId })).rejects.toThrow(
        new ForbiddenException('Students must complete their profile before creating a booking.'),
      );
    });

    it('should throw ConflictException when the slot has already started', async () => {
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
        new ConflictException('The selected slot has already started or is in the past.'),
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

    it('should throw ConflictException when the tutor is pending or rejected', async () => {
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
        new ConflictException('The selected listing is not currently available for booking.'),
      );
    });

    it.each([
      // Prisma's own unique-violation code, as `create()` sees it when the active-slot index trips.
      ['P2002', undefined],
      // A raw query carries the SQLSTATE in meta.code; `code` itself stays a P-code.
      ['P2010', { code: '23505' }],
    ])(
      'maps database conflict %s to a stable 409 without exposing database details',
      async (code, meta) => {
        const { listingId, slotId, studentUserId } = createTestData();

        const databaseError = createDatabaseError(
          'Unique constraint failed on the fields: (`studentUserId`,`slotId`)',
          code,
          meta,
        );

        mockPrismaService.$transaction.mockRejectedValue(databaseError);

        const input: CreateBookingInput = {
          listingId,
          slotId,
          studentUserId,
        };

        await expect(service.create(input)).rejects.toThrow(
          new ConflictException(
            'The selected slot could not be booked because its availability changed.',
          ),
        );
      },
    );

    it.each([
      // A check-constraint violation means this service wrote an invalid row: a defect, not a race.
      ['a check-constraint violation', 'P2010', { code: '23514' }],
      // An unrecognised database fault arrives without any code at all.
      ['an unrecognised database fault', '', undefined],
    ])('rethrows %s instead of reporting a conflict', async (_description, code, meta) => {
      const { listingId, slotId, studentUserId } = createTestData();
      const databaseError = createDatabaseError('database failed', code, meta);

      mockPrismaService.$transaction.mockRejectedValue(databaseError);

      await expect(service.create({ listingId, slotId, studentUserId })).rejects.toThrow(
        databaseError,
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
      const { bookingId, listingId, slotId, studentUserId, tutorUserId } = createTestData();
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
            findFirst: jest.fn().mockResolvedValue(verifiedTutorProfile),
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
      studentProfile: { nickname: 'Nan' },
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

    it('returns the authoritative quote for a verified tutor with a valid listing and free slot', async () => {
      const verificationStatus = TutorVerificationStatus.VERIFIED;
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
      mockPrismaService.tutorProfile.findFirst.mockResolvedValue({
        displayName: 'Anan Suksawat',
        verificationStatus,
      });

      const result = await service.getQuote({ listingId, slotId, studentUserId });

      expect(result.tutor).toEqual({
        displayName: 'Anan Suksawat',
        tutorId: tutorUserId,
        verificationStatus,
      });
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
      expect(mockPrismaService.tutorProfile.findFirst).toHaveBeenCalledWith({
        select: { displayName: true, verificationStatus: true },
        where: {
          user: { accountStatus: 'ACTIVE', deletedAt: null, role: 'TUTOR' },
          userId: tutorUserId,
          verificationStatus: 'VERIFIED',
        },
      });
    });

    it('prorates the authoritative amount from the slot duration and rounds to satang', async () => {
      const { listingId, slotId, studentUserId, tutorUserId } = createTestData();
      const startAtUtc = new Date(Date.now() + 60 * 60 * 1000);

      mockPrismaService.availabilitySlot.findUnique.mockResolvedValue({
        ...mockSlotResult(slotId, tutorUserId),
        startAtUtc,
        endAtUtc: new Date(startAtUtc.getTime() + 20 * 60 * 1000),
      });
      mockPrismaService.booking.findFirst.mockResolvedValue(null);
      mockPrismaService.user.findUnique.mockResolvedValue(mockStudentResult(studentUserId));
      mockPrismaService.teachingListing.findUnique.mockResolvedValue(
        mockListingResult(listingId, tutorUserId, 100),
      );
      mockPrismaService.tutorProfile.findFirst.mockResolvedValue({
        displayName: 'Anan Suksawat',
        verificationStatus: TutorVerificationStatus.VERIFIED,
      });

      const result = await service.getQuote({ listingId, slotId, studentUserId });

      expect(result.subtotalAmount).toBe('33.33');
      expect(result.discountAmount).toBe('0.00');
      expect(result.netAmount).toBe('33.33');
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
      mockPrismaService.tutorProfile.findFirst.mockResolvedValue({
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

    it('throws ConflictException when the slot has already started', async () => {
      const { listingId, slotId, studentUserId, tutorUserId } = createTestData();

      mockPrismaService.availabilitySlot.findUnique.mockResolvedValue({
        deletedAt: null,
        endAtUtc: new Date(Date.now() - 30 * 60 * 1000),
        id: slotId,
        startAtUtc: new Date(Date.now() - 60 * 60 * 1000),
        tutorProfileId: tutorUserId,
      });

      await expect(service.getQuote({ listingId, slotId, studentUserId })).rejects.toThrow(
        new ConflictException('The selected slot has already started or is in the past.'),
      );
      expect(mockPrismaService.booking.findFirst).not.toHaveBeenCalled();
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

    it('throws ConflictException when the tutor is pending or rejected', async () => {
      const { listingId, slotId, studentUserId, tutorUserId } = createTestData();

      mockPrismaService.availabilitySlot.findUnique.mockResolvedValue(
        mockSlotResult(slotId, tutorUserId),
      );
      mockPrismaService.booking.findFirst.mockResolvedValue(null);
      mockPrismaService.user.findUnique.mockResolvedValue(mockStudentResult(studentUserId));
      mockPrismaService.teachingListing.findUnique.mockResolvedValue(
        mockListingResult(listingId, tutorUserId, 450),
      );
      mockPrismaService.tutorProfile.findFirst.mockResolvedValue(null);

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

    it('requires a completed student profile before returning a quote', async () => {
      const { listingId, slotId, studentUserId, tutorUserId } = createTestData();

      mockPrismaService.availabilitySlot.findUnique.mockResolvedValue(
        mockSlotResult(slotId, tutorUserId),
      );
      mockPrismaService.booking.findFirst.mockResolvedValue(null);
      mockPrismaService.user.findUnique.mockResolvedValue({
        ...mockStudentResult(studentUserId),
        studentProfile: null,
      });

      await expect(service.getQuote({ listingId, slotId, studentUserId })).rejects.toThrow(
        new ForbiddenException('Students must complete their profile before requesting a quote.'),
      );
      expect(mockPrismaService.teachingListing.findUnique).not.toHaveBeenCalled();
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
      tutorProfile: {
        displayName: 'Anan Suksawat',
        userId: '1772b6be-ebb5-40b7-b5bd-1c1fcfe26857',
      },
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
        expect.objectContaining({ skip: 0, take: 20, where: { studentUserId } }),
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

    it('applies validated page and pageSize values while keeping the filtered total', async () => {
      const { studentUserId } = createTestData();
      mockPrismaService.booking.findMany.mockResolvedValue([]);
      mockPrismaService.booking.count.mockResolvedValue(57);

      const result = await service.getMyBookings({ page: 3, pageSize: 25, studentUserId });

      expect(mockPrismaService.booking.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 50, take: 25, where: { studentUserId } }),
      );
      expect(result.total).toBe(57);
    });

    it('combines the status and date filters and counts the same filtered set', async () => {
      const { studentUserId } = createTestData();

      mockPrismaService.booking.findMany.mockResolvedValue([]);
      mockPrismaService.booking.count.mockResolvedValue(0);

      await service.getMyBookings({
        from: '2026-09-01T00:00:00.000Z',
        status: BookingStatus.CONFIRMED,
        studentUserId,
        to: '2026-09-30T23:59:59.999Z',
      });

      const expectedWhere = {
        slot: {
          startAtUtc: {
            gte: new Date('2026-09-01T00:00:00.000Z'),
            lte: new Date('2026-09-30T23:59:59.999Z'),
          },
        },
        status: BookingStatus.CONFIRMED,
        studentUserId,
      };
      expect(mockPrismaService.booking.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expectedWhere }),
      );
      expect(mockPrismaService.booking.count).toHaveBeenCalledWith({ where: expectedWhere });
    });

    it('returns an empty result when the student has no bookings', async () => {
      const { studentUserId } = createTestData();

      mockPrismaService.booking.findMany.mockResolvedValue([]);
      mockPrismaService.booking.count.mockResolvedValue(0);

      const result = await service.getMyBookings({ studentUserId });

      expect(result).toEqual({ items: [], total: 0 });
    });
  });

  describe('getMyBookingById', () => {
    const mockBookingRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
      createdAt: new Date('2026-09-10T09:04:31.001Z'),
      currency: 'THB',
      discountAmount: new Prisma.Decimal(0),
      id: '3c54a0d6-e3f3-4a38-bd55-3b4011ee31ae',
      listing: {
        description: 'One-on-one algebra and calculus tutoring.',
        gradeLevel: { id: 'grade-id', name: 'Grade 10' },
        id: 'a22c4b4d-4f8e-4de6-9b3d-faae7db5eb6d',
        pricePerHour: new Prisma.Decimal(600),
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
      tutorProfile: {
        displayName: 'Anan Suksawat',
        userId: '1772b6be-ebb5-40b7-b5bd-1c1fcfe26857',
      },
      updatedAt: new Date('2026-09-11T00:00:00.000Z'),
      ...overrides,
    });

    it('lets the owning student reload their booking with amounts from the booking snapshot', async () => {
      const { studentUserId, bookingId } = createTestData();
      const row = mockBookingRow({ id: bookingId });

      mockPrismaService.booking.findFirst.mockResolvedValue(row);

      const result = await service.getMyBookingById({ bookingId, studentUserId });

      expect(mockPrismaService.booking.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: bookingId, studentUserId } }),
      );
      expect(result).toEqual({
        createdAt: row.createdAt.toISOString(),
        currency: 'THB',
        discountAmount: '0.00',
        id: row.id,
        listing: {
          description: 'One-on-one algebra and calculus tutoring.',
          gradeLevelId: 'grade-id',
          gradeLevelName: 'Grade 10',
          id: row.listing.id,
          pricePerHour: '600.00',
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
        updatedAt: row.updatedAt.toISOString(),
      });
    });

    it('returns an ownership-safe 404 when the booking belongs to another student', async () => {
      const { bookingId } = createTestData();
      const anotherStudentId = '11111111-1111-4111-8111-111111111111';

      mockPrismaService.booking.findFirst.mockResolvedValue(null);

      await expect(
        service.getMyBookingById({ bookingId, studentUserId: anotherStudentId }),
      ).rejects.toThrow(new NotFoundException('Booking not found'));
      expect(mockPrismaService.booking.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: bookingId, studentUserId: anotherStudentId },
        }),
      );
    });

    it('returns the same ownership-safe 404 when the booking does not exist at all', async () => {
      const { studentUserId } = createTestData();
      const missingBookingId = '22222222-2222-4222-8222-222222222222';

      mockPrismaService.booking.findFirst.mockResolvedValue(null);

      await expect(
        service.getMyBookingById({ bookingId: missingBookingId, studentUserId }),
      ).rejects.toThrow(new NotFoundException('Booking not found'));
    });
  });

  describe('getTutorBookings', () => {
    it.each([-1, 0, 1])('validates from minus to at %i milliseconds', async (deltaMs) => {
      const { tutorUserId } = createTestData();
      const to = '2026-10-10T03:00:00.000Z';
      const from = new Date(new Date(to).getTime() + deltaMs).toISOString();
      mockPrismaService.booking.findMany.mockResolvedValue([]);
      mockPrismaService.booking.count.mockResolvedValue(0);

      const result = service.getTutorBookings({ from, to, tutorUserId });
      if (deltaMs > 0) {
        await expect(result).rejects.toThrow(BadRequestException);
        expect(mockPrismaService.booking.findMany).not.toHaveBeenCalled();
        expect(mockPrismaService.booking.count).not.toHaveBeenCalled();
      } else {
        await expect(result).resolves.toEqual({ items: [], total: 0 });
      }
      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });

    it.each(['from', 'to'] as const)('supports a single %s endpoint', async (endpoint) => {
      const { tutorUserId } = createTestData();
      const date = '2026-10-10T03:00:00.000Z';
      mockPrismaService.booking.findMany.mockResolvedValue([]);
      mockPrismaService.booking.count.mockResolvedValue(0);
      await expect(service.getTutorBookings({ [endpoint]: date, tutorUserId })).resolves.toEqual({
        items: [],
        total: 0,
      });
      expect(mockPrismaService.booking.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tutorProfileId: tutorUserId,
            slot: { startAtUtc: { [endpoint === 'from' ? 'gte' : 'lte']: new Date(date) } },
          },
        }),
      );
    });

    const mockTutorBookingRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
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
      student: {
        studentProfile: {
          firstName: 'Napat',
          gradeLevel: 'Grade 10',
          lastName: 'Suksawat',
          nickname: 'Nan',
          phone: '0800000000',
          school: 'HKTutor Test School',
        },
      },
      studentUserId: '6bb01222-1fce-4bc3-a69d-3d90db2fdf57',
      subtotalAmount: new Prisma.Decimal(450),
      ...overrides,
    });

    it('throws BadRequestException when tutorUserId is missing', async () => {
      await expect(service.getTutorBookings({ tutorUserId: '' })).rejects.toThrow(
        new BadRequestException('tutorUserId is required to list bookings'),
      );
    });

    it('throws BadRequestException when from is later than to', async () => {
      const { tutorUserId } = createTestData();

      await expect(
        service.getTutorBookings({
          from: '2026-09-30T00:00:00.000Z',
          to: '2026-09-01T00:00:00.000Z',
          tutorUserId,
        }),
      ).rejects.toThrow(new BadRequestException('from must not be later than to'));
    });

    it('scopes the query to the authenticated tutor and projects only the student nickname', async () => {
      const { tutorUserId } = createTestData();
      const row = mockTutorBookingRow();

      mockPrismaService.booking.findMany.mockResolvedValue([row]);
      mockPrismaService.booking.count.mockResolvedValue(1);

      const result = await service.getTutorBookings({ tutorUserId });

      expect(mockPrismaService.booking.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 20,
          where: { tutorProfileId: tutorUserId },
        }),
      );
      const findManyCalls = mockPrismaService.booking.findMany.mock.calls as unknown as Array<
        [{ select: { student: unknown } }]
      >;
      expect(findManyCalls[0]?.[0].select.student).toEqual({
        select: { studentProfile: { select: { nickname: true } } },
      });
      expect(result.items[0]?.student).toStrictEqual({ nickname: 'Nan' });
      expect(result.items[0]).not.toHaveProperty('tutor');
      expect(result.items[0]).not.toHaveProperty('studentUserId');
    });

    it('returns a null nickname when a historical booking no longer has a student profile', async () => {
      const { tutorUserId } = createTestData();
      const row = mockTutorBookingRow({ student: { studentProfile: null } });

      mockPrismaService.booking.findMany.mockResolvedValue([row]);
      mockPrismaService.booking.count.mockResolvedValue(1);

      await expect(service.getTutorBookings({ tutorUserId })).resolves.toMatchObject({
        items: [expect.objectContaining({ student: { nickname: null } })],
      });
    });

    it('combines the status filter with the where clause', async () => {
      const { tutorUserId } = createTestData();

      mockPrismaService.booking.findMany.mockResolvedValue([]);
      mockPrismaService.booking.count.mockResolvedValue(0);

      await service.getTutorBookings({ status: BookingStatus.CONFIRMED, tutorUserId });

      expect(mockPrismaService.booking.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: BookingStatus.CONFIRMED, tutorProfileId: tutorUserId },
        }),
      );
    });

    it('combines the from/to date range filter with the where clause', async () => {
      const { tutorUserId } = createTestData();

      mockPrismaService.booking.findMany.mockResolvedValue([]);
      mockPrismaService.booking.count.mockResolvedValue(0);

      await service.getTutorBookings({
        from: '2026-09-01T00:00:00.000Z',
        to: '2026-09-30T23:59:59.999Z',
        tutorUserId,
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
            tutorProfileId: tutorUserId,
          },
        }),
      );
    });

    it('applies validated page and pageSize values while keeping the filtered total', async () => {
      const { tutorUserId } = createTestData();
      mockPrismaService.booking.findMany.mockResolvedValue([]);
      mockPrismaService.booking.count.mockResolvedValue(41);

      const result = await service.getTutorBookings({ page: 2, pageSize: 15, tutorUserId });

      expect(mockPrismaService.booking.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 15,
          take: 15,
          where: { tutorProfileId: tutorUserId },
        }),
      );
      expect(result.total).toBe(41);
    });

    it('combines the status and date filters and counts the same filtered set', async () => {
      const { tutorUserId } = createTestData();

      mockPrismaService.booking.findMany.mockResolvedValue([]);
      mockPrismaService.booking.count.mockResolvedValue(0);

      await service.getTutorBookings({
        from: '2026-09-01T00:00:00.000Z',
        status: BookingStatus.CONFIRMED,
        tutorUserId,
        to: '2026-09-30T23:59:59.999Z',
      });

      const expectedWhere = {
        slot: {
          startAtUtc: {
            gte: new Date('2026-09-01T00:00:00.000Z'),
            lte: new Date('2026-09-30T23:59:59.999Z'),
          },
        },
        status: BookingStatus.CONFIRMED,
        tutorProfileId: tutorUserId,
      };
      expect(mockPrismaService.booking.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expectedWhere }),
      );
      expect(mockPrismaService.booking.count).toHaveBeenCalledWith({ where: expectedWhere });
    });

    it('returns a deterministic empty result when the tutor has no bookings', async () => {
      const { tutorUserId } = createTestData();

      mockPrismaService.booking.findMany.mockResolvedValue([]);
      mockPrismaService.booking.count.mockResolvedValue(0);

      const result = await service.getTutorBookings({ tutorUserId });

      expect(result).toEqual({ items: [], total: 0 });
    });
  });

  describe('tutor confirm and reject actions', () => {
    const pendingBooking = (tutorUserId: string) => ({
      status: BookingStatus.PENDING,
      tutorProfileId: tutorUserId,
    });

    const stubTransition = (options: {
      activeBookings?: number;
      bookingId: string;
      canceledAt?: Date | null;
      slotId: string;
      status?: BookingStatus;
      transitionCount?: number;
    }) => {
      const updateMany = jest.fn().mockResolvedValue({ count: options.transitionCount ?? 1 });
      const findUniqueOrThrow = jest.fn().mockResolvedValue({
        canceledAt: options.canceledAt ?? null,
        id: options.bookingId,
        slotId: options.slotId,
        status: options.status ?? BookingStatus.CONFIRMED,
      });
      const count = jest.fn().mockResolvedValue(options.activeBookings ?? 1);

      mockPrismaService.$transaction.mockImplementation(async (callback: TransactionCallback) =>
        callback({ booking: { count, findUniqueOrThrow, updateMany } }),
      );

      return { count, findUniqueOrThrow, updateMany };
    };

    describe.each(['confirm', 'reject'] as const)('%s transition decision edges', (action) => {
      const act = (bookingId: string, tutorUserId: string) =>
        action === 'confirm'
          ? service.confirmTutorBooking({ bookingId, tutorUserId })
          : service.rejectTutorBooking({ bookingId, tutorUserId });

      it.each([
        BookingStatus.CONFIRMED,
        BookingStatus.COMPLETED,
        BookingStatus.CANCELED,
        BookingStatus.EXPIRED,
      ])('refuses the %s state before opening a transaction', async (status) => {
        const { bookingId, tutorUserId } = createTestData();
        mockPrismaService.booking.findUnique.mockResolvedValue({
          status,
          tutorProfileId: tutorUserId,
        });
        await expect(act(bookingId, tutorUserId)).rejects.toMatchObject({
          response: { code: 'BOOKING_NOT_PENDING', statusCode: 409 },
        });
        expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
      });

      it('rejects a missing booking before opening a transaction', async () => {
        const { bookingId, tutorUserId } = createTestData();
        mockPrismaService.booking.findUnique.mockResolvedValue(null);
        await expect(act(bookingId, tutorUserId)).rejects.toMatchObject({
          response: { code: 'BOOKING_NOT_FOUND', statusCode: 404 },
        });
        expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
      });

      it.each([BookingStatus.PENDING, BookingStatus.COMPLETED])(
        'checks ownership before the %s state',
        async (status) => {
          const { bookingId, tutorUserId } = createTestData();
          mockPrismaService.booking.findUnique.mockResolvedValue({
            status,
            tutorProfileId: '99999999-9999-4999-8999-999999999999',
          });
          await expect(act(bookingId, tutorUserId)).rejects.toMatchObject({
            response: { code: 'BOOKING_NOT_OWNED', statusCode: 403 },
          });
          expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
        },
      );

      // Two affected rows are impossible with a unique booking ID. This is a defensive mock fault,
      // not a database fixture or evidence of concurrent database execution.
      it.each([0, 2])('does not report success for %i affected rows', async (transitionCount) => {
        const { bookingId, slotId, tutorUserId } = createTestData();
        mockPrismaService.booking.findUnique.mockResolvedValue(pendingBooking(tutorUserId));
        const { count, findUniqueOrThrow } = stubTransition({ bookingId, slotId, transitionCount });
        await expect(act(bookingId, tutorUserId)).rejects.toMatchObject({
          response: { code: 'BOOKING_TRANSITION_CONFLICT', statusCode: 409 },
        });
        expect(findUniqueOrThrow).not.toHaveBeenCalled();
        expect(count).not.toHaveBeenCalled();
      });

      it.each(['P2002', 'P2003', 'P2004'])('reports a conflict for %s', async (code) => {
        const { bookingId, tutorUserId } = createTestData();
        mockPrismaService.booking.findUnique.mockResolvedValue(pendingBooking(tutorUserId));
        mockPrismaService.$transaction.mockRejectedValue(
          createDatabaseError('database race', code),
        );
        await expect(act(bookingId, tutorUserId)).rejects.toMatchObject({
          response: { code: 'BOOKING_TRANSITION_CONFLICT', statusCode: 409 },
        });
      });

      it.each([
        new Error('unexpected fault'),
        createDatabaseError('unknown Prisma error', 'P9999'),
        { code: 2002, meta: { code: 23505 } },
        null,
        'connection failure',
      ])('preserves an unrecognized failure %p', async (error) => {
        const { bookingId, tutorUserId } = createTestData();
        mockPrismaService.booking.findUnique.mockResolvedValue(pendingBooking(tutorUserId));
        mockPrismaService.$transaction.mockRejectedValue(error);
        await expect(act(bookingId, tutorUserId)).rejects.toBe(error);
      });
    });

    it.each(['', '   '])('uses the default for direct service blank reason %j', async (reason) => {
      const { bookingId, slotId, tutorUserId } = createTestData();
      mockPrismaService.booking.findUnique.mockResolvedValue(pendingBooking(tutorUserId));
      const { updateMany } = stubTransition({
        bookingId,
        slotId,
        status: BookingStatus.CANCELED,
        activeBookings: 0,
      });
      await service.rejectTutorBooking({ bookingId, tutorUserId, reason });
      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ cancellationReason: 'Rejected by the tutor' }) as unknown,
        }),
      );
    });

    it('confirms a pending booking and keeps the slot reserved', async () => {
      const { bookingId, slotId, tutorUserId } = createTestData();

      mockPrismaService.booking.findUnique.mockResolvedValue(pendingBooking(tutorUserId));
      const { updateMany } = stubTransition({ bookingId, slotId });

      await expect(service.confirmTutorBooking({ bookingId, tutorUserId })).resolves.toEqual({
        bookingId,
        canceledAt: null,
        slotStatus: BookingSlotStatus.RESERVED,
        status: BookingStatus.CONFIRMED,
      });
      expect(updateMany).toHaveBeenCalledWith({
        data: { status: BookingStatus.CONFIRMED },
        where: { id: bookingId, status: BookingStatus.PENDING, tutorProfileId: tutorUserId },
      });
    });

    it('rejects a pending booking, records the reason and releases the slot', async () => {
      const { bookingId, slotId, tutorUserId } = createTestData();
      const canceledAt = new Date('2026-10-04T09:04:31.001Z');

      mockPrismaService.booking.findUnique.mockResolvedValue(pendingBooking(tutorUserId));
      const { updateMany } = stubTransition({
        activeBookings: 0,
        bookingId,
        canceledAt,
        slotId,
        status: BookingStatus.CANCELED,
      });

      await expect(
        service.rejectTutorBooking({ bookingId, reason: '  Double booked  ', tutorUserId }),
      ).resolves.toEqual({
        bookingId,
        canceledAt: canceledAt.toISOString(),
        slotStatus: BookingSlotStatus.AVAILABLE,
        status: BookingStatus.CANCELED,
      });

      const updateManyCalls = updateMany.mock.calls as unknown as Array<
        [
          {
            data: {
              canceledAt: Date;
              canceledById: string;
              cancellationReason: string;
              status: BookingStatus;
            };
          },
        ]
      >;
      const data = updateManyCalls[0]?.[0].data;
      expect(data?.cancellationReason).toBe('Double booked');
      expect(data?.canceledById).toBe(tutorUserId);
      expect(data?.status).toBe(BookingStatus.CANCELED);
      // The database check constraint also requires canceledAt on a canceled booking.
      expect(data?.canceledAt).toBeInstanceOf(Date);
    });

    it('stores a default reason when the tutor rejects without one', async () => {
      const { bookingId, slotId, tutorUserId } = createTestData();

      mockPrismaService.booking.findUnique.mockResolvedValue(pendingBooking(tutorUserId));
      const { updateMany } = stubTransition({
        activeBookings: 0,
        bookingId,
        canceledAt: new Date('2026-10-04T09:04:31.001Z'),
        slotId,
        status: BookingStatus.CANCELED,
      });

      await service.rejectTutorBooking({ bookingId, tutorUserId });

      const updateManyCalls = updateMany.mock.calls as unknown as Array<
        [{ data: { cancellationReason: string } }]
      >;
      // The database check constraint refuses a canceled booking without a non-empty reason.
      expect(updateManyCalls[0]?.[0].data.cancellationReason).toBe('Rejected by the tutor');
    });
  });

  describe('updateMeetingLink', () => {
    it.each([
      ['not-a-url'],
      ['http://example.com/meet'],
      ['ftp://example.com'],
      [''],
      ['https:meet.google.com/abc'],
      ['https:/meet.google.com/abc'],
      [' https://meet.google.com/abc '],
      ['https://'],
    ])('rejects invalid or non-https URL %j with 400', async (meetingUrl) => {
      const { bookingId } = createTestData();

      await expect(service.updateMeetingLink({ bookingId, meetingUrl })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects with 404 when booking does not exist', async () => {
      const { bookingId } = createTestData();
      mockPrismaService.booking.findFirst.mockResolvedValue(null);

      await expect(
        service.updateMeetingLink({
          bookingId,
          meetingUrl: 'https://meet.google.com/abc-defg-hij',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it.each([BookingStatus.PENDING, BookingStatus.CANCELED, BookingStatus.COMPLETED])(
      'rejects when booking is %s rather than CONFIRMED with 409',
      async (status) => {
        const { bookingId } = createTestData();
        mockPrismaService.booking.findFirst.mockResolvedValue({ id: bookingId, status });

        await expect(
          service.updateMeetingLink({
            bookingId,
            meetingUrl: 'https://meet.google.com/abc-defg-hij',
          }),
        ).rejects.toThrow(ConflictException);
      },
    );

    it('updates meeting link and returns response DTO for a confirmed booking', async () => {
      const { bookingId } = createTestData();
      const meetingUrl = 'https://meet.google.com/abc-defg-hij';
      const updatedAt = new Date('2026-10-09T09:04:31.001Z');

      mockPrismaService.booking.findFirst.mockResolvedValue({
        id: bookingId,
        status: BookingStatus.CONFIRMED,
      });
      mockPrismaService.booking.update.mockResolvedValue({
        id: bookingId,
        meetingUrl,
        updatedAt,
      });

      const result = await service.updateMeetingLink({ bookingId, meetingUrl });

      expect(mockPrismaService.booking.update).toHaveBeenCalledWith({
        data: { meetingUrl },
        where: { id: bookingId },
      });
      expect(result).toEqual({
        bookingId,
        meetingUrl,
        updatedAt: updatedAt.toISOString(),
      });
    });
  });

  describe('getBookingClassDetail', () => {
    it('rejects with 404 when booking does not exist', async () => {
      const { bookingId } = createTestData();
      mockPrismaService.booking.findFirst.mockResolvedValue(null);

      await expect(service.getBookingClassDetail(bookingId)).rejects.toThrow(NotFoundException);
    });

    it.each([BookingStatus.PENDING, BookingStatus.CANCELED, BookingStatus.COMPLETED])(
      'rejects when booking is %s rather than CONFIRMED with 409',
      async (status) => {
        const { bookingId } = createTestData();
        mockPrismaService.booking.findFirst.mockResolvedValue({ id: bookingId, status });

        await expect(service.getBookingClassDetail(bookingId)).rejects.toThrow(ConflictException);
      },
    );

    it('returns class details with meetingUrl null when a confirmed booking has no meeting link', async () => {
      const { bookingId, studentUserId, tutorUserId } = createTestData();
      const startAtUtc = new Date('2026-10-09T09:00:00.000Z');
      const endAtUtc = new Date('2026-10-09T10:00:00.000Z');

      mockPrismaService.booking.findFirst.mockResolvedValue({
        attendance: null,
        id: bookingId,
        meetingUrl: null,
        slot: { endAtUtc, startAtUtc },
        status: BookingStatus.CONFIRMED,
        studentUserId,
        tutorProfile: {
          bio: 'Mathematics tutor',
          displayName: 'Kru Anan',
          experienceYears: 5,
          firstName: 'Anan',
          lastName: 'Suksawat',
          nickname: 'Nan',
        },
        tutorProfileId: tutorUserId,
      });

      const studentProfile = {
        firstName: 'Suda',
        gradeLevel: 'Grade 10',
        lastName: 'Dee',
        nickname: 'Da',
        phone: '0812345678',
        school: 'Demo School',
      };
      mockPrismaService.studentProfile.findFirst.mockResolvedValue(studentProfile);

      const result = await service.getBookingClassDetail(bookingId);

      expect(result).toEqual({
        attendance: null,
        bookingId,
        endAt: endAtUtc.toISOString(),
        meetingUrl: null,
        participants: {
          student: {
            detail: studentProfile,
            id: studentUserId,
          },
          tutor: {
            detail: {
              bio: 'Mathematics tutor',
              displayName: 'Kru Anan',
              experienceYears: 5,
              firstName: 'Anan',
              lastName: 'Suksawat',
              nickname: 'Nan',
            },
            id: tutorUserId,
          },
        },
        startAt: startAtUtc.toISOString(),
        status: BookingStatus.CONFIRMED,
      });
    });

    it('rejects with 400 when student profile is not found', async () => {
      const { bookingId, studentUserId } = createTestData();
      mockPrismaService.booking.findFirst.mockResolvedValue({
        id: bookingId,
        meetingUrl: 'https://meet.google.com/abc-defg-hij',
        slot: {
          endAtUtc: new Date('2026-10-09T10:00:00.000Z'),
          startAtUtc: new Date('2026-10-09T09:00:00.000Z'),
        },
        status: BookingStatus.CONFIRMED,
        studentUserId,
        tutorProfile: { displayName: 'Kru Anan' },
      });
      mockPrismaService.studentProfile.findFirst.mockResolvedValue(null);

      await expect(service.getBookingClassDetail(bookingId)).rejects.toThrow(BadRequestException);
    });

    it('returns complete class details for a confirmed booking with meeting link', async () => {
      const { bookingId, studentUserId, tutorUserId } = createTestData();
      const startAtUtc = new Date('2026-10-09T09:00:00.000Z');
      const endAtUtc = new Date('2026-10-09T10:00:00.000Z');
      const meetingUrl = 'https://meet.google.com/abc-defg-hij';

      mockPrismaService.booking.findFirst.mockResolvedValue({
        attendance: AttendanceStatus.ATTENDED,
        id: bookingId,
        meetingUrl,
        slot: { endAtUtc, startAtUtc },
        status: BookingStatus.CONFIRMED,
        studentUserId,
        tutorProfile: {
          bio: 'Mathematics tutor',
          displayName: 'Kru Anan',
          experienceYears: 5,
          firstName: 'Anan',
          lastName: 'Suksawat',
          nickname: 'Nan',
        },
        tutorProfileId: tutorUserId,
      });

      const studentProfile = {
        firstName: 'Suda',
        gradeLevel: 'Grade 10',
        lastName: 'Dee',
        nickname: 'Da',
        phone: '0812345678',
        school: 'Demo School',
      };
      mockPrismaService.studentProfile.findFirst.mockResolvedValue(studentProfile);

      const result = await service.getBookingClassDetail(bookingId);

      expect(result).toEqual({
        attendance: AttendanceStatus.ATTENDED,
        bookingId,
        endAt: endAtUtc.toISOString(),
        meetingUrl,
        participants: {
          student: {
            detail: studentProfile,
            id: studentUserId,
          },
          tutor: {
            detail: {
              bio: 'Mathematics tutor',
              displayName: 'Kru Anan',
              experienceYears: 5,
              firstName: 'Anan',
              lastName: 'Suksawat',
              nickname: 'Nan',
            },
            id: tutorUserId,
          },
        },
        startAt: startAtUtc.toISOString(),
        status: BookingStatus.CONFIRMED,
      });
    });
  });

  describe('cancelBooking', () => {
    const stubCancelTransaction = (options: {
      booking: unknown;
      canceledBooking?: unknown;
      transitionCount?: number;
    }) => {
      const findUnique = jest.fn().mockResolvedValue(options.booking);
      const updateMany = jest.fn().mockResolvedValue({
        count:
          options.transitionCount !== undefined
            ? options.transitionCount
            : options.canceledBooking !== undefined
              ? 1
              : 0,
      });
      const findUniqueOrThrow = jest.fn().mockResolvedValue(options.canceledBooking);

      mockPrismaService.$transaction.mockImplementation(async (callback: TransactionCallback) =>
        callback({ booking: { findUnique, findUniqueOrThrow, updateMany } }),
      );

      return { findUnique, findUniqueOrThrow, updateMany };
    };

    it('cancels an unpaid, incomplete, active booking when slot start time is more than 24 hours away', async () => {
      const { bookingId, studentUserId, tutorUserId } = createTestData();
      const startAtUtc = new Date(Date.now() + 48 * 60 * 60 * 1000);
      const canceledAt = new Date('2026-10-13T10:00:00.000Z');
      const activeBooking = {
        id: bookingId,
        paymentStatus: PaymentStatus.UNPAID,
        slot: { startAtUtc },
        status: BookingStatus.CONFIRMED,
        studentUserId,
        tutorProfileId: tutorUserId,
      };
      const updatedBooking = {
        canceledAt,
        id: bookingId,
        status: BookingStatus.CANCELED,
      };

      const { findUnique, findUniqueOrThrow, updateMany } = stubCancelTransaction({
        booking: activeBooking,
        canceledBooking: updatedBooking,
      });

      const result = await service.cancelBooking({
        bookingId,
        reason: 'Emergency schedule conflict',
        userId: studentUserId,
      });

      expect(result).toEqual({
        bookingId,
        canceledAt: canceledAt.toISOString(),
        status: BookingStatus.CANCELED,
      });
      expect(findUnique).toHaveBeenCalledWith({
        select: {
          id: true,
          paymentStatus: true,
          slot: { select: { startAtUtc: true } },
          status: true,
          studentUserId: true,
          tutorProfileId: true,
        },
        where: { id: bookingId },
      });

      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: bookingId,
            paymentStatus: PaymentStatus.UNPAID,
            status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
          },
        }) as unknown,
      );
      const updateCalls = updateMany.mock.calls as unknown as Array<
        [
          {
            data: {
              canceledAt: unknown;
              canceledById: string;
              cancellationReason: string;
              status: BookingStatus;
            };
          },
        ]
      >;
      const updatePayload = updateCalls[0]?.[0];
      expect(updatePayload?.data.status).toBe(BookingStatus.CANCELED);
      expect(updatePayload?.data.canceledById).toBe(studentUserId);
      expect(updatePayload?.data.cancellationReason).toBe('Emergency schedule conflict');
      expect(updatePayload?.data.canceledAt).toBeInstanceOf(Date);

      expect(findUniqueOrThrow).toHaveBeenCalledWith({
        select: { canceledAt: true, id: true, status: true },
        where: { id: bookingId },
      });
    });

    it('allows the tutor participant to cancel the booking', async () => {
      const { bookingId, studentUserId, tutorUserId } = createTestData();
      const startAtUtc = new Date(Date.now() + 48 * 60 * 60 * 1000);
      const canceledAt = new Date('2026-10-13T10:00:00.000Z');
      const activeBooking = {
        id: bookingId,
        paymentStatus: PaymentStatus.UNPAID,
        slot: { startAtUtc },
        status: BookingStatus.PENDING,
        studentUserId,
        tutorProfileId: tutorUserId,
      };
      const updatedBooking = {
        canceledAt,
        id: bookingId,
        status: BookingStatus.CANCELED,
      };

      const { updateMany } = stubCancelTransaction({
        booking: activeBooking,
        canceledBooking: updatedBooking,
      });

      const result = await service.cancelBooking({
        bookingId,
        reason: 'Tutor emergency',
        userId: tutorUserId,
      });

      expect(result).toEqual({
        bookingId,
        canceledAt: canceledAt.toISOString(),
        status: BookingStatus.CANCELED,
      });
      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: bookingId,
            paymentStatus: PaymentStatus.UNPAID,
            status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
          },
        }) as unknown,
      );
      const updateCalls = updateMany.mock.calls as unknown as Array<
        [
          {
            data: {
              canceledAt: unknown;
              canceledById: string;
              cancellationReason: string;
              status: BookingStatus;
            };
          },
        ]
      >;
      const updatePayload = updateCalls[0]?.[0];
      expect(updatePayload?.data.status).toBe(BookingStatus.CANCELED);
      expect(updatePayload?.data.canceledById).toBe(tutorUserId);
      expect(updatePayload?.data.cancellationReason).toBe('Tutor emergency');
      expect(updatePayload?.data.canceledAt).toBeInstanceOf(Date);
    });

    it('allows cancellation at exactly 24 hours before slot start time', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-10-13T10:00:00.000Z'));
      try {
        const { bookingId, studentUserId, tutorUserId } = createTestData();
        const startAtUtc = new Date('2026-10-14T10:00:00.000Z');
        const canceledAt = new Date('2026-10-13T10:00:00.000Z');
        const activeBooking = {
          id: bookingId,
          paymentStatus: PaymentStatus.UNPAID,
          slot: { startAtUtc },
          status: BookingStatus.CONFIRMED,
          studentUserId,
          tutorProfileId: tutorUserId,
        };

        stubCancelTransaction({
          booking: activeBooking,
          canceledBooking: {
            canceledAt,
            id: bookingId,
            status: BookingStatus.CANCELED,
          },
        });

        const result = await service.cancelBooking({
          bookingId,
          reason: 'Valid cancellation on the 24h boundary',
          userId: studentUserId,
        });

        expect(result.status).toBe(BookingStatus.CANCELED);
      } finally {
        jest.useRealTimers();
      }
    });

    it('throws ForbiddenException when requesting user is not a participant', async () => {
      const { bookingId, studentUserId, tutorUserId } = createTestData();
      const foreignUserId = '99999999-9999-4999-8999-999999999999';
      stubCancelTransaction({
        booking: {
          id: bookingId,
          paymentStatus: PaymentStatus.UNPAID,
          slot: { startAtUtc: new Date(Date.now() + 48 * 60 * 60 * 1000) },
          status: BookingStatus.CONFIRMED,
          studentUserId,
          tutorProfileId: tutorUserId,
        },
      });

      await expect(
        service.cancelBooking({
          bookingId,
          reason: 'Unauthorized cancel attempt',
          userId: foreignUserId,
        }),
      ).rejects.toMatchObject({
        response: {
          code: 'BOOKING_NOT_OWNED',
          error: 'Forbidden',
          message: 'This booking belongs to another user',
          statusCode: 403,
        },
      });
    });

    it.each(['', '   ', undefined as unknown as string, null as unknown as string])(
      'throws BadRequestException when reason is empty (%p)',
      async (reason) => {
        const { bookingId, studentUserId } = createTestData();

        await expect(
          service.cancelBooking({ bookingId, reason, userId: studentUserId }),
        ).rejects.toMatchObject({
          response: {
            code: 'REASON_MISSING',
            error: 'Bad Request',
            message: 'Reason cannot be empty!',
            statusCode: 400,
          },
        });
        expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
      },
    );

    it('throws NotFoundException when booking does not exist', async () => {
      const { bookingId, studentUserId } = createTestData();
      stubCancelTransaction({ booking: null });

      await expect(
        service.cancelBooking({
          bookingId,
          reason: 'Valid reason',
          userId: studentUserId,
        }),
      ).rejects.toMatchObject({
        response: {
          code: 'BOOKING_NOT_FOUND',
          error: 'Not Found',
          message: 'Booking not found',
          statusCode: 404,
        },
      });
    });

    it('throws ConflictException when booking is already paid', async () => {
      const { bookingId, studentUserId, tutorUserId } = createTestData();
      stubCancelTransaction({
        booking: {
          id: bookingId,
          paymentStatus: PaymentStatus.PAID,
          slot: { startAtUtc: new Date(Date.now() + 48 * 60 * 60 * 1000) },
          status: BookingStatus.CONFIRMED,
          studentUserId,
          tutorProfileId: tutorUserId,
        },
      });

      await expect(
        service.cancelBooking({
          bookingId,
          reason: 'Valid reason',
          userId: studentUserId,
        }),
      ).rejects.toMatchObject({
        response: {
          code: 'BOOKING_ALREADY_PAID',
          error: 'Conflict',
          message: 'This booking is already paid',
          statusCode: 409,
        },
      });
    });

    it('throws ConflictException when booking is already completed', async () => {
      const { bookingId, studentUserId, tutorUserId } = createTestData();
      stubCancelTransaction({
        booking: {
          id: bookingId,
          paymentStatus: PaymentStatus.UNPAID,
          slot: { startAtUtc: new Date(Date.now() + 48 * 60 * 60 * 1000) },
          status: BookingStatus.COMPLETED,
          studentUserId,
          tutorProfileId: tutorUserId,
        },
      });

      await expect(
        service.cancelBooking({
          bookingId,
          reason: 'Valid reason',
          userId: studentUserId,
        }),
      ).rejects.toMatchObject({
        response: {
          code: 'BOOKING_ALREADY_COMPLETED',
          error: 'Conflict',
          message: 'This booking is already completed',
          statusCode: 409,
        },
      });
    });

    it('throws ConflictException when booking is already canceled', async () => {
      const { bookingId, studentUserId, tutorUserId } = createTestData();
      stubCancelTransaction({
        booking: {
          id: bookingId,
          paymentStatus: PaymentStatus.UNPAID,
          slot: { startAtUtc: new Date(Date.now() + 48 * 60 * 60 * 1000) },
          status: BookingStatus.CANCELED,
          studentUserId,
          tutorProfileId: tutorUserId,
        },
      });

      await expect(
        service.cancelBooking({
          bookingId,
          reason: 'Valid reason',
          userId: studentUserId,
        }),
      ).rejects.toMatchObject({
        response: {
          code: 'BOOKING_ALREADY_CANCELED',
          error: 'Conflict',
          message: 'This booking is already canceled',
          statusCode: 409,
        },
      });
    });

    it('throws ConflictException when booking is already expired', async () => {
      const { bookingId, studentUserId, tutorUserId } = createTestData();
      stubCancelTransaction({
        booking: {
          id: bookingId,
          paymentStatus: PaymentStatus.UNPAID,
          slot: { startAtUtc: new Date(Date.now() + 48 * 60 * 60 * 1000) },
          status: BookingStatus.EXPIRED,
          studentUserId,
          tutorProfileId: tutorUserId,
        },
      });

      await expect(
        service.cancelBooking({
          bookingId,
          reason: 'Valid reason',
          userId: studentUserId,
        }),
      ).rejects.toMatchObject({
        response: {
          code: 'BOOKING_ALREADY_EXPIRED',
          error: 'Conflict',
          message: 'This booking is already expired',
          statusCode: 409,
        },
      });
    });

    it('throws ConflictException when slot start time is within 24 hours', async () => {
      const { bookingId, studentUserId, tutorUserId } = createTestData();
      const startAtUtc = new Date(Date.now() + 2 * 60 * 60 * 1000);
      stubCancelTransaction({
        booking: {
          id: bookingId,
          paymentStatus: PaymentStatus.UNPAID,
          slot: { startAtUtc },
          status: BookingStatus.CONFIRMED,
          studentUserId,
          tutorProfileId: tutorUserId,
        },
      });

      await expect(
        service.cancelBooking({
          bookingId,
          reason: 'Valid reason',
          userId: studentUserId,
        }),
      ).rejects.toMatchObject({
        response: {
          code: 'BOOKING_EXCEED_CANCEL_RANGE',
          error: 'Conflict',
          message: 'This booking is exceeding cancel range',
          statusCode: 409,
        },
      });
    });

    it('throws ConflictException when slot start time has already passed', async () => {
      const { bookingId, studentUserId, tutorUserId } = createTestData();
      const startAtUtc = new Date(Date.now() - 1 * 60 * 60 * 1000);
      stubCancelTransaction({
        booking: {
          id: bookingId,
          paymentStatus: PaymentStatus.UNPAID,
          slot: { startAtUtc },
          status: BookingStatus.CONFIRMED,
          studentUserId,
          tutorProfileId: tutorUserId,
        },
      });

      await expect(
        service.cancelBooking({
          bookingId,
          reason: 'Valid reason',
          userId: studentUserId,
        }),
      ).rejects.toMatchObject({
        response: {
          code: 'BOOKING_EXCEED_CANCEL_RANGE',
          error: 'Conflict',
          message: 'This booking is exceeding cancel range',
          statusCode: 409,
        },
      });
    });

    it('throws ConflictException when concurrent update modifies the booking (transition count 0)', async () => {
      const { bookingId, studentUserId, tutorUserId } = createTestData();
      const startAtUtc = new Date(Date.now() + 48 * 60 * 60 * 1000);
      stubCancelTransaction({
        booking: {
          id: bookingId,
          paymentStatus: PaymentStatus.UNPAID,
          slot: { startAtUtc },
          status: BookingStatus.CONFIRMED,
          studentUserId,
          tutorProfileId: tutorUserId,
        },
        transitionCount: 0,
      });

      await expect(
        service.cancelBooking({
          bookingId,
          reason: 'Valid reason',
          userId: studentUserId,
        }),
      ).rejects.toMatchObject({
        response: {
          code: 'BOOKING_TRANSITION_CONFLICT',
          error: 'Conflict',
          message: 'The booking was already updated by another request',
          statusCode: 409,
        },
      });
    });

    it.each(['P2002', 'P2003', 'P2004'])(
      'throws ConflictException when database conflict %s occurs',
      async (code) => {
        const { bookingId, studentUserId, tutorUserId } = createTestData();
        const startAtUtc = new Date(Date.now() + 48 * 60 * 60 * 1000);
        stubCancelTransaction({
          booking: {
            id: bookingId,
            paymentStatus: PaymentStatus.UNPAID,
            slot: { startAtUtc },
            status: BookingStatus.CONFIRMED,
            studentUserId,
            tutorProfileId: tutorUserId,
          },
        });
        mockPrismaService.$transaction.mockRejectedValue(
          createDatabaseError('Constraint violation', code),
        );

        await expect(
          service.cancelBooking({
            bookingId,
            reason: 'Valid reason',
            userId: studentUserId,
          }),
        ).rejects.toMatchObject({
          response: {
            code: 'BOOKING_TRANSITION_CONFLICT',
            error: 'Conflict',
            message: 'The booking was already updated by another request',
            statusCode: 409,
          },
        });
      },
    );
  });
});
