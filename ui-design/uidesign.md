# HKTutor — UI design and page-to-data mapping

Updated 2026-09-09 from the complete first-party Markdown/TSX inventory and the project workbook.
This document defines what each screen should show, which model supplies it, who may act, and
what remains to design. It is a design plan, not a claim that the proposed pages or APIs exist.

Worktree: `HKTutor-design-ui/`, branch `design/ui`. Both its HEAD and freshly fetched `origin/main`
were `ead6751` at this review. The main checkout is `HKTutor/`.

## Sources and reading scope

| Source                                                                                                                                              | Scope and use                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Sprint 1 Backlog](https://docs.google.com/spreadsheets/d/17RMTjXa26ho7blv-TK5pbJFbHxVHJEBRPKCXk9x5AE0/edit?gid=1146751862#gid=1146751862)          | Rows 2–30: task status, owners and dependencies. Snapshot: 16 Done, 5 In Progress, 8 To do.                                                                                              |
| [Data Model](https://docs.google.com/spreadsheets/d/17RMTjXa26ho7blv-TK5pbJFbHxVHJEBRPKCXk9x5AE0/edit?gid=1191524122#gid=1191524122)                | Rows 2–19: all 18 entities; rows 23–36: business rules; rows 41–75: constraints/conventions; rows 79–93: state transitions.                                                              |
| [Role-Based Access Control](https://docs.google.com/spreadsheets/d/17RMTjXa26ho7blv-TK5pbJFbHxVHJEBRPKCXk9x5AE0/edit?gid=1973937976#gid=1973937976) | Rows 6–27: public, participant, owner and admin access.                                                                                                                                  |
| Product Backlog tab in the same workbook                                                                                                            | Rows 4–86: UI acceptance criteria and Sprint 1–3 boundaries, including exact filtering, chat, classes, rescheduling, documents, reports, reviews and coupons.                            |
| `apps/api/prisma/schema.prisma` and migrations                                                                                                      | Actual persisted fields and database constraints. A sheet field is not necessarily implemented.                                                                                          |
| `apps/api/src/app.module.ts`, controllers, auth DTO/client and root foundation tests                                                                | Actual HTTP surface, identity contract and implemented safeguards. Production domain controllers are absent at this commit.                                                              |
| All seven repository Markdown files                                                                                                                 | Root README, API README, auth example README, web README, web AGENTS/CLAUDE and this file. Read once after confirming copies in both checkouts were byte-identical.                      |
| Workspace `AGENT.md`, `t09progress.md`, three `.hermes/plans/*.md` files                                                                            | Working conventions and history. Old Clerk/onboarding plans and pre-merge progress wording are historical.                                                                               |
| All 19 first-party `apps/web/src/**/*.tsx` files                                                                                                    | Seven route pages, root layout, nine components, auth context and i18n. Both checkouts were byte-identical before this documentation change. Generated output/dependencies are excluded. |
| `dashboard-navigation.ts`, `globals.css`, `ui-design/index.html` and prototype references                                                           | Navigation targets, theme and existing design conventions.                                                                                                                               |

Source priority: merged code describes current implementation; the workbook describes intended
product behavior and task ownership; this document proposes screen structure and routes. Resolve
the specific conflicts in §12 before implementing dependent behavior. Documents stay in English
under the workspace convention; product screens must support EN/TH.

## 1. Existing UI and actual readiness

| Route / shared surface  | TSX files under `apps/web/src/`                                                                                          | Current behavior                                                                        | Data available now                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `/`                     | `app/page.tsx`, `components/login.tsx`                                                                                   | Working email/password login; redirects signed-in users to dashboard                    | Auth identity/session                                                  |
| `/register`             | `app/register/page.tsx`, `components/register.tsx`, `components/privacy-consent.tsx`                                     | Student/tutor choice, password confirmation, explicit privacy consent                   | Registration creates User and sends email; it does not start a session |
| `/register/verify`      | `app/register/verify/page.tsx`, `components/verify.tsx`                                                                  | Waiting, link verification, resend, cross-tab completion/fallback                       | Token verification and session creation                                |
| `/register/verifypage`  | `app/register/verifypage/page.tsx`                                                                                       | Legacy alias using the same Verify component                                            | No separate design needed                                              |
| `/dashboard`            | `app/dashboard/page.tsx`, `components/dashboard/{dashboard-shell,student-dashboard,tutor-dashboard,admin-dashboard}.tsx` | T09 role selection and responsive shell are implemented; domain panels are placeholders | `AuthUser.id/email/role`; counts, lists and revenue are not live       |
| `/privacy`              | `app/privacy/page.tsx`                                                                                                   | Static English privacy notice from `lib/privacy-notice.ts`                              | Policy content/version, no private account query                       |
| `/about-me`             | `app/about-me/page.tsx`                                                                                                  | Static EN/TH informational page                                                         | `copy.aboutMe`; not a user profile                                     |
| Shared layout/auth/i18n | `app/layout.tsx`, `components/auth-shell.tsx`, `lib/auth-context.tsx`, `lib/i18n.tsx`                                    | Auth/session bootstrap, theme, language persistence                                     | Auth refresh response; local language preference                       |

There are **7 existing routes**, including one legacy alias. Student, Tutor and Admin dashboards
share one route. The Admin view is a safe placeholder, not a completed admin console.

Most dashboard navigation still uses hashes such as `#profile`, `#bookings`, `#find-tutor`,
`#new-listing`, `#availability`, `#calendar`, `#settings` and `#support`. These are not completed
domain destinations. Replace them with agreed routes when those screens are implemented.

## 2. Remaining Sprint 1 screens and proposed navigation

Routes below are **proposals**, not existing routes or agreed API URLs. A detail screen may be a
drawer instead of a new route if it preserves the same information and deep-link behavior.

| Screen                                 | Proposed route                                                                           | Task / owner                    | Sheet status and dependencies                                   | Design scope                                                                         |
| -------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Tutor profile editor                   | `/dashboard/profile`                                                                     | S1-T16, First/P                 | To do; T15 In Progress; T13/T14 Done                            | Basic profile and preview; existing v4 draft; documents deferred to Sprint 2         |
| My listings + create/edit              | `/dashboard/listings`, `/dashboard/listings/new`, `/dashboard/listings/[listingId]/edit` | S1-T16, First/P                 | To do; T15 In Progress                                          | Reuse one form for create/edit, cards and publication state                          |
| Availability manager                   | `/dashboard/availability`                                                                | S1-T19, Korpai/Tonnam           | To do; T18 In Progress; T13/T17 Done                            | Bangkok-time list/calendar and add/delete flow                                       |
| Tutor search                           | `/tutors`                                                                                | S1-T22, Model                   | To do; T21 To do, depending on T15 and completed T20            | Subject, level, maximum budget, minimum rating; exact results/no match               |
| Listing/tutor details + slot selection | `/tutors/[tutorProfileId]?listingId=…`                                                   | Proposed shared T22/T25 handoff | Search/profile/listing query and slot query required            | Explicitly connect a selected listing to a slot from the same tutor; can be a drawer |
| Booking review and submitted result    | `/dashboard/bookings/new?listingId=…&slotId=…`, `/dashboard/bookings/[bookingId]`        | S1-T25, Model                   | To do; T22 and T24 required; T24 In Progress                    | Review details, submit once, display actual returned PENDING booking                 |
| Student booking list                   | `/dashboard/bookings`                                                                    | S1-T25, Model                   | Same dependencies; list/detail query contract must be confirmed | Own bookings, status/time filtering and detail navigation                            |

These are seven design surfaces, not seven mandatory new routes. Forms, detail drawers and
confirmation states can share screens; do not use the old approximate page count as a requirement.

Student navigation proposal: Dashboard → Find a tutor → My bookings → Account → Privacy → Sign out.
Tutor: Dashboard → My profile → My listings → Availability → Bookings → Privacy → Sign out.
The tutor booking-management actions arrive in Sprint 2. Account can remain read-only using the
existing identity contract. Settings/support have no dedicated storage or workflow contract yet.
Guest search is allowed by RBAC; use a public header without private dashboard identity.

## 3. Dependency and implementation boundaries

```text
T06 + T08 (Done) -> T09 (Done): auth/session + role-aware dashboard shell
T13 + T14 (Done) -> T15 (In Progress) -> T16: profile/listing UI
T13 + T17 (Done) -> T18 (In Progress) -> T19: availability UI
T15 + T20 (Done) -> T21 (To do) -> T22: search UI
T18 + T23 (Done) -> T24 (In Progress) + T22 -> T25: booking flow
T09 + T16 + T19 + T25 -> T26 integration; T13 + T24 -> T27 regression
```

Static design can proceed with clearly fictional data. API-backed implementation must inspect the
merged dependency DTOs/Swagger first. Do not infer a booking list endpoint from a create-booking
task or infer a production resource API from the private-listing authorization example.

Available authentication URLs use `/api/v1/auth`: `register`, `verify-email`,
`resend-verification`, `login`, `refresh`, `logout`, and `me`. `AuthUser` contains only
`id`, `email`, and uppercase `role`. Profile fields and account metadata need separate contracts.
The remaining sections specify data needs without inventing domain HTTP endpoints.

---

## 4. Visual style guide (verified against the current UI, 2026-09-09)

Read from: `auth-shell.tsx`, `register.tsx`, `verify.tsx`, `privacy-consent.tsx`, `globals.css`,
`layout.tsx`. **Drafts must reuse these exact tokens** so accepted drafts port 1:1 into Tailwind.

### Color palette (warm cream/ivory theme — NOT default Tailwind grays)

| Token                  | Hex                                                              | Used for                                             |
| ---------------------- | ---------------------------------------------------------------- | ---------------------------------------------------- |
| Page background (auth) | `#f7f4ec`                                                        | Warm cream canvas behind auth pages (AuthShell root) |
| Card / surface         | `#ffffff`                                                        | Main white card on cream background                  |
| Text primary           | `#171714`                                                        | Headings, near-black with warm tint                  |
| Text secondary         | `#5e5a52`                                                        | Subtitles, body copy, footer                         |
| Text muted             | `#77736b`                                                        | Input placeholders                                   |
| Border default         | `#e2dfd8`                                                        | Input borders, social buttons                        |
| Border hover           | `#c6c0b5` / `#b9b3a8`                                            | Input/button hover                                   |
| Accent (amber/ochre)   | `#d18b43`                                                        | Eyebrow text, underline decoration, artwork accents  |
| Accent hover           | `#d88835`                                                        | Link hover color                                     |
| CTA background         | `#ffc57d`                                                        | Header "Register" pill button (amber)                |
| CTA shadow             | `rgba(206,145,64,0.12)`                                          | Soft amber glow under CTA                            |
| Input fill (secondary) | `#faf9f6`                                                        | Confirm-password field, social button hover          |
| Error text             | `#c04f40` / border `#d96452`                                     | Inline errors, invalid input border                  |
| Error surface          | `red-50`                                                         | Error alert background                               |
| Artwork neutrals       | `#e5ded2`, `#ded6ca`, `#d4c7b5`, `#f1ddc4`, `#9c988e`, `#b2ada2` | Decorative circles/dots/lines                        |

### Role colors (from `globals.css` @theme + dashboard drafts v3)

| Token             | Hex       | Used for                                                                 |
| ----------------- | --------- | ------------------------------------------------------------------------ |
| `--color-student` | `#1cd5b0` | Student-role accent (teal/mint) — drafts deepen to `#22c49a` / `#0e8a73` |
| `--color-tutor`   | `#0e8eea` | Tutor-role accent (blue) — drafts deepen to `#0b6db0`                    |

### Logged-in (dashboard) design language — established by the v3 dashboard drafts

Extracted from `pages/dashboard-student.html` + `pages/dashboard-tutor.html` (v3 polished).
**Reuse the existing logged-in tokens** from `apps/web/src/app/globals.css` and the accepted
dashboard references. The production stylesheet includes Student, Tutor, and Admin accents:

| Token           | Value                                                                                  | Used for                                                                                  |
| --------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Page background | gradient `#f7f4ec → #f3ecdf` (160deg)                                                  | Logged-in canvas — softer than auth `#f7f4ec` flat                                        |
| Card            | `#ffffff`, `border-radius: 1.6rem`, `--shadow-card`                                    | Every panel; hover lifts `translateY(-3px)` + `--shadow-card-hover`                       |
| Text ink        | `#1a1916` / `#5e5a52` / `#8a857b`                                                      | primary / secondary / muted (warmer than auth's `#171714`)                                |
| Border          | `#ebe6dd` / strong `#d9d2c6`                                                           | Row dividers, inputs (`1.5px` on focus-visible surfaces)                                  |
| Accent          | `#d18b43` / hover `#d88835`, CTA `#ffc57d → #f0a04e` gradient                          | Eyebrow pills, warning pills, header CTA (unchanged from auth)                            |
| Role accent     | student `#22c49a` (+grad `#3fd8b3→#0c9a7c`), tutor `#0e8eea` (+grad `#4ab4f5→#0a6fbc`) | Role chip, summary-card top bars, avatars, focus rings, soft tints `rgba(role,0.14/0.07)` |
| Warn            | bg `rgba(209,139,67,0.14)`, fg `#c07a2e`                                               | pending pills, "waiting" rows                                                             |
| Error           | `#c04f40`                                                                              | danger nav item, destructive ghost-button hover                                           |
| Dark button     | gradient `#2a2822→#151410`, pill radius                                                | Primary in-app actions (Book, +), vs amber CTA for auth/signup CTAs                       |
| Shadows         | `--shadow-card`, `--shadow-card-hover`, `--shadow-cta`, `--shadow-btn`                 | Layered soft shadows (see drafts' `:root`)                                                |

**Layout skeleton (both dashboards):**

- Sticky left sidebar (`300px`, gradient `#fbf9f3→#f4efe4`, full viewport height, collapsible
  with the current logo/burger transition): logo, `user-chip` (gradient avatar +
  name + email), `side-nav` (icon + EN/TH label, optional count `chip` or `ln` outline pill,
  `danger` item last), small `side-card` promo/tip.
- Main column (`min(1200px, …)`): greeting block (eyebrow pill, `h1` with role chip,
  subtitle) → **row 1: 4 summary cards** (5px role-gradient top bar, soft corner circle,
  icon-dot headings, `.big` stat + `.sub`) → **row 2: one wide panel** (search/filter head +
  table/list) → supporting panels per role.
- Header: logo (HK monogram in dark rounded square, gradient), nav, lang toggle (role-colored
  dot), amber CTA pill.
- Decorative `BackgroundArtwork`: fixed blurred radial blobs (2 warm + 1 role-tinted) + radial
  highlight — subtler than auth page artwork.

**Reusable component patterns (copy from drafts):**

- `pill` (dot + label): `.confirmed`/`.published`/`.verified` (role tint), `.pending` (warn),
  `.draft`/`.done` (neutral ink), `.open`/`.booked` (slot states).
- `avatar`: gradient role-circle with initials, `box-shadow` role tint; used in `user-chip`,
  `tutor-line`, table rows.
- `search`: pill input (`height 3rem`, `border-radius 999px`), focus ring `role + 4px soft`.
- Row lists: `.tutor-row` (grid `auto 1fr auto auto`, hover `role-softer`), `.req-row`
  (booking requests with `btn-ghost` decline / `btn-ok` role-gradient accept), `.mini-list`.
- `.qa` quick-action links (hover: tint bg + `translateX(3px)`), `.slot` availability rows,
  `.earn` money stat, `.strength` progress bar (role gradient fill).
- Buttons: `.btn-dark`/`.btn-book` (dark gradient pill), `.btn-ok` (role gradient),
  `.btn-ghost` (outline, error on hover), `.cta` (amber, header only).
- i18n in drafts: `data-en`/`data-th` attributes + `html[lang]` CSS switch (drafts) — real
  implementation still uses `copy.<section>.<key>` from `lib/i18n.tsx`.
- Accessibility: same conventions as auth (sr-only labels, `aria-label` on icon buttons,
  `role="alert"` errors, `aria-hidden` artwork) + collapsible sidebar keeps a visible close
  button and a fixed reopen pill.

### Typography

- Font stack: **system UI + `"Noto Sans Thai"`** for Thai support; body CSS currently
  `Arial, Helvetica, sans-serif` (globals.css). Use Thai-capable fallbacks in drafts.
- Display heading: `text-[2rem]–[2.25rem] font-bold tracking-[-0.055em]` (tight tracking).
- Eyebrow label: `text-[0.68rem] font-bold uppercase tracking-[0.24em] text-[#d18b43]`.
- Subtitle: `text-[1.02rem] leading-7 text-[#5e5a52]`, max-width `~360px`, centered.
- Logo: `text-[1.55rem] font-black tracking-[-0.08em]` + "HK" monogram in a dark circle.
- Small helper/error text: `text-xs`.
- i18n: New interactive UI copy must use `copy.<section>.<key>` (`lib/i18n.tsx`, EN/TH via `useLanguage()`,
  persisted in `localStorage['hktutor-language']`). Drafts must show both languages — existing keys where available; proposed page keys must be added to both languages.

### Component patterns (copy these shapes into drafts)

- **AuthShell layout** (every auth page): full-viewport cream page → header (logo left,
  language toggle + nav link + amber CTA right) → centered content (`max-w-[624px]`) →
  centered footer `© year | privacy & support`. Background has decorative `BackgroundArtwork`:
  large soft circles, dot pattern, hand-drawn squiggle lines (SVG), radial highlight.
- **Card**: `rounded-[2rem] bg-white shadow-[0_22px_65px_rgba(46,39,25,0.08)]`, inner
  `max-w-[490px] mx-auto`, padding `px-6 py-9` → `lg:px-[4.25rem] lg:py-14`.
- **Text input**: `h-[3.65rem] rounded-xl border border-[#e2dfd8] px-5`, hover border
  `#c6c0b5`, focus border `#171714` + `ring-[#171714]/10`; error state border `#d96452`.
  Labels are `sr-only` (placeholder-driven). Passwords have an eye toggle button.
- **Primary CTA button**: `rounded-xl bg-[#ffc57d] font-semibold px-4–6 py-3–3.5` with amber
  shadow, hover `-translate-y-0.5`.
- **Unused social-button reference** (the component is exported but not mounted by login/register; no OAuth contract exists): `h-12 rounded-xl border border-[#e2dfd8] bg-white`, 3-col grid
  (Google/Apple/Facebook), labels hidden on mobile (`hidden sm:inline`).
- **Error alert**: `rounded-lg bg-red-50 p-3 text-xs text-[#c04f40]` with `role="alert"`;
  invalid checkbox gets `outline-2 outline-[#d96452]`.
- **Links**: bold `#171714` with `decoration-[#d18b43] underline-offset-4`, hover `#d88835`.
- **Language toggle**: globe icon + `EN`/`TH` label, `rounded-full p-2 hover:bg-white/60`,
  `aria-pressed`.
- **Icons**: inline SVG, stroke `currentColor`, `strokeWidth 1.1–1.5` (thin-line style).
- **Accessibility conventions in use**: `sr-only` labels, `aria-label`/`aria-pressed` on icon
  buttons, `role="alert"` + `aria-invalid` + `aria-describedby` for errors, `aria-hidden` on
  decorative artwork. Drafts should preserve these.
- **State/flow patterns**: loading disables + swaps button text (`copy.*.loading`); inline
  error banners; password visibility toggles;
  role picker (student/tutor buttons with `aria-pressed`) + privacy consent checkbox with version number
  interpolated via `.replace('{version}', ...)`.

### Anti-patterns to avoid in drafts

- No default Tailwind gray/blue palette — the design language is warm cream + amber, with
  role accents (teal student / blue tutor) and dark-gradient action buttons.
- No dark mode handling anywhere yet.
- Logged-in look is now ESTABLISHED by the v3 dashboard drafts (§4 "Logged-in design
  language") — new pages must reuse those tokens, not invent new ones.
- No animation library — only Tailwind `transition-*` + small hover transforms.
- **Motion rule:** UI design prototypes must not apply `prefers-reduced-motion`; transitions need
  to remain visible so reviewers can assess them. Production UI must implement
  `@media (prefers-reduced-motion: reduce)` and remove or shorten non-essential motion for users
  whose operating system requests reduced motion.

---

## 5. Draft folder layout

```
ui-design/
├── uidesign.md          ← this file
├── pages/               ← one draft per page/route (e.g. pages/dashboard-tutor.html)
├── shared/              ← shared CSS/TS used by multiple drafts (e.g. shared/theme.css)
└── index.html           ← gallery linking every draft (open in browser to navigate)
```

## 6. Draft conventions

1. **Stack per draft:** a single `.html` entry file. Shared logged-in pages use
   `shared/prototype.css` and `shared/prototype-shell.js` so the header, sidebar, tokens and
   responsive behavior remain identical. No build step or framework is required; drafts must
   open from the gallery or a small local static server.
2. **TypeScript:** if a draft needs logic, keep a sibling `.ts` file and compile with the
   workspace's `typescript` package (`npx tsc <file>.ts --outFile ...`), or use `<script type="module">`
   with plain typed-notation JS for pure layout mocks. Compiled output stays next to the source.
3. **Match the real design language** of `apps/web`: Tailwind-based look, hand-rolled EN/TH i18n
   (`lib/i18n.tsx`) — drafts should show both EN and TH text where the page will have copy.
4. **One draft per page route** — name files after the real route: `dashboard-student.html`,
   `dashboard-tutor.html`, `availability.html`, etc. Iterate in place; git-history style backups
   are not needed here.
5. **No real data.** Mock data only (tutor names/prices may copy the seed fixtures: Pim THB 450,
   Mali THB 350 Mathematics). No secrets, no Clerk IDs, no connection strings — ever.
6. **Not a spec of record.** Sections 1–3 and 9–13 define the page/data design plan; merged API contracts remain authoritative for implementation; the draft
   index (§7) is exploration tracking. When a draft is accepted, mark it in §7 and implement
   in `apps/web` on the owning task's branch.

## 7. Page drafts index

| Draft file                     | Real route                                  | Owning task | Status                                                                                                                |
| ------------------------------ | ------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------- |
| `index.html`                   | — (gallery)                                 | —           | ✅ scaffold                                                                                                           |
| `pages/dashboard-student.html` | `/dashboard` (student view)                 | S1-T09      | ✅ **shell implemented in T09** — accepted visual reference; domain data/actions still pending                        |
| `pages/dashboard-tutor.html`   | `/dashboard` (tutor view)                   | S1-T09      | ✅ **shell implemented in T09** — accepted blue theme; booking, listing, availability and earnings data still pending |
| `pages/tutor-profile.html`     | profile form                                | S1-T16      | 🟡 **draft v4** — basic profile belongs to Sprint 1; document upload/review belongs to Sprint 2; see §9.4 and §12     |
| `pages/listing-form.html`      | listing form + cards                        | S1-T16      | 🟡 interactive draft — complete data, validation, preview and status filters; awaiting visual review                  |
| `pages/availability.html`      | availability manager (Bangkok time UTC+7)   | S1-T19      | 🟡 interactive draft — complete slot data, derived status, create/delete and conflict states; awaiting visual review  |
| `pages/search.html`            | tutor search + filters + no-match state     | S1-T22      | 🟡 interactive draft — complete listing data, four filters and exact no-match state; awaiting visual review           |
| `pages/booking.html`           | booking confirmation + student booking list | S1-T25      | 🟡 interactive draft — complete request summary, booking states and slot-conflict state; awaiting visual review       |

## 8. Acceptance flow (draft → real page)

1. **Draft the page here** (layout + copy EN/TH + mock data) using the design language in §4 —
   copy the dashboard `:root` token block and reuse the component patterns; do not invent
   new tokens.
2. Review in chat; iterate until agreed.
3. Hand to the owning task's TDD branch in `apps/web` (read `apps/web/node_modules/next/dist/docs/`
   first — Next 16 breaking changes).
4. Mark the draft row in §7 ✅ implemented (keep the draft; don't delete).

---

## 9. Screen-to-field specifications

Within these tables, **current model** means persisted in Prisma, not available through a
production domain endpoint. **Derived** means computed from authoritative records. **Planned**
means workbook-only. Fields such as owner IDs, timestamps, verification and monetary totals are
server-controlled unless a row explicitly describes an input.

### 9.1 Authentication, privacy and account identity

| Screen / block          | Visible data or input                                                                                 | Model / source                                                                           | Rules and states                                                                                                                                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login                   | Email, password, password visibility, submit, registration link                                       | Input email maps to `User.email`; server verifies `passwordHash`                         | Loading, invalid credentials, unverified account, throttled/network failure; password is write-only and never echoed in a response                                                                              |
| Register                | Email, password, confirm password, Student/Tutor role, consent checkbox and policy link/version       | `User.email/role`; password → server hash; consent → `consentAcceptedAt/policyVersion`   | Confirm password is client-only; no admin option; current client requires 10+ characters with a letter and number; server DTO remains final validator; unchecked consent prevents submit; duplicate email error |
| Verify / resend         | Destination email, waiting/verifying/success/error text, resend and login actions, close-tab fallback | `EmailVerificationToken` consumed server-side; `User.emailVerifiedAt`; new `AuthSession` | Single-use link; invalid/expired/consumed link requires recovery; the raw token is an input only, never visible page content or persisted UI state; do not design numeric OTP boxes                             |
| Privacy                 | Title, version, effective date, summary, sections, back link                                          | `PRIVACY_NOTICE`; consent field values are not the notice body                           | Currently English-only; a future translated notice needs reviewed copy with the same version                                                                                                                    |
| Account / sidebar       | Own email, role, derived initial; language toggle; sign out                                           | Current `AuthUser`; local language store                                                 | Current display name is an email-prefix fallback. A tutor's real public name comes from `TutorProfile.displayName` after profile API integration                                                                |
| Future account metadata | Verification date, account status, consent date/version, joined date                                  | Current `User.emailVerifiedAt/accountStatus/consentAcceptedAt/policyVersion/createdAt`   | Read-only only after an allowlisted owner response exists; current `AuthUser` does not expose these fields                                                                                                      |

No StudentProfile, student name, avatar/photo URL, school, phone, date of birth, goals, or language
preference field exists in the data model. Do not add editable controls for them without a new
contract. The `/about-me` page stays informational. OAuth, password reset, email change and session
management UI are outside the current auth scope despite unused social-button exports/copy.

### 9.2 Student dashboard

Preserve the existing shell and ordering: greeting → four summary cards → Your tutors panel.

| Block                   | Required visible data                                                                            | Source / derivation                                                                              | Action and state                                                                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Greeting / identity     | Own display fallback, email and Student role                                                     | `AuthUser`; do not fabricate a student profile                                                   | Existing authenticated shell                                                                                                                                                                         |
| Next lesson             | Tutor name, subject, grade, Bangkok date and start/end, status                                   | Own `Booking` joined to `TutorProfile`, `TeachingListing.subject/gradeLevel`, `AvailabilitySlot` | Proposed query: earliest future CONFIRMED booking. Ongoing sessions may be shown separately. Open booking detail; no Join button in Sprint 1                                                         |
| Booking summary         | Upcoming, completed and pending counts                                                           | Owner-scoped `Booking.status` + slot time                                                        | Proposed upcoming count: future PENDING + CONFIRMED; completed count: COMPLETED; pending count: PENDING. Use the same definitions in badges/list filters                                             |
| Waiting on tutor        | Pending booking reference, tutor, subject, requested time, submitted date                        | Own `Booking` where PENDING; `createdAt`                                                         | Open detail; after confirmation move out of this list; empty state only after successful query                                                                                                       |
| Quick actions           | Find a tutor, My bookings, Account                                                               | Routes; no new model                                                                             | Point to the proposed destinations rather than hashes                                                                                                                                                |
| Your tutors             | Tutor name/initial, subjects taught to this student, next booked lesson, relevant booking status | Derived from this student's bookings joined to profiles/listings/slots                           | Proposed inclusion: distinct tutors with PENDING/CONFIRMED/COMPLETED bookings; canceled-only tutors remain in history. Filter by name/subject; confirm this product rule before query implementation |
| Book again / view tutor | Relevant listing, current rate and availability when returned                                    | Current public listing/profile query                                                             | Revalidate published/verified eligibility. Historical booking relationship alone does not make a tutor bookable                                                                                      |

There is no saved-tutor/favorite table. “Your tutors” must be derived from bookings unless a new
feature is agreed. The current Thai empty copy implies saved tutors; change that wording when
connecting the panel. Do not use a list page's item count as an all-record total.

### 9.3 Tutor dashboard

| Block                 | Required visible data                                                                | Source / derivation                                                 | Action and Sprint                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Greeting              | Public display name, own email, Tutor role, verification status                      | `TutorProfile.displayName/verificationStatus` + auth identity       | Load missing-profile state and link to profile editor                                                                         |
| Next session          | Student label approved by the API, subject, grade, Bangkok time and status           | Own `Booking` + listing/catalog + slot; student relation            | Open detail; student display-name field is absent, so use an agreed private label or booking reference, not a fabricated name |
| Requests              | Pending count; requests submitted this week                                          | Own PENDING bookings; `createdAt` for the weekly subset             | Query-derived counts. Week boundary is a proposal to confirm, using Asia/Bangkok                                              |
| Reschedule requests   | Pending request count and requested target time                                      | Planned `RescheduleRequest`                                         | Sprint 2; no real zero/count before the endpoint exists                                                                       |
| Earnings              | Paid completed revenue for selected period; number of completed sessions             | Planned `Booking.paymentStatus/paidAt` + current `status/netAmount` | Report is Sprint 3 (US7-1). Cannot label current totals PAID or revenue from `netAmount` alone                                |
| Profile readiness     | Checklist: basic profile, published listing, future open slot, verification status   | Current profile/listing/slot fields, derived                        | Proposed checklist replaces unsupported arbitrary `0%`; no persisted `profileStrength` field or agreed score formula          |
| Booking requests list | Reference, allowed student label, subject/level, date/time, amount and PENDING badge | Owner-scoped Booking join                                           | Confirm/Reject only in Sprint 2 US12-4; re-read state on conflict; do not expose controls merely because a badge says pending |
| My listings           | Subject/level title, THB/hour, description excerpt, publication state                | Own `TeachingListing` + Subject/GradeLevel                          | New/edit/publish through T15/T16; view all                                                                                    |
| Today                 | Start/end, derived Open/Reserved state; own booking reference if reserved            | Own slots overlapping the Bangkok day + PENDING/CONFIRMED bookings  | T18/T19; sort by start; Manage availability                                                                                   |

The existing `0`, `0฿`, `0%`, PAID label and empty panels are static placeholders. Future designs
must distinguish unavailable data from a successful zero-result response. Preserve the visual
space while using an unavailable state or hiding a later-Sprint block.

### 9.4 Tutor profile editor and documents

Suggested layout: basic profile form beside public preview; verification/read-only summary below;
documents as a separate, clearly scoped section when Sprint 2 is enabled.

| Control / block      | Fields                                                                   | Source and mutability                                                                                     | Validation / state                                                                                                 |
| -------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Public name          | `displayName`                                                            | Current `TutorProfile`; owner editable                                                                    | Required nonblank text; final length limit comes from T15 DTO                                                      |
| Introduction         | `bio`                                                                    | Current `TutorProfile`; owner editable                                                                    | Required content; a listing's 20–1000 rule must not automatically be applied to bio                                |
| Experience           | `experienceYears`                                                        | Current `TutorProfile`; owner editable                                                                    | Integer ≥ 0; zero is valid; no model-backed maximum of 80                                                          |
| Public preview       | Name, bio, experience, verification badge, rating/count if returned      | Same current profile fields; local unsaved preview labelled accordingly                                   | No public email, private documents, IDs or review notes; a preview cannot self-assign Verified                     |
| Verification summary | `verificationStatus`                                                     | Current profile; server/admin-controlled                                                                  | Pending/Verified/Rejected; email verification does not satisfy tutor verification                                  |
| Rating summary       | `ratingAverage`, `reviewCount`                                           | Current cached fields; read-only                                                                          | Null/0 → New tutor; seeded values are demo data, not genuine review evidence                                       |
| Record metadata      | `createdAt`, `updatedAt`                                                 | Current profile; read-only                                                                                | Prefer compact Updated text; full internal IDs are not normal user-facing labels                                   |
| Upload documents     | File picker, filename, MIME, byte size, progress, individual error/retry | Planned `TutorDocument.originalFileName/mimeType/sizeBytes`; actual file sent to protected upload service | Sprint 2 US6-1; PDF/JPG/PNG; 0 < size ≤ 5 MB; server validates bytes/type; per-file progress is transient UI state |
| Document list        | Filename/type/size, status, uploaded/reviewed dates, review note         | Planned `TutorDocument.status/uploadedAt/reviewedAt/reviewNote`                                           | Own documents only; Pending/Verified/Rejected; show rejection feedback and permitted resubmission                  |
| View document        | Short-lived authorized viewer/download action                            | Planned server-issued signed URL from private `objectPath`                                                | URL is transient, not a public profile field; handle expiry and denied access                                      |

Draft review: `pages/tutor-profile.html` currently assumes bio length and experience limits and
allows removal of document rows. Those are prototype behaviors, not confirmed DTO/storage rules.
Removing a locally queued file is safe draft behavior; persisted document deletion needs an explicit
API/RBAC contract (the sheet grants tutor create/read, not delete). Public profile verification
must use the aggregate profile status; it cannot be inferred from one document being approved.

### 9.5 Teaching listings: list, create and edit

| Control / block               | Fields / joins                                                                         | Data ownership                                | Validation / behavior                                                                                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Subject selector              | `subjectId` → `Subject.id/code/name/active`                                            | Catalog lookup; selected ID stored on listing | Offer active options; keep historical inactive labels readable; no free-text spelling variants                                                                |
| Grade selector                | `gradeLevelId` → `GradeLevel.id/code/name/sortOrder/active`                            | Catalog lookup                                | Sort by `sortOrder`; inactive existing value needs an explicit edit policy                                                                                    |
| Price per hour                | `pricePerHour`                                                                         | Owner input; current decimal field            | THB/hour, strictly > 0, two-decimal money handling; not a lesson total                                                                                        |
| Description                   | `description`                                                                          | Owner input                                   | Trimmed 20–1000 characters; counter and inline error                                                                                                          |
| Publication                   | `publicationStatus`, `publishedAt`                                                     | Server-controlled lifecycle                   | Draft/Published/Archived. Publish requires verified tutor; saving a draft must not imply publishing                                                           |
| Listing card                  | Subject + grade title, tutor name where useful, rate, excerpt, status and updated date | Listing + catalogs + profile                  | There is no listing `title`, image, duration, capacity, location or teaching-mode field; derive the title                                                     |
| Save / edit / publish actions | Listing ID for selection; owner derived from session                                   | T15 contract pending                          | Disable while saving, keep form values on failure, show success from returned record; publishing and unpublishing/archive semantics must match the merged API |

One listing selects one subject and one grade. Multiple offerings require multiple listings.
Availability belongs to a tutor, not a listing. Do not add per-listing calendars without a schema
change. Archived and soft-deleted are different states; preserve historical booking references.

### 9.6 Availability manager and student slot picker

| Block              | Visible input / data                                                  | Model / derivation                                | Rules                                                                                                              |
| ------------------ | --------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Date navigation    | Selected day/week, Bangkok timezone label                             | Transient date filter                             | Explicit Asia/Bangkok regardless of browser timezone                                                               |
| Add range          | Local date, start time, end time                                      | Convert to `AvailabilitySlot.startAtUtc/endAtUtc` | Future range; start < end. Preview the date as well as time if it crosses midnight; no recurring-rule model exists |
| Slot list/calendar | Start/end, duration, Open/Reserved; own linked booking when permitted | Current slot + active Booking                     | Derived duration; reserved when a PENDING or CONFIRMED booking exists; no stored slot status                       |
| Delete slot        | Selected `slot.id`                                                    | Owner API performs soft delete                    | Only unreserved slots; handle 409 if reserved in the meantime; do not cascade-remove booking history               |
| Student selection  | Future open times for the chosen tutor, selected range summary        | Eligible slots returned by API                    | View-only, then select `slotId` for booking; show no other students' identity or booking details                   |

Examples: 2026-09-10 18:00–19:00 Bangkok is 11:00–12:00 UTC. An adjacent 19:00–20:00
slot is valid; 18:30–19:30 conflicts. A future slot with only canceled/completed history is not
reserved, but past times are never new booking options. Display loading, no slots, save conflict,
past/inverted range, reserved-delete conflict and retryable service error states.

### 9.7 Tutor search and public detail

| Block                 | Fields                                                                                                                                                                      | Rule / action                                                                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Filters               | Subject ID/code, grade ID/code, maximum budget, minimum rating                                                                                                              | Map labels to canonical catalogs and eventual T21 parameter names; optional filters combine with AND; inclusive price maximum and rating minimum                        |
| Result card           | `TutorProfile.userId/displayName/experienceYears/verificationStatus/ratingAverage/reviewCount`; selected `TeachingListing.id/pricePerHour/description`; subject/grade names | Only eligible published listings of verified tutors; exclude deleted/unavailable public records through server query                                                    |
| Result grouping       | Tutor + matching listing(s)                                                                                                                                                 | Proposal: display one card per matching listing or explicitly group matching offerings; never pair the lowest price from a different offering with the selected subject |
| Rating                | Cached average and count                                                                                                                                                    | No reviews → New tutor and 0 reviews; minimum-rating filtering must not invent a score for null; demo seed ratings are labelled as demo                                 |
| Detail overview       | Name, bio, experience, Verified badge, rating/count and public offerings                                                                                                    | Same profile/listing joins; public allowlist excludes email, consent, account internals and document files                                                              |
| Offering and schedule | Selected listing description/rate/subject/grade; next eligible slot when allowed                                                                                            | Change listing only within the selected tutor; slot query must belong to the same tutor; full slot access for guests needs RBAC clarification (§12)                     |
| Search states         | Loading, exact results/count, no exact matches, invalid filter, service error, pagination if supported                                                                      | Retain filters and offer Clear filters; do not substitute unrelated tutors for an empty exact result                                                                    |
| Calls to action       | View details; sign in/register to book for guest; choose slot/book for Student                                                                                              | Tutor/Admin can browse but cannot create bookings; no role-switch-to-student control                                                                                    |

Do not add name free-text search, a lower-price bound or sorting parameters as an existing T21
contract. They need confirmation. Sprint 2 US1-2 adds deterministic ranking by lowest price,
highest rating or earliest availability plus honest reason tags. Sprint 3 US10 adds comparison.

### 9.8 Booking review, submitted result and booking list

Suggested flow: search → public detail/selected offering → available slot → review booking →
submit → persisted booking detail → My bookings. “Request submitted” is distinct from “Tutor
confirmed”; Sprint 1 booking creation returns PENDING.

| Screen / block     | Required fields / joins                                                                                                                  | Behavior                                                                                                                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before submit      | Tutor public name, subject/grade, selected listing description, local date/start/end, derived duration, quoted THB subtotal/discount/net | Read current listing/slot; show a quote only from an agreed server contract. Do not assume every slot is one hour or finalize prorating/rounding rules locally                                 |
| Create request     | Selected `listingId`, `slotId` and contract-required inputs                                                                              | Server derives student/owner identity, verifies same tutor and reserves atomically; never trust client-entered price/owner IDs                                                                 |
| Submitted result   | `Booking.id/status/createdAt`, tutor, listing, time, `subtotalAmount/discountAmount/netAmount/currency`                                  | Render returned PENDING record; use ID as a reference and detail key; retain full reference for copy if needed                                                                                 |
| Student list       | Reference, tutor, subject/grade, Bangkok time, status, net amount                                                                        | Owner-scoped `studentUserId`; filter status/date and paginate when supported; empty vs error vs unavailable states                                                                             |
| Detail             | All list data plus full description as permitted, amount breakdown, last update                                                          | Join through `listingId`, `slotId`, `tutorProfileId`; amount snapshots are authoritative, not today's listing rate                                                                             |
| Tutor booking list | Same core details with approved student label, incoming status and amount                                                                | Owner-scoped `tutorProfileId`; no unrelated student account data; management actions in Sprint 2                                                                                               |
| Failure / race     | Validation, unauthorized, missing resource, slot conflict, stale quote, uncertain network result                                         | On 409 reload available slots and allow reselection. On an uncertain submit outcome, reconcile with server state before repeating a mutation; idempotency support is not currently established |

No payment form, Paid badge, meeting link, cancellation reason, attendance control, review input or
coupon field is backed by the current Booking schema. Reserve layout sections for the planned
extensions in §10, without implying they are shipped in Sprint 1.

## 10. Later-Sprint screens and complete model coverage

All routes here are proposed. These specifications capture every additional Data Model entity so
the remaining UI can be designed consistently without expanding the first implementation slice.

### 10.1 Sprint 2–3 screen extensions

| Screen / route proposal                                   | Visible fields and data mapping                                                                                                                                               | Allowed actions, states and scope                                                                                                                                                                                                                                                     |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tutor booking request detail, existing booking route      | Current Booking status/time/amount and participant label                                                                                                                      | S2 US12-4: owning tutor confirms PENDING → CONFIRMED or rejects → CANCELED; other actors read only as authorized; duplicate/invalid transition → 409                                                                                                                                  |
| Class details, section on booking detail                  | Planned `Booking.meetingUrl/attendance/attendanceMarkedAt`; core booking participants, subject/time                                                                           | S2 US4: tutor sets HTTPS link; participants view for CONFIRMED/COMPLETED only; absent link has a waiting state; owning tutor marks attended/absent after class end; no separate ClassSession model                                                                                    |
| Mock payment, section on booking detail                   | Planned `Booking.paymentStatus/mockReference/paidAt`; current amount snapshots                                                                                                | S2 US12-5: owning student, CONFIRMED + unpaid only; nonblank unique mock reference and exact authoritative amount; success → paid; demo payment only, no bank/card fields                                                                                                             |
| Cancellation dialog                                       | Planned `Booking.cancellationReason/canceledById/canceledAt`, status, class start, payment state                                                                              | S2 US5-1: owning student/tutor; CONFIRMED, unpaid, at least 24 hours before start inclusive; reason required; explain ineligibility; completed/canceled are terminal                                                                                                                  |
| Reschedule request/detail                                 | Planned `RescheduleRequest.id/bookingId/fromSlotId/requestedSlotId/reason/status/requestedAt/decidedAt/withdrawnAt`; old/new slot times and reviewer identity where permitted | S2 US5-2: student requests own booking, tutor approves/rejects, original requester withdraws. One pending request; ≥24h cutoff; pending target is not reserved. Approval rechecks future/free/same tutor; conflict preserves original booking                                         |
| Tutor documents, profile section                          | Planned `TutorDocument` fields specified in §9.4                                                                                                                              | S2 US6-1/2: own upload/view, admin review; show profile verification separately from document status                                                                                                                                                                                  |
| Admin verification queue `/dashboard/admin/verifications` | Tutor name, document filename/type/size, uploaded date, status; detail includes file viewer, review note/date and reviewer                                                    | S2 US6: admin verifies/rejects pending documents through protected API. Pending/Verified/Rejected tabs; file-expired, access-denied and stale-review conflict states; no public file URLs                                                                                             |
| Messages `/dashboard/messages`, conversation selection    | Planned `Conversation.id/studentUserId/tutorProfileId/createdAt`; `Message.id/conversationId/senderUserId/body/createdAt/readAt/clientMessageId`                              | S2 US2-1/2: participants only, no Admin content access; body trimmed 1–2000; history cursor, send/retry, unread/read. Last preview/unread badge derived; never fabricate recipient read state. S3 US2-3 adds realtime/reconnect with REST fallback and duplicate prevention           |
| Notifications `/dashboard/notifications` or header panel  | Planned `Notification.id/type/bookingId/payloadJson/createdAt/readAt`; unread count derived                                                                                   | S2 US3-1, S3 US3-2 reminders: recipient-only mark read and detail link; eventKey is internal idempotency data; translate allowlisted payload fields rather than display JSON. Failed booking creates no notification; paid classes retain class reminders but no payment reminder     |
| Review form in completed booking; tutor review section    | Planned `Review.bookingId/clarity/punctuality/preparation/feedback/createdAt`; derived overall rating; profile cached average/count                                           | S3 US8: own completed booking only, one review; three integer ratings 1–5, trimmed feedback 1–1000; already-reviewed and invalid-state handling. Review average = mean of dimensions; tutor average = mean of review means. Public individual-review access needs clarification (§12) |
| Tutor reports `/dashboard/reports`                        | Derived own Booking totals and status breakdown; sum of netAmount where paid + COMPLETED; completion rate                                                                     | S3 US7-1: Tutor own aggregates, Admin authorized aggregate view; no student report. Rate = completed / (completed + canceled), N/A for zero denominator. Example: 6 completed + 2 canceled → 75%; paid completed 405 + 500 → THB 905. Period basis must be agreed                     |
| Admin coupons `/dashboard/admin/coupons`                  | Planned `Coupon.id/code/percent/expiresAt/maxUses/active/createdAt/updatedAt`; usage count from `CouponUse`                                                                   | S3 US9-1: admin create/manage; case-insensitive unique code, integer percent 1–100, maxUses ≥1, future expiry on create. Show Active/Inactive and derived Expired/Exhausted; history retained                                                                                         |
| Apply coupon, mock-payment section                        | `Coupon.code`; planned `Booking.couponId`; amount breakdown; `CouponUse.discountAmount/consumedAt`                                                                            | S3 US9-2: owning student applies once; show expired/exhausted/already-used errors. Usage is consumed atomically with successful payment, not preview. No second coupon on one booking and no repeat use by the same student; no decrement/refund of use on cancellation               |
| Compare `/tutors/compare` or comparison drawer            | Profile name/experience/rating/count; selected offering subject/grade/rate; next available slot                                                                               | S3 US10: Student selects 2–3 tutors; align attributes and specify compared offering; lowest price/highest rating/earliest slot sort; no-slot last; no Comparison database table                                                                                                       |
| Admin account management `/dashboard/admin/users`         | Current `User.id/email/role/accountStatus/emailVerifiedAt/createdAt/deletedAt`, profile summary where allowed                                                                 | Planned admin endpoint/UI under US11-3; read/update permitted roles/status; no self-escalation; suspension/deletion revokes sessions. Task ownership and role-change consequences need agreement                                                                                      |
| Admin audit `/dashboard/admin/audit`                      | Planned `AuditLog.id/actorUserId/action/entityType/entityId/requestId/createdAt`, redacted `beforeData/afterData`                                                             | Admin-only read/filter/detail; append-only, no edit/delete controls; system actor may be null; never expose hashes/tokens/private file contents                                                                                                                                       |

### 10.2 Entity → screen cross-reference

| Entity                 | Current schema? | UI destinations                                                                  | Fields kept internal / derivation note                                                                |
| ---------------------- | --------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| User                   | Yes             | Auth, own identity, booking participant label, future admin users                | Password hash never returned; owner/actor IDs derived server-side; account/consent fields allowlisted |
| AuthSession            | Yes             | Auth restore, logout, expired-session state                                      | Refresh hash, raw tokens and session internals have no normal UI                                      |
| EmailVerificationToken | Yes             | Email verification and resend outcome                                            | Hash, token record IDs and consumption logic stay server-side                                         |
| AuditLog               | No              | Future admin audit                                                               | Redacted snapshots only; no UI write controls                                                         |
| TutorProfile           | Yes             | Profile editor, dashboard, search, public detail, comparison, admin verification | Read-only verification/rating cache; `userId` is its PK, not a separate profile `id`                  |
| Subject                | Yes             | Listing selector, search filters, offering/booking labels                        | Use IDs/codes for references; display `name`                                                          |
| GradeLevel             | Yes             | Listing selector, search filters, offering/booking labels                        | Sort by `sortOrder`; active controls new selection                                                    |
| TeachingListing        | Yes             | Tutor listings, search, offering detail, booking review/history                  | Publication lifecycle and soft deletion are different; title derived from catalogs                    |
| AvailabilitySlot       | Yes             | Tutor calendar, student picker, dashboard/session time, reschedule               | Open/reserved derived from Booking; no stored availability status                                     |
| Booking                | Core only       | Both dashboards, booking list/detail, future classes/payments/reports            | Current fields end at core ownership/status/amount/timestamps; extensions below remain planned        |
| RescheduleRequest      | No              | Booking detail/dialog, tutor request queue                                       | Target not held until approval; IDs joined to readable times                                          |
| TutorDocument          | No              | Tutor profile document section, admin verification                               | Private objectPath and signed URL are not public profile data                                         |
| Conversation           | No              | Participant inbox/chat                                                           | Unique student/tutor pair; no default Admin access                                                    |
| Message                | No              | Chat history, inbox preview/read count                                           | clientMessageId is retry metadata, not message text                                                   |
| Notification           | No              | Recipient notification panel, unread badge                                       | eventKey and raw payload JSON stay internal to presentation mapping                                   |
| Review                 | No              | Eligible booking review form, authorized review list, rating aggregate           | overallRating derived; one per completed booking                                                      |
| Coupon                 | No              | Admin coupon manager, student payment coupon validation                          | usedCount derived, never separately persisted                                                         |
| CouponUse              | No              | Payment discount receipt; authorized usage totals/history                        | Immutable usage, one per booking and per coupon/student; no standalone student CRUD page              |

Planned Booking fields absent from current Prisma: `couponId`, `paymentStatus`, `mockReference`,
`paidAt`, `meetingUrl`, `attendance`, `attendanceMarkedAt`, `canceledById`, `cancellationReason`,
`canceledAt`. These must not be presented as available API response fields.

## 11. Shared screen states and reusable components

| Pattern                               | Design contract                                                                                                                                                                                                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identity and permissions              | Use API-verified role; owner/participant scope enforced server-side. Wrong role → access denied; missing/non-owned private resource → generic not found according to endpoint contract. Unknown role must never unlock admin tools.                                      |
| Loading / unavailable / empty / error | Skeleton or status while loading; unavailable when integration is absent; zero/empty only after successful read; errors keep context and offer retry. Never turn fetch failure into a valid count of 0.                                                                  |
| Form feedback                         | Visible labels for new domain forms, required/optional text, help/counters, inline errors, focus first invalid field, preserve input after failed save; saving state prevents duplicate clicks.                                                                          |
| Success                               | Show returned record/status after server confirmation; reload dependent panels/counts. Static prototypes can simulate success but must remain clearly demo-only.                                                                                                         |
| Status badge                          | Text plus color. Keep tutor verification, listing publication, booking state, payment state and derived slot state separate. S2 reject booking maps to CANCELED, not a new REJECTED booking enum.                                                                        |
| Booking progression                   | PENDING → CONFIRMED or CANCELED; CONFIRMED → COMPLETED or eligible CANCELED; COMPLETED/CANCELED terminal. Confirmation is not a terminal state. Completion requires class end to have passed.                                                                            |
| Time                                  | Store/compare UTC, display Asia/Bangkok and explicit date/time; use the same boundary for cards, filters and reports. Do not rely on browser-local timezone or change timezone when switching EN/TH.                                                                     |
| Money                                 | THB; distinguish hourly rate, quoted lesson total and persisted booking amounts; show subtotal − discount = net. Use server decimal values; do not recompute historical amounts from current rate.                                                                       |
| Identity fallback                     | Initial avatar is derived decoration. Public tutor name uses profile; private student label needs an agreed allowlist. No invented photo, name or personal profile data.                                                                                                 |
| Responsive layout                     | Preserve 300px desktop rail and current collapsible behavior. Stack forms/cards on narrow screens; present booking rows as readable cards or bounded tables; retain core time/status/action visibility.                                                                  |
| Keyboard and language                 | EN/TH labels, placeholders, errors and empty states; labelled icon buttons, focus visibility, aria-live status, inert collapsed navigation. New designs must remain usable with zoom and reduced motion.                                                                 |
| Reusable building blocks              | Existing AuthShell/DashboardShell; proposed StatusBadge, Tutor/ListingCard, BookingSummary, BangkokTimeRange, MoneyBreakdown, CatalogSelect, Empty/ErrorState, DocumentRow and confirmation dialog. These names describe proposed components, not files already present. |

## 12. Contract gaps and source conflicts to resolve

These items do not prevent static design. They must be settled with the owning API task before
shipping the corresponding controls or query logic.

| Finding                                     | Evidence / effect                                                                                                                              | Design decision for now                                                                                                                           |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard documentation lag                 | Root README and old UI inventory call it a stub; TSX and T09 Done show role shells                                                             | Mark shells implemented, domain data pending. Do not redesign completed auth/session work                                                         |
| No production domain API on main            | `AppModule` includes auth, health and examples only                                                                                            | Confirm actual DTOs, list/detail queries, pagination, filters and error codes after merge; no invented endpoint names                             |
| No student display profile                  | `User` lacks name/photo; `AuthUser` is only id/email/role                                                                                      | Use a booking reference or API-approved private label in tutor rows; public email is never a fallback for tutor identity                          |
| Profile draft validation differs from model | v4 bio/experience limits are prototype-only; database only fixes nonnegative integer experience                                                | Do not transfer 20–1000 listing constraints or maximum 80 experience to profile without T15 approval                                              |
| Document scope and removal                  | TutorDocument is Sprint 2; tutor RBAC grants upload/read, not persisted deletion                                                               | Split basic profile and document designs; queue removal only until a delete contract exists                                                       |
| Verification aggregation                    | Sheet mentions document review affecting profile, but no rule for multiple accepted/rejected documents                                         | Display aggregate `TutorProfile.verificationStatus`; do not compute it client-side or treat email verification as qualification approval          |
| Listing unpublish/archive                   | Workbook enum has draft/published/archived; explicit transition table only specifies draft → published                                         | Design state variants; confirm available archive/unpublish/re-publish actions and their effects on booked lessons                                 |
| Guest availability / individual reviews     | RBAC permits guest listing search but has no guest slot or review access; future comparison uses next availability                             | Keep public profile basics and cached public search rating; require sign-in for protected slot/review detail until API allowlist resolves scope   |
| Slot mutations                              | RBAC lists update, but S1-T18 is create/list/delete                                                                                            | Do not promise drag-to-reschedule, recurring schedules or direct slot editing in Sprint 1                                                         |
| Lesson pricing and history                  | Sheet requires server amount snapshot; slots can have variable duration; listing text/time snapshots are not in schema                         | Confirm duration billing/rounding and whether booked listing/slot edits are prevented or snapshotted; use persisted amounts for existing bookings |
| Confirm wording                             | Product Backlog US12-4 calls confirm/reject final, while Data Model rows 26/80–84 allow confirmed → completed/canceled                         | Use explicit Data Model lifecycle; only canceled/completed are terminal                                                                           |
| Reschedule target wording                   | Product Backlog row 39 says rejected target stays unavailable; Data Model rows 28/85–87 say target is never held and rejection changes no slot | Follow no-hold model: original booking stays; target availability remains independently derived; flag wording for tracker correction              |
| Attendance permission                       | RBAC row 16 is broad; US4-2 specifically permits owning tutor marking                                                                          | Student reads attendance only in proposed design; no student marking control                                                                      |
| Reminder wording                            | US3-2 has broad paid exclusion but explicit example/model preserves paid class reminders                                                       | Paid skips payment reminder only; canceled/ineligible states follow scheduler contract                                                            |
| Public/privacy language and copy            | Privacy is static English; some auth errors and nav aria labels are literal English; TH Your tutors implies saved records                      | Add reviewed EN/TH copy during relevant UI work; do not claim current universal localization                                                      |
| Unsupported dashboard metrics               | PAID/earnings/reschedule/profile-strength placeholders lack complete data contracts                                                            | Gate later features; agree report period and checklist/count definitions before populating cards                                                  |
| Settings, support and admin console         | Hash links/safe admin placeholder do not establish backend workflows                                                                           | Keep read-only account/real privacy links; future admin screens follow explicit admin endpoints; no invented support-ticket model                 |

## 13. Design order and handoff checklist

1. Refine `pages/tutor-profile.html`: map only basic profile in Sprint 1 and separate document
   states for Sprint 2. Preserve the current Tutor shell and public preview.
2. Draft `pages/listing-form.html`: listing management cards, create/edit states and publication
   eligibility; reuse Subject/Grade selectors and price/description validation.
3. Draft `pages/availability.html`: Bangkok-time empty/populated list/calendar, add range,
   overlap conflict and reserved-delete refusal; include the Student picker variant.
4. Draft `pages/search.html`: four required filters, results, no matches, public detail/selected
   offering and entry into slot selection. Include guest and Student action differences.
5. Draft `pages/booking.html`: review, submitting, PENDING submitted result, 409 conflict, own
   list and detail. Reuse the summary in both dashboards.
6. Connect the existing dashboard design to those agreed destinations and data definitions.
   Complete API-backed implementation only after dependencies and list/query contracts are merged.
7. Design Sprint 2: tutor actions/classes/mock payment, cancellation/reschedule, documents/admin
   verification, chat and notifications. Then Sprint 3: reports, detailed reviews, coupons,
   comparison, realtime chat and reminders.

For each draft, record: role, entry/exit route, primary action, exact displayed/input fields,
source entity or derived rule, dependency task, EN/TH copy, empty/loading/error/conflict/success
states, mobile layout, and fields deliberately deferred. Use fictional data covering unverified
tutor, no reviews, no listings, no slots, inactive catalog, reserved slot, pending booking and
conflicting submission. A frontend-ready handoff additionally requires verified request/response
types, authoritative permission checks and agreed business transitions.

This update changes documentation only. No TSX, runtime behavior, schema, shared database or
Google Sheet is modified by this design mapping.
