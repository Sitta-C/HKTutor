import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { BookingResponseDto, CreateBookingDto } from '@/bookings/bookings.dto';
import { PrismaService } from '@/database/prisma.service';
import {
  AccountStatus,
  BookingStatus,
  ListingPublicationStatus,
  Role,
  TutorVerificationStatus,
} from '@/generated/prisma/enums';

export type CreateBookingInput = CreateBookingDto & { studentUserId: string };

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
          },
        });

        if (!student || student.role !== Role.STUDENT || student.accountStatus !== AccountStatus.ACTIVE || student.deletedAt) {
          throw new ForbiddenException('Only active students can create bookings.');
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
          throw new ConflictException('The selected listing is not currently available for booking.');
        }

        if (student.id === slot.tutorProfileId) {
          throw new BadRequestException('Tutors cannot book their own slots.');
        }

        const booking = await tx.booking.create({
          data: {
            currency: 'THB',
            discountAmount: 0,
            listingId: listing.id,
            netAmount: listing.pricePerHour,
            slotId: input.slotId,
            status: BookingStatus.PENDING,
            studentUserId: input.studentUserId,
            subtotalAmount: listing.pricePerHour,
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
        const message = formatDatabaseConflict(error);
        throw new ConflictException(message);
      }

      throw error;
    }
  }
}

function isDatabaseConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const code = String((error as { code?: string }).code ?? '');
  return ['23503', '23505', '23514'].includes(code);
}

function formatDatabaseConflict(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return 'The selected slot could not be booked.';
  }

  const message = String((error as { message?: string }).message ?? '');
  if (message) {
    return message;
  }

  return 'The selected slot could not be booked.';
}
