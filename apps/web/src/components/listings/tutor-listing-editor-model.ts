import { ApiError } from '@/lib/api/error';

export interface ListingFormData {
  subjectId: string;
  gradeLevelId: string;
  pricePerHour: string;
  description: string;
}

export type ListingFormErrors = Partial<Record<keyof ListingFormData, string>>;

export const emptyListingForm: ListingFormData = {
  subjectId: '',
  gradeLevelId: '',
  pricePerHour: '',
  description: '',
};

export function formatTutorExperience(years: number, language: 'en' | 'th'): string {
  return language === 'th' ? `ประสบการณ์ ${years} ปี` : `${years} years experience`;
}

export function validateListingForm(
  form: ListingFormData,
  copy: {
    subjectError: string;
    gradeError: string;
    priceError: string;
    descriptionError: string;
  },
): ListingFormErrors {
  const errors: ListingFormErrors = {};
  const price = Number(form.pricePerHour);
  if (!form.subjectId) errors.subjectId = copy.subjectError;
  if (!form.gradeLevelId) errors.gradeLevelId = copy.gradeError;
  if (
    !form.pricePerHour ||
    !Number.isFinite(price) ||
    price <= 0 ||
    !/^\d+(\.\d{1,2})?$/.test(form.pricePerHour)
  ) {
    errors.pricePerHour = copy.priceError;
  }
  const descriptionLength = form.description.trim().length;
  if (descriptionLength < 20 || descriptionLength > 1000) {
    errors.description = copy.descriptionError;
  }
  return errors;
}

export function readListingEditorError(error: unknown, fallback: string, notFound?: string) {
  if (error instanceof ApiError && error.status === 404) return notFound ?? fallback;
  return fallback;
}
