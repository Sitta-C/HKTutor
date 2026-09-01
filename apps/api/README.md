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
pnpm db:migrate:deploy
pnpm db:seed
```

Only the designated migration owner creates migrations. Never reset the shared development/demo
database.

S1-T07 requires `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` in the ignored root `.env` when
running `pnpm db:seed`. The seed creates one active administrator with an Argon2id password hash,
preserves an existing administrator on repeated runs, and refuses to promote an existing
student/tutor account. Review the S1-T07 migration before running `pnpm db:migrate:deploy` against
the shared database.

S1-T14 additionally requires `SEED_TUTOR_EMAIL` and `SEED_TUTOR_PASSWORD`. The same atomic,
idempotent seed inserts Mathematics, Grade 10, and one active verified tutor profile while
preserving existing administrator and tutor credentials. The migration adds tutor profiles,
subjects, grade levels, and teaching listings; publication authorization remains an S1-T15
application rule.

Only after the S1-T14 migration has been reviewed, merged, and explicitly approved for the shared
checkpoint should the migration owner run status, deploy, seed twice, and status again. Never use
`prisma migrate reset` against the shared project.

### Tutor search fixtures (S1-T20)

S1-T20 adds deterministic teaching-listing and seeded-rating fixtures to the same transaction. It
uses the configured tutor plus four non-loginable `hktutor.invalid` tutor accounts to cover exact
Mathematics/Grade 10 matches, THB 350 and THB 500 budget cases, Physics mismatch, Grade 11 mismatch,
and one cheaper draft listing. Synthetic plaintext credentials are random and discarded; user
upserts never replace existing password hashes. Fixed UUIDs prove that reserved fixture emails are
seed-owned; a same-role email collision with any other UUID aborts the transaction so no search
fixture profile or listing changes are committed.

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
to S1-T18, and booked-slot deletion protection is completed with S1-T23. S1-T17 has no seed and
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

Pull requests and pushes to `main` run the root `pnpm check` command in GitHub Actions. CI does not
receive shared-database credentials.
