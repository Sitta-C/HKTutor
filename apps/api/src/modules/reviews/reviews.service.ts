import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '@generated/prisma/client';
import { BookingStatus } from '@generated/prisma/enums';
import { PrismaService } from '@infrastructure/database/prisma.service';

import type { CreateReviewDto } from '@modules/reviews/reviews.dto';
import type { CreateReviewResponseDto } from '@modules/reviews/reviews.swagger';

const bookingSelect = {
  status: true,
  studentUserId: true,
  tutorProfileId: true,
} satisfies Prisma.BookingSelect;

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
      throw new NotFoundException('Booking not found');
    }
    if (booking.studentUserId !== studentUserId) {
      throw bookingNotOwned();
    }
    if (booking.status !== BookingStatus.COMPLETED) {
      throw bookingNotCompleted();
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Locking the booking row first, then the tutor row, matches the order every other module
        // in this codebase locks these two tables in, so this transaction cannot deadlock against them.
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

        // Recomputed from every stored review each time: averaging per-review rounded means would
        // double-round and drift from the raw-dimension aggregate the product decision requires.
        const aggregate = await tx.review.aggregate({
          _count: true,
          _sum: { clarity: true, preparation: true, punctuality: true },
          where: { tutorProfileId: current.tutorProfileId },
        });
        const dimensionTotal =
          (aggregate._sum.clarity ?? 0) +
          (aggregate._sum.punctuality ?? 0) +
          (aggregate._sum.preparation ?? 0);
        const ratingAverage = new Prisma.Decimal(dimensionTotal)
          .dividedBy(aggregate._count * 3)
          .toDecimalPlaces(2);

        await tx.tutorProfile.update({
          data: {
            ratingAverage,
            ratingUpdatedAt: new Date(),
            reviewCount: aggregate._count,
          },
          where: { userId: current.tutorProfileId },
        });

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
}
