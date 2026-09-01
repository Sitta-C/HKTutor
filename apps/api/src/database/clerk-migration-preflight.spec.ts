import {
  classifyClerkMigrationSnapshot,
  formatClerkMigrationPreflightResult,
  type ClerkMigrationSnapshot,
} from '@/database/clerk-migration-preflight';

const legacySnapshot = (
  override: Partial<ClerkMigrationSnapshot> = {},
): ClerkMigrationSnapshot => ({
  schemaState: 'legacy',
  userCount: 0,
  adminUserCount: 0,
  tutorUserCount: 0,
  studentUserCount: 0,
  nonActiveUserCount: 0,
  deletedUserCount: 0,
  consentedUserCount: 0,
  knownSyntheticTutorCount: 0,
  invalidSyntheticTutorCount: 0,
  tutorProfileCount: 0,
  invalidTutorProfileCount: 0,
  teachingListingCount: 0,
  knownTeachingListingCount: 0,
  invalidTeachingListingRelationCount: 0,
  availabilitySlotCount: 0,
  bookingCount: 0,
  ...override,
});

it('accepts the empty historical identity state', () => {
  expect(classifyClerkMigrationSnapshot(legacySnapshot())).toEqual({ state: 'empty' });
});

it('accepts the S1-T14 foundation seed state', () => {
  expect(
    classifyClerkMigrationSnapshot(
      legacySnapshot({ userCount: 2, adminUserCount: 1, tutorUserCount: 1, tutorProfileCount: 1 }),
    ),
  ).toEqual({ state: 's1-t14-seed' });
});

it('accepts the S1-T20 search seed state', () => {
  expect(
    classifyClerkMigrationSnapshot(
      legacySnapshot({
        userCount: 6,
        adminUserCount: 1,
        tutorUserCount: 5,
        knownSyntheticTutorCount: 4,
        tutorProfileCount: 5,
        teachingListingCount: 6,
        knownTeachingListingCount: 6,
      }),
    ),
  ).toEqual({ state: 's1-t20-seed' });
});

it.each([
  ['unexpected-schema', { schemaState: 'unexpected' as const }],
  ['student-user', { studentUserCount: 1 }],
  ['non-active-user', { nonActiveUserCount: 1 }],
  ['deleted-user', { deletedUserCount: 1 }],
  ['consent-row', { consentedUserCount: 1 }],
  ['booking-row', { bookingCount: 1 }],
  ['availability-slot-row', { availabilitySlotCount: 1 }],
  ['seed-shape', { invalidSyntheticTutorCount: 1 }],
  ['tutor-profile', { invalidTutorProfileCount: 1 }],
  ['unknown-listing', { teachingListingCount: 1, knownTeachingListingCount: 0 }],
  ['listing-relation', { invalidTeachingListingRelationCount: 1 }],
  ['seed-shape', { userCount: 1 }],
])('rejects the %s invariant', (invariant, override) => {
  expect(classifyClerkMigrationSnapshot(legacySnapshot(override))).toEqual({
    state: 'rejected',
    invariant,
  });
});

it('accepts an already migrated Clerk schema', () => {
  expect(classifyClerkMigrationSnapshot(legacySnapshot({ schemaState: 'clerk' }))).toEqual({
    state: 'already-migrated',
  });
});

it('formats accepted and rejected results without sensitive values', () => {
  expect(formatClerkMigrationPreflightResult({ state: 'empty' })).toBe('empty');
  expect(formatClerkMigrationPreflightResult({ state: 's1-t14-seed' })).toBe('s1-t14-seed');
  expect(formatClerkMigrationPreflightResult({ state: 's1-t20-seed' })).toBe('s1-t20-seed');
  expect(formatClerkMigrationPreflightResult({ state: 'already-migrated' })).toBe(
    'already-migrated',
  );
  expect(formatClerkMigrationPreflightResult({ state: 'rejected', invariant: 'booking-row' })).toBe(
    'S1-T07 Clerk migration preflight rejected: booking-row',
  );
});
