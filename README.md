# HKTutor

HKTutor is a pnpm monorepo containing a Next.js web client and a NestJS/Prisma API. Authentication
is owned by the application: users register with email and password, verify their address through
Resend, and then use short-lived JWT access tokens backed by revocable refresh sessions.

## Workspace

- `apps/web` — Next.js 16 client on port 3000
- `apps/api` — NestJS 11 API on port 3001
- `packages/eslint-config` and `packages/tsconfig` — shared tooling
- `ui-design` — versioned static HTML design references; these do not ship with `apps/web`

Use Node.js 24.19.0 and pnpm 11.19.0.

```bash
pnpm install
cp .env.example .env
pnpm db:generate
pnpm dev
```

The web client calls the API through the same origin at `/api/v1`. During `pnpm dev`, Next.js
rewrites that path to the API on port 3001. The API documentation is available at
`http://localhost:3000/api/v1/docs` (or directly at `http://localhost:3001/api/v1/docs`).

### Current product surface

The implemented web flow is login (`/`), registration (`/register`), email verification
(`/register/verify`, with `/register/verifypage` retained as a legacy alias), role-specific profile
onboarding (`/onboarding/profile`), a protected dashboard (`/dashboard`), profile editing
(`/dashboard/profile`), tutor availability management (`/dashboard/availability`), and the
informational `/about-me` page. The availability screen creates and deletes future Bangkok-time
ranges while exchanging UTC timestamps with the API, protecting reserved slots, and presenting a
Gregorian calendar in English or a Buddhist calendar in Thai. The privacy notice opens as a
closable modal from registration and the dashboard instead of using a separate route.

The accepted student and tutor dashboard concepts, plus the tutor profile/certificate form, live
in [`ui-design`](ui-design/). Open [`ui-design/index.html`](ui-design/index.html) directly or serve
the directory as static files. [`ui-design/uidesign.md`](ui-design/uidesign.md) records the page
inventory, design tokens, component conventions, draft status, and API dependencies. Implemented
UI must be ported into `apps/web`; do not import or iframe the prototype HTML.

## Authentication flow

1. `POST /api/v1/auth/register` accepts email, password, `student` or `tutor` role, and privacy consent.
2. The API stores an Argon2id password hash and a SHA-256 hash of a random verification token.
3. Resend delivers a link to `/register/verify?token=...`.
4. `POST /api/v1/auth/verify-email` consumes the one-time token and starts a session.
5. Login and verification return a short-lived JWT access token. The rotating refresh token is kept
   only in an HttpOnly cookie and represented in PostgreSQL by its SHA-256 hash.
6. Protected endpoints verify the JWT signature, issuer, audience, token type, session state,
   account state, and email verification state.

Public auth endpoints are rate-limited. Access tokens are held in browser memory; they are not
written to local storage. Refresh-token rotation detects reuse and revokes the affected session.

### Environment

Copy `.env.example` to the ignored `.env` and replace every bracketed placeholder. Important values:

- `DATABASE_URL` — PostgreSQL/Supabase connection string used only by the API
- `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` — different random values, each at least 32 characters
- `RESEND_API_KEY` and `EMAIL_FROM` — Resend API key and an approved sender
- `APP_URL` — web URL embedded in email verification links
- `WEB_ORIGIN` — exact browser origin allowed by API CORS
- `COOKIE_SECURE=true` — required for an HTTPS deployment
- `API_INTERNAL_URL` — server-only NestJS origin used by the Next.js development rewrite
- `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_TUTOR_EMAIL`, and `SEED_TUTOR_PASSWORD` — local
  verified demo accounts; passwords must be at least 10 characters

Generate secrets locally, for example:

```bash
openssl rand -base64 48
openssl rand -base64 48
```

Use two different outputs and never commit `.env`.

For a Resend sandbox, the sender and recipient restrictions in the Resend account still apply. For
a deployed demo, verify a sending domain and set `EMAIL_FROM` to an address on that domain.

## One-shot migration and reseed

The migration `20260908120000_replace_clerk_with_local_jwt_auth` is intentionally destructive. The
project has no real users, so it deletes the demo identity-owned graph in foreign-key order:
`Booking`, `AvailabilitySlot`, `TeachingListing`, `TutorProfile`, then `User`. It preserves the
subject and grade-level catalogs, removes the old external-auth identity fields, and creates local
verification/session tables.

Do not apply this migration to a database containing data that must be retained. Review the target
and back it up first. With the intended disposable/demo database and completed `.env`:

```bash
pnpm db:migrate:status
pnpm db:migrate:deploy
pnpm db:seed
```

The seed hashes the configured passwords and marks the provisioned admin and tutor accounts as
verified. Public registration can create only student or tutor accounts, never administrators.

To exercise database constraints against a disposable local PostgreSQL database only:

```bash
HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 pnpm db:verify:sprint1
```

The verifier refuses non-loopback hosts and database names that do not begin with `hktutor-` or
`hktutor_`.

## Checks

```bash
pnpm check
```

This generates Prisma Client, runs workspace contract tests, formatting checks, lint, unit tests,
and production builds. It does not apply migrations, seed a database, or send email.

Docker images can be validated with `docker compose config` after required environment values are
set. Compose publishes one gateway on port 3000; `/api/v1` goes directly to NestJS and every other
path goes to Next.js. The web and API ports stay private inside the Compose network. Terminate HTTPS
at this gateway or an upstream VM proxy and set `COOKIE_SECURE=true` for a deployed demo.

## Demo scope

The local authentication implementation covers registration, verification-link resend, email
verification, login, refresh rotation, logout, current-user lookup, and route protection. Password
reset, email change, multi-factor authentication, and session-management UI are intentionally out
of scope for this small demo.

Domain models for tutor profiles, teaching listings, availability slots, and bookings already
exist in Prisma. The tutor availability flow is connected to its production API; other domain web
flows may still be incomplete. Check the current task tracker and API surface before implementing a
design draft; task wording that refers to Clerk is stale because `main` now uses local JWT
authentication.
