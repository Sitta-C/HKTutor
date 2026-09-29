import { ApiError } from '@/lib/api/error';

import type { StudentProfile, TutorProfile } from '@/lib/api/types';

export type StudentForm = StudentProfile;

export interface TutorForm {
  bio: string;
  displayName: string;
  experienceYears: string;
  firstName: string;
  lastName: string;
  nickname: string;
}

export type ProfileFieldName = keyof StudentForm | keyof TutorForm;
export type ProfileFieldErrors = Partial<Record<ProfileFieldName, string>>;

export const emptyStudentForm: StudentForm = {
  firstName: '',
  gradeLevel: '',
  lastName: '',
  nickname: '',
  phone: '',
  school: '',
};

export const emptyTutorForm: TutorForm = {
  bio: '',
  displayName: '',
  experienceYears: '',
  firstName: '',
  lastName: '',
  nickname: '',
};

const phonePattern = /^[+0-9][0-9 ()-]{7,31}$/;
const fields: ProfileFieldName[] = [
  'firstName',
  'lastName',
  'nickname',
  'school',
  'gradeLevel',
  'phone',
  'displayName',
  'bio',
  'experienceYears',
];

interface ValidationCopy {
  invalidPhone: string;
  invalidYears: string;
  fieldLabels: Record<ProfileFieldName, string>;
}

export function toTutorForm(profile: TutorProfile): TutorForm {
  return {
    bio: profile.bio,
    displayName: profile.displayName,
    experienceYears: String(profile.experienceYears),
    firstName: profile.firstName ?? '',
    lastName: profile.lastName ?? '',
    nickname: profile.nickname ?? '',
  };
}

export function trimProfileForm<T extends object>(data: T): T {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, value?.trim() ?? '']),
  ) as T;
}

export function isStudentProfileComplete(data: StudentForm): boolean {
  return Object.values(data).every((value) => value.trim()) && phonePattern.test(data.phone.trim());
}

export function isTutorProfileComplete(data: TutorForm): boolean {
  const years = Number(data.experienceYears);
  return (
    [data.firstName, data.lastName, data.nickname, data.displayName, data.bio].every((value) =>
      value?.trim(),
    ) &&
    data.experienceYears !== '' &&
    Number.isInteger(years) &&
    years >= 0
  );
}

export function validateStudentProfile(
  data: StudentForm,
  language: 'en' | 'th',
  copy: ValidationCopy,
): ProfileFieldErrors {
  const errors = validateRequired(data, language, copy);
  if (data.phone.trim() && !phonePattern.test(data.phone.trim())) {
    errors.phone = copy.invalidPhone;
  }
  return errors;
}

export function validateTutorProfile(
  data: TutorForm,
  language: 'en' | 'th',
  copy: ValidationCopy,
): ProfileFieldErrors {
  const errors = validateRequired(data, language, copy);
  const years = Number(data.experienceYears);
  if (data.experienceYears.trim() && (!Number.isInteger(years) || years < 0)) {
    errors.experienceYears = copy.invalidYears;
  }
  return errors;
}

export function readProfileFieldErrors(error: unknown): ProfileFieldErrors {
  if (!(error instanceof ApiError) || !error.details || typeof error.details !== 'object')
    return {};
  const value = (error.details as { message?: unknown }).message;
  const messages = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : typeof value === 'string'
      ? [value]
      : [];
  const errors: ProfileFieldErrors = {};
  for (const field of fields) {
    const matchingMessage = messages.find((message) =>
      message.toLowerCase().includes(field.toLowerCase()),
    );
    if (matchingMessage) errors[field] = matchingMessage;
  }
  return errors;
}

function validateRequired(
  data: StudentForm | TutorForm,
  language: 'en' | 'th',
  copy: ValidationCopy,
): ProfileFieldErrors {
  const errors: ProfileFieldErrors = {};
  for (const [field, value] of Object.entries(data) as [ProfileFieldName, string | null][]) {
    if (!value?.trim()) errors[field] = requiredMessage(field, language, copy);
  }
  return errors;
}

function requiredMessage(field: ProfileFieldName, language: 'en' | 'th', copy: ValidationCopy) {
  const label = copy.fieldLabels[field];
  return language === 'th' ? `กรุณากรอก${label}` : `Enter your ${label.toLowerCase()}.`;
}
