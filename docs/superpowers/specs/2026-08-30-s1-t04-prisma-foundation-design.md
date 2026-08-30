# S1-T04 Prisma Foundation Design

## Objective

Configure the API to use Prisma with the existing shared Supabase PostgreSQL project, commit a safe first migration and an idempotent seed command, and expose a database-aware health endpoint without implementing domain tables assigned to later sprint tasks.

## Scope

S1-T04 owns:

- Prisma 7.10.0 configuration and generated-client workflow for `apps/api`.
- A reusable NestJS database module backed by `@prisma/adapter-pg` and `pg`.
- Strict `DATABASE_URL` startup validation that never includes the secret value in errors.
- `GET /api/health`, returning HTTP 200 and `{ "database": "connected" }` after a successful database probe, or HTTP 503 and `{ "database": "disconnected" }` when the probe fails.
- A foundation migration enabling the `citext` and `btree_gist` PostgreSQL extensions.
- An idempotent seed command that verifies connectivity without inserting domain data.
- Docker, Compose, environment-template, test, and runbook updates required to exercise the preceding behavior.

S1-T04 explicitly does not own:

- `User`, `Role`, or administrator seed data, which belong to S1-T07.
- Tutor, listing, rating, availability, booking, or other domain tables and fixtures assigned to later tasks.
- A second Supabase project, a custom database role, or a separate `DIRECT_URL`.
- Destructive reset of the shared development/demo database.

## Architecture

The API uses the Supabase Supavisor session-mode connection on port 5432 through a single `DATABASE_URL`. Prisma Client is generated into `apps/api/src/generated/prisma` and excluded from Git; both local and Docker builds generate it from the committed schema. `prisma.config.ts` permits `prisma generate` without a real connection string, while the NestJS configuration validator and database commands reject a missing or blank `DATABASE_URL` before attempting a connection.

For a URL with `sslmode=require`, the Node PostgreSQL adapter adds `uselibpqcompat=true` unless the operator already selected a compatibility mode. This preserves the standard libpq meaning of `require` for the shared demo pooler and avoids Node's temporary verify-full interpretation of that value. A production environment that needs server identity verification installs the Supabase CA certificate and selects `sslmode=verify-full` instead.

`DatabaseModule` owns a singleton `PrismaService`. The service constructs `PrismaClient` with `PrismaPg`, connects during Nest application initialization, probes with `SELECT 1`, and disconnects during shutdown. `HealthController` converts probe success into the stable response contract and converts a connection/query failure into an HTTP 503 response without returning the caught error.

The first migration is intentionally SQL-only and contains no business tables. It creates `citext` and `btree_gist` in the Supabase `extensions` schema. The seed runner connects, executes `SELECT 1`, disconnects in `finally`, and can be run repeatedly with the same result.

## Security and Operations

- `.env` remains ignored and is never copied into a Docker image.
- The API build and runtime image includes OpenSSL, and TypeScript build scope remains under `src` so the production entrypoint is `dist/main.js`.
- Logs, thrown configuration errors, health responses, documentation examples, and command output must not contain the database password or complete connection URL.
- Only the designated migration owner creates migration files. Other developers and deployment jobs use `prisma migrate deploy`.
- `prisma migrate reset` is prohibited for the shared development/demo project.
- Before the first remote migration, the connection target is checked in a redacted form. The password is never printed.
- Migration and seed commands are run only after local tests, lint, formatting, build, Prisma validation, and generated-client checks pass.

## Acceptance Criteria

1. `pnpm db:generate` succeeds without requiring a committed or build-time secret.
2. Starting the API without `DATABASE_URL` fails with the exact safe message `DATABASE_URL is required` and does not print a secret.
3. With a reachable shared Supabase database, `GET /api/health` returns HTTP 200 and `{ "database": "connected" }`.
4. When the database probe fails, `GET /api/health` returns HTTP 503 and `{ "database": "disconnected" }` without exposing the underlying error.
5. The committed first migration enables `citext` and `btree_gist` and creates no domain tables.
6. `pnpm db:seed` succeeds twice consecutively without inserting or duplicating domain records.
7. Compose passes only `DATABASE_URL` to the API and checks `/api/health`.
8. The API production image contains the generated Prisma Client but no `.env` file.
9. Workspace tests, API tests, formatting, lint, build, Prisma validation, migration status, and seed verification pass.
