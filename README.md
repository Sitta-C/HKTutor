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

## Supabase environment (S1-T03)

The team uses one shared Supabase project for development and the final demonstration. The
committed [`.env.example`](.env.example) contains placeholders only; actual credentials belong in
the ignored root `.env` file.

For a fresh clone, create the local file before adding credentials:

```sh
cp .env.example .env
```

Replace every bracketed placeholder in `.env` with values from the Supabase project:

- `DATABASE_URL` — the Supavisor session-mode PostgreSQL connection string on port `5432`, reserved
  for the Prisma connection and migrations in S1-T04
- `SUPABASE_URL` — the project API URL
- `SUPABASE_SECRET_KEY` — a server-side `sb_secret_...` key for later NestJS Storage/API work

The secret key bypasses Row Level Security. It must stay in the NestJS/API environment and must
never use a `NEXT_PUBLIC_*` name or be exposed to the browser. Do not commit `.env`, paste secrets
into documentation, or run a migration as part of S1-T03.

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
Supabase in the later database tasks; no database container or persistent volume belongs here.

## Repository boundaries

- `apps/web` — Next.js web client (`@hktutor/web`)
- `apps/api` — NestJS API service (`@hktutor/api`)
- `packages/eslint-config` — shared ESLint presets (`@hktutor/eslint-config`)
- `packages/tsconfig` — shared strict TypeScript baseline (`@hktutor/tsconfig`)
- Root `package.json`, `pnpm-workspace.yaml`, and `pnpm-lock.yaml` — the sole workspace and dependency-install authority

Do not run per-package installs or add nested lockfiles. Dependencies belong in the package that consumes them and are resolved by the root pnpm workspace.

## Deferred work

This workspace still excludes later-sprint infrastructure and product features, including Redis,
queues/brokers, Socket.IO, Prisma schema/migrations, runtime Supabase integration, and
application-specific implementation. S1-T03 adds only the safe Supabase environment template;
Docker packaging for the Web and API services remains included.
