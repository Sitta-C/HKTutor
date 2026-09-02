import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

import { BookingResponseDto, CreateBookingDto } from '@/bookings/bookings.dto';
import { PrismaService } from '@/database/prisma.service';
import {
  AccountStatus,
  BookingStatus,
  ListingPublicationStatus,
  Role,
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
          throw new ConflictException('The selected slot does not exist.');
        }

        if (slot.deletedAt) {
          throw new ConflictException('The selected slot is no longer available.');
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

        const listingSelect = {
          deletedAt: true,
          id: true,
          pricePerHour: true,
          publicationStatus: true,
          tutorProfileId: true,
        } as const;

        const listing = input.listingId
          ? await tx.teachingListing.findUnique({
              where: { id: input.listingId },
              select: listingSelect,
            })
          : await tx.teachingListing.findFirst({
              where: {
                deletedAt: null,
                publicationStatus: ListingPublicationStatus.PUBLISHED,
                tutorProfileId: slot.tutorProfileId,
              },
              orderBy: { createdAt: 'desc' },
              select: listingSelect,
            });

        if (!listing) {
          throw new ConflictException('No published listing is available for this slot.');
        }

        if (listing.deletedAt || listing.publicationStatus !== ListingPublicationStatus.PUBLISHED) {
          throw new ConflictException('The selected listing is no longer available.');
        }

        if (listing.tutorProfileId !== slot.tutorProfileId) {
          throw new ConflictException('The selected slot does not belong to the selected listing.');
        }

        if (student.id === slot.tutorProfileId) {
          throw new ForbiddenException('Tutors cannot book their own slots.');
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
          currency: booking.currency,
          discountAmount: booking.discountAmount.toNumber(),
          id: booking.id,
          listingId: booking.listingId,
          netAmount: booking.netAmount.toNumber(),
          slotId: booking.slotId,
          status: booking.status,
          studentUserId: booking.studentUserId,
          subtotalAmount: booking.subtotalAmount.toNumber(),
          tutorProfileId: booking.tutorProfileId,
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
