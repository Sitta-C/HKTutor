import { describe, expect, it } from 'vitest';

import {
  buildAvailabilityWeek,
  buildAvailabilityWeekLayout,
  safeBangkokDateTime,
} from '@/components/availability/manage-tutor-availability-model';
import {
  emptyListingForm,
  formatTutorExperience,
  validateListingForm,
} from '@/components/listings/tutor-listing-editor-model';
import {
  emptyStudentForm,
  emptyTutorForm,
  isStudentProfileComplete,
  isTutorProfileComplete,
  trimProfileForm,
  validateStudentProfile,
  validateTutorProfile,
} from '@/components/profile/profile-editor-model';
import { tutorSearchCopy } from '@/components/tutors/tutor-search-copy';
import {
  initialTutorSearchForm,
  toTutorSearchQuery,
  validateTutorSearch,
} from '@/components/tutors/tutor-search-model';

import type { TutorAvailabilitySlot } from '@/lib/api/types';

const profileValidationCopy = {
  fieldLabels: {
    bio: 'Bio',
    displayName: 'Display name',
    experienceYears: 'Experience years',
    firstName: 'First name',
    gradeLevel: 'Grade level',
    lastName: 'Last name',
    nickname: 'Nickname',
    phone: 'Phone',
    school: 'School',
  },
  invalidPhone: 'Invalid phone',
  invalidYears: 'Invalid years',
};

describe('feature form models', () => {
  it('validates tutor-search numbers and omits empty filters from the query', () => {
    expect(
      validateTutorSearch(
        { ...initialTutorSearchForm, maxPrice: '-1', minimumRating: '5.5' },
        tutorSearchCopy.en,
      ),
    ).toEqual({
      maxPrice: tutorSearchCopy.en.validationError,
      minimumRating: tutorSearchCopy.en.validationError,
    });
    expect(
      toTutorSearchQuery({
        ...initialTutorSearchForm,
        grade: 'Grade 10',
        maxPrice: '500',
      }),
    ).toEqual({ grade: 'Grade 10', maxPrice: 500 });
  });

  it('keeps listing validation independent from editor orchestration', () => {
    const copy = {
      descriptionError: 'description',
      gradeError: 'grade',
      priceError: 'price',
      subjectError: 'subject',
    };

    expect(validateListingForm(emptyListingForm, copy)).toEqual({
      description: 'description',
      gradeLevelId: 'grade',
      pricePerHour: 'price',
      subjectId: 'subject',
    });
    expect(
      validateListingForm(
        {
          description: 'A patient tutor with clear examples.',
          gradeLevelId: 'grade-10',
          pricePerHour: '450.50',
          subjectId: 'math',
        },
        copy,
      ),
    ).toEqual({});
  });

  it('formats tutor experience naturally in both supported languages', () => {
    expect(formatTutorExperience(5, 'en')).toBe('5 years experience');
    expect(formatTutorExperience(5, 'th')).toBe('ประสบการณ์ 5 ปี');
  });

  it('trims and validates role-specific profile fields', () => {
    const student = {
      ...emptyStudentForm,
      firstName: ' Mali ',
      gradeLevel: ' Grade 10 ',
      lastName: ' Dee ',
      nickname: ' Mali ',
      phone: ' 0812345678 ',
      school: ' Demo School ',
    };
    const tutor = {
      ...emptyTutorForm,
      bio: ' Patient mathematics tutor. ',
      displayName: ' Teacher Mali ',
      experienceYears: '5',
      firstName: ' Mali ',
      lastName: ' Dee ',
      nickname: ' Mali ',
    };

    expect(isStudentProfileComplete(student)).toBe(true);
    expect(isTutorProfileComplete(tutor)).toBe(true);
    expect(trimProfileForm(student).firstName).toBe('Mali');
    expect(validateStudentProfile(student, 'en', profileValidationCopy)).toEqual({});
    expect(validateTutorProfile(tutor, 'en', profileValidationCopy)).toEqual({});
    expect(
      validateTutorProfile({ ...tutor, experienceYears: '-1' }, 'en', profileValidationCopy),
    ).toMatchObject({ experienceYears: 'Invalid years' });
  });
});

describe('availability presentation model', () => {
  function slot(startAtUtc: string, endAtUtc: string, id = 'slot'): TutorAvailabilitySlot {
    return { id, startAtUtc, endAtUtc, createdAt: '2026-10-01T00:00:00.000Z', state: 'OPEN' };
  }

  it('rejects invalid Bangkok date-time inputs safely', () => {
    expect(safeBangkokDateTime('invalid', '18:00')).toBeNull();
    expect(safeBangkokDateTime('2026-02-30', '18:00')).toBeNull();
    expect(safeBangkokDateTime('2026-10-05', '24:00')).toBeNull();
    expect(safeBangkokDateTime('2026-10-05', '18:00')?.toISOString()).toBe(
      '2026-10-05T11:00:00.000Z',
    );
  });

  it('shows a cross-day slot on both Bangkok dates without duplicating its identity', () => {
    const original = slot('2026-10-06T11:00:00.000Z', '2026-10-07T12:00:00.000Z');
    const week = buildAvailabilityWeek([original], '2026-10-05');
    expect(week.slots).toEqual([original]);
    expect(week.days.map(([day]) => day)).toEqual(['2026-10-06', '2026-10-07']);
    expect(week.days.at(0)?.[1].at(0)).toEqual({
      slot: original,
      startAtUtc: '2026-10-06T11:00:00.000Z',
      endAtUtc: '2026-10-06T17:00:00.000Z',
      endsAtMidnight: true,
      isContinuation: false,
    });
    expect(week.days.at(1)?.[1].at(0)).toEqual({
      slot: original,
      startAtUtc: '2026-10-06T17:00:00.000Z',
      endAtUtc: '2026-10-07T12:00:00.000Z',
      endsAtMidnight: false,
      isContinuation: true,
    });
    expect(week.days.at(1)?.[1].at(0)?.slot).toBe(original);
    expect(original.endAtUtc).toBe('2026-10-07T12:00:00.000Z');
  });

  it('does not add an empty next-day row when a slot ends exactly at Bangkok midnight', () => {
    const week = buildAvailabilityWeek(
      [slot('2026-10-06T11:00:00.000Z', '2026-10-06T17:00:00.000Z')],
      '2026-10-05',
    );
    expect(week.days.map(([day]) => day)).toEqual(['2026-10-06']);
    expect(week.days.at(0)?.[1].at(0)?.endsAtMidnight).toBe(true);
    expect(buildAvailabilityWeekLayout(week).spans).toHaveLength(1);
  });

  it('lays out one continuous card across day separators without covering adjacent slots', () => {
    const original = slot('2026-10-06T11:00:00.000Z', '2026-10-07T12:00:00.000Z', 'cross-day');
    const before = slot('2026-10-06T10:00:00.000Z', original.startAtUtc, 'before');
    const after = slot(original.endAtUtc, '2026-10-07T13:00:00.000Z', 'after');
    const layout = buildAvailabilityWeekLayout(
      buildAvailabilityWeek([after, original, before], '2026-10-05'),
    );
    expect(layout.spans).toHaveLength(3);
    expect(layout.spans.map(({ slot, rowStart, rowEnd }) => [slot.id, rowStart, rowEnd])).toEqual([
      ['before', 1, 2],
      ['cross-day', 3, 6],
      ['after', 7, 8],
    ]);
    expect(layout.spans.at(1)).toMatchObject({
      slot: original,
      firstDay: '2026-10-06',
      lastDay: '2026-10-07',
      firstSegment: { startAtUtc: original.startAtUtc },
      lastSegment: { endAtUtc: original.endAtUtc },
    });
    expect(
      layout.days.map(({ day, rowStart, separatorRow }) => [day, rowStart, separatorRow]),
    ).toEqual([
      ['2026-10-06', 1, null],
      ['2026-10-07', 5, 4],
    ]);
  });

  it('clips incoming and outgoing slots to the selected week with exclusive boundaries', () => {
    const incoming = slot('2026-10-04T15:00:00.000Z', '2026-10-05T03:00:00.000Z', 'incoming');
    const outgoing = slot('2026-10-11T16:00:00.000Z', '2026-10-12T02:00:00.000Z', 'outgoing');
    const slots = [
      incoming,
      outgoing,
      slot('2026-10-04T16:00:00.000Z', '2026-10-04T17:00:00.000Z', 'before'),
      slot('2026-10-11T17:00:00.000Z', '2026-10-11T18:00:00.000Z', 'after'),
    ];
    const week = buildAvailabilityWeek(slots, '2026-10-05');
    expect(week.slots).toEqual([incoming, outgoing]);
    expect(week.days.map(([day]) => day)).toEqual(['2026-10-05', '2026-10-11']);
    expect(week.days.at(0)?.[1].at(0)).toMatchObject({
      startAtUtc: '2026-10-04T17:00:00.000Z',
      isContinuation: true,
    });
    expect(week.days.at(1)?.[1].at(0)?.endAtUtc).toBe('2026-10-11T17:00:00.000Z');
    const next = buildAvailabilityWeek([outgoing], '2026-10-12');
    expect(next.days.map(([day]) => day)).toEqual(['2026-10-12']);
    expect(next.days.at(0)?.[1].at(0)?.startAtUtc).toBe('2026-10-11T17:00:00.000Z');
  });

  it('limits a long multi-week slot to seven daily portions and counts it once', () => {
    const original = slot('2026-10-01T00:00:00.000Z', '2026-10-31T00:00:00.000Z');
    const week = buildAvailabilityWeek([original], '2026-10-05');
    expect(week.slots).toHaveLength(1);
    expect(week.days).toHaveLength(7);
    expect(week.days.every(([, parts]) => parts.length === 1 && parts[0]?.isContinuation)).toBe(
      true,
    );
    expect(week.days.at(6)?.[1].at(0)?.endAtUtc).toBe('2026-10-11T17:00:00.000Z');
    const layout = buildAvailabilityWeekLayout(week);
    expect(layout.spans).toHaveLength(1);
    expect(layout.spans.at(0)).toMatchObject({
      rowStart: 1,
      rowEnd: 14,
      firstDay: '2026-10-05',
      lastDay: '2026-10-11',
    });
  });
});
