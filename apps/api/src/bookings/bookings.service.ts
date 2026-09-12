import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  BookingDetailResponseDto,
  BookingQuoteResponseDto,
  BookingResponseDto,
  CreateBookingDto,
  GetBookingQuoteQueryDto,
  GetMyBookingsQueryDto,
  GetTutorBookingsQueryDto,
  MyBookingsResponseDto,
  TutorBookingsResponseDto,
} from '@/bookings/bookings.dto';
import { PrismaService } from '@/database/prisma.service';
import { Prisma } from '@/generated/prisma/client';
import {
  AccountStatus,
  BookingStatus,
  ListingPublicationStatus,
  Role,
  TutorVerificationStatus,
} from '@/generated/prisma/enums';

export type CreateBookingInput = CreateBookingDto & { studentUserId: string };
export type GetBookingQuoteInput = GetBookingQuoteQueryDto & { studentUserId: string };
export type GetMyBookingsInput = GetMyBookingsQueryDto & { studentUserId: string };
export interface GetMyBookingDetailInput {
  bookingId: string;
  studentUserId: string;
}
export type GetTutorBookingsInput = GetTutorBookingsQueryDto & { tutorUserId: string };

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;
const BOOKING_CONFLICT_MESSAGE =
  'The selected slot could not be booked because its availability changed.';

@Injectable()
export class BookingsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateBookingInput): Promise<BookingResponseDto> {
    if (!input.studentUserId) {
      throw new BadRequestException('studentUserId is required to create a booking');
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<
          Array<{
            id: string;
            tutorProfileId: string;
            startAtUtc: Date;
            endAtUtc: Date;
            deletedAt: Date | null;
          }>
        >`SELECT "id", "tutorProfileId", "startAtUtc", "endAtUtc", "deletedAt"
          FROM "AvailabilitySlot"
          WHERE "id" = ${input.slotId}
          FOR UPDATE`;

        const slot = rows[0];
        if (!slot) {
          throw new NotFoundException('The selected slot does not exist.');
        }

        if (slot.deletedAt) {
          throw new ConflictException('The selected slot is no longer available.');
        }

        if (slot.startAtUtc.getTime() <= Date.now()) {
          throw new BadRequestException('The selected slot has already started or is in the past.');
        }

        const activeBooking = await tx.booking.findFirst({
          where: {
            slotId: input.slotId,
            status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
          },
          select: { id: true },
        });

        if (activeBooking) {
          throw new ConflictException('The selected slot is already booked.');
        }

        const student = await tx.user.findUnique({
          where: { id: input.studentUserId },
          select: {
            accountStatus: true,
            deletedAt: true,
            id: true,
            role: true,
            studentProfile: { select: { nickname: true } },
          },
        });

        if (
          !student ||
          student.role !== Role.STUDENT ||
          student.accountStatus !== AccountStatus.ACTIVE ||
          student.deletedAt
        ) {
          throw new ForbiddenException('Only active students can create bookings.');
        }

        if (student.studentProfile === null) {
          throw new ForbiddenException(
            'Students must complete their profile before creating a booking.',
          );
        }

        const listing = await tx.teachingListing.findUnique({
          where: { id: input.listingId },
          select: {
            deletedAt: true,
            id: true,
            pricePerHour: true,
            publicationStatus: true,
            tutorProfileId: true,
          },
        });

        if (!listing) {
          throw new NotFoundException('The selected listing does not exist.');
        }

        if (listing.deletedAt || listing.publicationStatus !== ListingPublicationStatus.PUBLISHED) {
          throw new ConflictException('The selected listing is no longer available.');
        }

        if (listing.tutorProfileId !== slot.tutorProfileId) {
          throw new ConflictException('The selected slot does not belong to the selected listing.');
        }

        const tutorProfile = await tx.tutorProfile.findUnique({
          where: { userId: listing.tutorProfileId },
          select: { verificationStatus: true },
        });

        if (!tutorProfile || tutorProfile.verificationStatus !== TutorVerificationStatus.VERIFIED) {
          throw new ConflictException(
            'The selected listing is not currently available for booking.',
          );
        }

        if (student.id === slot.tutorProfileId) {
          throw new BadRequestException('Tutors cannot book their own slots.');
        }

        const amounts = deriveBookingAmounts(listing.pricePerHour, slot);

        const booking = await tx.booking.create({
          data: {
            currency: amounts.currency,
            discountAmount: amounts.discountAmount,
            listingId: listing.id,
            netAmount: amounts.netAmount,
            slotId: input.slotId,
            status: BookingStatus.PENDING,
            studentUserId: input.studentUserId,
            subtotalAmount: amounts.subtotalAmount,
            tutorProfileId: slot.tutorProfileId,
          },
        });

        return {
          createdAt: booking.createdAt.toISOString(),
          currency: booking.currency,
          discountAmount: booking.discountAmount.toFixed(2),
          id: booking.id,
          listingId: booking.listingId,
          netAmount: booking.netAmount.toFixed(2),
          slotId: booking.slotId,
          status: booking.status,
          subtotalAmount: booking.subtotalAmount.toFixed(2),
        };
      });

      return result;
    } catch (error) {
      if (isDatabaseConflict(error)) {
        throw new ConflictException(BOOKING_CONFLICT_MESSAGE);
      }

      throw error;
    }
  }

  async getQuote(input: GetBookingQuoteInput): Promise<BookingQuoteResponseDto> {
    if (!input.studentUserId) {
      throw new BadRequestException('studentUserId is required to request a quote');
    }

    const slot = await this.prisma.availabilitySlot.findUnique({
      where: { id: input.slotId },
      select: { deletedAt: true, endAtUtc: true, id: true, startAtUtc: true, tutorProfileId: true },
    });

    if (!slot) {
      throw new NotFoundException('The selected slot does not exist.');
    }

    if (slot.deletedAt) {
      throw new ConflictException('The selected slot is no longer available.');
    }

    if (slot.startAtUtc.getTime() <= Date.now()) {
      throw new BadRequestException('The selected slot has already started or is in the past.');
    }

    const activeBooking = await this.prisma.booking.findFirst({
      where: {
        slotId: input.slotId,
        status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
      },
      select: { id: true },
    });

    if (activeBooking) {
      throw new ConflictException('The selected slot is already booked.');
    }

    const student = await this.prisma.user.findUnique({
      where: { id: input.studentUserId },
      select: {
        accountStatus: true,
        deletedAt: true,
        id: true,
        role: true,
        studentProfile: { select: { nickname: true } },
      },
    });

    if (
      !student ||
      student.role !== Role.STUDENT ||
      student.accountStatus !== AccountStatus.ACTIVE ||
      student.deletedAt
    ) {
      throw new ForbiddenException('Only active students can request a quote.');
    }

    if (student.studentProfile === null) {
      throw new ForbiddenException(
        'Students must complete their profile before requesting a quote.',
      );
    }

    const listing = await this.prisma.teachingListing.findUnique({
      where: { id: input.listingId },
      select: {
        deletedAt: true,
        description: true,
        gradeLevel: { select: { id: true, name: true } },
        id: true,
        pricePerHour: true,
        publicationStatus: true,
        subject: { select: { id: true, name: true } },
        tutorProfileId: true,
      },
    });

    if (!listing) {
      throw new NotFoundException('The selected listing does not exist.');
    }

    if (listing.deletedAt || listing.publicationStatus !== ListingPublicationStatus.PUBLISHED) {
      throw new ConflictException('The selected listing is no longer available.');
    }

    if (listing.tutorProfileId !== slot.tutorProfileId) {
      throw new ConflictException('The selected slot does not belong to the selected listing.');
    }

    const tutorProfile = await this.prisma.tutorProfile.findUnique({
      where: { userId: listing.tutorProfileId },
      select: { displayName: true, verificationStatus: true },
    });

    if (!tutorProfile || tutorProfile.verificationStatus !== TutorVerificationStatus.VERIFIED) {
      throw new ConflictException('The selected listing is not currently available for booking.');
    }

    const amounts = deriveBookingAmounts(listing.pricePerHour, slot);

    return {
      currency: amounts.currency,
      discountAmount: amounts.discountAmount.toFixed(2),
      listing: {
        description: listing.description,
        gradeLevelId: listing.gradeLevel.id,
        gradeLevelName: listing.gradeLevel.name,
        id: listing.id,
        pricePerHour: listing.pricePerHour.toFixed(2),
        subjectId: listing.subject.id,
        subjectName: listing.subject.name,
      },
      netAmount: amounts.netAmount.toFixed(2),
      slot: {
        endAtUtc: slot.endAtUtc.toISOString(),
        id: slot.id,
        startAtUtc: slot.startAtUtc.toISOString(),
      },
      subtotalAmount: amounts.subtotalAmount.toFixed(2),
      tutor: {
        displayName: tutorProfile.displayName,
        tutorId: listing.tutorProfileId,
      },
    };
  }

  async getMyBookings(input: GetMyBookingsInput): Promise<MyBookingsResponseDto> {
    if (!input.studentUserId) {
      throw new BadRequestException('studentUserId is required to list bookings');
    }

    if (input.from && input.to && new Date(input.from).getTime() > new Date(input.to).getTime()) {
      throw new BadRequestException('from must not be later than to');
    }

    const where: Prisma.BookingWhereInput = {
      studentUserId: input.studentUserId,
      ...(input.status ? { status: input.status } : {}),
      ...(input.from || input.to
        ? {
            slot: {
              startAtUtc: {
                ...(input.from ? { gte: new Date(input.from) } : {}),
                ...(input.to ? { lte: new Date(input.to) } : {}),
              },
            },
          }
        : {}),
    };

    const [bookings, total] = await Promise.all([
      this.prisma.booking.findMany({
        orderBy: { createdAt: 'desc' },
        select: {
          createdAt: true,
          currency: true,
          discountAmount: true,
          id: true,
          listing: {
            select: {
              description: true,
              gradeLevel: { select: { id: true, name: true } },
              id: true,
              pricePerHour: true,
              subject: { select: { id: true, name: true } },
            },
          },
          netAmount: true,
          slot: { select: { endAtUtc: true, id: true, startAtUtc: true } },
          status: true,
          subtotalAmount: true,
          tutorProfile: { select: { displayName: true, userId: true } },
        },
        where,
      }),
      this.prisma.booking.count({ where }),
    ]);

    return {
      items: bookings.map((booking) => ({
        createdAt: booking.createdAt.toISOString(),
        currency: booking.currency,
        discountAmount: booking.discountAmount.toFixed(2),
        id: booking.id,
        listing: {
          description: booking.listing.description,
          gradeLevelId: booking.listing.gradeLevel.id,
          gradeLevelName: booking.listing.gradeLevel.name,
          id: booking.listing.id,
          pricePerHour: booking.listing.pricePerHour.toFixed(2),
          subjectId: booking.listing.subject.id,
          subjectName: booking.listing.subject.name,
        },
        netAmount: booking.netAmount.toFixed(2),
        slot: {
          endAtUtc: booking.slot.endAtUtc.toISOString(),
          id: booking.slot.id,
          startAtUtc: booking.slot.startAtUtc.toISOString(),
        },
        status: booking.status,
        subtotalAmount: booking.subtotalAmount.toFixed(2),
        tutor: {
          displayName: booking.tutorProfile.displayName,
          tutorId: booking.tutorProfile.userId,
        },
      })),
      total,
    };
  }

  async getMyBookingById(input: GetMyBookingDetailInput): Promise<BookingDetailResponseDto> {
    const booking = await this.prisma.booking.findFirst({
      select: {
        createdAt: true,
        currency: true,
        discountAmount: true,
        id: true,
        listing: {
          select: {
            description: true,
            gradeLevel: { select: { id: true, name: true } },
            id: true,
            pricePerHour: true,
            subject: { select: { id: true, name: true } },
          },
        },
        netAmount: true,
        slot: { select: { endAtUtc: true, id: true, startAtUtc: true } },
        status: true,
        subtotalAmount: true,
        tutorProfile: { select: { displayName: true, userId: true } },
        updatedAt: true,
      },
      where: { id: input.bookingId, studentUserId: input.studentUserId },
    });

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    return {
      createdAt: booking.createdAt.toISOString(),
      currency: booking.currency,
      discountAmount: booking.discountAmount.toFixed(2),
      id: booking.id,
      listing: {
        description: booking.listing.description,
        gradeLevelId: booking.listing.gradeLevel.id,
        gradeLevelName: booking.listing.gradeLevel.name,
        id: booking.listing.id,
        pricePerHour: booking.listing.pricePerHour.toFixed(2),
        subjectId: booking.listing.subject.id,
        subjectName: booking.listing.subject.name,
      },
      netAmount: booking.netAmount.toFixed(2),
      slot: {
        endAtUtc: booking.slot.endAtUtc.toISOString(),
        id: booking.slot.id,
        startAtUtc: booking.slot.startAtUtc.toISOString(),
      },
      status: booking.status,
      subtotalAmount: booking.subtotalAmount.toFixed(2),
      tutor: {
        displayName: booking.tutorProfile.displayName,
        tutorId: booking.tutorProfile.userId,
      },
      updatedAt: booking.updatedAt.toISOString(),
    };
  }

  async getTutorBookings(input: GetTutorBookingsInput): Promise<TutorBookingsResponseDto> {
    if (!input.tutorUserId) {
      throw new BadRequestException('tutorUserId is required to list bookings');
    }

    if (input.from && input.to && new Date(input.from).getTime() > new Date(input.to).getTime()) {
      throw new BadRequestException('from must not be later than to');
    }

    const where: Prisma.BookingWhereInput = {
      tutorProfileId: input.tutorUserId,
      ...(input.status ? { status: input.status } : {}),
      ...(input.from || input.to
        ? {
            slot: {
              startAtUtc: {
                ...(input.from ? { gte: new Date(input.from) } : {}),
                ...(input.to ? { lte: new Date(input.to) } : {}),
              },
            },
          }
        : {}),
    };

    const [bookings, total] = await Promise.all([
      this.prisma.booking.findMany({
        orderBy: { createdAt: 'desc' },
        select: {
          createdAt: true,
          currency: true,
          discountAmount: true,
          id: true,
          listing: {
            select: {
              description: true,
              gradeLevel: { select: { id: true, name: true } },
              id: true,
              pricePerHour: true,
              subject: { select: { id: true, name: true } },
            },
          },
          netAmount: true,
          slot: { select: { endAtUtc: true, id: true, startAtUtc: true } },
          status: true,
          student: { select: { studentProfile: { select: { nickname: true } } } },
          subtotalAmount: true,
        },
        where,
      }),
      this.prisma.booking.count({ where }),
    ]);

    return {
      items: bookings.map((booking) => ({
        createdAt: booking.createdAt.toISOString(),
        currency: booking.currency,
        discountAmount: booking.discountAmount.toFixed(2),
        id: booking.id,
        listing: {
          description: booking.listing.description,
          gradeLevelId: booking.listing.gradeLevel.id,
          gradeLevelName: booking.listing.gradeLevel.name,
          id: booking.listing.id,
          pricePerHour: booking.listing.pricePerHour.toFixed(2),
          subjectId: booking.listing.subject.id,
          subjectName: booking.listing.subject.name,
        },
        netAmount: booking.netAmount.toFixed(2),
        slot: {
          endAtUtc: booking.slot.endAtUtc.toISOString(),
          id: booking.slot.id,
          startAtUtc: booking.slot.startAtUtc.toISOString(),
        },
        status: booking.status,
        student: { nickname: booking.student.studentProfile!.nickname },
        subtotalAmount: booking.subtotalAmount.toFixed(2),
      })),
      total,
    };
  }
}

function isDatabaseConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const code = String((error as { code?: string }).code ?? '');
  return ['P2002', 'P2003', 'P2004', '23503', '23505', '23514'].includes(code);
}

function deriveBookingAmounts(
  pricePerHour: Prisma.Decimal,
  slot: { endAtUtc: Date; startAtUtc: Date },
): {
  currency: 'THB';
  discountAmount: Prisma.Decimal;
  netAmount: Prisma.Decimal;
  subtotalAmount: Prisma.Decimal;
} {
  const durationMs = slot.endAtUtc.getTime() - slot.startAtUtc.getTime();

  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new ConflictException('The selected slot has an invalid duration.');
  }

  const subtotalAmount = new Prisma.Decimal(pricePerHour)
    .mul(durationMs)
    .div(MILLISECONDS_PER_HOUR)
    .toDecimalPlaces(2);
  const discountAmount = new Prisma.Decimal(0);

  return {
    currency: 'THB',
    discountAmount,
    netAmount: subtotalAmount.minus(discountAmount),
    subtotalAmount,
  };
}
