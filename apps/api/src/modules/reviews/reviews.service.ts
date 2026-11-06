import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '@generated/prisma/client';
import { BookingStatus } from '@generated/prisma/enums';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { refreshLockedTutorReviewRating } from '@modules/reviews/review-ratings';
import {
  decodeTutorReviewsCursor,
  encodeTutorReviewsCursor,
} from '@modules/reviews/reviews.cursor';
import { DEFAULT_TUTOR_REVIEWS_LIMIT } from '@modules/reviews/reviews.dto';
import {
  isPublicTutorVerificationStatus,
  publicTutorWhere,
} from '@modules/tutors/public-tutor-access';

import type { CreateReviewDto, GetTutorReviewsQueryDto } from '@modules/reviews/reviews.dto';
import type {
  CreateReviewResponseDto,
  GetReviewResponseDto,
  TutorReviewsResponseDto,
} from '@modules/reviews/reviews.swagger';

const bookingSelect = {
  status: true,
  studentUserId: true,
  tutorProfileId: true,
} satisfies Prisma.BookingSelect;

const bookingOwnerSelect = {
  studentUserId: true,
} satisfies Prisma.BookingSelect;

function bookingNotFound(): NotFoundException {
  return new NotFoundException({ code: 'BOOKING_NOT_FOUND', message: 'Booking not found' });
}

function bookingNotOwned(): ForbiddenException {
  return new ForbiddenException({
    code: 'BOOKING_NOT_OWNED',
    message: 'This booking belongs to another student',
  });
}

function bookingNotCompleted(): ConflictException {
  return new ConflictException({
    code: 'BOOKING_NOT_COMPLETED',
    message: 'Only a completed booking can be reviewed',
  });
}

function reviewAlreadyExists(): ConflictException {
  return new ConflictException({
    code: 'REVIEW_ALREADY_EXISTS',
    message: 'A review already exists for this booking',
  });
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

// The composite evidence foreign key rejects an insert whose bookingStatus no longer matches the
// booking's current status; this only fires if the booking left COMPLETED between the lock and the
// insert, which the row lock below should already prevent.
function isForeignKeyViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003';
}

/** Mean of the three raw dimensions for one review, rounded half up to 2 decimals for display. */
function overallRatingOf(review: {
  clarity: number;
  punctuality: number;
  preparation: number;
}): number {
  return new Prisma.Decimal(review.clarity)
    .plus(review.punctuality)
    .plus(review.preparation)
    .dividedBy(3)
    .toDecimalPlaces(2)
    .toNumber();
}

@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(
    bookingId: string,
    studentUserId: string,
    dto: CreateReviewDto,
  ): Promise<CreateReviewResponseDto> {
    const booking = await this.prisma.booking.findUnique({
      select: bookingSelect,
      where: { id: bookingId },
    });
    if (!booking) {
      throw bookingNotFound();
    }
    if (booking.studentUserId !== studentUserId) {
      throw bookingNotOwned();
    }
    if (booking.status !== BookingStatus.COMPLETED) {
      throw bookingNotCompleted();
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Locks the booking row, then the tutor row: no other module in this codebase locks both
        // tables in one transaction, so this order cannot deadlock against an existing code path.
        await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${bookingId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT "userId" FROM "TutorProfile" WHERE "userId" = ${booking.tutorProfileId}::uuid FOR UPDATE`;

        const current = await tx.booking.findUniqueOrThrow({
          select: bookingSelect,
          where: { id: bookingId },
        });
        if (current.studentUserId !== studentUserId) {
          throw bookingNotOwned();
        }
        if (current.status !== BookingStatus.COMPLETED) {
          throw bookingNotCompleted();
        }

        const review = await tx.review.create({
          data: {
            authorStudentUserId: studentUserId,
            bookingId,
            bookingStatus: BookingStatus.COMPLETED,
            clarity: dto.clarity,
            feedback: dto.feedback,
            preparation: dto.preparation,
            punctuality: dto.punctuality,
            tutorProfileId: current.tutorProfileId,
          },
        });

        await refreshLockedTutorReviewRating(tx, current.tutorProfileId);

        return {
          review: {
            clarity: review.clarity,
            createdAt: review.createdAt.toISOString(),
            feedback: review.feedback,
            id: review.id,
            overallRating: overallRatingOf(review),
            preparation: review.preparation,
            punctuality: review.punctuality,
          },
        };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw reviewAlreadyExists();
      }
      if (isForeignKeyViolation(error)) {
        throw bookingNotCompleted();
      }
      throw error;
    }
  }

  /**
   * Reads the canonical saved review for the caller's own booking, or null if none exists yet.
   * Eligibility to submit a review comes from the booking's own detail, not from this read, so a
   * booking that is not COMPLETED yet also answers null here rather than an error.
   */
  async findMine(bookingId: string, studentUserId: string): Promise<GetReviewResponseDto> {
    const booking = await this.prisma.booking.findUnique({
      select: bookingOwnerSelect,
      where: { id: bookingId },
    });
    if (!booking) {
      throw bookingNotFound();
    }
    if (booking.studentUserId !== studentUserId) {
      throw bookingNotOwned();
    }

    const review = await this.prisma.review.findUnique({ where: { bookingId } });
    if (!review) {
      return { review: null };
    }

    return {
      review: {
        clarity: review.clarity,
        createdAt: review.createdAt.toISOString(),
        feedback: review.feedback,
        id: review.id,
        overallRating: overallRatingOf(review),
        preparation: review.preparation,
        punctuality: review.punctuality,
      },
    };
  }

  /**
   * Public, cursor-paginated review list for one tutor's profile. Reuses the same visibility rule
   * as the public tutor detail endpoint: a hidden, unverified, inactive, deleted or missing tutor
   * answers 404, while a visible tutor with zero reviews answers 200 with an empty page.
   */
  async listForTutor(
    tutorId: string,
    query: GetTutorReviewsQueryDto,
  ): Promise<TutorReviewsResponseDto> {
    const tutor = await this.prisma.tutorProfile.findFirst({
      select: { userId: true, verificationStatus: true },
      where: { ...publicTutorWhere, userId: tutorId },
    });
    if (!tutor || !isPublicTutorVerificationStatus(tutor.verificationStatus)) {
      if (tutor) {
        this.logger.warn(
          `Hiding reviews for tutor ${tutor.userId} with unexpected verification status ${tutor.verificationStatus}`,
        );
      }
      throw new NotFoundException('Tutor not found');
    }

    const cursor =
      query.cursor === undefined ? undefined : decodeTutorReviewsCursor(query.cursor, tutorId);
    const limit = query.limit ?? DEFAULT_TUTOR_REVIEWS_LIMIT;

    // One extra row tells whether another page follows, without a separate count query.
    const rows = await this.prisma.review.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        author: { select: { studentProfile: { select: { nickname: true } } } },
        clarity: true,
        createdAt: true,
        feedback: true,
        id: true,
        preparation: true,
        punctuality: true,
      },
      take: limit + 1,
      where: {
        tutorProfileId: tutorId,
        ...(cursor === undefined
          ? {}
          : {
              OR: [
                { createdAt: { lt: new Date(cursor.createdAt) } },
                { AND: [{ createdAt: new Date(cursor.createdAt) }, { id: { lt: cursor.id } }] },
              ],
            }),
      },
    });

    const page = rows.slice(0, limit);
    const last = page.at(-1);

    return {
      items: page.map((review) => ({
        author: { displayName: review.author.studentProfile?.nickname.trim() || 'A student' },
        clarity: review.clarity,
        createdAt: review.createdAt.toISOString(),
        feedback: review.feedback,
        id: review.id,
        overallRating: overallRatingOf(review),
        preparation: review.preparation,
        punctuality: review.punctuality,
      })),
      nextCursor:
        rows.length > limit && last !== undefined
          ? encodeTutorReviewsCursor({
              createdAt: last.createdAt.toISOString(),
              id: last.id,
              tutorId,
            })
          : null,
    };
  }
}
