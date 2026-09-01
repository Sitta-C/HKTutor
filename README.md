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

Replace every bracketed placeholder in `.env` with values from the Supabase project:

- `DATABASE_URL` — the Supavisor session-mode PostgreSQL connection string on port `5432`, used by
  the NestJS Prisma client and migration commands
- `SUPABASE_URL` — the project API URL
- `SUPABASE_SECRET_KEY` — a server-side `sb_secret_...` key for later NestJS Storage/API work
- `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` — credentials used only to seed the active
  administrator introduced in S1-T07
- `SEED_TUTOR_EMAIL` and `SEED_TUTOR_PASSWORD` — credentials used only to seed the verified tutor
  foundation introduced in S1-T14

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
directories. Once a migration is reviewed and committed, teammates and deployment jobs apply it
in this order:

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

S1-T07 adds the `User` model required by later authentication and authorization tasks. Email uses
PostgreSQL `citext` with a unique index, roles are limited to student, tutor, and admin, and account
status is limited to active, suspended, and deleted. Consent fields remain nullable until the
registration transaction is implemented in S1-T12. Authentication sessions, JWT endpoints, and
guards remain deferred to S1-T08 and S1-T13.

The administrator seed reads `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` only from the ignored
local `.env`. It normalizes the email, stores an Argon2id password hash, and never logs the password
or hash. Re-running the seed preserves an existing administrator's credentials. If the configured
email already belongs to a student or tutor, the seed fails instead of elevating that account.

The migration owner must obtain review of the new migration before changing the shared database.
After review, apply and verify it in this order:

```sh
pnpm db:migrate:status
pnpm db:migrate:deploy
pnpm db:seed
pnpm db:seed
pnpm db:migrate:status
```

Running the seed twice is the idempotency check. Never commit seed credentials or use
`prisma migrate reset` against the shared project.

## Tutor profile and listing foundation (S1-T14)

S1-T14 adds tutor profiles, subjects, grade levels, and teaching listings. The database enforces
non-negative experience and review counts, ratings from 1 through 5 when present, positive listing
prices, bounded non-blank descriptions, and a publication timestamp for published listings.
Foreign keys use restrictive deletes so application workflows cannot silently remove referenced
domain data. The cross-row rule that only a verified tutor may publish is intentionally owned by
the S1-T15 application transaction rather than a database trigger.

The seed requires all four administrator and tutor credential variables in the ignored root
`.env`. It inserts the canonical Mathematics subject, Grade 10 grade level, and one active verified
tutor profile. Re-running it preserves both users' password hashes. It fails if either configured
email already belongs to a different role. The S1-T14 seed unit itself does not insert teaching
listings or synthetic ratings; S1-T20 adds those fixtures in a separate seed unit.

After the S1-T14 pull request is reviewed and merged, the migration owner may apply the shared
database checkpoint in this order:

```sh
pnpm db:migrate:status
pnpm db:migrate:deploy
pnpm db:seed
pnpm db:seed
pnpm db:migrate:status
```

The second seed run verifies idempotency. Stop if the migration status reports drift or an
unexpected history. Never reset the shared Supabase database, and do not deploy or seed it without
the team's explicit checkpoint approval.

## Tutor search fixtures (S1-T20)

S1-T20 extends the existing atomic seed without adding a migration or new environment variables.
The configured tutor becomes the published Mathematics/Grade 10 exact-match fixture. Four
non-loginable tutor accounts under the reserved `hktutor.invalid` domain cover lowest price, the
inclusive THB 500 budget boundary, Physics subject mismatch, and Grade 11 mismatch. Their plaintext
credentials are random and discarded; repeated runs preserve all existing user password hashes.
Each synthetic tutor also has a fixed seed-owned UUID. The seed fails closed if a reserved fixture
email already belongs to any other UUID, even when that account has the tutor role.

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
prices, and ratings; never print fixture emails or password hashes. Do not run
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
  unaccepted, states the version being accepted, and links to the notice in a new tab.
- Registration blocks submission and shows `CONSENT_REQUIRED_MESSAGE` while consent is unaccepted,
  so no onboarding request is issued without it.
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
requires `DATABASE_URL` from the ignored root `.env` and passes it only to the API container.

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
