# HKTutor shared contributor guide

This file contains repository-wide working rules for every contributor and coding agent. Keep it
stable and team-oriented. Do not add personal task assignments, individual progress logs, local
machine paths, account details, branch-specific notes, or temporary handoff context.

## Sources of truth

- Tracked production code and automated tests define implemented behavior.
- API controllers, DTOs, services, and Swagger decorators define callable server contracts.
- `ui-design/uidesign.md` maps current screens and explicitly proposed work. It must not claim that
  a route, field, API, or workflow exists before production code provides it.
- Static files under `ui-design/pages/` are visual references with fictional data. They are not API
  contracts or evidence of shipped behavior.

## Feature boundaries

- Check `ui-design/sprint1-ui-api-map.md` and the current server modules before implementing a
  dependency owned by another task. A frontend client call does not prove that its endpoint exists.
- Treat endpoints marked Proposed or To Do as unavailable until their controller, DTO, service,
  Swagger contract, and tests are present in the current branch.
- When a UI dependency is missing, show an honest unavailable or load-error state. Do not hardcode
  database IDs, duplicate server-owned catalogs in the client, or report a dependency failure as an
  unrelated resource-not-found error.

## Shared UI rules

- `apps/web/src/components/dashboard/dashboard-shell.tsx` and
  `apps/web/src/app/globals.css` are authoritative for the logged-in sidebar and header.
- The Student and Tutor profile prototypes use the production `dash-*` structure and load the
  production stylesheet. When the production shell changes, update both profile prototypes,
  `ui-design/uidesign.md`, and the profile foundation test in the same change.
- Keep role navigation, active-route treatment, collapsed rail, mobile backdrop, keyboard behavior,
  notification control, language toggle, and accessible labels aligned with production.
- Product UI supports English and Thai. Add or change user-facing production copy in both language
  objects.

## Data and privacy

- Never commit secrets or values from `.env` files.
- Use fictional identities, email addresses, telephone numbers, documents, and booking data in
  drafts, tests, screenshots, and documentation.
- Preserve server-enforced ownership and privacy boundaries. Do not expose legal names, contact
  details, account identifiers, or private documents in public or unrelated-user views.

## Verification

Run checks that cover the changed area. For web/profile work, the expected baseline is:

```bash
node --test tests/personal-profile-foundation.test.mjs
pnpm --filter @hktutor/web lint
pnpm --filter @hktutor/web exec tsc --noEmit
pnpm exec prettier --check <changed-files>
git diff --check
```

The repository declares its supported Node version in `.node-version` and `package.json`. Use that
version for production builds.
