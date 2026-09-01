# HKTutor API

This is the HKTutor NestJS API service. The repository root [README](../../README.md) is the authoritative guide for installation, workspace commands, database migrations, and development checks.

From the repository root, configure the ignored `.env`, then run `pnpm --filter @hktutor/api dev`
to start the API on [http://localhost:3001](http://localhost:3001). Set `PORT` to use another API
port. The database-aware health endpoint is
[http://localhost:3001/api/health](http://localhost:3001/api/health).

The shared API contract is published at:

- Swagger UI: [http://localhost:3001/api/docs](http://localhost:3001/api/docs)
- OpenAPI JSON: [http://localhost:3001/api/docs-json](http://localhost:3001/api/docs-json)

All DTO-backed request input passes through the global NestJS `ValidationPipe`. DTOs should use
concrete classes with `class-validator` decorators and explicit `class-transformer` conversions
where a query or path value is not a string. Undeclared properties and invalid values return HTTP 400. Controllers are responsible for adding Swagger parameter, response, and example metadata as
their endpoints are introduced.

Prisma commands are exposed from the repository root:

```sh
pnpm db:generate
pnpm db:validate
pnpm db:migrate:status
pnpm db:preflight:s1-t07-clerk
pnpm db:migrate:deploy
pnpm db:seed
```

These root commands delegate to this API package; do not copy the root workspace command sequence
into an `apps/api` shell. Only the designated migration owner creates migrations. Never reset the
shared development/demo database.

S1-T07 maps a pre-provisioned Clerk administrator through `SEED_ADMIN_CLERK_USER_ID` and
`SEED_ADMIN_EMAIL` in the ignored root `.env`. The seed upserts by Clerk identity, refreshes the
cached primary email, and refuses to promote an existing student/tutor account. The application
does not store local passwords or sessions.

The reviewed S1-T07 migration replaces the historical email/password `User` table with the
Clerk-backed shape. It was rehearsed against accepted historical states, but this pull request did
not touch shared Supabase. A shared deployment still requires separate, explicit team approval and
the migration owner.

From the repository root, and only after approval, run this exact sequence:

```sh
pnpm db:migrate:status
pnpm db:preflight:s1-t07-clerk
pnpm db:migrate:deploy
pnpm db:seed
pnpm db:seed
pnpm db:migrate:status
```

Once preflight accepts a recognized state, make and verify a backup checkpoint before deploy.
Preflight accepts only `empty`, `s1-t14-seed`, or `s1-t20-seed`. Any other result, command failure,
drift, or unexpected migration history stops deployment without reset or forced cleanup; preserve the
state and coordinate with the migration owner.

The migration purges and reseeds identity/demo rows in `Booking`, `AvailabilitySlot`,
`TeachingListing`, `TutorProfile`, and `User`, while preserving `Subject` and `GradeLevel`. The
current seed requires test/deployment Clerk mappings from the ignored root `.env`; running it twice
is the idempotency verification. Never print or log secrets, Clerk identity mappings, or
connection-string values.

S1-T14 additionally requires `SEED_TUTOR_CLERK_USER_ID` and `SEED_TUTOR_EMAIL`. The same atomic,
idempotent seed inserts Mathematics, Grade 10, and one active verified tutor profile while syncing
cached emails by Clerk identity. The migration adds tutor profiles, subjects, grade levels, and
teaching listings; publication authorization remains an S1-T15 application rule.

Only after the S1-T14 migration has been reviewed, merged, and explicitly approved for the shared
checkpoint should the migration owner use the reviewed S1-T07 sequence above, including preflight
and the backup checkpoint. Never use `prisma migrate reset` against the shared project.

### Tutor search fixtures (S1-T20)

S1-T20 adds deterministic teaching-listing and seeded-rating fixtures to the same transaction. It
uses the configured tutor plus four non-loginable local `hktutor.invalid` tutor fixtures to cover exact
Mathematics/Grade 10 matches, THB 350 and THB 500 budget cases, Physics mismatch, Grade 11 mismatch,
and one cheaper draft listing. Synthetic fixtures use deterministic placeholder Clerk user IDs and
fixed UUIDs without creating Clerk accounts or credentials. A fixture Clerk user ID resolving to
any other UUID aborts the transaction so no search fixture profile or listing changes are committed.

The S1-T21 contract is Mathematics/Grade 10 at a THB 500 maximum returning Anan, Mali, and Kiet;
below THB 350 it returns no published result. Physics, Grade 11, and draft fixtures must remain
excluded from that result set.

S1-T20 requires no new environment variables and has no migration. After merge and separate shared
checkpoint approval, run `status -> seed -> seed -> status`, then verify redacted fixture counts and
states. Do not run migrate deploy for this task.

### Availability slot foundation (S1-T17)

Availability slots belong to `TutorProfile` and store `startAtUtc`/`endAtUtc` as `TIMESTAMPTZ(3)`.
The database checks `startAtUtc < endAtUtc` and uses a partial GiST exclusion for overlaps only
when `deletedAt` is null; its `[)` range permits adjacent slots. The future-only rule is deferred
to S1-T18, and S1-T23 adds the database guards; S1-T18 maps them into the deletion API transaction. S1-T17 has no seed and
no stored availability state. After pulling or merging, run `pnpm db:generate` to match the
generated client to the schema. After the PR is reviewed and merged, and deployment is separately
approved, shared deployment is only (see the root README for drift and unexpected-history stop
conditions):

```sh
pnpm db:migrate:status
pnpm db:migrate:deploy
pnpm db:migrate:status
```

`pnpm db:seed` is intentionally absent from the S1-T17 checkpoint.

### Booking foundation (S1-T23)

`Booking` stores the Sprint 1 ownership/reservation and THB price snapshot needed by S1-T24. Active
status means only `pending` or `confirmed`; `Booking_active_slot_key` prevents concurrent active
duplicates while completed/canceled rows retain history without reserving the slot.

The database exposes `Booking_active_slot_not_deleted_check` and
`AvailabilitySlot_active_booking_delete_check` for the two slot soft-delete conflicts. S1-T18/S1-T24
must still lock/read the slot in their domain transactions and map these named conflicts to HTTP 409.
Roles, future time, own-tutor rejection, listing publication, and listing/slot tutor equality remain
application rules. This task adds no endpoint or seed.

Shared deployment remains separately approved: run `status -> deploy -> status`, then a
rollback-only redacted conflict probe. Do not seed or reset for S1-T23.

Pull requests and pushes to `main` run the root `pnpm check` command in GitHub Actions. CI does not
receive shared-database credentials.
