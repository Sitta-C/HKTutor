import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  AvailabilityPostRequestDto,
  AvailabilityQueryDto,
  ListingPatchRequestDto,
  ListingPostRequestDto,
  ListingQueryDto,
  ListingStatusRequestDto,
  TutorSearchQueryDto,
} from '@/tutors/tutors.dto';

describe('tutor listing DTOs', () => {
  it('accepts a valid create request and transforms a numeric price string', async () => {
    const dto = plainToInstance(ListingPostRequestDto, {
      description: 'Experienced mathematics tutor.',
      gradeLevelId: '40000000-0000-4000-8000-000000000001',
      pricePerHour: '450.50',
      subjectId: '30000000-0000-4000-8000-000000000001',
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
      description: 'Experienced mathematics tutor.',
      gradeLevelId: '40000000-0000-4000-8000-000000000001',
      pricePerHour: 450.5,
      subjectId: '30000000-0000-4000-8000-000000000001',
      ...override,
    });

    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('rejects an empty patch and validates fields that are present', async () => {
    expect(await validate(plainToInstance(ListingPatchRequestDto, {}))).not.toHaveLength(0);

    const invalid = plainToInstance(ListingPatchRequestDto, {
      description: 'Too short',
      pricePerHour: '-10',
    });
    expect(await validate(invalid)).not.toHaveLength(0);
  });

  it('accepts one valid partial field', async () => {
    const dto = plainToInstance(ListingPatchRequestDto, { pricePerHour: '500.00' });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.pricePerHour).toBe(500);
  });

  it('rejects an unknown patch field', async () => {
    const dto = plainToInstance(ListingPatchRequestDto, { title: 'Not part of the contract' });

    const errors = await validate(dto, { forbidNonWhitelisted: true, whitelist: true });
    expect(errors).not.toHaveLength(0);
    expect(errors.some((error) => error.property === 'title')).toBe(true);
  });

  it.each(['DRAFT', 'PUBLISHED', 'ARCHIVED'])('accepts the %s listing filter', async (status) => {
    const dto = plainToInstance(ListingQueryDto, { publicationStatus: status });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects an unknown listing filter', async () => {
    const dto = plainToInstance(ListingQueryDto, { publicationStatus: 'UNKNOWN' });

    expect(await validate(dto)).not.toHaveLength(0);
  });

  it.each(['DRAFT', 'PUBLISHED', 'ARCHIVED'])('accepts the %s status mutation', async (status) => {
    const dto = plainToInstance(ListingStatusRequestDto, { publicationStatus: status });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it.each([{}, { publicationStatus: 'UNKNOWN' }])(
    'rejects an invalid status mutation (%p)',
    async (payload) => {
      const dto = plainToInstance(ListingStatusRequestDto, payload);

      expect(await validate(dto)).not.toHaveLength(0);
    },
  );

  it('accepts optional search filters and transforms numeric query strings', async () => {
    const dto = plainToInstance(TutorSearchQueryDto, {
      grade: 'Grade 10',
      maxPrice: '500',
      minimumRating: '4.00',
      subject: 'mathematics',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.maxPrice).toBe(500);
    expect(dto.minimumRating).toBe(4);
  });

  it.each([
    ['negative price', { maxPrice: -1 }],
    ['rating below one', { minimumRating: 0 }],
    ['rating above five', { minimumRating: 6 }],
    ['non-numeric price', { maxPrice: 'not-a-number' }],
    ['infinite rating', { minimumRating: 'Infinity' }],
    ['blank price', { maxPrice: ' ' }],
  ])('rejects invalid public search filter: %s', async (_label, override) => {
    const dto = plainToInstance(TutorSearchQueryDto, override);

    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('rejects unknown search query fields when the global pipe whitelist is applied', async () => {
    const dto = plainToInstance(TutorSearchQueryDto, { unexpected: 'value' });

    const errors = await validate(dto, { forbidNonWhitelisted: true, whitelist: true });
    expect(errors.some((error) => error.property === 'unexpected')).toBe(true);
  });
});

describe('availability DTOs', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-01T00:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('transforms valid startAt and endAt ISO strings into future dates', async () => {
    const dto = plainToInstance(AvailabilityPostRequestDto, {
      endAt: '2026-10-17T09:00:00.000Z',
      startAt: '2026-10-17T08:00:00.000Z',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.startAt).toEqual(new Date('2026-10-17T08:00:00.000Z'));
    expect(dto.endAt).toEqual(new Date('2026-10-17T09:00:00.000Z'));
  });

  it('rejects the old startAtUtc and endAtUtc request fields', async () => {
    const dto = plainToInstance(AvailabilityPostRequestDto, {
      endAtUtc: '2026-10-17T09:00:00.000Z',
      startAtUtc: '2026-10-17T08:00:00.000Z',
    });

    const errors = await validate(dto, { forbidNonWhitelisted: true, whitelist: true });

    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['startAtUtc', 'endAtUtc', 'startAt', 'endAt']),
    );
  });

  it('rejects invalid or past timestamps', async () => {
    const invalid = plainToInstance(AvailabilityPostRequestDto, {
      endAt: 'not-a-date',
      startAt: '2026-09-30T23:00:00.000Z',
    });

    expect(await validate(invalid)).not.toHaveLength(0);
  });

  it('transforms valid query timestamps and rejects malformed values', async () => {
    const valid = plainToInstance(AvailabilityQueryDto, {
      from: '2026-10-17T08:00:00.000Z',
      to: '2026-10-17T09:00:00.000Z',
    });
    const invalid = plainToInstance(AvailabilityQueryDto, { from: 'not-a-date' });

    await expect(validate(valid)).resolves.toHaveLength(0);
    expect(valid.from).toBeInstanceOf(Date);
    expect(valid.to).toBeInstanceOf(Date);
    expect(await validate(invalid)).not.toHaveLength(0);
  });
});
