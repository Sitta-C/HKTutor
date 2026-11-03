import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { Prisma } from '@generated/prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { ReviewsService } from '@modules/reviews/reviews.service';

import type { CreateReviewDto } from '@modules/reviews/reviews.dto';

const BOOKING_ID = '30000000-0000-4000-8000-000000000001';
const STUDENT_ID = '40000000-0000-4000-8000-000000000001';
const TUTOR_ID = '50000000-0000-4000-8000-000000000001';
const REVIEW_ID = '60000000-0000-4000-8000-000000000001';

const completedBooking = () => ({
  status: 'COMPLETED',
  studentUserId: STUDENT_ID,
  tutorProfileId: TUTOR_ID,
});

const dto = (): CreateReviewDto => ({
  clarity: 5,
  feedback: 'Clear examples',
  preparation: 5,
  punctuality: 4,
});

const createdReview = () => ({
  bookingId: BOOKING_ID,
  clarity: 5,
  createdAt: new Date('2026-11-10T11:00:00.000Z'),
  feedback: 'Clear examples',
  id: REVIEW_ID,
  preparation: 5,
  punctuality: 4,
});

describe('ReviewsService', () => {
  let service: ReviewsService;
  const db = {
    booking: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
    review: { aggregate: jest.fn(), create: jest.fn(), findUnique: jest.fn() },
    tutorProfile: { update: jest.fn() },
    $queryRaw: jest.fn(),
  };
  const transaction = jest.fn();

  beforeEach(async () => {
    jest.resetAllMocks();
    transaction.mockImplementation((run: (tx: typeof db) => Promise<unknown>) => run(db));
    db.booking.findUnique.mockResolvedValue(completedBooking());
    db.booking.findUniqueOrThrow.mockResolvedValue(completedBooking());
    db.review.create.mockResolvedValue(createdReview());
    db.review.aggregate.mockResolvedValue({
      _count: 1,
      _sum: { clarity: 5, preparation: 5, punctuality: 4 },
    });
    db.tutorProfile.update.mockResolvedValue({});

    const module = await Test.createTestingModule({
      providers: [
        ReviewsService,
        { provide: PrismaService, useValue: { ...db, $transaction: transaction } },
      ],
    }).compile();
    service = module.get(ReviewsService);
  });

  it('locks the booking and the tutor row before writing', async () => {
    await service.create(BOOKING_ID, STUDENT_ID, dto());
    expect(db.$queryRaw).toHaveBeenNthCalledWith(1, expect.anything(), BOOKING_ID);
    expect(db.$queryRaw).toHaveBeenNthCalledWith(2, expect.anything(), TUTOR_ID);
  });

  it('returns the per-review mean rounded half up, independent of the tutor aggregate', async () => {
    const result = await service.create(BOOKING_ID, STUDENT_ID, dto());
    // (5 + 4 + 5) / 3 = 4.666..., half up to 4.67.
    expect(result.review.overallRating).toBe(4.67);
    expect(result.review.id).toBe(REVIEW_ID);
  });

  it('aggregates raw dimensions across every review before rounding, not the average of rounded means', async () => {
    // A second, pre-existing 4/4/4 review alongside this new 5/4/5 one: (5+4+5+4+4+4)/6 = 4.333...
    // Averaging the two reviews' own rounded means (4.67 and 4.00) would wrongly give 4.335 -> 4.34.
    db.review.aggregate.mockResolvedValue({
      _count: 2,
      _sum: { clarity: 9, preparation: 9, punctuality: 8 },
    });
    let update: { data: { ratingAverage: Prisma.Decimal; reviewCount: number } } | undefined;
    db.tutorProfile.update.mockImplementation(
      (args: { data: { ratingAverage: Prisma.Decimal; reviewCount: number } }) => {
        update = args;
        return Promise.resolve({});
      },
    );

    await service.create(BOOKING_ID, STUDENT_ID, dto());

    expect(update?.data.ratingAverage.toString()).toBe('4.33');
    expect(update?.data.reviewCount).toBe(2);
    expect(db.tutorProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: TUTOR_ID } }),
    );
  });

  it('throws 404 when the booking does not exist', async () => {
    db.booking.findUnique.mockResolvedValue(null);
    await expect(service.create(BOOKING_ID, STUDENT_ID, dto())).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it('throws 403 when the booking belongs to another student', async () => {
    db.booking.findUnique.mockResolvedValue({
      ...completedBooking(),
      studentUserId: 'someone-else',
    });
    const outcome = service.create(BOOKING_ID, STUDENT_ID, dto());
    await expect(outcome).rejects.toThrow(ForbiddenException);
    await expect(outcome).rejects.toMatchObject({ response: { code: 'BOOKING_NOT_OWNED' } });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('throws 409 when the booking is not completed yet', async () => {
    db.booking.findUnique.mockResolvedValue({ ...completedBooking(), status: 'CONFIRMED' });
    const outcome = service.create(BOOKING_ID, STUDENT_ID, dto());
    await expect(outcome).rejects.toThrow(ConflictException);
    await expect(outcome).rejects.toMatchObject({ response: { code: 'BOOKING_NOT_COMPLETED' } });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('re-validates completion under the lock, not only before opening the transaction', async () => {
    db.booking.findUniqueOrThrow.mockResolvedValue({ ...completedBooking(), status: 'CANCELED' });
    await expect(service.create(BOOKING_ID, STUDENT_ID, dto())).rejects.toMatchObject({
      response: { code: 'BOOKING_NOT_COMPLETED' },
    });
    expect(db.review.create).not.toHaveBeenCalled();
  });

  it('maps a concurrent duplicate submission to 409 REVIEW_ALREADY_EXISTS', async () => {
    db.review.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Review_bookingId_key', {
        clientVersion: '7.10.0',
        code: 'P2002',
      }),
    );
    await expect(service.create(BOOKING_ID, STUDENT_ID, dto())).rejects.toMatchObject({
      response: { code: 'REVIEW_ALREADY_EXISTS' },
    });
    expect(db.tutorProfile.update).not.toHaveBeenCalled();
  });

  it('maps a booking that left COMPLETED mid-transaction to 409 BOOKING_NOT_COMPLETED', async () => {
    db.review.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Review_booking_evidence_fkey', {
        clientVersion: '7.10.0',
        code: 'P2003',
      }),
    );
    await expect(service.create(BOOKING_ID, STUDENT_ID, dto())).rejects.toMatchObject({
      response: { code: 'BOOKING_NOT_COMPLETED' },
    });
  });

  describe('findMine', () => {
    beforeEach(() => {
      db.booking.findUnique.mockResolvedValue({ studentUserId: STUDENT_ID });
    });

    it('returns the saved review with its own rounded mean', async () => {
      db.review.findUnique.mockResolvedValue(createdReview());
      const result = await service.findMine(BOOKING_ID, STUDENT_ID);
      expect(result).toEqual({
        review: {
          clarity: 5,
          createdAt: '2026-11-10T11:00:00.000Z',
          feedback: 'Clear examples',
          id: REVIEW_ID,
          overallRating: 4.67,
          preparation: 5,
          punctuality: 4,
        },
      });
    });

    it('returns null without throwing when no review was submitted yet, including on a booking that is not completed', async () => {
      // findMine never selects or checks booking.status: eligibility to submit lives on the
      // booking's own detail, so a not-yet-completed booking takes the exact same "no review" path.
      db.review.findUnique.mockResolvedValue(null);
      await expect(service.findMine(BOOKING_ID, STUDENT_ID)).resolves.toEqual({ review: null });
      expect(db.booking.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ select: { studentUserId: true } }),
      );
    });

    it('throws 404 when the booking does not exist', async () => {
      db.booking.findUnique.mockResolvedValue(null);
      await expect(service.findMine(BOOKING_ID, STUDENT_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(db.review.findUnique).not.toHaveBeenCalled();
    });

    it('throws 403 when the booking belongs to another student', async () => {
      db.booking.findUnique.mockResolvedValue({ studentUserId: 'someone-else' });
      const outcome = service.findMine(BOOKING_ID, STUDENT_ID);
      await expect(outcome).rejects.toThrow(ForbiddenException);
      await expect(outcome).rejects.toMatchObject({ response: { code: 'BOOKING_NOT_OWNED' } });
      expect(db.review.findUnique).not.toHaveBeenCalled();
    });
  });
});
