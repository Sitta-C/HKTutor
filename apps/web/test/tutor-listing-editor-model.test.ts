import { describe, expect, it } from 'vitest';

import {
  stepListingPrice,
  validateListingForm,
} from '@/components/listings/tutor-listing-editor-model';

describe('listing price increments', () => {
  it.each([
    ['450', 1, '500'],
    ['450', -1, '400'],
    ['325.75', 1, '375.75'],
    ['325.75', -1, '275.75'],
    ['', 1, '50'],
    ['invalid', 1, '50'],
    ['25', -1, '0.01'],
    ['0.01', -1, '0.01'],
  ] as const)('steps %s in direction %s to %s', (value, direction, result) => {
    expect(stepListingPrice(value, direction)).toBe(result);
  });

  it('continues accepting manually entered prices that are not multiples of 50', () => {
    const copy = {
      subjectError: 'subject',
      gradeError: 'grade',
      priceError: 'price',
      descriptionError: 'description',
    };
    expect(
      validateListingForm(
        {
          subjectId: 'math',
          gradeLevelId: 'grade10',
          pricePerHour: '325.75',
          description: 'A detailed mathematics course for Grade 10.',
        },
        copy,
      ),
    ).toEqual({});
  });
});
