import {
  classifyClerkMigrationSnapshot,
  formatClerkMigrationPreflightResult,
  readClerkMigrationSnapshot,
  runClerkMigrationPreflight,
  type ClerkMigrationQueryClient,
  type ClerkMigrationSnapshot,
} from '@/database/clerk-migration-preflight';

const legacyCatalog = [
  { table_name: 'User', column_name: 'email' },
  { table_name: 'User', column_name: 'passwordHash' },
];

const clerkCatalog = [
  { table_name: 'User', column_name: 'clerkUserId' },
  { table_name: 'User', column_name: 'primaryEmail' },
  { table_name: 'ClerkWebhookEvent', column_name: 'eventId' },
];

const aggregateSnapshot = (override: Record<string, unknown> = {}) => ({
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

interface QueryDouble extends ClerkMigrationQueryClient {
  queries: string[];
}

const queryClient = (...results: unknown[]): QueryDouble => {
  let next = 0;
  const queries: string[] = [];
  return {
    queries,
    $queryRawUnsafe: <T = unknown>(query: string): Promise<T> => {
      queries.push(query);
      return Promise.resolve(results[next++] as T);
    },
  };
};

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

it('reads the legacy snapshot through the static aggregate query', async () => {
  const client = queryClient(legacyCatalog, [aggregateSnapshot()]);

  await expect(readClerkMigrationSnapshot(client)).resolves.toEqual(legacySnapshot());
  expect(client.queries).toHaveLength(2);

  const aggregateQuery = client.queries[1];
  expect(aggregateQuery).not.toMatch(
    /SELECT[\s\S]*"(?:email|passwordHash|clerkUserId|primaryEmail)"/i,
  );
  expect(aggregateQuery).not.toMatch(/\b(?:email|passwordHash|clerkUserId|primaryEmail)\s+AS\s+/i);
});

it('constructs a balanced legacy aggregate with the migration consent predicate', async () => {
  const client = queryClient(legacyCatalog, [aggregateSnapshot()]);

  await readClerkMigrationSnapshot(client);

  const aggregateQuery = client.queries[1];
  expect((aggregateQuery.match(/\(/g) ?? []).length).toBe(
    (aggregateQuery.match(/\)/g) ?? []).length,
  );
  expect(aggregateQuery).toContain(
    'u."consentAcceptedAt" IS NOT NULL OR u."policyVersion" IS NOT NULL',
  );
  expect(aggregateQuery).toContain('::extensions.citext');
  expect(aggregateQuery).not.toContain('::citext');
});

it('returns already-migrated without querying legacy columns for the Clerk catalog', async () => {
  const client = queryClient(clerkCatalog);

  await expect(runClerkMigrationPreflight(client)).resolves.toEqual({ state: 'already-migrated' });
  expect(client.queries).toHaveLength(1);
});

it('rejects an unexpected catalog column combination as schema-state', async () => {
  const client = queryClient([{ table_name: 'User', column_name: 'email' }]);

  await expect(readClerkMigrationSnapshot(client)).rejects.toThrow('schema-state');
});

it('normalizes bigint and string aggregate values before classifying', async () => {
  const client = queryClient(legacyCatalog, [
    aggregateSnapshot({
      userCount: BigInt(2),
      adminUserCount: '1',
      tutorUserCount: '1',
      tutorProfileCount: '1',
    }),
  ]);

  await expect(runClerkMigrationPreflight(client)).resolves.toEqual({ state: 's1-t14-seed' });
});

it.each([
  ['malformed', 'one'],
  ['negative', -1],
  ['non-integral', 1.5],
])('rejects %s aggregate counts as snapshot-value', async (_label, userCount) => {
  const client = queryClient(legacyCatalog, [aggregateSnapshot({ userCount })]);

  await expect(readClerkMigrationSnapshot(client)).rejects.toThrow('snapshot-value');
});
