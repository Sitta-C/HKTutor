import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { BookingStatus, Prisma } from '@generated/prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { publicTutorWhere } from '@modules/tutors/public-tutor-access';
import { AvailabilityState } from '@modules/tutors/tutors.dto';

import type {
  AvailabilityPostRequestDto,
  AvailabilityPostResponseDto,
  AvailabilityPrivateQueryDto,
  AvailabilityPrivateResponseDto,
  AvailabilityPublicResponseDto,
  AvailabilityQueryDto,
} from '@modules/tutors/tutors.dto';

const activeBookingStatuses: BookingStatus[] = [BookingStatus.PENDING, BookingStatus.CONFIRMED];
const activeBookingWhere = {
  status: { in: activeBookingStatuses },
} satisfies Prisma.BookingWhereInput;

const invalidTimeRange = (message: string): BadRequestException =>
  new BadRequestException({
    code: 'INVALID_TIME_RANGE',
    error: 'Bad Request',
    message,
    statusCode: 400,
  });

const availabilityOverlap = (): ConflictException =>
  new ConflictException({
    code: 'AVAILABILITY_OVERLAP',
    error: 'Conflict',
    message: 'Availability slot overlaps an existing slot',
    statusCode: 409,
  });

const slotNotFound = (): NotFoundException =>
  new NotFoundException({
    code: 'SLOT_NOT_FOUND',
    error: 'Not Found',
    message: 'Availability slot not found',
    statusCode: 404,
  });

const slotReserved = (): ConflictException =>
  new ConflictException({
    code: 'SLOT_RESERVED',
    error: 'Conflict',
    message: 'Availability slot has an active booking',
    statusCode: 409,
  });

const tutorNotFound = (): NotFoundException =>
  new NotFoundException({
    code: 'TUTOR_NOT_FOUND',
    error: 'Not Found',
    message: 'Published tutor not found',
    statusCode: 404,
  });

const isRecordNotFound = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2025';

const isConstraintViolation = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;
  if ('code' in error && error.code === 'P2004') return true;

  return (
    'message' in error &&
    typeof error.message === 'string' &&
    (error.message.includes('AvailabilitySlot_no_overlap_excl') ||
      error.message.includes('AvailabilitySlot_active_booking_delete_check'))
  );
};

@Injectable()
export class TutorAvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async getAvailabilityPrivate(
    userId: string,
    query: AvailabilityPrivateQueryDto,
  ): Promise<AvailabilityPrivateResponseDto[]> {
    this.validateAvailabilityRange(query);

    const availabilities = await this.prisma.availabilitySlot.findMany({
      select: {
        id: true,
        startAtUtc: true,
        endAtUtc: true,
        createdAt: true,
        bookings: {
          select: { id: true },
          take: 1,
          where: activeBookingWhere,
        },
      },
      where: {
        tutorProfileId: userId,
        deletedAt: null,
        ...this.availabilityRangeWhere(query),
      },
      orderBy: [{ startAtUtc: 'asc' }, { endAtUtc: 'asc' }],
    });

    return availabilities.map((availability) => ({
      id: availability.id,
      startAtUtc: availability.startAtUtc,
      endAtUtc: availability.endAtUtc,
      createdAt: availability.createdAt,
      state: availability.bookings.length > 0 ? AvailabilityState.RESERVED : AvailabilityState.OPEN,
    }));
  }

  async getAvailabilityPublic(
    tutorId: string,
    query: AvailabilityQueryDto,
  ): Promise<AvailabilityPublicResponseDto[]> {
    this.validateAvailabilityRange(query);

    const tutor = await this.prisma.tutorProfile.findFirst({
      select: { userId: true },
      where: { ...publicTutorWhere, userId: tutorId },
    });
    if (!tutor) throw tutorNotFound();

    const now = new Date();
    const from = query.from !== undefined && query.from > now ? query.from : now;

    return this.prisma.availabilitySlot.findMany({
      orderBy: [{ startAtUtc: 'asc' }, { endAtUtc: 'asc' }],
      select: {
        endAtUtc: true,
        id: true,
        startAtUtc: true,
      },
      where: {
        bookings: { none: activeBookingWhere },
        deletedAt: null,
        startAtUtc: {
          gte: from,
          ...(query.to !== undefined && { lt: query.to }),
        },
        tutorProfileId: tutorId,
      },
    });
  }

  async postAvailability(
    userId: string,
    request: AvailabilityPostRequestDto,
  ): Promise<AvailabilityPostResponseDto> {
    if (request.endAt <= request.startAt) {
      throw invalidTimeRange('endAt must be later than startAt');
    }

    if (
      (await this.prisma.availabilitySlot.count({
        where: {
          deletedAt: null,
          endAtUtc: { gt: request.startAt },
          startAtUtc: { lt: request.endAt },
          tutorProfileId: userId,
        },
      })) > 0
    ) {
      throw availabilityOverlap();
    }

    try {
      const availability = await this.prisma.availabilitySlot.create({
        data: {
          endAtUtc: request.endAt,
          startAtUtc: request.startAt,
          tutorProfileId: userId,
        },
      });

      return {
        endAtUtc: availability.endAtUtc,
        id: availability.id,
        startAtUtc: availability.startAtUtc,
        tutorProfileId: availability.tutorProfileId,
      };
    } catch (error) {
      if (isConstraintViolation(error)) throw availabilityOverlap();
      throw error;
    }
  }

  async deleteAvailability(userId: string, slotId: string): Promise<void> {
    const availability = await this.prisma.availabilitySlot.findFirst({
      select: {
        bookings: {
          select: { id: true },
          take: 1,
          where: activeBookingWhere,
        },
      },
      where: {
        deletedAt: null,
        id: slotId,
        tutorProfileId: userId,
      },
    });

    if (!availability) throw slotNotFound();
    if (availability.bookings.length > 0) throw slotReserved();

    try {
      await this.prisma.availabilitySlot.update({
        where: {
          deletedAt: null,
          id: slotId,
          tutorProfileId: userId,
        },
        data: {
          deletedAt: new Date(),
        },
      });
    } catch (error) {
      if (isRecordNotFound(error)) throw slotNotFound();
      if (isConstraintViolation(error)) throw slotReserved();
      throw error;
    }
  }

  private availabilityRangeWhere(
    query: AvailabilityPrivateQueryDto,
  ): Prisma.AvailabilitySlotWhereInput {
    if (query.from === undefined && query.to === undefined) return {};

    if (query.rangeMode === 'overlap') {
      return {
        ...(query.from !== undefined && { endAtUtc: { gt: query.from } }),
        ...(query.to !== undefined && { startAtUtc: { lt: query.to } }),
      };
    }

    return {
      startAtUtc: {
        ...(query.from !== undefined && { gte: query.from }),
        ...(query.to !== undefined && { lt: query.to }),
      },
    };
  }

  private validateAvailabilityRange(query: AvailabilityQueryDto): void {
    if (query.from !== undefined && query.to !== undefined && query.to <= query.from) {
      throw invalidTimeRange('to must be later than from');
    }
  }
}
