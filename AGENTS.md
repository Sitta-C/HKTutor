# AGENTS.md

This file is the operating guide for humans and AI agents working in the HKTutor repository. It
applies to the entire repository unless a more specific `AGENTS.md` exists below the directory you
are editing.

## Working agreement

- Read the relevant implementation, nearby tests, and repository documentation before editing.
- Keep changes scoped to the requested outcome. Do not refactor unrelated code while completing a
  feature or fix.
- Preserve user-authored or unrelated working-tree changes. Never discard or overwrite them to make
  a task easier.
- Prefer the smallest complete change that follows an existing local pattern. Add a new abstraction
  only when it removes real duplication or clarifies a domain boundary.
- Update tests and documentation when behavior, public contracts, setup, or operational commands
  change.
- Do not claim a check passed unless it was actually run. Report any check that could not be run and
  why.

## Repository map

HKTutor is a pnpm monorepo using Node.js 24.19.0 and pnpm 11.19.0.

- `apps/web`: Next.js 16 App Router client, React 19, Tailwind CSS, Vitest, and Playwright.
- `apps/api`: NestJS 11 REST API, Prisma 7, PostgreSQL, Jest, and Supertest.
- `packages/eslint-config`: shared ESLint rules. Treat these rules as the source of truth.
- `packages/tsconfig`: shared strict TypeScript configuration.
- `tests`: repository-level contract tests run by `pnpm verify:workspace`.
- `ui-design`: versioned HTML/CSS design references. This directory is not production runtime code.

Read the root `README.md` for the current product surface, environment variables, and operational
warnings. Read `apps/api/README.md` before changing API architecture or authentication.

## Commands

Run workspace commands from the repository root.

```bash
pnpm install
pnpm dev
pnpm check
```

Prefer targeted checks while iterating, then run the broadest practical verification before handing
off the change:

```bash
# Formatting and linting
pnpm format:check
pnpm lint

# Web
pnpm --filter @hktutor/web test
pnpm --filter @hktutor/web lint
pnpm --filter @hktutor/web build
pnpm --filter @hktutor/web test:e2e

# API
pnpm --filter @hktutor/api test
pnpm --filter @hktutor/api test:e2e
pnpm --filter @hktutor/api lint
pnpm --filter @hktutor/api build

# Repository contracts
pnpm verify:workspace
```

`pnpm check` generates Prisma Client, checks formatting, lints, tests, and builds all packages. It
does not migrate or seed a database. Playwright and database-backed checks may require services and
environment variables; do not silently substitute mocked success for an unavailable dependency.

## Code style

- TypeScript is strict. Do not introduce `any`, unsafe casts, unchecked non-null assertions, or
  disabled lint rules to bypass type errors.
- Use 2-space indentation, LF endings, single quotes, semicolons, trailing commas, and a 100-column
  print width. Let Prettier settle formatting.
- Use braces for every control-flow body and strict equality checks.
- Keep imports ordered in groups: platform/built-in, external, internal aliases, relative imports,
  then type-only imports. Separate groups with a blank line.
- Use `import type` for type-only dependencies.
- Use descriptive domain names. Files use lowercase kebab-case; React components and classes use
  PascalCase; functions and variables use camelCase; constants use UPPER_SNAKE_CASE when truly
  constant.
- Favor explicit return types at public boundaries and for exported helpers. Keep functions focused
  and use early validation when it makes the happy path clearer.
- Comments should explain intent, constraints, or surprising behavior. Do not narrate obvious code.
- Never import source files across `apps/web` and `apps/api`. Their boundary is HTTP or an explicit
  shared package.

### Imports

Application code uses absolute aliases. Relative imports are allowed only for styles by the current
lint configuration.

- Web: use `@/*` for `apps/web/src/*`.
- API: use `@app/*`, `@modules/*`, `@infrastructure/*`, `@common/*`, `@config/*`, `@generated/*`,
  and `@examples/*` according to the directory being imported.

Do not edit generated output under `apps/api/src/generated`. Change `schema.prisma` or generation
inputs and run `pnpm db:generate` instead.

## Web conventions

- For UI/design work, read `ui-design/frontend-direction.md` first for the current Notebook Focus
  implementation, component references, scope, and preview workflow. Treat it as repository context;
  shared design conventions are reviewed through the normal PR process. Follow explicit task
  requirements and current source when historical prototypes differ.
- Keep App Router `page.tsx` and `layout.tsx` files thin. Put feature behavior and substantial UI in
  `src/components/<feature>` and reusable data access or pure logic in `src/lib`.
- Default to Server Components. Add `'use client'` only when a component needs browser APIs, React
  state/effects, context, or event handlers.
- Browser calls to the backend go through `src/lib/api`. Use the same-origin `/api/v1` contract and
  the existing `apiFetch`/`authenticatedFetch` flow; do not create a second token store or persist
  access tokens in local storage.
- Keep API wire types in `src/lib/api/types.ts` unless a feature has a strong reason for a narrower
  local type. Encode path segments and construct query strings with `URLSearchParams`.
- Separate pure transformations and view models from large interactive components when practical;
  pure logic belongs in testable model/helper modules.
- Reuse the public UI primitives and existing design tokens before adding one-off styling. Preserve
  the established notebook visual language and verify responsive behavior at mobile, tablet, and
  desktop widths.
- Treat `ui-design` as a visual and product reference only. Port approved behavior into `apps/web`;
  never import, iframe, or ship prototype HTML.
- User-facing copy is bilingual where the surrounding feature is bilingual. Keep Thai and English
  translation keys aligned and avoid hard-coded copy inside reusable components.
- Add useful metadata to routes. Protected/private pages should not accidentally become indexable.
- Preserve accessibility: semantic elements, associated labels, keyboard operation, meaningful
  button text/ARIA labels, visible focus states, and non-color status cues.
- HKTutor's business timezone is `Asia/Bangkok`. Exchange timestamps with the API as UTC ISO 8601
  strings and use the existing date-time helpers for display and input conversion. Do not rely on
  the machine's local timezone. Thai UI may use the Buddhist calendar; API values remain Gregorian.

Web unit tests live in `apps/web/test/*.test.ts` and use Vitest in a Node environment. End-to-end
tests live in `apps/web/e2e` and use Playwright. Test pure behavior at the lowest useful layer and
reserve end-to-end coverage for critical user journeys and responsive/browser behavior.

## API conventions

- Organize runtime features in a flat `src/modules/<feature>` directory until a split has a clear
  benefit. A typical feature contains `<feature>.module.ts`, controller, service, DTO, and Swagger
  files.
- Controllers own HTTP concerns: route decorators, guards, DTOs, status codes, and mapping the
  authenticated user into service input. Services own domain rules and persistence orchestration.
- DTOs use `class-validator` and Swagger property decorators. The global validation pipe strips
  unknown fields, rejects non-whitelisted input, and transforms supported values; declare every
  accepted field explicitly.
- Keep Swagger decorators and response models in the feature's `*.swagger.ts` file. Update Swagger
  documentation whenever an endpoint, validation rule, auth requirement, or response changes.
- All routes receive the global `/api/v1` prefix. Follow existing REST naming and Nest exception
  types so clients receive consistent status codes.
- Protected endpoints authenticate before authorizing. Use `JwtAuthGuard`, then `RolesGuard`, and
  `ResourceOwnershipGuard` where ownership applies. Never trust a user ID supplied in a body or
  query when it should come from `@CurrentUser()`.
- Keep role checks and ownership checks server-side even if the web UI hides an action. Distinguish
  unauthenticated (401), authenticated but unauthorized (403), missing (404), invalid (400), and
  state conflict (409) cases intentionally.
- Select only the database fields needed by the operation. Use Prisma payload/select types instead
  of duplicating broad model shapes.
- Money is stored and calculated with Prisma `Decimal`; do not use binary floating point for
  persisted monetary calculations. API money values follow the existing fixed-decimal string
  contract.
- Use database transactions and database constraints for race-sensitive writes. Do not replace an
  atomic booking or session flow with a read-then-write sequence outside a transaction.
- Use Nest's `Logger`; `console` is prohibited in API TypeScript.
- Keep infrastructure adapters such as database and email in `src/infrastructure`, cross-feature
  utilities in `src/common`, and environment parsing in `src/config`.

API unit tests live in `apps/api/test/unit/**/*.spec.ts`; API end-to-end tests live directly under
`apps/api/test` and use `test/jest-e2e.json`. Mirror the source feature in unit-test paths. Cover the
successful path, validation and authorization failures, relevant state conflicts, and persistence
interactions. Use deterministic timestamps and IDs when exact output matters.

## Database and migrations

- Treat `apps/api/prisma/schema.prisma` and committed migrations as a shared contract. Every schema
  change needs a migration and tests or contract updates appropriate to its risk.
- Never rewrite an already-shared migration merely to make a new database converge. Add a new
  migration unless the team explicitly confirms the migration has never been shared or applied.
- Preserve migration-managed PostgreSQL behavior such as partial indexes, check constraints,
  extensions, and case-insensitive columns; not every constraint is represented in Prisma schema.
- Soft-deleted records must remain excluded wherever the existing domain contract requires it.
- Do not run migration deploy, seed, destructive verification, or data-reset commands unless the
  task explicitly requires it and the target database has been confirmed safe.
- `db:verify:sprint1` is only for an explicitly opted-in disposable local database. Never weaken its
  loopback/database-name safety checks.

## Authentication, privacy, and secrets

- Authentication is application-owned email/password auth with short-lived access JWTs, rotating
  refresh sessions, and email verification. Do not reintroduce assumptions from the old Clerk-based
  implementation.
- Access tokens stay in browser memory. Refresh tokens stay in secure HttpOnly cookies and are
  represented in the database only by hashes. Preserve refresh-token rotation and reuse detection.
- Never log passwords, raw tokens, cookie values, password hashes, verification secrets, API keys,
  or full environment contents.
- Never commit `.env` or real credentials. Update `.env.example` with safe placeholders when adding
  configuration, and validate required settings in the existing config layer.
- Preserve privacy-consent checks and policy-version behavior in registration, onboarding, and
  private-profile flows.
- Security-sensitive changes require negative tests, including invalid authentication, wrong role,
  ownership violations, expired/reused credentials, or unsafe state transitions as applicable.

## Completion checklist

Before handing off a change:

1. Review the diff for accidental edits, generated files, secrets, and unrelated formatting churn.
2. Run the most focused relevant tests during development.
3. Run formatting and lint checks for every touched workspace.
4. Run relevant builds when types, imports, configuration, routes, or bundling changed.
5. Run `pnpm check` when practical for cross-cutting or release-ready work.
6. Summarize behavior changed, files or areas affected, checks run, and any remaining risk or manual
   verification.

Use conventional commit subjects consistent with repository history, such as `feat(scope): ...`,
`fix(scope): ...`, `refactor(scope): ...`, `test(scope): ...`, `docs(scope): ...`, or `chore(scope):
...`. Keep each commit focused on one coherent change.
