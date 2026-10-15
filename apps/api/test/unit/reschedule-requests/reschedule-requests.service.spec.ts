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
  BookingStatus,
  RescheduleRequestStatus,
  Role,
} from '@generated/prisma/enums';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { CURRENT_PRIVACY_POLICY_VERSION } from '@modules/auth/auth.constants';
import {
  DEFAULT_RESCHEDULE_REASON,
  RescheduleRequestsService,
} from '@modules/reschedule-requests/reschedule-requests.service';

type DatabaseError = Error & {
  code: string;
  meta?: { driverAdapterError: { cause: { originalCode: string } } };
};

const createDatabaseError = (message: string, code: string, sqlState?: string): DatabaseError => {
  const error = new Error(message) as DatabaseError;
  error.code = code;
  if (sqlState !== undefined) {
    error.meta = { driverAdapterError: { cause: { originalCode: sqlState } } };
  }
  return error;
};

describe('RescheduleRequestsService', () => {
  let service: RescheduleRequestsService;

  const mockPrisma = {
    $transaction: jest.fn(),
    availabilitySlot: { findFirst: jest.fn(), findUnique: jest.fn() },
    booking: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      updateMany: jest.fn(),
    },
    rescheduleRequest: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    user: { findUnique: jest.fn() },
  };

  const STUDENT_ID = '70e1232d-3c06-4d5d-b3d2-6026df5ff315';
  const TUTOR_ID = 'ad08a291-dd8b-40c1-84e5-ddafca54c6fc';
  const OUTSIDER_ID = '99999999-9999-9999-9999-999999999999';
  const BOOKING_ID = '3c54a0d6-e3f3-4a38-bd55-3b4011ee31ae';
  const REQUEST_ID = '8f0a20bf-7ff8-41ec-bbf5-59b5cfa33020';
  const CURRENT_SLOT_ID = '550e8400-e29b-41d4-a716-446655440000';
  const TARGET_SLOT_ID = '7a0f9ab0-8f25-4d80-bb00-67b3a0c7d3d5';

  const mockActiveUser = (id = STUDENT_ID, role = Role.STUDENT) => ({
    accountStatus: AccountStatus.ACTIVE,
    deletedAt: null,
    id,
    policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
    role,
  });

  const futureDate = (hoursFromNow: number) => new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
  const pastDate = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 60 * 60 * 1000);

  const mockBooking = (overrides: Record<string, unknown> = {}) => ({
    id: BOOKING_ID,
    listingId: 'listing-1',
    netAmount: new Prisma.Decimal('450.00'),
    slot: {
      endAtUtc: futureDate(50),
      id: CURRENT_SLOT_ID,
      startAtUtc: futureDate(48),
      tutorProfileId: TUTOR_ID,
    },
    slotId: CURRENT_SLOT_ID,
    status: BookingStatus.CONFIRMED,
    studentUserId: STUDENT_ID,
    subtotalAmount: new Prisma.Decimal('450.00'),
    tutorProfileId: TUTOR_ID,
    updatedAt: new Date(),
    ...overrides,
  });

  const mockTargetSlot = (overrides: Record<string, unknown> = {}) => ({
    deletedAt: null,
    endAtUtc: futureDate(74),
    id: TARGET_SLOT_ID,
    startAtUtc: futureDate(72),
    tutorProfileId: TUTOR_ID,
    ...overrides,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(
      async (callback: (tx: typeof mockPrisma) => Promise<unknown>) => callback(mockPrisma),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [RescheduleRequestsService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = moduleRef.get<RescheduleRequestsService>(RescheduleRequestsService);
  });

  describe('User account & consent assertions', () => {
    it('rejects when the account is not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.create(STUDENT_ID, Role.STUDENT, BOOKING_ID, { targetSlotId: TARGET_SLOT_ID }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects when the account is inactive or deleted', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockActiveUser(),
        accountStatus: AccountStatus.SUSPENDED,
      });

      await expect(
        service.create(STUDENT_ID, Role.STUDENT, BOOKING_ID, { targetSlotId: TARGET_SLOT_ID }),
      ).rejects.toThrow(ForbiddenException);

      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockActiveUser(),
        deletedAt: new Date(),
      });

      await expect(
        service.create(STUDENT_ID, Role.STUDENT, BOOKING_ID, { targetSlotId: TARGET_SLOT_ID }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects when privacy policy consent is missing or outdated', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockActiveUser(),
        policyVersion: '2025-01-01',
      });

      await expect(
        service.create(STUDENT_ID, Role.STUDENT, BOOKING_ID, { targetSlotId: TARGET_SLOT_ID }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('create', () => {
    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue(mockActiveUser());
    });

    it('rejects if the booking does not exist (404)', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue(null);

      await expect(
        service.create(STUDENT_ID, Role.STUDENT, BOOKING_ID, { targetSlotId: TARGET_SLOT_ID }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects if the user is not a participant in the booking (403)', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue(mockBooking());

      await expect(
        service.create(OUTSIDER_ID, Role.STUDENT, BOOKING_ID, { targetSlotId: TARGET_SLOT_ID }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects if the booking is not confirmed (409)', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue(
        mockBooking({ status: BookingStatus.PENDING }),
      );

      await expect(
        service.create(STUDENT_ID, Role.STUDENT, BOOKING_ID, { targetSlotId: TARGET_SLOT_ID }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects if the booking start time is inside the 24-hour cutoff (409)', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue(
        mockBooking({
          slot: {
            endAtUtc: futureDate(12),
            id: CURRENT_SLOT_ID,
            startAtUtc: futureDate(10), // inside cutoff
            tutorProfileId: TUTOR_ID,
          },
        }),
      );

      await expect(
        service.create(STUDENT_ID, Role.STUDENT, BOOKING_ID, { targetSlotId: TARGET_SLOT_ID }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects if a pending reschedule request already exists (409)', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue(mockBooking());
      mockPrisma.rescheduleRequest.findFirst.mockResolvedValue({ id: 'existing-pending-id' });

      await expect(
        service.create(STUDENT_ID, Role.STUDENT, BOOKING_ID, { targetSlotId: TARGET_SLOT_ID }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects if target slot is the same as current slot (400)', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue(mockBooking());
      mockPrisma.rescheduleRequest.findFirst.mockResolvedValue(null);

      await expect(
        service.create(STUDENT_ID, Role.STUDENT, BOOKING_ID, { targetSlotId: CURRENT_SLOT_ID }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects if target slot does not exist (404)', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue(mockBooking());
      mockPrisma.rescheduleRequest.findFirst.mockResolvedValue(null);
      mockPrisma.availabilitySlot.findUnique.mockResolvedValue(null);

      await expect(
        service.create(STUDENT_ID, Role.STUDENT, BOOKING_ID, { targetSlotId: TARGET_SLOT_ID }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects if target slot is soft-deleted (409)', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue(mockBooking());
      mockPrisma.rescheduleRequest.findFirst.mockResolvedValue(null);
      mockPrisma.availabilitySlot.findUnique.mockResolvedValue(
        mockTargetSlot({ deletedAt: new Date() }),
      );

      await expect(
        service.create(STUDENT_ID, Role.STUDENT, BOOKING_ID, { targetSlotId: TARGET_SLOT_ID }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects if target slot belongs to a different tutor (400)', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue(mockBooking());
      mockPrisma.rescheduleRequest.findFirst.mockResolvedValue(null);
      mockPrisma.availabilitySlot.findUnique.mockResolvedValue(
        mockTargetSlot({ tutorProfileId: 'another-tutor-id' }),
      );

      await expect(
        service.create(STUDENT_ID, Role.STUDENT, BOOKING_ID, { targetSlotId: TARGET_SLOT_ID }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects if target slot is in the past (400)', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue(mockBooking());
      mockPrisma.rescheduleRequest.findFirst.mockResolvedValue(null);
      mockPrisma.availabilitySlot.findUnique.mockResolvedValue(
        mockTargetSlot({ startAtUtc: pastDate(2) }),
      );

      await expect(
        service.create(STUDENT_ID, Role.STUDENT, BOOKING_ID, { targetSlotId: TARGET_SLOT_ID }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects if target slot overlaps in time with the booking current slot (400)', async () => {
      const start = futureDate(48);
      const end = futureDate(50);
      mockPrisma.booking.findUnique.mockResolvedValue(
        mockBooking({
          slot: {
            endAtUtc: end,
            id: CURRENT_SLOT_ID,
            startAtUtc: start,
            tutorProfileId: TUTOR_ID,
          },
        }),
      );
      mockPrisma.rescheduleRequest.findFirst.mockResolvedValue(null);
      // Target slot overlaps with [48, 50]
      mockPrisma.availabilitySlot.findUnique.mockResolvedValue(
        mockTargetSlot({
          endAtUtc: futureDate(51),
          id: TARGET_SLOT_ID,
          startAtUtc: futureDate(49),
        }),
      );

      await expect(
        service.create(STUDENT_ID, Role.STUDENT, BOOKING_ID, { targetSlotId: TARGET_SLOT_ID }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects if target slot is already reserved by an active booking (409)', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue(mockBooking());
      mockPrisma.rescheduleRequest.findFirst.mockResolvedValue(null);
      mockPrisma.availabilitySlot.findUnique.mockResolvedValue(mockTargetSlot());
      mockPrisma.booking.findFirst.mockResolvedValue({ id: 'active-booking-on-target' });

      await expect(
        service.create(STUDENT_ID, Role.STUDENT, BOOKING_ID, { targetSlotId: TARGET_SLOT_ID }),
      ).rejects.toThrow(ConflictException);
    });

    it('creates request successfully with custom reason', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue(mockBooking());
      mockPrisma.rescheduleRequest.findFirst.mockResolvedValue(null);
      mockPrisma.availabilitySlot.findUnique.mockResolvedValue(mockTargetSlot());
      mockPrisma.booking.findFirst.mockResolvedValue(null);
      mockPrisma.rescheduleRequest.create.mockResolvedValue({
        bookingId: BOOKING_ID,
        id: REQUEST_ID,
        requestedSlotId: TARGET_SLOT_ID,
        status: RescheduleRequestStatus.PENDING,
      });

      const result = await service.create(STUDENT_ID, Role.STUDENT, BOOKING_ID, {
        reason: 'Exam conflict',
        targetSlotId: TARGET_SLOT_ID,
      });

      expect(mockPrisma.rescheduleRequest.create).toHaveBeenCalledWith({
        data: {
          bookingId: BOOKING_ID,
          fromSlotId: CURRENT_SLOT_ID,
          reason: 'Exam conflict',
          requestedById: STUDENT_ID,
          requestedSlotId: TARGET_SLOT_ID,
          status: RescheduleRequestStatus.PENDING,
        },
      });
      expect(result).toEqual({
        bookingId: BOOKING_ID,
        requestId: REQUEST_ID,
        status: RescheduleRequestStatus.PENDING,
        targetSlotId: TARGET_SLOT_ID,
      });
    });

    it('uses default reason when reason is omitted or empty', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockActiveUser(TUTOR_ID, Role.TUTOR));
      mockPrisma.booking.findUnique.mockResolvedValue(mockBooking());
      mockPrisma.rescheduleRequest.findFirst.mockResolvedValue(null);
      mockPrisma.availabilitySlot.findUnique.mockResolvedValue(mockTargetSlot());
      mockPrisma.booking.findFirst.mockResolvedValue(null);
      mockPrisma.rescheduleRequest.create.mockResolvedValue({
        bookingId: BOOKING_ID,
        id: REQUEST_ID,
        requestedSlotId: TARGET_SLOT_ID,
        status: RescheduleRequestStatus.PENDING,
      });

      await service.create(TUTOR_ID, Role.TUTOR, BOOKING_ID, {
        targetSlotId: TARGET_SLOT_ID,
      });

      expect(mockPrisma.rescheduleRequest.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          reason: DEFAULT_RESCHEDULE_REASON,
          requestedById: TUTOR_ID,
        }) as object,
      });
    });

    it('maps concurrent database conflict error to 409', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue(mockBooking());
      mockPrisma.rescheduleRequest.findFirst.mockResolvedValue(null);
      mockPrisma.availabilitySlot.findUnique.mockResolvedValue(mockTargetSlot());
      mockPrisma.booking.findFirst.mockResolvedValue(null);
      mockPrisma.rescheduleRequest.create.mockRejectedValue(
        createDatabaseError('Duplicate pending', 'P2002', '23505'),
      );

      await expect(
        service.create(STUDENT_ID, Role.STUDENT, BOOKING_ID, { targetSlotId: TARGET_SLOT_ID }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('getCurrent', () => {
    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue(mockActiveUser());
    });

    it('rejects if booking does not exist (404)', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue(null);

      await expect(service.getCurrent(STUDENT_ID, BOOKING_ID)).rejects.toThrow(NotFoundException);
    });

    it('rejects if caller is not a booking participant (403)', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue(mockBooking());

      await expect(service.getCurrent(OUTSIDER_ID, BOOKING_ID)).rejects.toThrow(ForbiddenException);
    });

    it('returns null request and CREATE allowed action when eligible without pending request', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue(
        mockBooking({
          slot: { startAtUtc: futureDate(48) },
          status: BookingStatus.CONFIRMED,
        }),
      );
      mockPrisma.rescheduleRequest.findFirst.mockResolvedValue(null);

      const result = await service.getCurrent(STUDENT_ID, BOOKING_ID);

      expect(result).toEqual({
        allowedActions: ['CREATE'],
        request: null,
        targetSlot: null,
      });
    });

    it('returns empty allowedActions when booking is inside cutoff and has no pending request', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue(
        mockBooking({
          slot: { startAtUtc: futureDate(10) }, // inside cutoff
          status: BookingStatus.CONFIRMED,
        }),
      );
      mockPrisma.rescheduleRequest.findFirst.mockResolvedValue(null);

      const result = await service.getCurrent(STUDENT_ID, BOOKING_ID);

      expect(result).toEqual({
        allowedActions: [],
        request: null,
        targetSlot: null,
      });
    });

    it('returns WITHDRAW action for the requester when pending request exists', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue(mockBooking());
      mockPrisma.rescheduleRequest.findFirst.mockResolvedValue({
        bookingId: BOOKING_ID,
        decidedAt: null,
        fromSlotId: CURRENT_SLOT_ID,
        id: REQUEST_ID,
        reason: 'Exam conflict',
        requestedAt: new Date('2026-10-15T12:00:00Z'),
        requestedById: STUDENT_ID,
        requestedSlot: {
          endAtUtc: new Date('2026-10-25T11:00:00Z'),
          id: TARGET_SLOT_ID,
          startAtUtc: new Date('2026-10-25T10:00:00Z'),
          tutorProfileId: TUTOR_ID,
        },
        requestedSlotId: TARGET_SLOT_ID,
        reviewedById: null,
        status: RescheduleRequestStatus.PENDING,
        withdrawnAt: null,
      });

      const result = await service.getCurrent(STUDENT_ID, BOOKING_ID);

      expect(result.allowedActions).toEqual(['WITHDRAW']);
      expect(result.request?.id).toBe(REQUEST_ID);
      expect(result.targetSlot?.id).toBe(TARGET_SLOT_ID);
    });

    it('returns APPROVE and REJECT actions for the counterparty when pending request exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockActiveUser(TUTOR_ID, Role.TUTOR));
      mockPrisma.booking.findUnique.mockResolvedValue(mockBooking());
      mockPrisma.rescheduleRequest.findFirst.mockResolvedValue({
        bookingId: BOOKING_ID,
        decidedAt: null,
        fromSlotId: CURRENT_SLOT_ID,
        id: REQUEST_ID,
        reason: 'Exam conflict',
        requestedAt: new Date('2026-10-15T12:00:00Z'),
        requestedById: STUDENT_ID,
        requestedSlot: {
          endAtUtc: new Date('2026-10-25T11:00:00Z'),
          id: TARGET_SLOT_ID,
          startAtUtc: new Date('2026-10-25T10:00:00Z'),
          tutorProfileId: TUTOR_ID,
        },
        requestedSlotId: TARGET_SLOT_ID,
        reviewedById: null,
        status: RescheduleRequestStatus.PENDING,
        withdrawnAt: null,
      });

      const result = await service.getCurrent(TUTOR_ID, BOOKING_ID);

      expect(result.allowedActions).toEqual(['APPROVE', 'REJECT']);
    });
  });

  describe('approve', () => {
    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue(mockActiveUser(TUTOR_ID, Role.TUTOR));
    });

    const mockPendingRequestForApprove = (overrides: Record<string, unknown> = {}) => ({
      booking: mockBooking(),
      bookingId: BOOKING_ID,
      fromSlotId: CURRENT_SLOT_ID,
      id: REQUEST_ID,
      requestedById: STUDENT_ID,
      requestedSlot: mockTargetSlot(),
      requestedSlotId: TARGET_SLOT_ID,
      status: RescheduleRequestStatus.PENDING,
      ...overrides,
    });

    it('rejects if the request does not exist (404)', async () => {
      mockPrisma.rescheduleRequest.findUnique.mockResolvedValue(null);

      await expect(service.approve(TUTOR_ID, REQUEST_ID)).rejects.toThrow(NotFoundException);
    });

    it('rejects if the caller is not a booking participant (403)', async () => {
      mockPrisma.rescheduleRequest.findUnique.mockResolvedValue(mockPendingRequestForApprove());

      await expect(service.approve(OUTSIDER_ID, REQUEST_ID)).rejects.toThrow(ForbiddenException);
    });

    it('rejects if the requester attempts to approve their own request (403)', async () => {
      mockPrisma.rescheduleRequest.findUnique.mockResolvedValue(mockPendingRequestForApprove());

      await expect(service.approve(STUDENT_ID, REQUEST_ID)).rejects.toThrow(ForbiddenException);
    });

    it('rejects if the request is not pending (409)', async () => {
      mockPrisma.rescheduleRequest.findUnique.mockResolvedValue(
        mockPendingRequestForApprove({ status: RescheduleRequestStatus.APPROVED }),
      );

      await expect(service.approve(TUTOR_ID, REQUEST_ID)).rejects.toThrow(ConflictException);
    });

    it('rejects if the booking is no longer confirmed (409)', async () => {
      mockPrisma.rescheduleRequest.findUnique.mockResolvedValue(
        mockPendingRequestForApprove({
          booking: mockBooking({ status: BookingStatus.CANCELED }),
        }),
      );

      await expect(service.approve(TUTOR_ID, REQUEST_ID)).rejects.toThrow(ConflictException);
    });

    it('rejects if current slot is inside cutoff (409)', async () => {
      mockPrisma.rescheduleRequest.findUnique.mockResolvedValue(
        mockPendingRequestForApprove({
          booking: mockBooking({
            slot: { startAtUtc: futureDate(12) },
          }),
        }),
      );

      await expect(service.approve(TUTOR_ID, REQUEST_ID)).rejects.toThrow(ConflictException);
    });

    it('rejects if target slot was soft-deleted (409)', async () => {
      mockPrisma.rescheduleRequest.findUnique.mockResolvedValue(
        mockPendingRequestForApprove({
          requestedSlot: mockTargetSlot({ deletedAt: new Date() }),
        }),
      );

      await expect(service.approve(TUTOR_ID, REQUEST_ID)).rejects.toThrow(ConflictException);
    });

    it('rejects if target slot is in the past (400)', async () => {
      mockPrisma.rescheduleRequest.findUnique.mockResolvedValue(
        mockPendingRequestForApprove({
          requestedSlot: mockTargetSlot({ startAtUtc: pastDate(1) }),
        }),
      );

      await expect(service.approve(TUTOR_ID, REQUEST_ID)).rejects.toThrow(BadRequestException);
    });

    it('rejects if target slot is already reserved by another booking (409)', async () => {
      mockPrisma.rescheduleRequest.findUnique.mockResolvedValue(mockPendingRequestForApprove());
      mockPrisma.booking.findFirst.mockResolvedValue({ id: 'competing-booking-id' });

      await expect(service.approve(TUTOR_ID, REQUEST_ID)).rejects.toThrow(ConflictException);
    });

    it('rejects on update race condition (409)', async () => {
      mockPrisma.rescheduleRequest.findUnique.mockResolvedValue(mockPendingRequestForApprove());
      mockPrisma.booking.findFirst.mockResolvedValue(null);
      mockPrisma.rescheduleRequest.updateMany.mockResolvedValue({ count: 0 }); // lost race

      await expect(service.approve(TUTOR_ID, REQUEST_ID)).rejects.toThrow(ConflictException);
    });

    it('approves request and swaps booking slot successfully', async () => {
      mockPrisma.rescheduleRequest.findUnique.mockResolvedValue(mockPendingRequestForApprove());
      mockPrisma.booking.findFirst.mockResolvedValue(null);
      mockPrisma.rescheduleRequest.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.booking.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.booking.findUniqueOrThrow.mockResolvedValue(
        mockBooking({ slotId: TARGET_SLOT_ID }),
      );

      const result = await service.approve(TUTOR_ID, REQUEST_ID);

      expect(mockPrisma.rescheduleRequest.updateMany).toHaveBeenCalledWith({
        data: expect.objectContaining({
          reviewedById: TUTOR_ID,
          status: RescheduleRequestStatus.APPROVED,
        }) as object,
        where: { id: REQUEST_ID, status: RescheduleRequestStatus.PENDING },
      });
      expect(mockPrisma.booking.updateMany).toHaveBeenCalledWith({
        data: { slotId: TARGET_SLOT_ID },
        where: {
          id: BOOKING_ID,
          slotId: CURRENT_SLOT_ID,
          status: BookingStatus.CONFIRMED,
        },
      });
      expect(result.status).toBe(RescheduleRequestStatus.APPROVED);
      expect(result.booking.slotId).toBe(TARGET_SLOT_ID);
      expect(result.newSlot.id).toBe(TARGET_SLOT_ID);
    });

    it('maps concurrent slot index conflict to 409', async () => {
      mockPrisma.rescheduleRequest.findUnique.mockResolvedValue(mockPendingRequestForApprove());
      mockPrisma.booking.findFirst.mockResolvedValue(null);
      mockPrisma.rescheduleRequest.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.booking.updateMany.mockRejectedValue(
        createDatabaseError('Booking_active_slot_key violation', 'P2002', '23505'),
      );

      await expect(service.approve(TUTOR_ID, REQUEST_ID)).rejects.toThrow(ConflictException);
    });
  });

  describe('reject', () => {
    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue(mockActiveUser(TUTOR_ID, Role.TUTOR));
    });

    const mockPendingRequestForReject = () => ({
      booking: { studentUserId: STUDENT_ID, tutorProfileId: TUTOR_ID },
      id: REQUEST_ID,
      requestedById: STUDENT_ID,
      status: RescheduleRequestStatus.PENDING,
    });

    it('rejects if request not found (404)', async () => {
      mockPrisma.rescheduleRequest.findUnique.mockResolvedValue(null);

      await expect(service.reject(TUTOR_ID, REQUEST_ID, {})).rejects.toThrow(NotFoundException);
    });

    it('rejects if caller is not a booking participant (403)', async () => {
      mockPrisma.rescheduleRequest.findUnique.mockResolvedValue(mockPendingRequestForReject());

      await expect(service.reject(OUTSIDER_ID, REQUEST_ID, {})).rejects.toThrow(ForbiddenException);
    });

    it('rejects if requester tries to reject their own request (403)', async () => {
      mockPrisma.rescheduleRequest.findUnique.mockResolvedValue(mockPendingRequestForReject());

      await expect(service.reject(STUDENT_ID, REQUEST_ID, {})).rejects.toThrow(ForbiddenException);
    });

    it('rejects if request is not pending (409)', async () => {
      mockPrisma.rescheduleRequest.findUnique.mockResolvedValue({
        ...mockPendingRequestForReject(),
        status: RescheduleRequestStatus.REJECTED,
      });

      await expect(service.reject(TUTOR_ID, REQUEST_ID, {})).rejects.toThrow(ConflictException);
    });

    it('rejects request successfully and preserves booking and slots', async () => {
      mockPrisma.rescheduleRequest.findUnique.mockResolvedValue(mockPendingRequestForReject());
      mockPrisma.rescheduleRequest.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.reject(TUTOR_ID, REQUEST_ID, {
        reason: 'Unavailable',
      });

      expect(mockPrisma.rescheduleRequest.updateMany).toHaveBeenCalledWith({
        data: expect.objectContaining({
          reviewedById: TUTOR_ID,
          status: RescheduleRequestStatus.REJECTED,
        }) as object,
        where: { id: REQUEST_ID, status: RescheduleRequestStatus.PENDING },
      });
      expect(result.status).toBe(RescheduleRequestStatus.REJECTED);
      expect(result.reviewedAt).toBeDefined();
    });
  });

  describe('withdraw', () => {
    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue(mockActiveUser(STUDENT_ID, Role.STUDENT));
    });

    const mockPendingRequestForWithdraw = () => ({
      booking: { studentUserId: STUDENT_ID, tutorProfileId: TUTOR_ID },
      id: REQUEST_ID,
      requestedById: STUDENT_ID,
      status: RescheduleRequestStatus.PENDING,
    });

    it('rejects if request not found (404)', async () => {
      mockPrisma.rescheduleRequest.findUnique.mockResolvedValue(null);

      await expect(service.withdraw(STUDENT_ID, REQUEST_ID)).rejects.toThrow(NotFoundException);
    });

    it('rejects if caller is counterparty rather than requester (403)', async () => {
      mockPrisma.rescheduleRequest.findUnique.mockResolvedValue(mockPendingRequestForWithdraw());

      await expect(service.withdraw(TUTOR_ID, REQUEST_ID)).rejects.toThrow(ForbiddenException);
    });

    it('rejects if caller is an outsider (403)', async () => {
      mockPrisma.rescheduleRequest.findUnique.mockResolvedValue(mockPendingRequestForWithdraw());

      await expect(service.withdraw(OUTSIDER_ID, REQUEST_ID)).rejects.toThrow(ForbiddenException);
    });

    it('rejects if request is not pending (409)', async () => {
      mockPrisma.rescheduleRequest.findUnique.mockResolvedValue({
        ...mockPendingRequestForWithdraw(),
        status: RescheduleRequestStatus.WITHDRAWN,
      });

      await expect(service.withdraw(STUDENT_ID, REQUEST_ID)).rejects.toThrow(ConflictException);
    });

    it('withdraws request successfully and preserves booking and slots', async () => {
      mockPrisma.rescheduleRequest.findUnique.mockResolvedValue(mockPendingRequestForWithdraw());
      mockPrisma.rescheduleRequest.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.withdraw(STUDENT_ID, REQUEST_ID);

      expect(mockPrisma.rescheduleRequest.updateMany).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: RescheduleRequestStatus.WITHDRAWN,
        }) as object,
        where: { id: REQUEST_ID, status: RescheduleRequestStatus.PENDING },
      });
      expect(result.status).toBe(RescheduleRequestStatus.WITHDRAWN);
      expect(result.withdrawnAt).toBeDefined();
    });
  });
});
