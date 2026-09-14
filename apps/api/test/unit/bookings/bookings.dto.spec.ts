import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { GetMyBookingsQueryDto, GetTutorBookingsQueryDto } from '@/bookings/bookings.dto';

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
