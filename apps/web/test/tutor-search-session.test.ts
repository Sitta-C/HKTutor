import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  emptyTutorSearchSession,
  parseTutorSearchSession,
  readTutorSearchSession,
  TUTOR_SEARCH_SESSION_KEY,
  writeTutorSearchSession,
} from '@/components/tutors/tutor-search-session';

const session = () => ({
  ...emptyTutorSearchSession(),
  form: { subject: 'Mathematics', grade: 'Grade 10', maxPrice: '750', minimumRating: '4' },
  query: {
    subject: 'Mathematics',
    grade: 'Grade 10',
    maxPrice: 600,
    minimumRating: 4,
    priority: 'lowest_price' as const,
    page: 2,
    pageSize: 10,
  },
  choices: [
    { tutorId: 'tutor-1', listingId: 'course-1' },
    { tutorId: 'tutor-2', listingId: 'course-2' },
  ],
  filtersOpen: true,
  scrollY: 800.5,
});

afterEach(() => vi.unstubAllGlobals());

describe('tab-scoped tutor search session', () => {
  it('round trips applied filters, a different unsent draft, ranking, page, ordered IDs and scroll', () => {
    expect(parseTutorSearchSession(JSON.stringify(session()))).toEqual(session());
  });

  it('keeps invalid draft inputs without applying them to the restored query', () => {
    const value = session();
    value.form.maxPrice = '-1.234';
    expect(parseTutorSearchSession(JSON.stringify(value))).toEqual(value);
  });

  it('does not retain names, prices, result payloads or extra fields', () => {
    const value = {
      ...session(),
      results: [{ displayName: 'Old name', pricePerHour: 1 }],
      query: { ...session().query, privateField: 'secret' },
      form: { ...session().form, extra: 'secret' },
      choices: [{ tutorId: 'tutor-1', listingId: 'course-1', displayName: 'Old name', price: 1 }],
    };
    expect(parseTutorSearchSession(JSON.stringify(value))).toEqual({
      ...session(),
      choices: [{ tutorId: 'tutor-1', listingId: 'course-1' }],
    });
  });

  it.each([null, '{', 'null', '[]', '{}', 'x'.repeat(10_001)])(
    'ignores malformed/missing storage %s',
    (raw) => {
      expect(parseTutorSearchSession(raw)).toBeNull();
    },
  );

  it.each([
    { version: 2 },
    { scrollY: -1 },
    { scrollY: '100' },
    { filtersOpen: 'true' },
    { choices: [{ tutorId: '../profile', listingId: 'course-1' }] },
    { choices: [session().choices[0], session().choices[0]] },
    {
      choices: Array.from({ length: 4 }, (_, i) => ({
        tutorId: `tutor-${i}`,
        listingId: `course-${i}`,
      })),
    },
    { query: { page: 0, pageSize: 10 } },
    { query: { page: 1.5, pageSize: 10 } },
    { query: { page: 2, pageSize: 100 } },
    { query: { page: 1, pageSize: 10, maxPrice: -1 } },
    { query: { page: 1, pageSize: 10, minimumRating: 5.5 } },
    { query: { page: 1, pageSize: 10, priority: '__proto__' } },
  ])('rejects invalid stored state %j', (patch) => {
    expect(parseTutorSearchSession(JSON.stringify({ ...session(), ...patch }))).toBeNull();
  });

  it('reads and writes only the versioned session key, including an empty selection', () => {
    let raw: string | null = null;
    const getItem = vi.fn(() => raw);
    const setItem = vi.fn((_key: string, value: string) => {
      raw = value;
    });
    vi.stubGlobal('window', { sessionStorage: { getItem, setItem } });
    expect(readTutorSearchSession()).toEqual(emptyTutorSearchSession());
    writeTutorSearchSession(session());
    expect(readTutorSearchSession()).toEqual(session());
    writeTutorSearchSession({ ...session(), choices: [] });
    expect(readTutorSearchSession().choices).toEqual([]);
    expect(getItem).toHaveBeenCalledWith(TUTOR_SEARCH_SESSION_KEY);
    expect(setItem).toHaveBeenLastCalledWith(TUTOR_SEARCH_SESSION_KEY, expect.any(String));
  });

  it('falls back to memory when storage access is denied or a write exceeds quota', () => {
    vi.stubGlobal('window', {
      get sessionStorage() {
        throw new Error('Blocked');
      },
    });
    expect(readTutorSearchSession()).toEqual(emptyTutorSearchSession());
    expect(() => writeTutorSearchSession(session())).not.toThrow();
    vi.stubGlobal('window', {
      sessionStorage: {
        setItem() {
          throw new Error('Quota exceeded');
        },
      },
    });
    expect(() => writeTutorSearchSession(session())).not.toThrow();
  });
});
