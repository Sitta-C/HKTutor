# HKTutor

HKTutor is a pnpm monorepo containing the web client, API service, and shared TypeScript configuration for the initial project workspace.

## Prerequisites

- Node.js `24.19.0` (see [`.node-version`](.node-version))
- pnpm `11.19.0` (the version recorded in the root `packageManager` field)
- Docker Desktop or Docker Engine with the Docker Compose plugin

Enable Corepack if pnpm is not already available:

```sh
corepack enable
corepack prepare pnpm@11.19.0 --activate
```

## Install

Install from the repository root. For a clean or CI installation, use the lockfile-enforcing command:

```sh
pnpm install --frozen-lockfile
```

Use `pnpm install` only when intentionally updating dependencies and the committed root `pnpm-lock.yaml`.

## Development and checks

Run all workspace commands from the repository root:

```sh
pnpm dev
pnpm build
pnpm test
pnpm lint
pnpm format:check
pnpm verify:workspace
pnpm check
```

## API contract and CI (S1-T05)

With the API running, the interactive Swagger UI and its machine-readable OpenAPI document are
available at:

- Swagger UI: [http://localhost:3001/api/docs](http://localhost:3001/api/docs)
- OpenAPI JSON: [http://localhost:3001/api/docs-json](http://localhost:3001/api/docs-json)

The API applies one global validation policy. DTO-backed inputs are transformed to their declared
types, properties without validation decorators are rejected, and malformed requests return HTTP
400 validation details instead of reaching a controller with invalid data. Each feature module is
responsible for documenting its own parameters, success response, and expected error responses.

GitHub Actions runs `pnpm install --frozen-lockfile` followed by `pnpm check` for pull requests and
pushes to `main`. The workflow intentionally receives no database or Supabase credentials; unit
tests and the build must remain safe to run without a live shared database.

## Supabase environment

The team uses one shared Supabase project for development and the final demonstration. The
committed [`.env.example`](.env.example) contains placeholders only; actual credentials belong in
the ignored root `.env` file.

For a fresh clone, create the local file before adding credentials:

```sh
cp .env.example .env
```

Replace every bracketed placeholder in `.env` with the corresponding local or hosted value:

- `DATABASE_URL` — the Supavisor session-mode PostgreSQL connection string on port `5432`, used by
  the NestJS Prisma client and migration commands
- `SUPABASE_URL` — the project API URL
- `SUPABASE_SECRET_KEY` — a server-side `sb_secret_...` key for later NestJS Storage/API work
- `CLERK_SECRET_KEY` — the server-only Clerk key used by Next.js middleware and the NestJS API
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` — the browser-safe Clerk key; Next.js embeds it when the web
  application is built
- `NEXT_PUBLIC_BACKEND_URL` — the API URL used by browser requests
- `WEB_ORIGIN` — the web application origin accepted by the NestJS CORS policy
- `SEED_ADMIN_CLERK_USER_ID` and `SEED_ADMIN_EMAIL` — map a pre-provisioned Clerk identity to the
  active local administrator introduced in S1-T07
- `SEED_TUTOR_CLERK_USER_ID` and `SEED_TUTOR_EMAIL` — map a pre-provisioned Clerk identity to the
  verified tutor foundation introduced in S1-T14

The secret key bypasses Row Level Security. It must stay in the NestJS/API environment and must
never use a `NEXT_PUBLIC_*` name or be exposed to the browser. Do not commit `.env` or paste
secrets into documentation, issues, or chat.

## Prisma and shared database workflow (S1-T04)

S1-T04 establishes only the database foundation. Its first migration enables PostgreSQL `citext`
and `btree_gist`; user, tutor, listing, availability, booking, review, and other domain tables
belong to their later sprint tasks.

Generate and validate Prisma locally without connecting to the database:

```sh
pnpm db:generate
pnpm db:validate
```

The team must nominate one migration owner. Only that person creates and commits new migration
directories. This is the S1-T04-only shared-database workflow; whenever S1-T07 is pending, use the
reviewed S1-T07 checkpoint below instead. Once the S1-T04 migration is reviewed and committed,
teammates and deployment jobs apply it in this order:

```sh
pnpm db:migrate:status
pnpm db:migrate:deploy
pnpm db:seed
```

The seed command is idempotent and may be run repeatedly. In S1-T04 it only proves database
connectivity and does not insert domain records. Never run `prisma migrate reset` against the
shared development/demo project. If Prisma reports drift, an unexpected migration history, or a
reset requirement, stop and coordinate with the migration owner instead of forcing a reset.

For `sslmode=require`, the API adapter explicitly opts into libpq-compatible TLS semantics because
the Supabase pooler certificate chain is not trusted by Node.js by default. This keeps the
connection encrypted but does not verify the certificate or hostname. A production deployment
with stronger identity verification should install the Supabase CA certificate and use
`sslmode=verify-full`.

The database-aware API check is available at
[http://localhost:3001/api/health](http://localhost:3001/api/health). A healthy response has the
body `{ "database": "connected" }`.

## User and administrator seed foundation (S1-T07)

S1-T07 defines the Clerk-backed local `User` model required by later authentication and
authorization tasks. The local UUID remains the domain primary key, `clerkUserId` is the unique
external identity, and nullable CITEXT `primaryEmail` is only a synchronized cache. Roles are
limited to student, tutor, and admin; account status is limited to active, suspended, and deleted.
Consent fields remain nullable until the onboarding transaction is implemented in S1-T12. Clerk
owns credentials and sessions; the application stores no password hash or refresh token.

The administrator seed reads `SEED_ADMIN_CLERK_USER_ID` and `SEED_ADMIN_EMAIL` from the ignored
local `.env`. It upserts by Clerk identity, refreshes the cached primary email, and refuses to
elevate an existing student or tutor. Public onboarding must never create an administrator.

The reviewed S1-T07 migration replaces the historical email/password `User` table with the
Clerk-backed shape. It has been rehearsed against the accepted historical states; this pull request
did not touch shared Supabase. Shared deployment still needs a separate, explicit approval from the
team and must be performed by the migration owner.

From the repository root, after that approval, use this exact sequence:

```sh
pnpm db:migrate:status
pnpm db:preflight:s1-t07-clerk
pnpm db:migrate:deploy
pnpm db:seed
pnpm db:seed
pnpm db:migrate:status
```

The first status result must show
`20260901160000_migrate_user_identity_to_clerk` as the **only** pending migration. If any other
migration is pending, stop and require its own review and explicit deployment approval; do not let
`pnpm db:migrate:deploy` apply it as part of this checkpoint. After preflight authorizes continuing,
make and verify a backup checkpoint before `pnpm db:migrate:deploy`. The CLI can successfully report
`already-migrated`, but that is not authorization to deploy or reseed. Only `empty`,
`s1-t14-seed`, or `s1-t20-seed` authorize continuing; `already-migrated`, any other result, command
failure, drift, or unexpected migration history stops deployment. Do not reset or force cleanup:
preserve the state and coordinate with the migration owner.

The migration purges and reseeds identity/demo rows in `Booking`, `AvailabilitySlot`,
`TeachingListing`, `TutorProfile`, and `User`; it preserves `Subject` and `GradeLevel`. The current
seed requires the test/deployment Clerk mappings in the ignored root `.env`, and the second,
idempotent seed run verifies that rerunning it is safe. Never print or log a secret, a Clerk identity
mapping, or a connection-string value.

After the second seed and final `pnpm db:migrate:status` report success and an up-to-date schema,
run these redacted checks from the repository root. They print only aggregate counts and catalog
booleans; they do not select identities, cached emails, secrets, or the connection-string value.
This requires `psql` 18 or a compatible PostgreSQL client. Inspect and trust the ignored root
`.env` before running the block: it is sourced only inside a temporary subshell so its exported
secrets do not remain in the operator's shell afterward.

```sh
(
  command -v psql >/dev/null 2>&1 || {
    printf '%s\n' 'S1-T07 verification requires psql 18 or a compatible PostgreSQL client.' >&2
    exit 1
  }
  if [ ! -r ./.env ]; then
    printf '%s\n' 'S1-T07 verification requires the trusted ignored root .env file.' >&2
    exit 1
  fi
  unset DATABASE_URL
  set -a; . ./.env; set +a
  if [ -z "${DATABASE_URL:-}" ]; then
    printf '%s\n' 'S1-T07 verification stopped: DATABASE_URL is unset.' >&2
    exit 1
  fi

  PGDATABASE="$DATABASE_URL" psql -X -v ON_ERROR_STOP=1 -P pager=off <<'SQL'
SELECT
  (SELECT COUNT(*) FROM "User") AS users,
  (SELECT COUNT(*) FROM "User" WHERE "role" = 'admin') AS admins,
  (SELECT COUNT(*) FROM "User" WHERE "role" = 'tutor') AS tutors,
  (SELECT COUNT(*) FROM "User" WHERE "role" = 'student') AS students,
  (SELECT COUNT(*) FROM "TutorProfile") AS tutor_profiles,
  (SELECT COUNT(*) FROM "Subject") AS subjects,
  (SELECT COUNT(*) FROM "GradeLevel") AS grade_levels,
  (SELECT COUNT(*) FROM "TeachingListing") AS teaching_listings,
  (SELECT COUNT(*) FROM "TeachingListing" WHERE "publicationStatus" = 'published') AS published_listings,
  (SELECT COUNT(*) FROM "TeachingListing" WHERE "publicationStatus" = 'draft') AS draft_listings,
  (SELECT COUNT(*) FROM "AvailabilitySlot") AS availability_slots,
  (SELECT COUNT(*) FROM "Booking") AS bookings,
  (SELECT COUNT(*) FROM "ClerkWebhookEvent") AS webhook_events;

SELECT
  to_regclass('"User_clerkUserId_key"') IS NOT NULL AS user_clerk_id_index,
  to_regclass('"User_active_primaryEmail_key"') IS NOT NULL AS user_active_email_index,
  to_regclass('"ClerkWebhookEvent"') IS NOT NULL AS webhook_table,
  to_regclass('"ClerkWebhookEvent_clerkUserId_idx"') IS NOT NULL AS webhook_clerk_user_index,
  COALESCE((
    SELECT array_agg(enum_value.enumlabel::text ORDER BY enum_value.enumsortorder) = ARRAY['processed', 'failed']::text[]
    FROM pg_type AS enum_type
    JOIN pg_enum AS enum_value ON enum_value.enumtypid = enum_type.oid
    JOIN pg_namespace AS enum_schema ON enum_schema.oid = enum_type.typnamespace
    WHERE enum_schema.nspname = current_schema()
      AND enum_type.typname = 'ClerkWebhookStatus'
  ), false) AS webhook_status_enum_exact;
SQL
)
```

The aggregate row must be exactly `6, 1, 5, 0, 5, 2, 2, 6, 5, 1, 0, 0, 0` in the displayed
column order, and every catalog boolean must be `t`. Any difference stops the checkpoint for
investigation without reset or forced cleanup.

## Tutor profile and listing foundation (S1-T14)

S1-T14 adds tutor profiles, subjects, grade levels, and teaching listings. The database enforces
non-negative experience and review counts, ratings from 1 through 5 when present, positive listing
prices, bounded non-blank descriptions, and a publication timestamp for published listings.
Foreign keys use restrictive deletes so application workflows cannot silently remove referenced
domain data. The cross-row rule that only a verified tutor may publish is intentionally owned by
the S1-T15 application transaction rather than a database trigger.

The seed requires the administrator and tutor Clerk user ID/email mappings in the ignored root
`.env`. It inserts the canonical Mathematics subject, Grade 10 grade level, and one active verified
tutor profile. Re-running it refreshes the cached emails without changing either local role. It
fails if either Clerk identity already belongs to a different role. The S1-T14 seed unit itself does
not insert teaching listings or synthetic ratings; S1-T20 adds those fixtures in a separate seed
unit.

After an S1-T14 pull request is reviewed and merged, any shared checkpoint must still follow the
reviewed S1-T07 sequence above, including preflight and the backup checkpoint:

```sh
pnpm db:migrate:status
pnpm db:preflight:s1-t07-clerk
pnpm db:migrate:deploy
pnpm db:seed
pnpm db:seed
pnpm db:migrate:status
```

The second seed run verifies idempotency. Never reset the shared Supabase database, and do not
deploy or seed it without the team's explicit checkpoint approval.

## Tutor search fixtures (S1-T20)

S1-T20 extends the existing atomic seed without adding a migration or new environment variables.
The configured tutor becomes the published Mathematics/Grade 10 exact-match fixture. Four
non-loginable local tutor fixtures under the reserved `hktutor.invalid` domain cover lowest price,
the inclusive THB 500 budget boundary, Physics subject mismatch, and Grade 11 mismatch. Each uses a
deterministic placeholder Clerk user ID and a fixed seed-owned UUID; no Clerk account or credential
is created. The seed fails closed if a reserved fixture Clerk user ID resolves to any other UUID,
even when that account has the tutor role.

The fixture set contains five published listings plus one draft listing. Published prices and
ratings are deterministic: Anan 400/4.8, Mali 350/4.4, Kiet 500/4.0, Niran 400/4.7, and Pim
450/4.6. The draft listing is cheaper than every published listing so S1-T21 can prove publication
filtering. Ratings are a Sprint 1-2 query cache; Review becomes canonical in Sprint 3.

The intended S1-T21 query contract is: Mathematics/Grade 10 with a THB 500 maximum returns Anan,
Mali, and Kiet; lowering the maximum below THB 350 returns no published result. Niran must not
appear in Mathematics results, Pim must not appear in Grade 10 results, and the THB 300 draft must
never appear in public search.

S1-T20 changes seed data only. After review and merge, obtain explicit approval before changing the
shared project, then run:

```sh
pnpm db:migrate:status
pnpm db:seed
pnpm db:seed
pnpm db:migrate:status
```

The second seed run verifies idempotency. Verify only redacted counts, roles, publication states,
prices, and ratings; never print fixture Clerk IDs or cached emails. Do not run
`pnpm db:migrate:deploy` for S1-T20 because it has no migration.

## Availability slot foundation (S1-T17)

Availability slots belong to `TutorProfile`. Each slot stores `startAtUtc` and `endAtUtc` as
`TIMESTAMPTZ(3)`. The database checks that `startAtUtc < endAtUtc`, and a partial GiST exclusion
constraint rejects overlapping slots only when `deletedAt` is null. The range is half-open (`[)`),
so adjacent slots such as `18:00-19:00` and `19:00-20:00` are permitted. The future-only rule
belongs to S1-T18; S1-T23 adds the database guards; S1-T18 maps them into the deletion API transaction.

S1-T17 has no seed and no stored availability state. After pulling or merging this migration, run
`pnpm db:generate` so the generated Prisma client matches the schema. After the PR is reviewed and
merged, and deployment is separately approved, shared deployment is only the following
`status -> deploy -> status` sequence. Stop if status reports drift or unexpected migration history.

```sh
pnpm db:migrate:status
pnpm db:migrate:deploy
pnpm db:migrate:status
```

## Booking foundation (S1-T23)

S1-T23 adds the Sprint 1 `Booking` persistence boundary without adding an API, UI, or seed. A
Booking snapshots student, tutor profile, listing, slot, THB subtotal/discount/net amounts, and one
of `pending`, `confirmed`, `completed`, or `canceled`. Booking history is retained; restrictive
foreign keys prevent destructive cascades.

Slot availability remains derived rather than stored. PostgreSQL permits only one `pending` or
`confirmed` Booking per slot through `Booking_active_slot_key`; completed/canceled history releases
the slot. Row-locking guards reject an active Booking on a soft-deleted slot and reject soft-deleting
a slot with an active Booking. S1-T18/S1-T24 map the named database conflicts to HTTP 409 and own the
application validation/transaction behavior.

After review and merge, obtain separate approval before changing shared Supabase. The migration
checkpoint is `status -> deploy -> status`, followed by a redacted conflict probe inside a transaction
that always rolls back. S1-T23 has no seed step; never run `prisma migrate reset`.

## Sprint 1 database contract verification

The final Sprint 1 alignment keeps cached primary email unique for every non-deleted Local User,
including suspended accounts. Soft deletion releases the email for reuse. It also prevents a partial
consent state: `consentAcceptedAt` and a non-blank `policyVersion` must either be stored together or
both remain null for separately provisioned/demo users. These database invariants do not authorize
public onboarding or replace the S1-T12 application transaction.

Use `db:verify:sprint1` only against a disposable local PostgreSQL database whose name starts with
`hktutor-` or `hktutor_`. The command refuses remote hosts and also requires an explicit disposable
database flag. It verifies the deterministic seed shape, case-insensitive catalogs, check and
exclusion constraints, restrictive foreign keys, slot-release behavior, and a two-connection booking
race. Transactional probes roll back; the concurrency fixture is removed before exit.

For a fresh disposable database, use this sequence after starting PostgreSQL locally:

```sh
export DATABASE_URL='postgresql://postgres@127.0.0.1:5432/hktutor-sprint1-contract'
export HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1
export SEED_ADMIN_CLERK_USER_ID='user_local_contract_admin'
export SEED_ADMIN_EMAIL='admin@local.hktutor.invalid'
export SEED_TUTOR_CLERK_USER_ID='user_local_contract_tutor'
export SEED_TUTOR_EMAIL='tutor@local.hktutor.invalid'

pnpm db:migrate:deploy
pnpm db:seed
pnpm db:seed
pnpm db:verify:sprint1
pnpm db:migrate:status
```

The second seed run is the idempotency check. Destroy the disposable database after verification.
This sequence is not a shared-Supabase deployment runbook: shared migration or seed remains a
separate approval checkpoint, and `prisma migrate reset` remains prohibited there.

`pnpm dev` starts both application packages concurrently. The intended local URLs are:

- Web: [http://localhost:3000](http://localhost:3000)
- API: [http://localhost:3001](http://localhost:3001)

The web development server always uses port `3000`. The API defaults to `3001` and may be moved without affecting the web server by setting `PORT` on the root command:

```sh
PORT=3002 pnpm dev
```

`pnpm lint` is read-only and treats warnings as failures. Formatting is also checked without
modifying files. Apply either operation intentionally with:

```sh
pnpm lint:fix
pnpm format
```

The shared ESLint presets enforce import grouping, type-only imports, promise safety, and the
boundary between web and API source. Both apps use `@/*` for imports rooted in their own `src`
directory; neither app may use it to import source from the other app.

To operate on one package, use pnpm filters:

```sh
pnpm --filter @hktutor/web dev
pnpm --filter @hktutor/web build
pnpm --filter @hktutor/api dev
pnpm --filter @hktutor/api test
```

## Privacy notice and onboarding consent (S1-T11)

`apps/web/src/lib/privacy-notice.ts` is the single source of truth for the privacy notice text,
its version string, and the consent payload shape. The current version is `2026-08-01`, matching
the `policyVersion` value in the US11-2 acceptance criteria.

- The full notice renders at [http://localhost:3000/privacy](http://localhost:3000/privacy) as a
  server component; it names Clerk as the identity and authentication processor, records that
  HKTutor stores no password, hash, JWT secret, or refresh token, and describes Supabase as the
  database and private-storage processor.
- `apps/web/src/components/privacy-consent.tsx` is the reusable consent control. Consent starts
  unaccepted, states the version being accepted, and links to the notice in a new tab. Its short
  consent line is translated through `@/lib/i18n` (`register.policyBefore`, `policyLink`,
  `policyAfter`, `policyRequired`); `policyAfter` interpolates `{version}` from
  `PRIVACY_POLICY_VERSION`, so both languages state the version actually being accepted.
- Registration blocks submission and shows `copy.register.policyRequired` while consent is
  unaccepted, so no onboarding request is issued without it. `CONSENT_REQUIRED_MESSAGE` remains the
  untranslated default for non-UI callers.
- The notice body itself is English only. Translating it is follow-up work and must ship with its
  own version bump so each language maps to one accepted wording.
- `buildOnboardingConsent(accepted)` returns `{ consent, policyVersion }`. S1-T12 consumes it and
  persists `consentAcceptedAt` and `policyVersion` inside the Local User onboarding transaction;
  S1-T11 itself adds no API route, database change, or environment variable.

Whenever the notice wording changes in a way that affects what is collected or why, raise
`PRIVACY_POLICY_VERSION` so stored consent stays attributable to the wording that was accepted.

`tests/privacy-consent-foundation.test.mjs` holds the repository-level contract for the version
string, the required disclosure topics, the consent control, and the registration guard.

## Docker Compose

Build and start the production Web and API containers from the repository root:

```sh
docker compose up --build --detach --wait
```

The published endpoints are:

- Web: [http://localhost:3000](http://localhost:3000)
- API: [http://localhost:3001](http://localhost:3001)

Inspect container health or logs with:

```sh
docker compose ps
docker compose logs --follow web api
```

If the default host ports are already in use, override them without changing the ports inside the
containers:

```sh
WEB_PORT=3100 API_PORT=3101 docker compose up --build --detach --wait
```

Stop and remove the containers and project network with:

```sh
docker compose down
```

Compose intentionally contains only `web` and `api`. PostgreSQL and file storage are managed by
the shared Supabase project; no database container or persistent volume belongs here. Compose
requires `DATABASE_URL`, `CLERK_SECRET_KEY`, and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` from the
ignored root `.env`. It supplies browser-visible values to the Next.js build, keeps the Clerk
secret out of image build arguments, and configures the API CORS origin through `WEB_ORIGIN`.

## Repository boundaries

- `apps/web` — Next.js web client (`@hktutor/web`)
- `apps/api` — NestJS API service (`@hktutor/api`)
- `packages/eslint-config` — shared ESLint presets (`@hktutor/eslint-config`)
- `packages/tsconfig` — shared strict TypeScript baseline (`@hktutor/tsconfig`)
- Root `package.json`, `pnpm-workspace.yaml`, and `pnpm-lock.yaml` — the sole workspace and dependency-install authority

Do not run per-package installs or add nested lockfiles. Dependencies belong in the package that consumes them and are resolved by the root pnpm workspace.

## Deferred work

This workspace still excludes later-sprint infrastructure and product features, including Redis,
queues/brokers, Socket.IO, Supabase JavaScript client integration, availability, bookings,
reviews and application-specific tutor workflows. S1-T11 adds only the privacy notice and its
onboarding consent control; consent persistence, Clerk token verification, and the onboarding
endpoint belong to S1-T08 and S1-T12. S1-T04 includes the
Prisma/Supabase PostgreSQL foundation and database health check; S1-T14 adds only the tutor profile
and teaching-listing persistence foundation plus catalog and verified-tutor seed data.
