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

Pull requests and pushes to `main` run the root `pnpm check` command in GitHub Actions. CI does not
receive shared-database credentials.
