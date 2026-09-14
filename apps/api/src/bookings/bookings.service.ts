import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import {
  BookingDetailResponseDto,
  BookingQuoteResponseDto,
  BookingResponseDto,
  CreateBookingDto,
  DEFAULT_BOOKINGS_PAGE,
  DEFAULT_BOOKINGS_PAGE_SIZE,
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
} from '@/generated/prisma/enums';
import { isPublicTutorVerificationStatus, publicTutorWhere } from '@/tutors/public-tutor-access';

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

const bookingListingSelect = {
  deletedAt: true,
  description: true,
  gradeLevel: { select: { id: true, name: true } },
  id: true,
  pricePerHour: true,
  publicationStatus: true,
  subject: { select: { id: true, name: true } },
  tutorProfileId: true,
} satisfies Prisma.TeachingListingSelect;

type BookingListing = Prisma.TeachingListingGetPayload<{ select: typeof bookingListingSelect }>;
type BookingValidationClient = Pick<
  Prisma.TransactionClient,
  'booking' | 'teachingListing' | 'tutorProfile' | 'user'
>;
type BookableSlot = {
  deletedAt: Date | null;
  endAtUtc: Date;
  id: string;
  startAtUtc: Date;
  tutorProfileId: string;
};
type BookingValidationIntent = 'create' | 'quote';

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

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
        this.assertBookableSlot(slot);
        const { amounts, listing } = await this.validateBookingSelection(tx, input, slot, 'create');

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

    this.assertBookableSlot(slot);
    const { amounts, listing, tutorProfile } = await this.validateBookingSelection(
      this.prisma,
      input,
      slot,
      'quote',
    );

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
        verificationStatus: tutorProfile.verificationStatus,
      },
    };
  }

  private assertBookableSlot(slot: BookableSlot | null | undefined): asserts slot is BookableSlot {
    if (!slot) {
      throw new NotFoundException('The selected slot does not exist.');
    }
    if (slot.deletedAt) {
      throw new ConflictException('The selected slot is no longer available.');
    }
    if (slot.startAtUtc.getTime() <= Date.now()) {
      throw new BadRequestException('The selected slot has already started or is in the past.');
    }
  }

  private async validateBookingSelection(
    client: BookingValidationClient,
    input: CreateBookingInput | GetBookingQuoteInput,
    slot: BookableSlot,
    intent: BookingValidationIntent,
  ): Promise<{
    amounts: ReturnType<typeof deriveBookingAmounts>;
    listing: BookingListing;
    tutorProfile: { displayName: string; verificationStatus: 'VERIFIED' };
  }> {
    const activeBooking = await client.booking.findFirst({
      where: {
        slotId: input.slotId,
        status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
      },
      select: { id: true },
    });
    if (activeBooking) {
      throw new ConflictException('The selected slot is already booked.');
    }

    const student = await client.user.findUnique({
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
      throw new ForbiddenException(
        intent === 'create'
          ? 'Only active students can create bookings.'
          : 'Only active students can request a quote.',
      );
    }
    if (student.studentProfile === null) {
      throw new ForbiddenException(
        intent === 'create'
          ? 'Students must complete their profile before creating a booking.'
          : 'Students must complete their profile before requesting a quote.',
      );
    }

    const listing = await client.teachingListing.findUnique({
      where: { id: input.listingId },
      select: bookingListingSelect,
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

    const tutorProfile = await client.tutorProfile.findFirst({
      where: { ...publicTutorWhere, userId: listing.tutorProfileId },
      select: { displayName: true, verificationStatus: true },
    });
    if (!tutorProfile || !isPublicTutorVerificationStatus(tutorProfile.verificationStatus)) {
      if (tutorProfile) {
        this.logger.warn(
          `Rejecting booking selection for tutor ${listing.tutorProfileId} with unexpected verification status ${tutorProfile.verificationStatus}`,
        );
      }
      throw new ConflictException('The selected listing is not currently available for booking.');
    }

    return {
      amounts: deriveBookingAmounts(listing.pricePerHour, slot),
      listing,
      tutorProfile: {
        displayName: tutorProfile.displayName,
        verificationStatus: tutorProfile.verificationStatus,
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

    const pagination = bookingPagination(input);
    const [bookings, total] = await Promise.all([
      this.prisma.booking.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
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
        skip: pagination.skip,
        take: pagination.take,
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

    const pagination = bookingPagination(input);
    const [bookings, total] = await Promise.all([
      this.prisma.booking.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
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
        skip: pagination.skip,
        take: pagination.take,
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
        student: { nickname: booking.student.studentProfile?.nickname ?? null },
        subtotalAmount: booking.subtotalAmount.toFixed(2),
      })),
      total,
    };
  }
}

function bookingPagination(input: { page?: number; pageSize?: number }): {
  skip: number;
  take: number;
} {
  const page = input.page ?? DEFAULT_BOOKINGS_PAGE;
  const take = input.pageSize ?? DEFAULT_BOOKINGS_PAGE_SIZE;
  return { skip: (page - 1) * take, take };
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
