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

export interface ClerkMigrationQueryClient {
  $queryRawUnsafe<T = unknown>(query: string): Promise<T>;
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

const CATALOG_QUERY = `
  SELECT table_name, column_name
  FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name IN ('User', 'ClerkWebhookEvent')
`;

const LEGACY_AGGREGATE_QUERY = `
  WITH known_synthetic_tutors(id, email) AS (
    VALUES
      ('20000000-0000-4000-8000-000000000001'::uuid, 'mali@s1t20.hktutor.invalid'::citext),
      ('20000000-0000-4000-8000-000000000002'::uuid, 'kiet@s1t20.hktutor.invalid'::citext),
      ('20000000-0000-4000-8000-000000000003'::uuid, 'niran@s1t20.hktutor.invalid'::citext),
      ('20000000-0000-4000-8000-000000000004'::uuid, 'pim@s1t20.hktutor.invalid'::citext)
  ), known_listings(id, tutor_profile_id) AS (
    VALUES
      ('10000000-0000-4000-8000-000000000001'::uuid, NULL::uuid),
      ('10000000-0000-4000-8000-000000000002'::uuid, '20000000-0000-4000-8000-000000000001'::uuid),
      ('10000000-0000-4000-8000-000000000003'::uuid, '20000000-0000-4000-8000-000000000002'::uuid),
      ('10000000-0000-4000-8000-000000000004'::uuid, '20000000-0000-4000-8000-000000000003'::uuid),
      ('10000000-0000-4000-8000-000000000005'::uuid, '20000000-0000-4000-8000-000000000004'::uuid),
      ('10000000-0000-4000-8000-000000000006'::uuid, NULL::uuid)
  )
  SELECT
    COUNT(*) AS "userCount",
    COUNT(*) FILTER (WHERE u.role = 'admin') AS "adminUserCount",
    COUNT(*) FILTER (WHERE u.role = 'tutor') AS "tutorUserCount",
    COUNT(*) FILTER (WHERE u.role = 'student') AS "studentUserCount",
    COUNT(*) FILTER (WHERE u."accountStatus" <> 'active') AS "nonActiveUserCount",
    COUNT(*) FILTER (WHERE u."deletedAt" IS NOT NULL) AS "deletedUserCount",
    COUNT(*) FILTER (WHERE u."consentAcceptedAt" IS NOT NULL) AS "consentedUserCount",
    COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM known_synthetic_tutors k WHERE k.id = u.id AND k.email = u.email)) AS "knownSyntheticTutorCount",
    COUNT(*) FILTER (WHERE u.role = 'tutor' AND u.email IN (SELECT email FROM known_synthetic_tutors) AND NOT EXISTS (SELECT 1 FROM known_synthetic_tutors k WHERE k.id = u.id AND k.email = u.email)) AS "invalidSyntheticTutorCount",
    (SELECT COUNT(*) FROM "TutorProfile") AS "tutorProfileCount",
    (SELECT COUNT(*) FROM "TutorProfile" p LEFT JOIN "User" profile_user ON profile_user.id = p."userId" WHERE profile_user.role <> 'tutor' OR profile_user.id IS NULL) AS "invalidTutorProfileCount",
    (SELECT COUNT(*) FROM "TeachingListing") AS "teachingListingCount",
    (SELECT COUNT(*) FROM "TeachingListing" l WHERE l.id IN (SELECT id FROM known_listings)) AS "knownTeachingListingCount",
    (SELECT COUNT(*) FROM "TeachingListing" l LEFT JOIN known_listings k ON k.id = l.id LEFT JOIN "User" listing_user ON listing_user.id = l."tutorProfileId" WHERE k.id IS NOT NULL AND ((k.tutor_profile_id IS NOT NULL AND l."tutorProfileId" <> k.tutor_profile_id) OR (k.tutor_profile_id IS NULL AND (listing_user.id IS NULL OR listing_user.role <> 'tutor' OR listing_user.id IN (SELECT id FROM known_synthetic_tutors) OR (l.id = '10000000-0000-4000-8000-000000000006'::uuid AND l."tutorProfileId" <> (SELECT "tutorProfileId" FROM "TeachingListing" WHERE id = '10000000-0000-4000-8000-000000000001'::uuid))))) AS "invalidTeachingListingRelationCount",
    (SELECT COUNT(*) FROM "AvailabilitySlot") AS "availabilitySlotCount",
    (SELECT COUNT(*) FROM "Booking") AS "bookingCount"
  FROM "User" u
`;

type CatalogRow = { table_name: unknown; column_name: unknown };

const SNAPSHOT_FIELDS = [
  'userCount',
  'adminUserCount',
  'tutorUserCount',
  'studentUserCount',
  'nonActiveUserCount',
  'deletedUserCount',
  'consentedUserCount',
  'knownSyntheticTutorCount',
  'invalidSyntheticTutorCount',
  'tutorProfileCount',
  'invalidTutorProfileCount',
  'teachingListingCount',
  'knownTeachingListingCount',
  'invalidTeachingListingRelationCount',
  'availabilitySlotCount',
  'bookingCount',
] as const;

function normalizeSnapshotValue(value: unknown): number {
  const normalized =
    typeof value === 'bigint' ? Number(value) : typeof value === 'string' ? Number(value) : value;

  if (
    typeof normalized !== 'number' ||
    !Number.isFinite(normalized) ||
    !Number.isInteger(normalized) ||
    normalized < 0
  ) {
    throw new Error('snapshot-value');
  }

  return normalized;
}

function catalogHas(rows: CatalogRow[], table: string, column: string): boolean {
  return rows.some((row) => row.table_name === table && row.column_name === column);
}

function schemaState(rows: CatalogRow[]): ClerkMigrationSchemaState {
  const legacy = catalogHas(rows, 'User', 'email') && catalogHas(rows, 'User', 'passwordHash');
  const clerk =
    catalogHas(rows, 'User', 'clerkUserId') &&
    catalogHas(rows, 'User', 'primaryEmail') &&
    catalogHas(rows, 'ClerkWebhookEvent', 'eventId');

  if (legacy && !clerk) return 'legacy';
  if (clerk && !legacy) return 'clerk';
  return 'unexpected';
}

export async function readClerkMigrationSnapshot(
  client: ClerkMigrationQueryClient,
): Promise<ClerkMigrationSnapshot> {
  const catalog = await client.$queryRawUnsafe<CatalogRow[]>(CATALOG_QUERY);
  const detectedSchemaState = schemaState(catalog);

  if (detectedSchemaState === 'unexpected') throw new Error('schema-state');
  if (detectedSchemaState === 'clerk') {
    return {
      schemaState: 'clerk',
      ...Object.fromEntries(SNAPSHOT_FIELDS.map((field) => [field, 0])),
    } as ClerkMigrationSnapshot;
  }

  const [aggregate] =
    await client.$queryRawUnsafe<Record<string, unknown>[]>(LEGACY_AGGREGATE_QUERY);
  if (!aggregate) throw new Error('snapshot-value');

  return {
    schemaState: 'legacy',
    ...Object.fromEntries(
      SNAPSHOT_FIELDS.map((field) => [field, normalizeSnapshotValue(aggregate[field])]),
    ),
  } as ClerkMigrationSnapshot;
}

export async function runClerkMigrationPreflight(
  client: ClerkMigrationQueryClient,
): Promise<ClerkMigrationPreflightResult> {
  return classifyClerkMigrationSnapshot(await readClerkMigrationSnapshot(client));
}
