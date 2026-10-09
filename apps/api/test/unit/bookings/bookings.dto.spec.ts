import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  ConfirmBookingDto,
  CreateMockPaymentDto,
  GetMyBookingsQueryDto,
  GetTutorBookingsQueryDto,
  MAX_MOCK_PAYMENT_REFERENCE_LENGTH,
  MAX_TUTOR_ACTION_TEXT_LENGTH,
  RejectBookingDto,
} from '@modules/bookings/bookings.dto';

describe('booking list pagination DTOs', () => {
  it.each([GetMyBookingsQueryDto, GetTutorBookingsQueryDto])(
    'transforms valid page parameters for %p',
    async (Dto) => {
      const query = plainToInstance(Dto, { page: '2', pageSize: '25' });

      await expect(validate(query)).resolves.toHaveLength(0);
      expect(query).toMatchObject({ page: 2, pageSize: 25 });
    },
  );

  it.each([
    [{ page: '0' }, 'page below one'],
    [{ page: '1.5' }, 'non-integer page'],
    [{ pageSize: '0' }, 'page size below one'],
    [{ pageSize: '101' }, 'page size above the maximum'],
  ])('rejects %s (%s)', async (input) => {
    const query = plainToInstance(GetMyBookingsQueryDto, input);
    expect(await validate(query)).not.toHaveLength(0);
  });
});

describe('tutor booking action DTOs', () => {
  it.each([ConfirmBookingDto, RejectBookingDto])('accepts an empty body for %p', async (Dto) => {
    await expect(validate(plainToInstance(Dto, {}))).resolves.toHaveLength(0);
  });

  it('accepts a confirmation note and a rejection reason', async () => {
    const confirm = plainToInstance(ConfirmBookingDto, { note: 'See you in class.' });
    const reject = plainToInstance(RejectBookingDto, { reason: 'I am no longer available.' });

    await expect(validate(confirm)).resolves.toHaveLength(0);
    await expect(validate(reject)).resolves.toHaveLength(0);
  });

  it.each(['', '   ', '\n'])('rejects a blank reason (%j)', async (reason) => {
    const reject = plainToInstance(RejectBookingDto, { reason });

    expect(await validate(reject)).not.toHaveLength(0);
  });

  it('rejects text longer than the documented maximum', async () => {
    const reject = plainToInstance(RejectBookingDto, {
      reason: 'x'.repeat(MAX_TUTOR_ACTION_TEXT_LENGTH + 1),
    });
    const confirm = plainToInstance(ConfirmBookingDto, {
      note: 'x'.repeat(MAX_TUTOR_ACTION_TEXT_LENGTH + 1),
    });

    expect(await validate(reject)).not.toHaveLength(0);
    expect(await validate(confirm)).not.toHaveLength(0);
  });

  it('rejects a non-string reason', async () => {
    const reject = plainToInstance(RejectBookingDto, { reason: 42 });

    expect(await validate(reject)).not.toHaveLength(0);
  });
});

describe('mock payment DTO', () => {
  const valid = { amount: '450.00', reference: 'DEMO-7F3A91' };

  it('accepts a fixed-decimal amount and trims the reference', async () => {
    const dto = plainToInstance(CreateMockPaymentDto, {
      amount: '450.00',
      reference: '  DEMO-7F3A91  ',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.reference).toBe('DEMO-7F3A91');
  });

  it.each(['450', '450.0', '450.000', '4.5e2', '-450.00', '', 'free'])(
    'rejects the amount %j, which is not a fixed two-decimal string',
    async (amount) => {
      expect(
        await validate(plainToInstance(CreateMockPaymentDto, { ...valid, amount })),
      ).not.toHaveLength(0);
    },
  );

  it.each([
    ['', 'empty'],
    ['   ', 'whitespace only'],
    ['\n', 'a newline only'],
  ])('rejects the reference %j, which is %s', async (reference) => {
    expect(
      await validate(plainToInstance(CreateMockPaymentDto, { ...valid, reference })),
    ).not.toHaveLength(0);
  });

  it('rejects a reference longer than the documented maximum', async () => {
    const dto = plainToInstance(CreateMockPaymentDto, {
      ...valid,
      reference: 'x'.repeat(MAX_MOCK_PAYMENT_REFERENCE_LENGTH + 1),
    });

    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('rejects a multi-line reference, which no demo identifier needs', async () => {
    const dto = plainToInstance(CreateMockPaymentDto, { ...valid, reference: 'DEMO\n1' });

    expect(await validate(dto)).not.toHaveLength(0);
  });

  it.each([
    ['amount', { reference: 'DEMO-1' }],
    ['reference', { amount: '450.00' }],
  ])('requires %s', async (_field, body) => {
    expect(await validate(plainToInstance(CreateMockPaymentDto, body))).not.toHaveLength(0);
  });
});
