import { describe, expect, it } from 'vitest';

import { buildComparisonColumn } from '@/components/tutors/tutor-comparison-model';
import {
  COMPARISON_ATTRIBUTES,
  buildTutorComparisonEntry,
  buildTutorComparisonView,
} from '@/components/tutors/tutor-comparison-view-model';

import type { ComparisonColumn } from '@/components/tutors/tutor-comparison-model';
import type {
  PublicAvailabilitySlot,
  PublicTeachingListing,
  PublicTutorProfile,
} from '@/lib/api/types';

const choice = { tutorId: 'tutor-1', listingId: 'course-1' };
const tutor: PublicTutorProfile = {
  tutorId: 'tutor-1',
  displayName: 'Teacher Anan',
  bio: 'Public bio is not a compared attribute.',
  experienceYears: 5,
  verificationStatus: 'VERIFIED',
  ratingAverage: 4.33,
  reviewCount: 2,
};
const listing: PublicTeachingListing = {
  listingId: 'course-1',
  subject: 'Mathematics',
  grade: 'Grade 10',
  pricePerHour: 450,
  description: 'Course description is not a compared attribute.',
};
const slot: PublicAvailabilitySlot = {
  id: 'slot-1',
  startAtUtc: '2026-11-08T03:00:00.000Z',
  endAtUtc: '2026-11-08T04:00:00.000Z',
};

describe('comparison entry projection (S3-T31)', () => {
  it('keeps the six US10-1 attributes in table row order', () => {
    expect(COMPARISON_ATTRIBUTES).toEqual([
      'price',
      'subject',
      'rating',
      'reviews',
      'experience',
      'availability',
    ]);
  });

  it('projects the public profile, the selected listing and the next slot', () => {
    expect(buildTutorComparisonEntry(choice, tutor, listing, slot)).toEqual({
      tutorId: 'tutor-1',
      listingId: 'course-1',
      displayName: 'Teacher Anan',
      subject: 'Mathematics',
      grade: 'Grade 10',
      pricePerHour: 450,
      rating: { state: 'rated', score: '4.33', reviewCount: 2 },
      experienceYears: 5,
      nextAvailability: {
        startAtUtc: '2026-11-08T03:00:00.000Z',
        endAtUtc: '2026-11-08T04:00:00.000Z',
      },
    });
  });

  it('keeps no future slot as null instead of inventing one', () => {
    expect(buildTutorComparisonEntry(choice, tutor, listing, null).nextAvailability).toBeNull();
  });

  it('copies only allow-listed public fields, even when the API returns more', () => {
    // Simulates a wider response (e.g. a future API field) reaching the client at runtime.
    const widerTutor = {
      ...tutor,
      email: 'private@example.com',
      phone: '0800000000',
      verificationDocuments: ['private-document.pdf'],
    };
    const widerListing = { ...listing, publicationStatus: 'DRAFT', tutorProfileId: 'private-id' };
    const widerSlot = { ...slot, bookingId: 'private-booking' };

    const entry = buildTutorComparisonEntry(choice, widerTutor, widerListing, widerSlot);

    expect(Object.keys(entry).sort()).toEqual(
      [
        'displayName',
        'experienceYears',
        'grade',
        'listingId',
        'nextAvailability',
        'pricePerHour',
        'rating',
        'subject',
        'tutorId',
      ].sort(),
    );
    expect(Object.keys(entry.nextAvailability ?? {}).sort()).toEqual(['endAtUtc', 'startAtUtc']);
    const serialized = JSON.stringify(entry);
    for (const hidden of [
      tutor.bio,
      listing.description,
      'private@example.com',
      '0800000000',
      'private-document.pdf',
      'DRAFT',
      'private-id',
      'private-booking',
      'slot-1',
    ]) {
      expect(serialized).not.toContain(hidden);
    }
  });

  it('keeps the selected tutor and course IDs as the entry identity', () => {
    const entry = buildTutorComparisonEntry(choice, tutor, listing, null);
    expect({ tutorId: entry.tutorId, listingId: entry.listingId }).toEqual(choice);
  });
});

describe('missing comparison values (S3-T31)', () => {
  const entry = (
    tutorPatch: Partial<PublicTutorProfile>,
    listingPatch: Partial<PublicTeachingListing>,
  ) =>
    buildTutorComparisonEntry(
      choice,
      { ...tutor, ...tutorPatch },
      { ...listing, ...listingPatch },
      null,
    );

  it('trims public text and keeps 0 years of experience as a real value', () => {
    expect(
      entry(
        { displayName: '  Teacher Anan ', experienceYears: 0 },
        { subject: ' Physics ', grade: ' Grade 12 ' },
      ),
    ).toMatchObject({
      displayName: 'Teacher Anan',
      subject: 'Physics',
      grade: 'Grade 12',
      experienceYears: 0,
    });
  });

  it.each(['', '   '])('treats subject and grade %j as missing', (blank) => {
    expect(entry({}, { subject: blank, grade: blank })).toMatchObject({
      subject: null,
      grade: null,
    });
  });

  it.each([0, -450, Number.NaN, Number.POSITIVE_INFINITY])(
    'treats price %s as missing',
    (pricePerHour) => {
      expect(entry({}, { pricePerHour }).pricePerHour).toBeNull();
    },
  );

  it('keeps a two-decimal public price unchanged', () => {
    expect(entry({}, { pricePerHour: 450.5 }).pricePerHour).toBe(450.5);
  });

  it.each([-1, 2.5, Number.NaN])('treats experience %s as missing', (experienceYears) => {
    expect(entry({ experienceYears }, {}).experienceYears).toBeNull();
  });

  it('keeps New tutor and unavailable rating states from the shared rating model', () => {
    expect(entry({ ratingAverage: null, reviewCount: 0 }, {}).rating).toEqual({
      state: 'new',
      score: null,
      reviewCount: 0,
    });
    expect(entry({ ratingAverage: null, reviewCount: 3 }, {}).rating).toEqual({
      state: 'unavailable',
      score: null,
      reviewCount: 3,
    });
  });
});

describe('comparison view columns (S3-T31)', () => {
  const now = Date.parse('2026-11-07T00:00:00.000Z');
  const ready = (index: number): ComparisonColumn =>
    buildComparisonColumn(
      { tutorId: `tutor-${index}`, listingId: `course-${index}` },
      {
        tutor: { ...tutor, tutorId: `tutor-${index}`, displayName: `Teacher ${index}` },
        listings: [{ ...listing, listingId: `course-${index}` }],
      },
      [slot],
      now,
    );

  it('keeps selection order and the selected IDs as stable keys', () => {
    const view = buildTutorComparisonView([ready(3), ready(1), ready(2)]);
    expect(view.map((column) => [column.tutorId, column.listingId, column.state])).toEqual([
      ['tutor-3', 'course-3', 'ready'],
      ['tutor-1', 'course-1', 'ready'],
      ['tutor-2', 'course-2', 'ready'],
    ]);
  });

  it('keeps the tutor key when the column moves from loading to ready', () => {
    const loading = buildTutorComparisonView([
      { choice: { tutorId: 'tutor-1', listingId: 'course-1' }, state: 'loading' },
    ]);
    const loaded = buildTutorComparisonView([ready(1)]);
    expect(loading[0]?.tutorId).toBe(loaded[0]?.tutorId);
  });

  it.each(['loading', 'unavailable', 'error'] as const)(
    'exposes no tutor or course metadata while %s',
    (state) => {
      expect(buildTutorComparisonView([{ choice, state }])).toEqual([
        { tutorId: 'tutor-1', listingId: 'course-1', state },
      ]);
    },
  );

  it('shows one column per tutor even if a tutor is passed twice', () => {
    const view = buildTutorComparisonView([ready(1), ready(2), ready(1)]);
    expect(view.map((column) => column.tutorId)).toEqual(['tutor-1', 'tutor-2']);
  });

  it('never shows a profile or course other than the selected one', () => {
    const column = ready(1);
    if (column.state !== 'ready') {
      throw new Error('Expected a ready column');
    }
    const otherTutor: ComparisonColumn = { ...column, tutor: { ...column.tutor, tutorId: 'x' } };
    const otherCourse: ComparisonColumn = {
      ...column,
      listing: { ...column.listing, listingId: 'x' },
    };
    expect(buildTutorComparisonView([otherTutor])[0]?.state).toBe('unavailable');
    expect(buildTutorComparisonView([otherCourse])[0]?.state).toBe('unavailable');
  });

  it('builds a ready entry from the public column without bio or description', () => {
    const [column] = buildTutorComparisonView([ready(1)]);
    expect(column).toMatchObject({
      state: 'ready',
      entry: {
        tutorId: 'tutor-1',
        displayName: 'Teacher 1',
        pricePerHour: 450,
        nextAvailability: { startAtUtc: slot.startAtUtc },
      },
    });
    expect(JSON.stringify(column)).not.toContain(tutor.bio);
    expect(JSON.stringify(column)).not.toContain(listing.description);
  });

  it('returns an empty view for an empty selection', () => {
    expect(buildTutorComparisonView([])).toEqual([]);
  });
});
