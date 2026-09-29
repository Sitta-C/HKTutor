import { describe, expect, it } from 'vitest';

import {
  formatAvailabilityDuration,
  formatAvailabilityDurationLabel,
  formatAvailabilityHoursMinutes,
  safeBangkokDateTime,
} from '@/components/availability/manage-tutor-availability-model';
import {
  emptyListingForm,
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
  it('formats durations and rejects invalid Bangkok date-time inputs safely', () => {
    expect(formatAvailabilityDuration(1.5)).toBe('1.5');
    expect(formatAvailabilityDurationLabel(1, '{hours} hour', '{hours} hours')).toBe('1 hour');
    expect(
      formatAvailabilityHoursMinutes(
        1.5,
        '{count} hour',
        '{count} hours',
        '{count} minute',
        '{count} minutes',
      ),
    ).toBe('1 hour 30 minutes');
    expect(safeBangkokDateTime('invalid', '18:00')).toBeNull();
  });
});
