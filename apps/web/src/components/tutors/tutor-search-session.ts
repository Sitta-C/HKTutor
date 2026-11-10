import { MAX_COMPARISON_TUTORS } from '@/components/tutors/tutor-comparison-model';
import {
  initialTutorSearchForm,
  isTutorRankingPriority,
} from '@/components/tutors/tutor-search-model';
import { TUTOR_SEARCH_PAGE_SIZE } from '@/lib/api/tutors';

import type { TutorSearchForm } from '@/components/tutors/tutor-search-model';
import type { TutorComparisonSelection, TutorSearchQuery } from '@/lib/api/types';

export const TUTOR_SEARCH_SESSION_KEY = 'hktutor-tutor-search-v1';

export interface TutorSearchSession {
  version: 1;
  form: TutorSearchForm;
  query: TutorSearchQuery;
  choices: TutorComparisonSelection[];
  filtersOpen: boolean;
  scrollY: number;
}

export function emptyTutorSearchSession(): TutorSearchSession {
  return {
    version: 1,
    form: { ...initialTutorSearchForm },
    query: { page: 1, pageSize: TUTOR_SEARCH_PAGE_SIZE },
    choices: [],
    filtersOpen: false,
    scrollY: 0,
  };
}

/** Browser storage is untrusted. Reconstruct only bounded search inputs and selected IDs. */
export function parseTutorSearchSession(raw: string | null): TutorSearchSession | null {
  if (raw === null || raw.length > 10_000) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(raw);
    if (!record(value) || value.version !== 1 || !record(value.form) || !record(value.query)) {
      return null;
    }
    const { form, query } = value;
    if (
      !text(form.subject) ||
      !text(form.grade) ||
      !text(form.maxPrice) ||
      !text(form.minimumRating) ||
      !optionalText(query.subject) ||
      !optionalText(query.grade) ||
      !optionalMoney(query.maxPrice) ||
      (query.minimumRating !== undefined &&
        (!optionalMoney(query.minimumRating) ||
          query.minimumRating < 1 ||
          query.minimumRating > 5)) ||
      (query.priority !== undefined &&
        (typeof query.priority !== 'string' || !isTutorRankingPriority(query.priority))) ||
      typeof query.page !== 'number' ||
      !Number.isSafeInteger(query.page) ||
      query.page < 1 ||
      query.pageSize !== TUTOR_SEARCH_PAGE_SIZE ||
      typeof value.filtersOpen !== 'boolean' ||
      typeof value.scrollY !== 'number' ||
      !Number.isFinite(value.scrollY) ||
      value.scrollY < 0 ||
      !Array.isArray(value.choices) ||
      value.choices.length > MAX_COMPARISON_TUTORS
    ) {
      return null;
    }
    const choices: TutorComparisonSelection[] = [];
    const tutors = new Set<string>();
    const listings = new Set<string>();
    for (const choice of value.choices) {
      if (
        !record(choice) ||
        !identifier(choice.tutorId) ||
        !identifier(choice.listingId) ||
        tutors.has(choice.tutorId) ||
        listings.has(choice.listingId)
      ) {
        return null;
      }
      tutors.add(choice.tutorId);
      listings.add(choice.listingId);
      choices.push({ tutorId: choice.tutorId, listingId: choice.listingId });
    }
    return {
      version: 1,
      form: {
        subject: form.subject,
        grade: form.grade,
        maxPrice: form.maxPrice,
        minimumRating: form.minimumRating,
      },
      query: {
        page: query.page,
        pageSize: TUTOR_SEARCH_PAGE_SIZE,
        ...(query.subject === undefined ? {} : { subject: query.subject }),
        ...(query.grade === undefined ? {} : { grade: query.grade }),
        ...(query.maxPrice === undefined ? {} : { maxPrice: query.maxPrice }),
        ...(query.minimumRating === undefined ? {} : { minimumRating: query.minimumRating }),
        ...(query.priority === undefined ? {} : { priority: query.priority }),
      },
      choices,
      filtersOpen: value.filtersOpen,
      scrollY: value.scrollY,
    };
  } catch {
    return null;
  }
}

export function readTutorSearchSession(): TutorSearchSession {
  try {
    return (
      parseTutorSearchSession(window.sessionStorage.getItem(TUTOR_SEARCH_SESSION_KEY)) ??
      emptyTutorSearchSession()
    );
  } catch {
    return emptyTutorSearchSession();
  }
}

export function writeTutorSearchSession(session: TutorSearchSession): void {
  try {
    // Strip names, result payloads and any future fields even if a caller passes a broader object.
    const projected = parseTutorSearchSession(JSON.stringify(session));
    if (projected) {
      window.sessionStorage.setItem(TUTOR_SEARCH_SESSION_KEY, JSON.stringify(projected));
    }
  } catch {
    // Storage may be blocked/full. The current page remains usable with its in-memory state.
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function text(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 200;
}
function optionalText(value: unknown): value is string | undefined {
  return value === undefined || text(value);
}
function optionalMoney(value: unknown): value is number | undefined {
  return (
    value === undefined ||
    (typeof value === 'number' &&
      Number.isFinite(value) &&
      value >= 0 &&
      Math.round(value * 100) / 100 === value)
  );
}
function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
}
