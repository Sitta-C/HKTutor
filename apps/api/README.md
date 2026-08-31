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
preserving existing administrator and tutor credentials. It refuses role conflicts and does not
insert teaching listings or ratings. The migration adds tutor profiles, subjects, grade levels,
and teaching listings; publication authorization remains an S1-T15 application rule.

Only after the S1-T14 migration has been reviewed, merged, and explicitly approved for the shared
checkpoint should the migration owner run status, deploy, seed twice, and status again. Never use
`prisma migrate reset` against the shared project.

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
