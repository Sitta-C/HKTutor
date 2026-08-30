# S1-T04 Prisma Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Configure Prisma and the shared Supabase PostgreSQL connection, commit a safe foundation migration and idempotent seed command, and make the API health endpoint prove database connectivity.

**Architecture:** The NestJS API owns one `PrismaService` using Prisma 7.10.0, `@prisma/adapter-pg`, and the Supabase session-mode `DATABASE_URL`. The initial SQL migration enables only `citext` and `btree_gist`; domain models and fixtures remain in their later sprint tasks. Configuration validation, health responses, migrations, seed execution, and Docker builds never expose or bake in secrets.

**Tech Stack:** Node.js 24.19.0, pnpm 11.19.0, NestJS 11, Prisma 7.10.0, PostgreSQL/Supabase, Jest 30, Node test runner, Docker Compose

**Spec:** `docs/superpowers/specs/2026-08-30-s1-t04-prisma-foundation-design.md`

## Global Constraints

- Use one shared development/demo Supabase project and one session-mode `DATABASE_URL` on port 5432.
- Pin `prisma`, `@prisma/client`, and `@prisma/adapter-pg` to exactly `7.10.0`.
- Create no business tables or domain seed rows in S1-T04.
- Never print `DATABASE_URL`, its password, or `SUPABASE_SECRET_KEY`.
- Never run `prisma migrate reset` against the shared project.
- Follow RED-GREEN-REFACTOR for every production behavior.

---

### Task 1: Prisma workspace contract

**Files:**

- Modify: `tests/workspace-structure.test.mjs`
- Create: `tests/prisma-foundation.test.mjs`
- Modify: `apps/api/package.json`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Consumes: existing pnpm workspace and API package.
- Produces: root `db:generate`, `db:validate`, `db:migrate:deploy`, `db:migrate:status`, and `db:seed` commands; pinned Prisma dependencies in `@hktutor/api`.

- [x] **Step 1: Write the failing workspace contract tests**

  Add tests asserting that the API package pins Prisma packages to `7.10.0`, includes `pg`, `@types/pg`, `dotenv`, and `tsx`, and exposes the required database scripts at both API and root scope. Replace the obsolete blanket prohibition on Prisma with a test that still forbids Redis, queues, Socket.IO, Supabase JavaScript clients, and Prisma dependencies outside the API package.

- [x] **Step 2: Run the contract tests and verify RED**

  Run `node --test tests/workspace-structure.test.mjs tests/prisma-foundation.test.mjs` and confirm failure because the Prisma dependencies and scripts do not exist.

- [x] **Step 3: Install the pinned dependencies and add scripts**

  Install API runtime dependencies `@prisma/client@7.10.0`, `@prisma/adapter-pg@7.10.0`, `pg`, `@nestjs/config`, and `dotenv`; install API development dependencies `prisma@7.10.0`, `tsx`, and `@types/pg`. Add API scripts `db:generate`, `db:validate`, `db:migrate:deploy`, `db:migrate:status`, and `db:seed`, then add root forwarding scripts using `pnpm --filter @hktutor/api`.

- [x] **Step 4: Run the contract tests and verify GREEN**

  Run `node --test tests/workspace-structure.test.mjs tests/prisma-foundation.test.mjs` and confirm all contract tests pass.

### Task 2: Safe database configuration and Prisma lifecycle

**Files:**

- Create: `apps/api/src/config/database.config.spec.ts`
- Create: `apps/api/src/config/database.config.ts`
- Create: `apps/api/src/config/database-url.spec.ts`
- Create: `apps/api/src/config/database-url.ts`
- Create: `apps/api/src/database/prisma.service.spec.ts`
- Create: `apps/api/src/database/prisma.service.ts`
- Create: `apps/api/src/database/database.module.ts`
- Create: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma.config.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `.gitignore`

**Interfaces:**

- Consumes: `process.env.DATABASE_URL` and the generated `PrismaClient`.
- Produces: `validateDatabaseEnvironment(config: Record<string, unknown>): Record<string, unknown>` and injectable `PrismaService` with `onModuleInit()`, `onModuleDestroy()`, and `isHealthy(): Promise<boolean>`.

- [x] **Step 1: Write the failing configuration tests**

  Assert that missing, empty, and whitespace-only values throw `DATABASE_URL is required`, that valid values are returned unchanged, and that error messages never contain a supplied URL.

- [x] **Step 2: Run the configuration tests and verify RED**

  Run `pnpm --filter @hktutor/api test -- database.config.spec.ts --runInBand` and confirm failure because `database.config.ts` does not exist.

- [x] **Step 3: Implement minimal safe validation**

  Implement `validateDatabaseEnvironment` using a trimmed string presence check and return the original configuration object unchanged when valid.

- [x] **Step 4: Run the configuration tests and verify GREEN**

  Re-run the focused Jest command and confirm the configuration tests pass.

- [x] **Step 5: Write failing Prisma lifecycle and health-probe tests**

  Exercise a real `PrismaService` instance with its external client methods replaced at the network boundary. Assert initialization calls `$connect`, destruction calls `$disconnect`, a successful `$queryRaw` returns `true`, and a rejected `$queryRaw` returns `false` without throwing.

- [x] **Step 6: Run the Prisma service tests and verify RED**

  Run `pnpm --filter @hktutor/api test -- prisma.service.spec.ts --runInBand` and confirm failure because the service does not exist.

- [x] **Step 7: Add schema/config, generate the client, and implement the service**

  Configure a PostgreSQL datasource and a generated client output at `../src/generated/prisma`. Configure `prisma.config.ts` with schema, migrations, seed command, and `process.env['DATABASE_URL'] ?? ''`. Generate the client, implement the lifecycle/probe methods, create a global `DatabaseModule`, and load it from `AppModule` together with a global `ConfigModule` using `validateDatabaseEnvironment`.

  Normalize `sslmode=require` URLs for the Node PostgreSQL adapter by adding `uselibpqcompat=true` only when the operator did not already select a compatibility mode. Preserve `sslmode=verify-full` unchanged.

- [x] **Step 8: Run focused tests and verify GREEN**

  Run both focused spec files and confirm all configuration and Prisma service cases pass.

### Task 3: Database-aware API health endpoint

**Files:**

- Create: `apps/api/src/health/health.controller.spec.ts`
- Create: `apps/api/src/health/health.controller.ts`
- Create: `apps/api/src/health/health.module.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**

- Consumes: `PrismaService.isHealthy(): Promise<boolean>`.
- Produces: `GET /api/health` with `{ database: 'connected' }` at HTTP 200 or `{ database: 'disconnected' }` at HTTP 503.

- [x] **Step 1: Write failing endpoint contract tests**

  Use a Nest testing application with a test `PrismaService` provider. Assert literal response status and body for successful and failed probes, and assert that an underlying secret-bearing error cannot appear in the failed response.

- [x] **Step 2: Run the health tests and verify RED**

  Run `pnpm --filter @hktutor/api test -- health.controller.spec.ts --runInBand` and confirm failure because the health module and route do not exist.

- [x] **Step 3: Implement the health controller and module**

  Register `@Controller('api/health')`. Return `{ database: 'connected' }` when healthy; otherwise throw `ServiceUnavailableException` with `{ database: 'disconnected' }`. Import the module into `AppModule`.

- [x] **Step 4: Run the health tests and verify GREEN**

  Re-run the focused health spec and confirm both response branches pass.

### Task 4: Foundation migration and idempotent seed command

**Files:**

- Create: `apps/api/prisma/migrations/20260830000000_enable_required_extensions/migration.sql`
- Create: `apps/api/prisma/migrations/migration_lock.toml`
- Create: `apps/api/src/database/seed.spec.ts`
- Create: `apps/api/src/database/seed.ts`
- Create: `apps/api/prisma/seed.ts`
- Modify: `tests/prisma-foundation.test.mjs`

**Interfaces:**

- Consumes: Prisma Client configured with `DATABASE_URL`.
- Produces: SQL that creates `extensions.citext` and `extensions.btree_gist`; `runSeed(client): Promise<void>` that probes with `SELECT 1` and inserts no rows.

- [x] **Step 1: Add failing migration and seed behavior tests**

  Assert from the parsed SQL statements that both extensions are created with `IF NOT EXISTS`, no `CREATE TABLE` statement exists, and the seed runner completes a connectivity query and disconnects through its executable entrypoint.

- [x] **Step 2: Run the migration/seed tests and verify RED**

  Run `node --test tests/prisma-foundation.test.mjs` and the focused seed Jest spec; confirm failure because the migration and seed runner are missing.

- [x] **Step 3: Implement the minimal foundation migration and seed runner**

  Add two `CREATE EXTENSION IF NOT EXISTS ... WITH SCHEMA extensions` statements. Export `runSeed`, instantiate Prisma with `PrismaPg`, run a literal `SELECT 1`, print only `Database seed completed`, and disconnect in `finally`. Guard the executable entrypoint so importing the module in tests does not connect.

- [x] **Step 4: Run the migration/seed tests and verify GREEN**

  Re-run both test commands and confirm the migration and seed contracts pass.

### Task 5: Container and operator workflow

**Files:**

- Modify: `tests/docker-compose.test.mjs`
- Modify: `tests/environment-template.test.mjs`
- Modify: `compose.yaml`
- Modify: `apps/api/Dockerfile`
- Modify: `apps/api/tsconfig.build.json`
- Modify: `.dockerignore`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `apps/api/README.md`

**Interfaces:**

- Consumes: local `.env` and the root database scripts.
- Produces: Compose API injection `${DATABASE_URL:?DATABASE_URL is required}`, `/api/health` health checking, generated Prisma Client in the production image, and a migration-owner runbook.

- [x] **Step 1: Write failing Compose and template tests**

  Assert that the API receives `DATABASE_URL`, the API health check targets `/api/health`, the web still depends on a healthy API, the template shows session-mode port 5432 with a neutral `postgres.[PROJECT_REF]` username, and no secret value appears in tracked files.

- [x] **Step 2: Run the workspace tests and verify RED**

  Run `node --test tests/docker-compose.test.mjs tests/environment-template.test.mjs` and confirm failures for the missing Compose/database contracts.

- [x] **Step 3: Update Compose, Docker, template, and documentation**

  Require `DATABASE_URL` only for the API service, change its health path, ensure the Docker build installs OpenSSL, copies Prisma files, and runs `db:generate`, constrain Nest build input to `src/**/*.ts` so `dist/main.js` remains the runtime entrypoint, ensure `.env` is excluded from build context, and document commands, migration ownership, secret handling, deploy/status/seed order, and the prohibition on reset.

- [x] **Step 4: Run workspace tests and verify GREEN**

  Re-run the focused Node tests and confirm all Compose and template contracts pass.

### Task 6: Local and shared-project verification

**Files:**

- Modify only files required by failures attributable to S1-T04.

**Interfaces:**

- Consumes: the complete S1-T04 implementation and ignored local `.env`.
- Produces: fresh verification evidence and a migrated/seeded shared Supabase project.

- [x] **Step 1: Run local static and test verification**

  Run `pnpm db:generate`, `pnpm --filter @hktutor/api test --runInBand`, `pnpm verify:workspace`, `pnpm format:check`, `pnpm lint`, and `pnpm build`. Fix only S1-T04 failures and repeat until every command exits 0.

- [x] **Step 2: Validate the environment without exposing secrets**

  Load `.env` in a process that reports only whether `DATABASE_URL` is present, whether protocol is PostgreSQL, whether port is 5432, and whether SSL is required. Never print the raw URL, password, Supabase secret, or complete username.

- [x] **Step 3: Validate and deploy the committed migration**

  Run `pnpm db:validate`, `pnpm db:migrate:status`, and `pnpm db:migrate:deploy`. Stop if Prisma reports drift, a reset requirement, or an unexpected migration history; do not run reset.

- [x] **Step 4: Prove seed idempotency and health**

  Run `pnpm db:seed` twice. Start the API with local `.env`, request `/api/health`, assert HTTP 200 and the literal connected body, then stop the process.

- [x] **Step 5: Run the full final gate**

  Run `pnpm check`, inspect `git diff --check`, inspect `git status --short`, and scan tracked changes for credentials. Compare every spec acceptance criterion to implementation and evidence before reporting completion.
