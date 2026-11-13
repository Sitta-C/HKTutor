import { Logger } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';
import { Test } from '@nestjs/testing';

import { PrismaService } from '@infrastructure/database/prisma.service';
import { BookingExpiryService } from '@modules/bookings/booking-expiry.service';

const NOW = new Date('2026-11-15T11:00:00Z');

describe('BookingExpiryService', () => {
  const updateMany = jest.fn();
  let service: BookingExpiryService;

  beforeEach(async () => {
    updateMany.mockReset().mockResolvedValue({ count: 2 });
    const module = await Test.createTestingModule({
      providers: [
        BookingExpiryService,
        { provide: PrismaService, useValue: { booking: { updateMany } } },
      ],
    }).compile();
    service = module.get(BookingExpiryService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('expires due unpaid bookings at the start boundary while excluding unresolved payments and capacity', async () => {
    await expect(service.runOnce(NOW)).resolves.toBe(2);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        status: { in: ['PENDING', 'CONFIRMED'] },
        paymentStatus: 'UNPAID',
        paymentPending: false,
        slot: { startAtUtc: { lte: NOW } },
        paymentAttempts: { none: { status: { in: ['CREATING', 'PENDING'] } } },
        couponReservations: { none: { status: 'RESERVED' } },
      },
      data: { status: 'EXPIRED' },
    });
  });

  it('rejects an invalid clock before any database write', async () => {
    await expect(service.runOnce(new Date(NaN))).rejects.toThrow(RangeError);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('logs failures without leaking database details and retries on the next tick', async () => {
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    updateMany.mockRejectedValueOnce(new Error('private database details'));
    jest.useFakeTimers().setSystemTime(NOW);
    await expect(service.tick()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith('Booking expiry failed; retrying next tick');
    await expect(service.tick()).resolves.toBeUndefined();
    expect(updateMany).toHaveBeenCalledTimes(2);
  });

  it('registers a non-overlapping minute job in UTC, disabled in tests', () => {
    const tick: unknown = Object.getOwnPropertyDescriptor(
      BookingExpiryService.prototype,
      'tick',
    )?.value;
    if (typeof tick !== 'function') throw new Error('Missing expiry tick');
    const options: unknown = Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, tick);
    expect(options).toMatchObject({
      name: 'booking-payment-expiry',
      cronTime: CronExpression.EVERY_MINUTE,
      timeZone: 'UTC',
      waitForCompletion: true,
      disabled: true,
    });
  });
});
