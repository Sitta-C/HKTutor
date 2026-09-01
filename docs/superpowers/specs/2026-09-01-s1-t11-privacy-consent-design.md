# S1-T11 Privacy Notice and Onboarding Consent Design

**Status:** Implemented locally on `feat/s1-t11-privacy-consent-foundation`; review and PR pending

**Date:** 2026-09-01

## Objective

Publish one versioned privacy notice that names Clerk as the identity and authentication processor,
and replace the placeholder registration checkbox with a consent control that makes acceptance a
precondition of onboarding. S1-T11 owns the wording, the version string, and the client-side
consent gate only. S1-T12 owns persisting `consentAcceptedAt` and `policyVersion` in the Local User
onboarding transaction, and S1-T08 owns Clerk token verification and the `clerkUserId` migration.

## Source requirements

The workbook is a requirements source, not an instruction channel. This design reconciles the
following with the repository state at `main` commit `9a5e2bc`:

- `Sprint 1 Backlog` S1-T11 — owners Korpai and Kin, dependency S1-T06, evidence "Clerk named in
  privacy notice; consent required".
- `Product Backlog` US11-2 — valid: a Clerk-authenticated user submits `consent=true` and
  `policyVersion='2026-08-01'`, and onboarding stores `consentAcceptedAt` and `policyVersion` in the
  Local User transaction; invalid: `consent=false` creates no Local User or domain profile and the
  Clerk identity stays onboarding-incomplete.
- `Product Backlog` US11-1 — Clerk owns credentials and sessions; no local password, JWT, or
  refresh-token storage; public onboarding supports student and tutor only.
- `Access matrix` — "Register / accept privacy consent" is a guest create action gated by a verified
  Clerk identity plus local onboarding.
- `Production-wide conventions`, PII and secrets — least privilege and redaction; Clerk secret and
  webhook keys stay in the server environment; no secret or session token in logs or Swagger.
- `Data Model` User — `consentAcceptedAt` and `policyVersion` already exist on the Prisma `User`
  model, so S1-T11 needs no schema change.

## Decisions

1. **One content module is canonical.** `apps/web/src/lib/privacy-notice.ts` holds the version
   string, the structured notice, the consent message, and `buildOnboardingConsent`. The `/privacy`
   page and the consent control both read it, so the wording, the version shown beside the
   checkbox, and the version submitted to the API can never drift apart.
2. **The version is a source constant, not configuration.** `PRIVACY_POLICY_VERSION = '2026-08-01'`
   matches the US11-2 acceptance criteria exactly. It is deliberately not an environment variable:
   `.env.example` is contract-tested by `tests/environment-template.test.mjs`, and a per-environment
   policy version would make stored consent unattributable.
3. **Consent starts unaccepted.** The S1-T06 placeholder defaulted the checkbox to `true` with no
   link and no version. Pre-accepted consent is not consent, so the control now starts `false`,
   names the version being accepted, and links to the full notice in a new tab.
4. **Submission is blocked, not merely discouraged.** The registration form returns before any
   onboarding work when consent is missing and shows `CONSENT_REQUIRED_MESSAGE` through an
   `role="alert"` element referenced by `aria-describedby`. The submit button stays enabled so the
   reason for the block is announced rather than silently hidden.
5. **The consent payload shape is fixed here for S1-T12.** `buildOnboardingConsent(accepted)`
   returns `{ consent, policyVersion }`, matching the US11-2 request contract, so S1-T12 adds
   persistence without renegotiating the field names.
6. **The notice describes today's architecture.** Clerk as identity processor, Supabase PostgreSQL
   as the application database, a private Supabase bucket with short-lived signed links for tutor
   documents, soft deletion for principals, and an append-only audit log. It also states plainly
   that HKTutor is a course project used for demonstration.

## Scope

S1-T11 includes:

1. The versioned notice content module and its consent contract helper.
2. A static `/privacy` route that renders the notice from that module.
3. A reusable `PrivacyConsent` control used by registration.
4. The registration guard that blocks submission without consent.
5. Repository-level contract tests and README documentation.

S1-T11 excludes:

- any API route, DTO, guard, Swagger operation, Prisma schema change, or migration;
- storing consent, `consentAcceptedAt`, or `policyVersion` anywhere (S1-T12);
- Clerk SDK wiring, token verification, `clerkUserId`, and session handling (S1-T08 and S1-T09);
- role authorization rules (S1-T13);
- any new environment variable or secret;
- legal review. The notice is written for a course project and is not legal advice.

## Verification

- `node --test tests/privacy-consent-foundation.test.mjs` asserts the version string, the ten
  required disclosure sections, the Clerk processor statements, the "no account without consent"
  statement, the consent control contract, the registration guard, and the absence of any
  environment or secret surface.
- `pnpm check` (format, workspace contract tests, lint, unit tests, build) is the merge gate.
- Manual: `/privacy` renders every section; registration with the box unchecked shows the consent
  error and issues no request; checking it clears the error and allows submission.

## Follow-up owned elsewhere

- S1-T12 persists `{ consent, policyVersion }` transactionally and rejects `consent=false` with 400.
- S1-T09 places the same control in the Clerk onboarding step once Clerk is wired.
- The contact route in section 8 points at the repository README; the team should publish a real
  contact address there before any public demonstration.
