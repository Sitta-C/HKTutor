import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  ListingPatchRequestDto,
  ListingPostRequestDto,
  ListingQueryDto,
  ListingStatusRequestDto,
} from '@/tutors/tutors.dto';

describe('tutor listing DTOs', () => {
  const subjectId = '30000000-0000-4000-8000-000000000001';
  const gradeLevelId = '40000000-0000-4000-8000-000000000001';

  it('accepts a valid create request and transforms a numeric price string', async () => {
    const dto = plainToInstance(ListingPostRequestDto, {
      subjectId,
      gradeLevelId,
      pricePerHour: '450.50',
      description: 'Experienced mathematics tutor.',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.pricePerHour).toBe(450.5);
  });

  it.each([
    ['missing subject', { subjectId: undefined }],
    ['missing grade level', { gradeLevelId: undefined }],
    ['zero price', { pricePerHour: 0 }],
    ['more than two decimal places', { pricePerHour: 450.555 }],
    ['short description', { description: 'Too short' }],
  ])('rejects a create request with %s', async (_label, override) => {
    const dto = plainToInstance(ListingPostRequestDto, {
      subjectId,
      gradeLevelId,
      pricePerHour: 450.5,
      description: 'Experienced mathematics tutor.',
      ...override,
    });

    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('accepts an empty patch and validates fields that are present', async () => {
    await expect(validate(plainToInstance(ListingPatchRequestDto, {}))).resolves.toHaveLength(0);

    const invalid = plainToInstance(ListingPatchRequestDto, {
      pricePerHour: '-10',
      description: 'Too short',
    });
    expect(await validate(invalid)).not.toHaveLength(0);
  });

  it('trims listing descriptions before validating and storing them', async () => {
    const dto = plainToInstance(ListingPostRequestDto, {
      subjectId,
      gradeLevelId,
      pricePerHour: 450,
      description: '  Experienced mathematics tutor.  ',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.description).toBe('Experienced mathematics tutor.');
  });

  it.each(['DRAFT', 'PUBLISHED', 'ARCHIVED'])('accepts the %s listing filter', async (status) => {
    const dto = plainToInstance(ListingQueryDto, { publicationStatus: status });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects an unknown listing filter', async () => {
    const dto = plainToInstance(ListingQueryDto, { publicationStatus: 'UNKNOWN' });

    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('accepts publish and archive status changes only', async () => {
    await expect(
      validate(plainToInstance(ListingStatusRequestDto, { publicationStatus: 'PUBLISHED' })),
    ).resolves.toHaveLength(0);
    await expect(
      validate(plainToInstance(ListingStatusRequestDto, { publicationStatus: 'ARCHIVED' })),
    ).resolves.toHaveLength(0);
    expect(
      await validate(plainToInstance(ListingStatusRequestDto, { publicationStatus: 'DRAFT' })),
    ).not.toHaveLength(0);
  });
});
