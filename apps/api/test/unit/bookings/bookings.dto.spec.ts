import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  CancelBookingDto,
  ConfirmBookingDto,
  MAX_BOOKINGS_PAGE_SIZE,
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

  // No card restricts the reference to ASCII, and the product is bilingual, so a Thai reference has
  // to pass. Only control and format characters stay rejected.
  it.each(['เดโม-001', 'ดีโม 001', 'DEMO-7F3A91'])(
    'accepts the reference %j whatever script it is written in',
    async (reference) => {
      await expect(
        validate(plainToInstance(CreateMockPaymentDto, { ...valid, reference })),
      ).resolves.toHaveLength(0);
    },
  );

  it.each([
    ['DEMO\t1', 'a tab'],
    ['DEMO\u00001', 'a NUL'],
    ['DEMO​1', 'a zero-width space'],
  ])('rejects the reference %j, which hides %s', async (reference) => {
    expect(
      await validate(plainToInstance(CreateMockPaymentDto, { ...valid, reference })),
    ).not.toHaveLength(0);
  });

  it.each([
    ['amount', { reference: 'DEMO-1' }],
    ['reference', { amount: '450.00' }],
  ])('requires %s', async (_field, body) => {
    expect(await validate(plainToInstance(CreateMockPaymentDto, body))).not.toHaveLength(0);
  });
});

describe.each(['note', 'reason'] as const)('tutor action %s boundaries', (field) => {
  const actionDto = (value: unknown) => {
    const input = { [field]: value };
    return field === 'note'
      ? plainToInstance(ConfirmBookingDto, input)
      : plainToInstance(RejectBookingDto, input);
  };

  it.each([
    [MAX_TUTOR_ACTION_TEXT_LENGTH - 1, true],
    [MAX_TUTOR_ACTION_TEXT_LENGTH, true],
    [MAX_TUTOR_ACTION_TEXT_LENGTH + 1, false],
  ])('validates %i ASCII characters (accepted: %s)', async (length, accepted) => {
    const errors = await validate(actionDto('x'.repeat(length)));
    expect(errors.length === 0).toBe(accepted);
  });

  it('accepts omitted text', async () => {
    await expect(validate(actionDto(undefined))).resolves.toHaveLength(0);
  });

  it.each(['', ' ', '\n', 42, true, [], {}])('rejects explicit invalid text %p', async (value) => {
    expect(await validate(actionDto(value))).not.toHaveLength(0);
  });

  it('accepts a single nonblank character surrounded by whitespace', async () => {
    await expect(validate(actionDto(' x '))).resolves.toHaveLength(0);
  });
});

describe('tutor inbox query boundaries', () => {
  it.each([
    [{ page: '0' }, false],
    [{ page: '1' }, true],
    [{ page: '2' }, true],
    [{ pageSize: '0' }, false],
    [{ pageSize: '1' }, true],
    [{ pageSize: '2' }, true],
    [{ pageSize: String(MAX_BOOKINGS_PAGE_SIZE - 1) }, true],
    [{ pageSize: String(MAX_BOOKINGS_PAGE_SIZE) }, true],
    [{ pageSize: String(MAX_BOOKINGS_PAGE_SIZE + 1) }, false],
    [{ page: '1.5' }, false],
    [{ pageSize: 'NaN' }, false],
  ])('validates page/item limits %j (accepted: %s)', async (input, accepted) => {
    const errors = await validate(plainToInstance(GetTutorBookingsQueryDto, input));
    expect(errors.length === 0).toBe(accepted);
  });

  it.each(['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELED', 'EXPIRED'])(
    'accepts the implemented status %s',
    async (status) => {
      await expect(
        validate(plainToInstance(GetTutorBookingsQueryDto, { status })),
      ).resolves.toHaveLength(0);
    },
  );

  it.each(['NOT_A_STATUS', 42, ['PENDING', 'CONFIRMED']])(
    'rejects unknown or incorrectly typed status %p',
    async (status) => {
      expect(
        await validate(plainToInstance(GetTutorBookingsQueryDto, { status })),
      ).not.toHaveLength(0);
    },
  );
});

describe('cancel booking DTO', () => {
  it('accepts a non-empty cancellation reason', async () => {
    const dto = plainToInstance(CancelBookingDto, { reason: 'Schedule conflict' });
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it.each([
    ['', 'empty string'],
    ['   ', 'whitespace only'],
    [undefined, 'undefined'],
    [null, 'null'],
    [123, 'a number'],
  ])('rejects invalid reason %p (%s)', async (reason) => {
    const dto = plainToInstance(CancelBookingDto, { reason });
    expect(await validate(dto)).not.toHaveLength(0);
  });
});
