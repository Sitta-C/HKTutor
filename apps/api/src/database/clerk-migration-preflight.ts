export type ClerkMigrationSchemaState = 'legacy' | 'clerk' | 'unexpected';

export interface ClerkMigrationSnapshot {
  schemaState: ClerkMigrationSchemaState;
  userCount: number;
  adminUserCount: number;
  tutorUserCount: number;
  studentUserCount: number;
  nonActiveUserCount: number;
  deletedUserCount: number;
  consentedUserCount: number;
  knownSyntheticTutorCount: number;
  invalidSyntheticTutorCount: number;
  tutorProfileCount: number;
  invalidTutorProfileCount: number;
  teachingListingCount: number;
  knownTeachingListingCount: number;
  invalidTeachingListingRelationCount: number;
  availabilitySlotCount: number;
  bookingCount: number;
}

export type ClerkMigrationPreflightResult =
  | { state: 'empty' | 's1-t14-seed' | 's1-t20-seed' | 'already-migrated' }
  | { state: 'rejected'; invariant: string };

const zero = (snapshot: ClerkMigrationSnapshot): boolean =>
  snapshot.userCount === 0 &&
  snapshot.adminUserCount === 0 &&
  snapshot.tutorUserCount === 0 &&
  snapshot.studentUserCount === 0 &&
  snapshot.nonActiveUserCount === 0 &&
  snapshot.deletedUserCount === 0 &&
  snapshot.consentedUserCount === 0 &&
  snapshot.knownSyntheticTutorCount === 0 &&
  snapshot.invalidSyntheticTutorCount === 0 &&
  snapshot.tutorProfileCount === 0 &&
  snapshot.invalidTutorProfileCount === 0 &&
  snapshot.teachingListingCount === 0 &&
  snapshot.knownTeachingListingCount === 0 &&
  snapshot.invalidTeachingListingRelationCount === 0 &&
  snapshot.availabilitySlotCount === 0 &&
  snapshot.bookingCount === 0;

export function classifyClerkMigrationSnapshot(
  snapshot: ClerkMigrationSnapshot,
): ClerkMigrationPreflightResult {
  if (snapshot.schemaState === 'unexpected')
    return { state: 'rejected', invariant: 'unexpected-schema' };
  if (snapshot.schemaState === 'clerk') return { state: 'already-migrated' };
  if (snapshot.studentUserCount !== 0) return { state: 'rejected', invariant: 'student-user' };
  if (snapshot.nonActiveUserCount !== 0) return { state: 'rejected', invariant: 'non-active-user' };
  if (snapshot.deletedUserCount !== 0) return { state: 'rejected', invariant: 'deleted-user' };
  if (snapshot.consentedUserCount !== 0) return { state: 'rejected', invariant: 'consent-row' };
  if (snapshot.bookingCount !== 0) return { state: 'rejected', invariant: 'booking-row' };
  if (snapshot.availabilitySlotCount !== 0)
    return { state: 'rejected', invariant: 'availability-slot-row' };
  if (snapshot.invalidSyntheticTutorCount !== 0)
    return { state: 'rejected', invariant: 'seed-shape' };
  if (snapshot.invalidTutorProfileCount !== 0)
    return { state: 'rejected', invariant: 'tutor-profile' };
  if (snapshot.teachingListingCount !== snapshot.knownTeachingListingCount) {
    return { state: 'rejected', invariant: 'unknown-listing' };
  }
  if (snapshot.invalidTeachingListingRelationCount !== 0) {
    return { state: 'rejected', invariant: 'listing-relation' };
  }

  if (zero(snapshot)) return { state: 'empty' };

  const t14 =
    snapshot.userCount === 2 &&
    snapshot.adminUserCount === 1 &&
    snapshot.tutorUserCount === 1 &&
    snapshot.knownSyntheticTutorCount === 0 &&
    snapshot.tutorProfileCount === 1 &&
    snapshot.teachingListingCount === 0;
  if (t14) return { state: 's1-t14-seed' };

  const t20 =
    snapshot.userCount === 6 &&
    snapshot.adminUserCount === 1 &&
    snapshot.tutorUserCount === 5 &&
    snapshot.knownSyntheticTutorCount === 4 &&
    snapshot.tutorProfileCount === 5 &&
    snapshot.teachingListingCount === 6 &&
    snapshot.knownTeachingListingCount === 6;
  if (t20) return { state: 's1-t20-seed' };

  return { state: 'rejected', invariant: 'seed-shape' };
}

export function formatClerkMigrationPreflightResult(result: ClerkMigrationPreflightResult): string {
  return result.state === 'rejected'
    ? `S1-T07 Clerk migration preflight rejected: ${result.invariant}`
    : result.state;
}
