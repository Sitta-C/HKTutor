import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import {
  AccountStatus,
  BookingStatus,
  RescheduleRequestStatus,
  Role,
} from '@generated/prisma/enums';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { CURRENT_PRIVACY_POLICY_VERSION } from '@modules/auth/auth.constants';
import { RescheduleAction } from '@modules/reschedule-requests/reschedule-requests.dto';

import type { AvailabilitySlot } from '@generated/prisma/client';
import type {
  ApproveRescheduleResponseDto,
  CreateRescheduleRequestDto,
  CreateRescheduleRequestResponseDto,
  CurrentRescheduleRequestResponseDto,
  RejectRescheduleRequestDto,
  RejectRescheduleResponseDto,
  WithdrawRescheduleResponseDto,
} from '@modules/reschedule-requests/reschedule-requests.dto';

export const RESCHEDULE_BOOKING_OWNERSHIP_ERRORS = {
  foreignOwner: {
    code: 'BOOKING_NOT_PARTICIPANT',
    message: 'This booking belongs to another user',
  },
  missing: { code: 'BOOKING_NOT_FOUND', message: 'Booking not found' },
} as const;

export const DEFAULT_RESCHEDULE_REASON = 'Reschedule requested';
export const RESCHEDULE_CUTOFF_MS = 24 * 60 * 60 * 1000;

const CONFLICTING_PRISMA_CODES = new Set(['P2002', 'P2003', 'P2004', 'P2034']);
const CONFLICTING_SQL_STATES = new Set(['23503', '23505', '40001', '40P01']);

function readProperty(value: unknown, key: string): unknown {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function readDriverSqlState(error: object): string | undefined {
  const driverError = readProperty(readProperty(error, 'meta'), 'driverAdapterError');
  const sqlState = readProperty(readProperty(driverError, 'cause'), 'originalCode');
  return typeof sqlState === 'string' ? sqlState : undefined;
}

function isDatabaseConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const { code } = error as { code?: unknown };
  if (typeof code === 'string' && CONFLICTING_PRISMA_CODES.has(code)) {
    return true;
  }
  const sqlState = readDriverSqlState(error);
  return sqlState !== undefined && CONFLICTING_SQL_STATES.has(sqlState);
}

const bookingNotFound = (): NotFoundException =>
  new NotFoundException({
    code: RESCHEDULE_BOOKING_OWNERSHIP_ERRORS.missing.code,
    error: 'Not Found',
    message: RESCHEDULE_BOOKING_OWNERSHIP_ERRORS.missing.message,
    statusCode: 404,
  });

const bookingNotParticipant = (): ForbiddenException =>
  new ForbiddenException({
    code: RESCHEDULE_BOOKING_OWNERSHIP_ERRORS.foreignOwner.code,
    error: 'Forbidden',
    message: RESCHEDULE_BOOKING_OWNERSHIP_ERRORS.foreignOwner.message,
    statusCode: 403,
  });

const bookingNotConfirmed = (status: BookingStatus): ConflictException =>
  new ConflictException({
    code: 'BOOKING_NOT_CONFIRMED',
    error: 'Conflict',
    message: `Only a confirmed booking can be rescheduled; this booking is ${status}`,
    statusCode: 409,
  });

const rescheduleCutoffExceeded = (): ConflictException =>
  new ConflictException({
    code: 'RESCHEDULE_CUTOFF_EXCEEDED',
    error: 'Conflict',
    message: 'Reschedule requests must be made and approved at least 24 hours before class start',
    statusCode: 409,
  });

const rescheduleAlreadyPending = (): ConflictException =>
  new ConflictException({
    code: 'RESCHEDULE_REQUEST_ALREADY_PENDING',
    error: 'Conflict',
    message: 'A pending reschedule request already exists for this booking',
    statusCode: 409,
  });

const rescheduleTargetNotFound = (): NotFoundException =>
  new NotFoundException({
    code: 'SLOT_NOT_FOUND',
    error: 'Not Found',
    message: 'The selected target slot does not exist',
    statusCode: 404,
  });

const rescheduleTargetUnavailable = (): ConflictException =>
  new ConflictException({
    code: 'RESCHEDULE_TARGET_UNAVAILABLE',
    error: 'Conflict',
    message: 'The target slot is no longer available',
    statusCode: 409,
  });

const rescheduleTargetReserved = (): ConflictException =>
  new ConflictException({
    code: 'RESCHEDULE_TARGET_RESERVED',
    error: 'Conflict',
    message: 'The target slot is already reserved by another booking',
    statusCode: 409,
  });

const rescheduleTargetWrongTutor = (): BadRequestException =>
  new BadRequestException({
    code: 'RESCHEDULE_WRONG_TUTOR',
    error: 'Bad Request',
    message: 'Target slot must belong to the booking tutor',
    statusCode: 400,
  });

const rescheduleTargetPast = (): BadRequestException =>
  new BadRequestException({
    code: 'RESCHEDULE_TARGET_PAST',
    error: 'Bad Request',
    message: 'Target slot must be in the future',
    statusCode: 400,
  });

const rescheduleSlotOverlap = (): BadRequestException =>
  new BadRequestException({
    code: 'RESCHEDULE_SLOT_OVERLAP',
    error: 'Bad Request',
    message: 'Target slot must not be the same as or overlap the current slot',
    statusCode: 400,
  });

const rescheduleRequestNotFound = (): NotFoundException =>
  new NotFoundException({
    code: 'RESCHEDULE_REQUEST_NOT_FOUND',
    error: 'Not Found',
    message: 'Reschedule request not found',
    statusCode: 404,
  });

const rescheduleRequestNotPending = (status: RescheduleRequestStatus): ConflictException =>
  new ConflictException({
    code: 'RESCHEDULE_REQUEST_NOT_PENDING',
    error: 'Conflict',
    message: `Only a pending reschedule request can be acted on; this request is ${status}`,
    statusCode: 409,
  });

const rescheduleNotApprover = (): ForbiddenException =>
  new ForbiddenException({
    code: 'RESCHEDULE_NOT_APPROVER',
    error: 'Forbidden',
    message: 'Only the counterparty can approve this reschedule request',
    statusCode: 403,
  });

const rescheduleNotReviewer = (): ForbiddenException =>
  new ForbiddenException({
    code: 'RESCHEDULE_NOT_REVIEWER',
    error: 'Forbidden',
    message: 'Only the counterparty can review or reject this reschedule request',
    statusCode: 403,
  });

const rescheduleNotRequester = (): ForbiddenException =>
  new ForbiddenException({
    code: 'RESCHEDULE_NOT_REQUESTER',
    error: 'Forbidden',
    message: 'Only the original requester can withdraw this reschedule request',
    statusCode: 403,
  });

const rescheduleRaceConflict = (): ConflictException =>
  new ConflictException({
    code: 'RESCHEDULE_RACE_CONFLICT',
    error: 'Conflict',
    message: 'The reschedule request was already modified by another action',
    statusCode: 409,
  });

const accountNotActive = (): ForbiddenException =>
  new ForbiddenException({
    code: 'ACCOUNT_NOT_ACTIVE',
    error: 'Forbidden',
    message: 'Only active accounts can request or act on a reschedule',
    statusCode: 403,
  });

const privacyConsentRequired = (): BadRequestException =>
  new BadRequestException({
    code: 'PRIVACY_CONSENT_REQUIRED',
    error: 'Bad Request',
    message: 'Accept the current privacy notice before requesting or acting on a reschedule',
    statusCode: 400,
  });

@Injectable()
export class RescheduleRequestsService {
  private readonly logger = new Logger(RescheduleRequestsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async assertActiveUserWithConsent(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { accountStatus: true, deletedAt: true, policyVersion: true },
    });
    if (!user || user.accountStatus !== AccountStatus.ACTIVE || user.deletedAt) {
      throw accountNotActive();
    }
    if (user.policyVersion !== CURRENT_PRIVACY_POLICY_VERSION) {
      throw privacyConsentRequired();
    }
  }

  async create(
    userId: string,
    userRole: Role,
    bookingId: string,
    dto: CreateRescheduleRequestDto,
  ): Promise<CreateRescheduleRequestResponseDto> {
    await this.assertActiveUserWithConsent(userId);

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Match the persistence protocol: lock the booking before reading eligibility.
        await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${bookingId}::uuid FOR UPDATE`;
        const booking = await tx.booking.findUnique({
          select: {
            id: true,
            slot: { select: { endAtUtc: true, id: true, startAtUtc: true, tutorProfileId: true } },
            slotId: true,
            status: true,
            studentUserId: true,
            tutorProfileId: true,
          },
          where: { id: bookingId },
        });

        if (!booking) {
          throw bookingNotFound();
        }

        const isStudent = userRole === Role.STUDENT && booking.studentUserId === userId;
        const isTutor = userRole === Role.TUTOR && booking.tutorProfileId === userId;
        if (!isStudent && !isTutor) {
          throw bookingNotParticipant();
        }

        if (booking.status !== BookingStatus.CONFIRMED) {
          throw bookingNotConfirmed(booking.status);
        }

        const now = new Date();
        if (booking.slot.startAtUtc.getTime() - now.getTime() < RESCHEDULE_CUTOFF_MS) {
          throw rescheduleCutoffExceeded();
        }

        const existingPending = await tx.rescheduleRequest.findFirst({
          select: { id: true },
          where: { bookingId: booking.id, status: RescheduleRequestStatus.PENDING },
        });
        if (existingPending) {
          throw rescheduleAlreadyPending();
        }

        if (dto.targetSlotId === booking.slotId) {
          throw rescheduleSlotOverlap();
        }

        const targetSlot = await tx.availabilitySlot.findUnique({
          select: {
            deletedAt: true,
            endAtUtc: true,
            id: true,
            startAtUtc: true,
            tutorProfileId: true,
          },
          where: { id: dto.targetSlotId },
        });

        if (!targetSlot) {
          throw rescheduleTargetNotFound();
        }
        if (targetSlot.deletedAt !== null) {
          throw rescheduleTargetUnavailable();
        }
        if (targetSlot.tutorProfileId !== booking.tutorProfileId) {
          throw rescheduleTargetWrongTutor();
        }
        if (targetSlot.startAtUtc.getTime() <= now.getTime()) {
          throw rescheduleTargetPast();
        }

        const overlapsCurrent =
          targetSlot.startAtUtc < booking.slot.endAtUtc &&
          targetSlot.endAtUtc > booking.slot.startAtUtc;
        if (overlapsCurrent) {
          throw rescheduleSlotOverlap();
        }

        const activeTargetBooking = await tx.booking.findFirst({
          select: { id: true },
          where: {
            slotId: targetSlot.id,
            status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
          },
        });
        if (activeTargetBooking) {
          throw rescheduleTargetReserved();
        }

        const trimmedReason = dto.reason?.trim();
        const reason =
          trimmedReason && trimmedReason.length > 0 ? trimmedReason : DEFAULT_RESCHEDULE_REASON;

        const created = await tx.rescheduleRequest.create({
          data: {
            bookingId: booking.id,
            fromSlotId: booking.slotId,
            reason,
            requestedById: userId,
            requestedSlotId: targetSlot.id,
            status: RescheduleRequestStatus.PENDING,
          },
        });

        return {
          bookingId: created.bookingId,
          requestId: created.id,
          status: created.status,
          targetSlotId: created.requestedSlotId,
        };
      });
    } catch (error) {
      if (isDatabaseConflict(error)) {
        this.logger.warn(
          `Rejecting reschedule request creation for booking ${bookingId}: database reported a conflict`,
        );
        throw rescheduleAlreadyPending();
      }
      throw error;
    }
  }

  async getCurrent(
    userId: string,
    bookingId: string,
  ): Promise<CurrentRescheduleRequestResponseDto> {
    await this.assertActiveUserWithConsent(userId);

    const booking = await this.prisma.booking.findUnique({
      select: {
        id: true,
        slot: { select: { endAtUtc: true, startAtUtc: true } },
        slotId: true,
        status: true,
        studentUserId: true,
        tutorProfileId: true,
      },
      where: { id: bookingId },
    });

    if (!booking) {
      throw bookingNotFound();
    }

    if (booking.studentUserId !== userId && booking.tutorProfileId !== userId) {
      throw bookingNotParticipant();
    }

    const pending = await this.prisma.rescheduleRequest.findFirst({
      include: {
        requestedSlot: {
          select: {
            bookings: {
              select: { id: true },
              take: 1,
              where: { status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] } },
            },
            deletedAt: true,
            endAtUtc: true,
            id: true,
            startAtUtc: true,
            tutorProfileId: true,
          },
        },
      },
      where: { bookingId: booking.id, status: RescheduleRequestStatus.PENDING },
    });

    const now = new Date();
    const canReschedule =
      booking.status === BookingStatus.CONFIRMED &&
      booking.slot.startAtUtc.getTime() - now.getTime() >= RESCHEDULE_CUTOFF_MS;

    if (pending) {
      const isRequester = userId === pending.requestedById;
      const canApprove =
        canReschedule &&
        pending.fromSlotId === booking.slotId &&
        pending.requestedSlot.deletedAt === null &&
        pending.requestedSlot.startAtUtc > now &&
        pending.requestedSlot.tutorProfileId === booking.tutorProfileId &&
        pending.requestedSlot.bookings.length === 0 &&
        (pending.requestedSlot.startAtUtc >= booking.slot.endAtUtc ||
          pending.requestedSlot.endAtUtc <= booking.slot.startAtUtc);
      const allowedActions: RescheduleAction[] = isRequester
        ? [RescheduleAction.WITHDRAW]
        : canApprove
          ? [RescheduleAction.APPROVE, RescheduleAction.REJECT]
          : [RescheduleAction.REJECT];

      return {
        allowedActions,
        request: {
          bookingId: pending.bookingId,
          decidedAt: pending.decidedAt ? pending.decidedAt.toISOString() : null,
          fromSlotId: pending.fromSlotId,
          id: pending.id,
          reason: pending.reason,
          requestedAt: pending.requestedAt.toISOString(),
          requestedById: pending.requestedById,
          requestedSlotId: pending.requestedSlotId,
          reviewedById: pending.reviewedById,
          status: pending.status,
          withdrawnAt: pending.withdrawnAt ? pending.withdrawnAt.toISOString() : null,
        },
        targetSlot: {
          endAtUtc: pending.requestedSlot.endAtUtc.toISOString(),
          id: pending.requestedSlot.id,
          startAtUtc: pending.requestedSlot.startAtUtc.toISOString(),
          tutorProfileId: pending.requestedSlot.tutorProfileId,
        },
      };
    }

    return {
      allowedActions: canReschedule ? [RescheduleAction.CREATE] : [],
      request: null,
      targetSlot: null,
    };
  }

  async approve(userId: string, requestId: string): Promise<ApproveRescheduleResponseDto> {
    await this.assertActiveUserWithConsent(userId);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const identity = await tx.rescheduleRequest.findUnique({
          select: { bookingId: true },
          where: { id: requestId },
        });
        if (!identity) {
          throw rescheduleRequestNotFound();
        }
        await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${identity.bookingId}::uuid FOR UPDATE`;
        // A competing decision may have committed while the booking lock was pending.
        const request = await tx.rescheduleRequest.findUnique({
          include: {
            booking: {
              select: {
                id: true,
                listingId: true,
                netAmount: true,
                slot: { select: { endAtUtc: true, startAtUtc: true } },
                slotId: true,
                status: true,
                studentUserId: true,
                subtotalAmount: true,
                tutorProfileId: true,
              },
            },
          },
          where: { id: requestId },
        });

        if (!request) {
          throw rescheduleRequestNotFound();
        }

        const isParticipant =
          request.booking.studentUserId === userId || request.booking.tutorProfileId === userId;
        if (!isParticipant) {
          throw bookingNotParticipant();
        }

        if (request.requestedById === userId) {
          throw rescheduleNotApprover();
        }

        if (request.status !== RescheduleRequestStatus.PENDING) {
          throw rescheduleRequestNotPending(request.status);
        }

        if (request.booking.status !== BookingStatus.CONFIRMED) {
          throw bookingNotConfirmed(request.booking.status);
        }
        if (request.booking.slotId !== request.fromSlotId) {
          throw rescheduleRaceConflict();
        }

        // Deletion and booking writes also lock this row. Read it under that lock so a
        // concurrent deletion becomes a domain 409 before either state is changed.
        const [targetSlot] = await tx.$queryRaw<
          Pick<
            AvailabilitySlot,
            'id' | 'tutorProfileId' | 'startAtUtc' | 'endAtUtc' | 'deletedAt'
          >[]
        >`
          SELECT "id", "tutorProfileId", "startAtUtc", "endAtUtc", "deletedAt"
          FROM "AvailabilitySlot" WHERE "id" = ${request.requestedSlotId}::uuid FOR UPDATE
        `;

        const now = new Date();
        if (request.booking.slot.startAtUtc.getTime() - now.getTime() < RESCHEDULE_CUTOFF_MS) {
          throw rescheduleCutoffExceeded();
        }

        if (!targetSlot || targetSlot.deletedAt !== null) {
          throw rescheduleTargetUnavailable();
        }
        if (targetSlot.tutorProfileId !== request.booking.tutorProfileId) {
          throw rescheduleTargetWrongTutor();
        }
        if (targetSlot.startAtUtc.getTime() <= now.getTime()) {
          throw rescheduleTargetPast();
        }
        if (
          targetSlot.id === request.fromSlotId ||
          (targetSlot.startAtUtc < request.booking.slot.endAtUtc &&
            targetSlot.endAtUtc > request.booking.slot.startAtUtc)
        ) {
          throw rescheduleSlotOverlap();
        }

        const existingBooking = await tx.booking.findFirst({
          select: { id: true },
          where: {
            slotId: targetSlot.id,
            status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
          },
        });
        if (existingBooking) {
          throw rescheduleTargetReserved();
        }

        const decidedAt = new Date();
        const requestUpdate = await tx.rescheduleRequest.updateMany({
          data: {
            decidedAt,
            reviewedById: userId,
            status: RescheduleRequestStatus.APPROVED,
          },
          where: { id: requestId, status: RescheduleRequestStatus.PENDING },
        });

        if (requestUpdate.count !== 1) {
          throw rescheduleRaceConflict();
        }

        const bookingUpdate = await tx.booking.updateMany({
          data: { slotId: request.requestedSlotId },
          where: {
            id: request.bookingId,
            slotId: request.fromSlotId,
            status: BookingStatus.CONFIRMED,
          },
        });

        if (bookingUpdate.count !== 1) {
          throw rescheduleRaceConflict();
        }

        const updatedBooking = await tx.booking.findUniqueOrThrow({
          where: { id: request.bookingId },
        });

        return {
          booking: {
            id: updatedBooking.id,
            listingId: updatedBooking.listingId,
            netAmount: updatedBooking.netAmount.toFixed(2),
            slotId: updatedBooking.slotId,
            status: updatedBooking.status,
            studentUserId: updatedBooking.studentUserId,
            subtotalAmount: updatedBooking.subtotalAmount.toFixed(2),
            tutorProfileId: updatedBooking.tutorProfileId,
            updatedAt: updatedBooking.updatedAt.toISOString(),
          },
          newSlot: {
            endAtUtc: targetSlot.endAtUtc.toISOString(),
            id: targetSlot.id,
            startAtUtc: targetSlot.startAtUtc.toISOString(),
            tutorProfileId: targetSlot.tutorProfileId,
          },
          requestId: request.id,
          status: RescheduleRequestStatus.APPROVED,
        };
      });
    } catch (error) {
      if (isDatabaseConflict(error)) {
        this.logger.warn(
          `Rejecting reschedule approval for request ${requestId}: database reported a conflict`,
        );
        throw rescheduleTargetReserved();
      }
      throw error;
    }
  }

  async reject(
    userId: string,
    requestId: string,
    dto?: RejectRescheduleRequestDto,
  ): Promise<RejectRescheduleResponseDto> {
    await this.assertActiveUserWithConsent(userId);

    if (dto?.reason) {
      this.logger.log(`Reschedule request ${requestId} rejected with reason: ${dto.reason}`);
    }

    const request = await this.prisma.rescheduleRequest.findUnique({
      include: {
        booking: { select: { studentUserId: true, tutorProfileId: true } },
      },
      where: { id: requestId },
    });

    if (!request) {
      throw rescheduleRequestNotFound();
    }

    const isParticipant =
      request.booking.studentUserId === userId || request.booking.tutorProfileId === userId;
    if (!isParticipant) {
      throw bookingNotParticipant();
    }

    if (request.requestedById === userId) {
      throw rescheduleNotReviewer();
    }

    if (request.status !== RescheduleRequestStatus.PENDING) {
      throw rescheduleRequestNotPending(request.status);
    }

    const decidedAt = new Date();
    const result = await this.prisma.rescheduleRequest.updateMany({
      data: {
        decidedAt,
        reviewedById: userId,
        status: RescheduleRequestStatus.REJECTED,
      },
      where: { id: requestId, status: RescheduleRequestStatus.PENDING },
    });

    if (result.count !== 1) {
      throw rescheduleRaceConflict();
    }

    return {
      requestId: request.id,
      reviewedAt: decidedAt.toISOString(),
      status: RescheduleRequestStatus.REJECTED,
    };
  }

  async withdraw(userId: string, requestId: string): Promise<WithdrawRescheduleResponseDto> {
    await this.assertActiveUserWithConsent(userId);

    const request = await this.prisma.rescheduleRequest.findUnique({
      include: {
        booking: { select: { studentUserId: true, tutorProfileId: true } },
      },
      where: { id: requestId },
    });

    if (!request) {
      throw rescheduleRequestNotFound();
    }

    const isParticipant =
      request.booking.studentUserId === userId || request.booking.tutorProfileId === userId;
    if (!isParticipant) {
      throw bookingNotParticipant();
    }

    if (request.requestedById !== userId) {
      throw rescheduleNotRequester();
    }

    if (request.status !== RescheduleRequestStatus.PENDING) {
      throw rescheduleRequestNotPending(request.status);
    }

    const withdrawnAt = new Date();
    const result = await this.prisma.rescheduleRequest.updateMany({
      data: {
        status: RescheduleRequestStatus.WITHDRAWN,
        withdrawnAt,
      },
      where: { id: requestId, status: RescheduleRequestStatus.PENDING },
    });

    if (result.count !== 1) {
      throw rescheduleRaceConflict();
    }

    return {
      requestId: request.id,
      status: RescheduleRequestStatus.WITHDRAWN,
      withdrawnAt: withdrawnAt.toISOString(),
    };
  }
}
