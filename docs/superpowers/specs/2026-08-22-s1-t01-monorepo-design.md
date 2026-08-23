# S1-T01 Monorepo Bootstrap Design

## Goal

Bootstrap HKTutor from an empty repository into a reproducible pnpm monorepo containing a buildable Next.js web application, a buildable and tested NestJS API application, and a shared strict TypeScript configuration.

## Scope

S1-T01 creates only the technical foundation required by downstream Sprint 1 tasks. It does not add Dockerfiles, Docker Compose, Supabase projects, Prisma, authentication, Swagger, CI, or domain features.

## Repository Architecture

```text
HKTutor/
├── apps/
│   ├── web/                 # Next.js App Router application
│   └── api/                 # NestJS modular monolith entry point
├── packages/
│   └── tsconfig/            # shared strict TypeScript baseline
├── tests/                   # repository-level workspace contract tests
├── docs/
│   └── superpowers/         # approved designs and implementation plans
├── package.json
├── pnpm-workspace.yaml
└── pnpm-lock.yaml
```

The repository uses one Git history and one lockfile. Web and API remain independent deployables with their own package manifests, build commands, runtime ports, and future Dockerfiles.

## Package Boundaries

- `apps/web` owns presentation, browser state, and the HTTP client boundary.
- `apps/api` owns business rules, authorization, and future database access.
- Web communicates with API over HTTP and must not import NestJS source files.
- `packages/tsconfig` shares compiler safety settings only. Each app keeps framework-specific TypeScript settings.
- After Swagger is introduced in S1-T05, a generated API client or generated types may be added as a separate package. NestJS DTO classes will not be imported directly into the web bundle.

## Toolchain

- Node.js: `24.19.0`
- pnpm: `11.19.0`
- TypeScript: current compatible versions selected by the framework scaffolds
- Web: Next.js App Router, React, ESLint, `src/` layout
- API: NestJS, Express platform adapter, Jest
- Monorepo orchestration: pnpm workspace commands; no Turborepo or Nx in S1-T01

## Root Commands

- `pnpm dev` starts web and API development servers in parallel.
- `pnpm build` builds every workspace package that provides a build script.
- `pnpm test` runs every workspace package that provides a test script.
- `pnpm lint` lints every workspace package that provides a lint script.
- `pnpm verify:workspace` checks the repository contract.
- `pnpm check` runs the workspace contract, lint, tests, and builds in that order.

## Verification and Error Handling

The repository contract test fails with a precise missing-file or invalid-configuration assertion when the workspace drifts. Framework tests and builds remain owned by each app, so failures identify the affected package. S1-T01 is complete only when a clean `pnpm install --frozen-lockfile` followed by `pnpm check` succeeds.

## Git and Collaboration

The repository uses `main` as its initial branch and `https://github.com/Sitta-C/HKTutor.git` as its logical `origin`. All ten team members may modify both apps. Review responsibility is assigned per task rather than enforced through repository access restrictions.
