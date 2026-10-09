import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '@generated/prisma/client';
import {
  AccountStatus,
  BookingStatus,
  ListingPublicationStatus,
  PaymentStatus,
  Role,
} from '@generated/prisma/enums';
import { PrismaService } from '@infrastructure/database/prisma.service';
import {
  BookingDetailResponseDto,
  BookingQuoteResponseDto,
  BookingResponseDto,
  BookingSlotStatus,
  ConfirmBookingDto,
  CreateBookingDto,
  CreateMockPaymentDto,
  DEFAULT_BOOKINGS_PAGE,
  DEFAULT_BOOKINGS_PAGE_SIZE,
  GetBookingQuoteQueryDto,
  GetMyBookingsQueryDto,
  GetTutorBookingsQueryDto,
  MockPaymentResponseDto,
  MyBookingsResponseDto,
  RejectBookingDto,
  TutorBookingActionResponseDto,
  TutorBookingsResponseDto,
} from '@modules/bookings/bookings.dto';
import {
  isPublicTutorVerificationStatus,
  publicTutorWhere,
} from '@modules/tutors/public-tutor-access';

export type CreateBookingInput = CreateBookingDto & { studentUserId: string };
export type GetBookingQuoteInput = GetBookingQuoteQueryDto & { studentUserId: string };
export type GetMyBookingsInput = GetMyBookingsQueryDto & { studentUserId: string };
export interface GetMyBookingDetailInput {
  bookingId: string;
  studentUserId: string;
}
export type GetTutorBookingsInput = GetTutorBookingsQueryDto & { tutorUserId: string };
export interface TutorBookingActionInput {
  bookingId: string;
  tutorUserId: string;
}
export type ConfirmTutorBookingInput = TutorBookingActionInput & ConfirmBookingDto;
export type RejectTutorBookingInput = TutorBookingActionInput & RejectBookingDto;
export type CreateMockPaymentInput = CreateMockPaymentDto & {
  bookingId: string;
  studentUserId: string;
};

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;
const BOOKING_CONFLICT_MESSAGE =
  'The selected slot could not be booked because its availability changed.';
/** The database requires a non-empty cancellation reason, but the card keeps `reason` optional. */
const DEFAULT_REJECTION_REASON = 'Rejected by the tutor';

/**
 * Shared with the controller's ownership rule so `ResourceOwnershipGuard` and this service answer a
 * missing or foreign booking with the same body, whichever one rejects the request first.
 */
export const BOOKING_OWNERSHIP_ERRORS = {
  foreignOwner: { code: 'BOOKING_NOT_OWNED', message: 'This booking belongs to another tutor' },
  missing: { code: 'BOOKING_NOT_FOUND', message: 'Booking not found' },
} as const;

/**
 * The student payment route reports a foreign booking as 403 rather than the ownership-safe 404,
 * so the guard and this service answer with the same body whichever rejects the request first.
 */
export const STUDENT_BOOKING_OWNERSHIP_ERRORS = {
  foreignOwner: { code: 'BOOKING_NOT_OWNED', message: 'This booking belongs to another student' },
  missing: { code: 'BOOKING_NOT_FOUND', message: 'Booking not found' },
} as const;

const bookingNotFound = (): NotFoundException =>
  new NotFoundException({
    code: BOOKING_OWNERSHIP_ERRORS.missing.code,
    error: 'Not Found',
    message: BOOKING_OWNERSHIP_ERRORS.missing.message,
    statusCode: 404,
  });

const bookingNotOwned = (): ForbiddenException =>
  new ForbiddenException({
    code: BOOKING_OWNERSHIP_ERRORS.foreignOwner.code,
    error: 'Forbidden',
    message: BOOKING_OWNERSHIP_ERRORS.foreignOwner.message,
    statusCode: 403,
  });

const bookingNotPending = (status: BookingStatus): ConflictException =>
  new ConflictException({
    code: 'BOOKING_NOT_PENDING',
    error: 'Conflict',
    message: `Only a pending booking can be confirmed or rejected; this booking is ${status}`,
    statusCode: 409,
  });

const bookingTransitionConflict = (): ConflictException =>
  new ConflictException({
    code: 'BOOKING_TRANSITION_CONFLICT',
    error: 'Conflict',
    message: 'The booking was already updated by another request',
    statusCode: 409,
  });

const studentBookingNotOwned = (): ForbiddenException =>
  new ForbiddenException({
    code: STUDENT_BOOKING_OWNERSHIP_ERRORS.foreignOwner.code,
    error: 'Forbidden',
    message: STUDENT_BOOKING_OWNERSHIP_ERRORS.foreignOwner.message,
    statusCode: 403,
  });

const bookingNotPayable = (status: BookingStatus): ConflictException =>
  new ConflictException({
    code: 'BOOKING_NOT_PAYABLE',
    error: 'Conflict',
    message: `Only a confirmed booking can be paid; this booking is ${status}`,
    statusCode: 409,
  });

const bookingAlreadyPaid = (): ConflictException =>
  new ConflictException({
    code: 'BOOKING_ALREADY_PAID',
    error: 'Conflict',
    message: 'This booking is already paid',
    statusCode: 409,
  });

const mockReferenceTaken = (): ConflictException =>
  new ConflictException({
    code: 'MOCK_REFERENCE_TAKEN',
    error: 'Conflict',
    message: 'This payment reference is already recorded for another booking',
    statusCode: 409,
  });

const bookingPaymentConflict = (): ConflictException =>
  new ConflictException({
    code: 'BOOKING_PAYMENT_CONFLICT',
    error: 'Conflict',
    message: 'The booking payment was already recorded by another request',
    statusCode: 409,
  });

/** The declared amount only detects a stale client, so a mismatch is rejected as invalid input. */
const paymentAmountMismatch = (expected: Prisma.Decimal): BadRequestException =>
  new BadRequestException({
    code: 'BOOKING_PAYMENT_AMOUNT_MISMATCH',
    details: { expectedAmount: expected.toFixed(2) },
    error: 'Bad Request',
    message: 'amount does not match the amount recorded for this booking',
    statusCode: 400,
  });

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
      throw new ConflictException('The selected slot has already started or is in the past.');
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

  async confirmTutorBooking(
    input: ConfirmTutorBookingInput,
  ): Promise<TutorBookingActionResponseDto> {
    return this.transitionPendingBooking(input, { status: BookingStatus.CONFIRMED });
  }

  async rejectTutorBooking(input: RejectTutorBookingInput): Promise<TutorBookingActionResponseDto> {
    const reason = input.reason?.trim();

    return this.transitionPendingBooking(input, {
      canceledAt: new Date(),
      canceledById: input.tutorUserId,
      cancellationReason: reason && reason.length > 0 ? reason : DEFAULT_REJECTION_REASON,
      status: BookingStatus.CANCELED,
    });
  }

  /**
   * Records the demo payment for one CONFIRMED and UNPAID booking owned by the acting student. The
   * stored netAmount is authoritative: `amount` only declares what the client believed was due.
   */
  async createMockPayment(input: CreateMockPaymentInput): Promise<MockPaymentResponseDto> {
    const booking = await this.prisma.booking.findUnique({
      select: { netAmount: true, paymentStatus: true, status: true, studentUserId: true },
      where: { id: input.bookingId },
    });

    if (!booking) {
      throw bookingNotFound();
    }
    if (booking.studentUserId !== input.studentUserId) {
      throw studentBookingNotOwned();
    }
    if (booking.status !== BookingStatus.CONFIRMED) {
      throw bookingNotPayable(booking.status);
    }
    if (booking.paymentStatus === PaymentStatus.PAID) {
      throw bookingAlreadyPaid();
    }
    if (!booking.netAmount.equals(new Prisma.Decimal(input.amount))) {
      throw paymentAmountMismatch(booking.netAmount);
    }

    const paidAtUtc = new Date();

    try {
      return await this.prisma.$transaction(async (tx) => {
        // The UNPAID filter decides the winner when two payments race: the loser updates zero rows,
        // so no request can record a second payment or observe a half-applied one.
        const payment = await tx.booking.updateMany({
          data: {
            mockReference: input.reference,
            paidAt: paidAtUtc,
            paymentStatus: PaymentStatus.PAID,
          },
          where: {
            id: input.bookingId,
            paymentStatus: PaymentStatus.UNPAID,
            status: BookingStatus.CONFIRMED,
            studentUserId: input.studentUserId,
          },
        });

        if (payment.count !== 1) {
          throw bookingPaymentConflict();
        }

        const paid = await tx.booking.findUniqueOrThrow({
          select: {
            id: true,
            mockReference: true,
            netAmount: true,
            paidAt: true,
            paymentStatus: true,
          },
          where: { id: input.bookingId },
        });

        return {
          amount: paid.netAmount.toFixed(2),
          bookingId: paid.id,
          paidAt: (paid.paidAt ?? paidAtUtc).toISOString(),
          paymentStatus: paid.paymentStatus,
          reference: paid.mockReference ?? input.reference,
        };
      });
    } catch (error) {
      if (isDuplicateMockReference(error)) {
        this.logger.warn(`Rejecting mock payment for ${input.bookingId}: reference already used`);
        throw mockReferenceTaken();
      }
      if (isDatabaseConflict(error)) {
        this.logger.warn(
          `Rejecting mock payment for ${input.bookingId}: database reported a conflict`,
        );
        throw bookingPaymentConflict();
      }

      throw error;
    }
  }

  /**
   * Moves one PENDING booking owned by the acting tutor to its next status and reports the slot
   * state that results. Canceling releases the slot implicitly: availability is derived from the
   * bookings still holding it, and the partial unique index only counts PENDING/CONFIRMED rows.
   */
  private async transitionPendingBooking(
    input: TutorBookingActionInput,
    // Unchecked input so the transition can set the canceledById foreign key directly.
    data: Prisma.BookingUncheckedUpdateManyInput,
  ): Promise<TutorBookingActionResponseDto> {
    const booking = await this.prisma.booking.findUnique({
      select: { status: true, tutorProfileId: true },
      where: { id: input.bookingId },
    });

    if (!booking) {
      throw bookingNotFound();
    }
    if (booking.tutorProfileId !== input.tutorUserId) {
      throw bookingNotOwned();
    }
    if (booking.status !== BookingStatus.PENDING) {
      throw bookingNotPending(booking.status);
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        // The PENDING filter decides the winner when confirm and reject race: the loser updates
        // zero rows, so no request ever observes or persists a half-applied transition.
        const transition = await tx.booking.updateMany({
          data,
          where: {
            id: input.bookingId,
            status: BookingStatus.PENDING,
            tutorProfileId: input.tutorUserId,
          },
        });

        if (transition.count !== 1) {
          throw bookingTransitionConflict();
        }

        const updated = await tx.booking.findUniqueOrThrow({
          select: { canceledAt: true, id: true, slotId: true, status: true },
          where: { id: input.bookingId },
        });
        const activeBookings = await tx.booking.count({
          where: {
            slotId: updated.slotId,
            status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
          },
        });

        return {
          bookingId: updated.id,
          canceledAt: updated.canceledAt?.toISOString() ?? null,
          slotStatus: activeBookings > 0 ? BookingSlotStatus.RESERVED : BookingSlotStatus.AVAILABLE,
          status: updated.status,
        };
      });
    } catch (error) {
      if (isDatabaseConflict(error)) {
        this.logger.warn(
          `Rejecting booking transition for ${input.bookingId}: database reported a conflict`,
        );
        throw bookingTransitionConflict();
      }

      throw error;
    }
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

/** Prisma's own codes for the constraint violations a booking race can produce. */
const CONFLICTING_PRISMA_CODES = new Set(['P2002', 'P2003', 'P2004']);
/**
 * A raw SQLSTATE never reaches `error.code` — `PrismaClientKnownRequestError.code` is always a
 * `P####` value and an unrecognised database fault arrives as `PrismaClientUnknownRequestError`
 * with no code at all. The only place a SQLSTATE surfaces is `meta.code`, for example on the `P2010`
 * raised by a failing raw query such as the `SELECT ... FOR UPDATE` in `create()`.
 *
 * Only violations that mean "someone else changed the data first" belong here. A check-constraint
 * violation (`23514`) means this service wrote an invalid row, which is a defect rather than a
 * conflict, so it is deliberately absent and surfaces as a 500.
 */
const CONFLICTING_SQL_STATES = new Set(['23503', '23505']);

function isDuplicateMockReference(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const { code, meta } = error as { code?: unknown; meta?: { target?: unknown } };
  if (code !== 'P2002') {
    return false;
  }

  const target = meta?.target;
  const fields = Array.isArray(target) ? target : typeof target === 'string' ? [target] : [];
  return fields.some((field) => typeof field === 'string' && field.includes('mockReference'));
}

function isDatabaseConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const { code, meta } = error as { code?: unknown; meta?: { code?: unknown } };
  if (typeof code === 'string' && CONFLICTING_PRISMA_CODES.has(code)) {
    return true;
  }

  return typeof meta?.code === 'string' && CONFLICTING_SQL_STATES.has(meta.code);
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
