import { BadRequestException, ValidationPipe } from '@nestjs/common';

import { SearchTutorsQueryDto } from '@/tutors/tutors.dto';

describe('SearchTutorsQueryDto', () => {
  it('transforms maxPrice into a number', async () => {
    const pipe = new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    });

    await expect(
      pipe.transform(
        { maxPrice: '500', subject: 'Mathematics' },
        { metatype: SearchTutorsQueryDto, type: 'query' },
      ),
    ).resolves.toMatchObject({ maxPrice: 500, subject: 'Mathematics' });
  });

  it('rejects a non-numeric maxPrice', async () => {
    const pipe = new ValidationPipe({ transform: true });

    await expect(
      pipe.transform({ maxPrice: 'abc' }, { metatype: SearchTutorsQueryDto, type: 'query' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each(['', '   '])('rejects an empty maxPrice value %#', async (maxPrice) => {
    const pipe = new ValidationPipe({ transform: true });

    await expect(
      pipe.transform({ maxPrice }, { metatype: SearchTutorsQueryDto, type: 'query' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a negative maxPrice', async () => {
    const pipe = new ValidationPipe({ transform: true });

    await expect(
      pipe.transform({ maxPrice: '-1' }, { metatype: SearchTutorsQueryDto, type: 'query' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a non-string subject', async () => {
    const pipe = new ValidationPipe({ transform: true });

    await expect(
      pipe.transform(
        { subject: ['Math', 'Physics'] },
        { metatype: SearchTutorsQueryDto, type: 'query' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
