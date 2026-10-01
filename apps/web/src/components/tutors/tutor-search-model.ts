import type { TutorSearchCopy } from '@/components/tutors/tutor-search-copy';
import type { TutorSearchQuery } from '@/lib/api/types';

export interface TutorSearchForm {
  subject: string;
  grade: string;
  maxPrice: string;
  minimumRating: string;
}

export type TutorSearchErrors = Partial<Record<keyof TutorSearchForm, string>>;

export const initialTutorSearchForm: TutorSearchForm = {
  subject: '',
  grade: '',
  maxPrice: '',
  minimumRating: '',
};

export const tutorRatingOptions = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

export function validateTutorSearch(
  form: TutorSearchForm,
  text: TutorSearchCopy,
): TutorSearchErrors {
  const errors: TutorSearchErrors = {};
  if (form.maxPrice !== '') {
    const value = Number(form.maxPrice);
    if (!Number.isFinite(value) || value < 0 || decimalPlaces(form.maxPrice) > 2) {
      errors.maxPrice = text.validationError;
    }
  }
  if (form.minimumRating !== '') {
    const value = Number(form.minimumRating);
    if (
      !Number.isFinite(value) ||
      value < 1 ||
      value > 5 ||
      decimalPlaces(form.minimumRating) > 2
    ) {
      errors.minimumRating = text.validationError;
    }
  }
  return errors;
}

export function toTutorSearchQuery(form: TutorSearchForm): TutorSearchQuery {
  return {
    ...(form.subject ? { subject: form.subject } : {}),
    ...(form.grade ? { grade: form.grade } : {}),
    ...(form.maxPrice !== '' ? { maxPrice: Number(form.maxPrice) } : {}),
    ...(form.minimumRating !== '' ? { minimumRating: Number(form.minimumRating) } : {}),
  };
}

export function formatTutorSearchSummary(form: TutorSearchForm, text: TutorSearchCopy): string {
  const subject = form.subject || text.anySubject;
  const grade = form.grade || text.anyGrade;
  const budget = form.maxPrice ? `${text.upTo} ${form.maxPrice}฿/${text.hour}` : text.anyBudget;
  const rating = form.minimumRating
    ? `${text.ratingSummary} ${Number(form.minimumRating).toFixed(1)}+`
    : text.anyRating;

  return [subject, grade, budget, rating].join(' · ');
}

function decimalPlaces(value: string): number {
  const decimal = value.split('.')[1];
  return decimal?.length ?? 0;
}
