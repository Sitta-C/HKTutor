# HKTutor — UI design and page-to-data mapping

Updated 2026-09-11 from the tracked application, API, tests, and profile prototypes.
This document defines what each screen shows, which model supplies it, who may act, and what
remains to design. Current production code and tests are authoritative for implemented behavior;
future-looking rows are explicitly labelled proposed.

For the page-by-page API dependency, see
[`sprint1-ui-api-map.md`](./sprint1-ui-api-map.md). Frontend field requirements for Backend are in
[`sprint1-api-field-requirements.md`](./sprint1-api-field-requirements.md).

## Sources and reading scope

| Source                                                                                                                                              | Scope and use                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Trello Sprint 1 board](https://trello.com/b/5rez0fNO/hktutor-sprint-1-backlog)                                                                     | Planning IDs and proposed API decisions. Tracker state is not used as evidence that code exists.                                                                     |
| [Sprint 1 Backlog](https://docs.google.com/spreadsheets/d/17RMTjXa26ho7blv-TK5pbJFbHxVHJEBRPKCXk9x5AE0/edit?gid=1146751862#gid=1146751862)          | Product scope and dependencies. Assignee names and mutable progress snapshots stay out of this shared design reference.                                              |
| [Data Model](https://docs.google.com/spreadsheets/d/17RMTjXa26ho7blv-TK5pbJFbHxVHJEBRPKCXk9x5AE0/edit?gid=1191524122#gid=1191524122)                | Rows 2–19: all 18 entities; rows 23–36: business rules; rows 41–75: constraints/conventions; rows 79–93: state transitions.                                          |
| [Role-Based Access Control](https://docs.google.com/spreadsheets/d/17RMTjXa26ho7blv-TK5pbJFbHxVHJEBRPKCXk9x5AE0/edit?gid=1973937976#gid=1973937976) | Rows 6–27: public, participant, owner and admin access.                                                                                                              |
| Product Backlog tab in the same workbook                                                                                                            | Rows 4–86: UI acceptance criteria and Sprint 1–3 boundaries, including exact filtering, chat, classes, rescheduling, documents, reports, reviews and coupons.        |
| `apps/api/prisma/schema.prisma` and migrations                                                                                                      | Actual persisted fields and database constraints. A sheet field is not necessarily implemented.                                                                      |
| `apps/api/src/app.module.ts`, controllers, DTOs, services and contract tests                                                                        | Actual HTTP surface, identity contract and implemented safeguards. Profile and Tutor-listing controllers exist; availability, search and booking controllers do not. |
| Tracked repository Markdown                                                                                                                         | Root/API/web READMEs, `apps/web/AGENTS.md`, contract references and this document. Historical local task logs are not sources of truth.                              |
| All tracked first-party `apps/web/src/**/*.{ts,tsx}` files                                                                                          | Eleven route pages, shared components, API clients, auth context and i18n. Generated output and dependencies are excluded.                                           |
| `dashboard-navigation.ts`, `globals.css`, `ui-design/index.html` and prototype references                                                           | Navigation targets, theme and existing design conventions.                                                                                                           |

Source priority: tracked production code and tests describe current implementation; current API
controllers/DTOs describe callable contracts; planning tools describe future intent. This document
must not override implemented routes, fields, permissions, or validation. Product screens support
EN/TH; shared engineering documents stay free of personal work logs, local paths, secrets, and
assignee-specific instructions.

## 1. Existing UI and actual readiness

| Route / shared surface                 | TSX files under `apps/web/src/`                                                                                          | Current behavior                                                                                                                     | Data available now                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `/`                                    | `app/page.tsx`, `components/login.tsx`                                                                                   | Working email/password login; redirects signed-in users to dashboard                                                                 | Auth identity/session                                                    |
| `/register`                            | `app/register/page.tsx`, `components/register.tsx`, `components/privacy-consent.tsx`                                     | Student/tutor choice, password confirmation, explicit privacy consent                                                                | Registration creates User and sends email; it does not start a session   |
| `/register/verify`                     | `app/register/verify/page.tsx`, `components/verify.tsx`                                                                  | Waiting, link verification, resend, cross-tab completion/fallback                                                                    | Token verification and session creation                                  |
| `/register/verifypage`                 | `app/register/verifypage/page.tsx`                                                                                       | Legacy alias using the same Verify component                                                                                         | No separate design needed                                                |
| `/onboarding/profile`                  | `app/onboarding/profile/page.tsx`, `components/profile/profile-editor.tsx`                                               | Role-specific personal-profile onboarding after email verification                                                                   | Owner-only `StudentProfile`/`TutorProfile` API                           |
| `/dashboard`                           | `app/dashboard/page.tsx`, `components/dashboard/{dashboard-shell,student-dashboard,tutor-dashboard,admin-dashboard}.tsx` | T09 role selection and responsive shell are implemented; domain panels are placeholders                                              | Auth identity plus owner profile; counts, lists and revenue are not live |
| `/dashboard/profile`                   | `app/dashboard/profile/page.tsx`, `components/profile/profile-editor.tsx`                                                | Student/tutor can update the same fields collected during onboarding                                                                 | Owner-only profile upsert                                                |
| `/dashboard/listings`                  | `app/dashboard/listings/page.tsx`, `components/listings/tutor-listings-page.tsx`                                         | Tutor-owned listing cards, filters and publication-state actions                                                                     | Authenticated Tutor listing API                                          |
| `/dashboard/listings/new`              | `app/dashboard/listings/new/page.tsx`, `components/listings/tutor-listing-editor.tsx`                                    | Editor remains visible when T21 catalogs are unavailable; affected selectors and create actions are disabled with an explicit status | Tutor listing mutation exists; selector catalogs are unavailable         |
| `/dashboard/listings/[listingId]/edit` | `app/dashboard/listings/[listingId]/edit/page.tsx`, `components/listings/tutor-listing-editor.tsx`                       | Owned listing still loads when T21 catalogs are unavailable; existing subject/grade remain visible but locked                        | Ownership-checked listing API exists; selector catalogs are unavailable  |
| Privacy modal                          | `components/privacy-notice-modal.tsx`, `lib/privacy-notice.ts`                                                           | Closable modal opened from registration and dashboard                                                                                | Versioned notice content, no separate route                              |
| `/about-me`                            | `app/about-me/page.tsx`                                                                                                  | Static EN/TH informational page                                                                                                      | `copy.aboutMe`; not a user profile                                       |
| Shared layout/auth/i18n                | `app/layout.tsx`, `components/auth-shell.tsx`, `lib/auth-context.tsx`, `lib/i18n.tsx`                                    | Auth/session bootstrap, theme, language persistence                                                                                  | Auth refresh response; local language preference                         |

There are **11 existing route pages**, including one legacy alias and one dynamic listing route.
Student, Tutor and Admin dashboards
share one route. The Admin view is a safe placeholder, not a completed admin console.

Profile and Tutor-listing navigation use real routes. Bookings, availability, settings, support and
privacy entries still use hashes or modal actions where the corresponding domain page does not
exist.

## 2. Remaining Sprint 1 screens and proposed navigation

Routes below are **proposals**, not existing routes or agreed API URLs. A detail screen may be a
drawer instead of a new route if it preserves the same information and deep-link behavior.

| Screen                                 | Proposed route                                                                    | Current code boundary                                     | Design scope                                                           |
| -------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------- |
| Availability manager                   | `/dashboard/availability`                                                         | Static draft only; no web route or API controller         | Bangkok-time list/calendar and add/delete flow                         |
| Tutor search                           | `/tutors`                                                                         | Static draft only; no web route or search controller      | Subject, level, maximum budget, minimum rating; exact results/no match |
| Listing/tutor details + slot selection | `/tutors/[tutorId]?listingId=…`                                                   | Proposed; needs public listing and availability contracts | Connect a selected listing to a slot from the same tutor               |
| Booking review and submitted result    | `/dashboard/bookings/new?listingId=…&slotId=…`, `/dashboard/bookings/[bookingId]` | Static draft only; no web route or booking controller     | Review details, submit once, display actual returned PENDING booking   |
| Student booking list                   | `/dashboard/bookings`                                                             | Static draft only; no web route or booking controller     | Own bookings, status/time filtering and detail navigation              |

These are design surfaces rather than mandatory route count. Forms, detail drawers and
confirmation states may share screens when they preserve the same data and navigation behavior.

Current production Student navigation: Dashboard → My profile → My bookings → Settings → Support →
Privacy → Sign out. Current Tutor navigation: Dashboard → My profile → My listings → Availability →
Settings → Support → Privacy → Sign out.
The tutor booking-management actions arrive in Sprint 2. Account can remain read-only using the
existing identity contract. Settings/support have no dedicated storage or workflow contract yet.
Guest search is allowed by RBAC; use a public header without private dashboard identity.

## 3. Dependency and implementation boundaries

```text
Implemented: auth/session -> role-aware dashboard shell -> Student/Tutor profile editor
Implemented: Tutor listing API/client -> listing list and mutation contracts; create/edit UI exists
Blocked: listing create/edit selectors -> catalog APIs assigned to S1-T21/API-03 and API-04
Missing: availability API + route
Missing: public search/catalog API + route
Missing: booking quote/create/list/detail API + routes
```

Static design can proceed with clearly fictional data. API-backed implementation must inspect the
merged dependency DTOs/Swagger first. Do not infer a booking list endpoint from a create-booking
task or infer a production resource API from the private-listing authorization example.

Available authentication URLs use `/api/v1/auth`: `register`, `verify-email`,
`resend-verification`, `login`, `refresh`, `logout`, and `me`. `AuthUser` contains only
`id`, `email`, and uppercase `role`. Profile fields and account metadata need separate contracts.
Owner profile URLs are implemented under `/api/v1/profiles/me`. Tutor listing methods exist on the
tracked API under `/api/v1/tutors/me/listings`, including list, detail, create, patch, publication
status update and publish actions. The listing editor still depends on catalog reads that have no
matching production controller. A catalog failure does not hide the editor: it produces an
explicit unavailable status, locks the affected selectors, and blocks creation until the assigned
catalog service exists. Other domain sections specify proposed contracts and must remain labelled
as unavailable until matching controllers and clients exist.

---

## 4. Visual style guide (verified against the current UI, 2026-09-11)

Read from: `auth-shell.tsx`, `register.tsx`, `verify.tsx`, `privacy-consent.tsx`, `globals.css`,
`layout.tsx`, `dashboard-shell.tsx`. Profile drafts load `apps/web/src/app/globals.css` directly and
use the production `dash-*` shell classes, keeping the sidebar and header tied to the implemented
source rather than maintaining a second visual copy.

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

### Logged-in dashboard design language — implemented by `DashboardShell`

`apps/web/src/components/dashboard/dashboard-shell.tsx` and `apps/web/src/app/globals.css` are the
source of truth. Static profile prototypes use the same `dash-*` structure and load that stylesheet
directly. The production stylesheet includes Student, Tutor, and Admin accents:

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

- Sticky left sidebar (`300px`, full viewport height): the default dashboard uses the warm light
  gradient and profile pages use the production `dash-app-profile` coffee surface. The expanded
  logo links to `/dashboard`, and the top-right `<` button collapses it to a `4.75rem` icon rail.
  The rail keeps the existing HK logo visible; hovering the logo reveals a hamburger and clicking
  it expands the sidebar. Navigation icons remain operable in both states, the current route uses
  the role-tinted active card, and the preference is stored in
  `localStorage['hktutor-sidebar-collapsed']`.
- Expanded content includes the `user-chip` (gradient avatar + name + email), `side-nav` (icon +
  EN/TH label, optional count `chip` or `ln` outline pill, `danger` item last), and small
  `side-card` promo/tip. No duplicate logo or hamburger sits outside the sidebar.
- Main column (`min(1200px, …)`): greeting block (eyebrow pill, `h1` with role chip,
  subtitle) → **row 1: 4 summary cards** (5px role-gradient top bar, soft corner circle,
  icon-dot headings, `.big` stat + `.sub`) → **row 2: one wide panel** (search/filter head +
  table/list) → supporting panels per role.
- Header: profile pages show the notification trigger, language toggle and Back to dashboard CTA in
  that order. Notification popover, unread badge, close behavior and keyboard Escape handling follow
  `DashboardShell`.
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
  `role="alert"` errors, `aria-hidden` artwork). The expanded sidebar keeps a labelled close
  button; the collapsed logo/hamburger and each rail icon retain a label, focus style and route.

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
- **Motion rule:** profile prototypes inherit production `prefers-reduced-motion` behavior from
  `globals.css`. Other prototypes must preserve the same reduced-motion contract when their shell is
  synchronized.

---

## 5. Draft folder layout

```
ui-design/
├── uidesign.md          ← this file
├── pages/               ← one draft per page/route (e.g. pages/dashboard-tutor.html)
└── index.html           ← gallery linking every draft (open in browser to navigate)
```

## 6. Draft conventions

1. **Stack per draft:** a single `.html` entry file with mock-only page behavior. Profile drafts
   load `../../apps/web/src/app/globals.css` and use production `dash-*` classes for the shell so
   sidebar/header changes have one styling source. Drafts open from the gallery or a local static
   server rooted at the repository parent.
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
6. **Not a spec of record.** Sections 1–3 and 9–13 map the page/data design. Production code,
   DTOs and tests remain authoritative. Do not record personal assignments, local branch state,
   machine paths or individual progress notes here.

## 7. Page drafts index

| Draft file                     | Real route                                  | Current relationship to production                                                                |
| ------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `index.html`                   | — (gallery)                                 | Draft gallery                                                                                     |
| `pages/dashboard-student.html` | `/dashboard` (Student view)                 | Historical visual reference; production `DashboardShell` and `StudentDashboard` are authoritative |
| `pages/dashboard-tutor.html`   | `/dashboard` (Tutor view)                   | Historical visual reference; production `DashboardShell` and `TutorDashboard` are authoritative   |
| `pages/tutor-profile.html`     | `/dashboard/profile` (Tutor view)           | Profile content reference using the production profile shell classes and stylesheet               |
| `pages/student-profile.html`   | `/onboarding/profile`, `/dashboard/profile` | Profile content reference using the production profile shell classes and stylesheet               |
| `pages/listing-form.html`      | `/dashboard/listings*`                      | Older interactive reference; production listing pages/components are authoritative                |
| `pages/availability.html`      | Proposed availability manager               | Interactive draft only; no production route or controller                                         |
| `pages/search.html`            | Proposed tutor search                       | Interactive draft only; no production route or controller                                         |
| `pages/booking.html`           | Proposed booking flow                       | Interactive draft only; no production route or controller                                         |

## 8. Acceptance flow (draft → real page)

1. **Draft the page here** (layout + copy EN/TH + mock data) using the design language in §4 —
   copy the dashboard `:root` token block and reuse the component patterns; do not invent
   new tokens.
2. Review in chat; iterate until agreed.
3. Implement in `apps/web` after reading `apps/web/AGENTS.md` and the relevant Next 16 guide under
   `apps/web/node_modules/next/dist/docs/`.
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
| Privacy                 | Title, version, effective date, summary, sections, close action                                       | `PRIVACY_NOTICE`; consent field values are not the notice body                           | Presented in a closable modal; currently English-only; a future translated notice needs reviewed copy with the same version                                                                                     |
| Account / sidebar       | Own email, role, profile nickname/display name and derived initial; language toggle; sign out         | Current `AuthUser` plus owner profile; local language store                              | Student uses `StudentProfile.nickname`; tutor uses `TutorProfile.displayName`; email prefix remains only a loading/legacy fallback                                                                              |
| Future account metadata | Verification date, account status, consent date/version, joined date                                  | Current `User.emailVerifiedAt/accountStatus/consentAcceptedAt/policyVersion/createdAt`   | Read-only only after an allowlisted owner response exists; current `AuthUser` does not expose these fields                                                                                                      |

`StudentProfile` stores first name, last name, nickname, school, grade level and a private emergency
telephone number. Tutor personal names remain private while `TutorProfile.displayName` stays the
public tutor name. No avatar/photo URL, date of birth, goals, or language preference field exists.
The `/about-me` page stays informational. OAuth, password reset, email change and session management
UI are outside the current auth scope despite unused social-button exports/copy.

### 9.2 Student profile onboarding and editor

The same form supports required onboarding at `/onboarding/profile` and later edits at
`/dashboard/profile`. After email verification, a Student whose `profileComplete` is false must
finish this form before continuing to the dashboard.

| Control / block   | Fields                                                      | Source and visibility                                                      | Validation / state                                                                                                     |
| ----------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Legal identity    | `firstName`, `lastName`                                     | `StudentProfile`; owner and authorised administrators only                 | Required trimmed strings, 1–100 characters each                                                                        |
| Account label     | `nickname`                                                  | `StudentProfile`; owner UI and participant-scoped tutor booking label only | Required trimmed string, 1–60 characters; never replace it with email or legal name in tutor-facing UI                 |
| Learning context  | `school`, `gradeLevel`                                      | `StudentProfile`; owner and authorised administrators only                 | Required trimmed strings; school 1–160 and grade level 1–80 characters                                                 |
| Emergency contact | `phone`                                                     | `StudentProfile`; owner and authorised administrators only                 | Required 8–32 phone-number characters matching the API DTO; never expose through public tutor/search/booking responses |
| Account summary   | Nickname, school and grade level                            | Local preview of the same owner-only form data                             | Clearly label it as an account summary rather than a public profile preview                                            |
| Profile state     | `profileComplete`, `consentCurrent`, current policy version | `GET /api/v1/profiles/me`                                                  | Loading, missing profile, updated-consent requirement, save error, saved state and incomplete-profile redirect         |

Draft: `pages/student-profile.html` covers all six fields, exact current DTO limits, EN/TH copy,
live owner summary, validation, save/cancel feedback and the current Student dashboard shell. The
production form uses the draft's `1.35fr / minmax(290px, .75fr)` grid, persistent onboarding/edit
note, stacked School/Class summary rows, corner artwork, compact status dots and Student teal field
focus/action treatment. The legal name, school, grade level, phone and email are never presented as
tutor-visible data. The draft status strip shows only Account email and Profile status because
current privacy consent is already enforced before this screen; the wider email cell wraps long
addresses instead of truncating them.

### 9.3 Student dashboard

Preserve the existing shell and ordering: greeting → four summary cards → Your tutors panel.

| Block                   | Required visible data                                                                            | Source / derivation                                                                              | Action and state                                                                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Greeting / identity     | Own nickname, email and Student role                                                             | `StudentProfile.nickname` plus `AuthUser`                                                        | Incomplete profiles redirect to role-specific onboarding                                                                                                                                             |
| Next lesson             | Tutor name, subject, grade, Bangkok date and start/end, status                                   | Own `Booking` joined to `TutorProfile`, `TeachingListing.subject/gradeLevel`, `AvailabilitySlot` | Proposed query: earliest future CONFIRMED booking. Ongoing sessions may be shown separately. Open booking detail; no Join button in Sprint 1                                                         |
| Booking summary         | Upcoming, completed and pending counts                                                           | Owner-scoped `Booking.status` + slot time                                                        | Proposed upcoming count: future PENDING + CONFIRMED; completed count: COMPLETED; pending count: PENDING. Use the same definitions in badges/list filters                                             |
| Waiting on tutor        | Tutor, subject, requested time, submitted date, and Pending status                               | Own `Booking` where PENDING; `createdAt`                                                         | Open detail using the internal booking ID; after confirmation move out of this list; empty state only after successful query                                                                         |
| Quick actions           | Find a tutor, My bookings, Account                                                               | Routes; no new model                                                                             | Point to the proposed destinations rather than hashes                                                                                                                                                |
| Your tutors             | Tutor name/initial, subjects taught to this student, next booked lesson, relevant booking status | Derived from this student's bookings joined to profiles/listings/slots                           | Proposed inclusion: distinct tutors with PENDING/CONFIRMED/COMPLETED bookings; canceled-only tutors remain in history. Filter by name/subject; confirm this product rule before query implementation |
| Book again / view tutor | Relevant listing, current rate and availability when returned                                    | Current public listing/profile query                                                             | Revalidate published/verified eligibility. Historical booking relationship alone does not make a tutor bookable                                                                                      |

There is no saved-tutor/favorite table. “Your tutors” must be derived from bookings unless a new
feature is agreed. The current Thai empty copy implies saved tutors; change that wording when
connecting the panel. Do not use a list page's item count as an all-record total.

### 9.4 Tutor dashboard

| Block                 | Required visible data                                                              | Source / derivation                                                 | Action and Sprint                                                                                                             |
| --------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Greeting              | Public display name, own email, Tutor role, verification status                    | `TutorProfile.displayName/verificationStatus` + auth identity       | Load missing-profile state and link to profile editor                                                                         |
| Next session          | Student nickname approved by the API, subject, grade, Bangkok time and status      | Own `Booking` + `StudentProfile.nickname` + listing/catalog + slot  | Open detail; do not expose the student’s legal name, school, grade-level profile or emergency telephone number                |
| Requests              | Pending count; requests submitted this week                                        | Own PENDING bookings; `createdAt` for the weekly subset             | Query-derived counts. Week boundary is a proposal to confirm, using Asia/Bangkok                                              |
| Reschedule requests   | Pending request count and requested target time                                    | Planned `RescheduleRequest`                                         | Sprint 2; no real zero/count before the endpoint exists                                                                       |
| Earnings              | Paid completed revenue for selected period; number of completed sessions           | Planned `Booking.paymentStatus/paidAt` + current `status/netAmount` | Report is Sprint 3 (US7-1). Cannot label current totals PAID or revenue from `netAmount` alone                                |
| Profile readiness     | Checklist: basic profile, published listing, future open slot, verification status | Current profile/listing/slot fields, derived                        | Proposed checklist replaces unsupported arbitrary `0%`; no persisted `profileStrength` field or agreed score formula          |
| Booking requests list | Student nickname, subject/level, date/time, amount and PENDING badge               | Owner-scoped Booking join                                           | Confirm/Reject only in Sprint 2 US12-4; re-read state on conflict; do not expose controls merely because a badge says pending |
| My listings           | Subject/level title, THB/hour, description excerpt, publication state              | Own `TeachingListing` + Subject/GradeLevel                          | New/edit/publish through T15/T16; view all                                                                                    |
| Today                 | Start/end and derived Open/Reserved state                                          | Own slots overlapping the Bangkok day + PENDING/CONFIRMED bookings  | T18/T19; sort by start; Manage availability                                                                                   |

The existing `0`, `0฿`, `0%`, PAID label and empty panels are static placeholders. Future designs
must distinguish unavailable data from a successful zero-result response. Preserve the visual
space while using an unavailable state or hiding a later-Sprint block.

### 9.5 Tutor profile editor and documents

Suggested layout: basic profile form beside public preview; verification/read-only summary below;
documents as a separate, clearly scoped section when Sprint 2 is enabled.

| Control / block      | Fields                                                                   | Source and mutability                                                                                     | Validation / state                                                                                                 |
| -------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Private identity     | `firstName`, `lastName`, `nickname`                                      | Current `TutorProfile`; owner editable; never part of the public tutor preview                            | Required trimmed strings; first/last 1–100 characters and nickname 1–60                                            |
| Public name          | `displayName`                                                            | Current `TutorProfile`; owner editable and publicly visible                                               | Required trimmed text, 1–100 characters                                                                            |
| Introduction         | `bio`                                                                    | Current `TutorProfile`; owner editable and publicly visible                                               | Required trimmed content, 1–2000 characters                                                                        |
| Experience           | `experienceYears`                                                        | Current `TutorProfile`; owner editable and publicly visible                                               | Integer ≥ 0; zero is valid; the API has no maximum of 80                                                           |
| Public preview       | Name, bio, experience, verification badge, rating/count if returned      | Same current profile fields; local unsaved preview labelled accordingly                                   | No public email, private documents, IDs or review notes; a preview cannot self-assign Verified                     |
| Verification summary | `verificationStatus`                                                     | Current profile; server/admin-controlled                                                                  | Pending/Verified/Rejected; email verification does not satisfy tutor verification                                  |
| Rating summary       | `ratingAverage`, `reviewCount`                                           | Current cached fields; read-only                                                                          | Null/0 → New tutor; seeded values are demo data, not genuine review evidence                                       |
| Record metadata      | `createdAt`, `updatedAt`                                                 | Current profile; read-only                                                                                | Prefer compact Updated text; full internal IDs are not normal user-facing labels                                   |
| Upload documents     | File picker, filename, MIME, byte size, progress, individual error/retry | Planned `TutorDocument.originalFileName/mimeType/sizeBytes`; actual file sent to protected upload service | Sprint 2 US6-1; PDF/JPG/PNG; 0 < size ≤ 5 MB; server validates bytes/type; per-file progress is transient UI state |
| Document list        | Filename/type/size, status, uploaded/reviewed dates, review note         | Planned `TutorDocument.status/uploadedAt/reviewedAt/reviewNote`                                           | Own documents only; Pending/Verified/Rejected; show rejection feedback and permitted resubmission                  |
| View document        | Short-lived authorized viewer/download action                            | Planned server-issued signed URL from private `objectPath`                                                | URL is transient, not a public profile field; handle expiry and denied access                                      |

Draft review: `pages/tutor-profile.html` now matches the six current Tutor profile inputs, current
dashboard shell and blue Tutor form treatment while keeping private identity separate from the
public preview. Production uses the draft's `1.4fr / minmax(300px, .82fr)` grid, preview hierarchy,
corner artwork and four-column account-status strip with compact status dots. Its certificate
section remains a Sprint 2 interaction concept and is deliberately absent from the production
Sprint 1 form. Removing a locally queued file is safe draft behavior; persisted document deletion
needs an explicit API/RBAC contract (the sheet grants tutor create/read, not delete). Public profile
verification must use the aggregate profile status; it cannot be inferred from one document being
approved. The draft gives Account email the widest status column and wraps long addresses.

### 9.6 Teaching listings: list, create and edit

| Control / block              | Fields / joins                                                                         | Data ownership                                | Validation / behavior                                                                                                           |
| ---------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Subject selector             | `subjectId` → `Subject.id/code/name/active`                                            | Catalog lookup; selected ID stored on listing | Offer active options; keep historical inactive labels readable; no free-text spelling variants                                  |
| Grade selector               | `gradeLevelId` → `GradeLevel.id/code/name/sortOrder/active`                            | Catalog lookup                                | Sort by `sortOrder`; inactive existing value needs an explicit edit policy                                                      |
| Price per hour               | `pricePerHour`                                                                         | Owner input; current decimal field            | THB/hour, strictly > 0, two-decimal money handling; not a lesson total                                                          |
| Description                  | `description`                                                                          | Owner input                                   | Trimmed 20–1000 characters; counter and inline error                                                                            |
| Publication                  | `publicationStatus`, `publishedAt`                                                     | Server-controlled lifecycle                   | Draft/Published/Archived. Publish requires verified tutor; saving a draft must not imply publishing                             |
| Listing card                 | Subject + grade title, tutor name where useful, rate, excerpt, status and updated date | Listing + catalogs + profile                  | There is no listing `title`, image, duration, capacity, location or teaching-mode field; derive the title                       |
| Save / edit / status actions | Listing ID for selection; owner derived from session                                   | Current Tutor listing controller and client   | Disable while saving, keep form values on failure, and use the implemented create, patch, publish, archive, and restore actions |

One listing selects one subject and one grade. Multiple offerings require multiple listings.
Availability belongs to a tutor, not a listing. Do not add per-listing calendars without a schema
change. Archived and soft-deleted are different states; preserve historical booking references.
The production form must not substitute catalog request failures as missing listings. Keep the
selector flow unavailable until S1-T21 provides the contracted catalog endpoints; do not substitute
hardcoded IDs or infer a complete catalog from a Tutor's existing listings.

### 9.7 Availability manager and student slot picker

| Block              | Visible input / data                                                  | Model / derivation                                                                         | Rules                                                                                                              |
| ------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Date navigation    | Selected day/week, Bangkok timezone label                             | Transient date filter                                                                      | Explicit Asia/Bangkok regardless of browser timezone                                                               |
| Add range          | Local date, start time, end time                                      | Convert to UTC and send Trello fields `startAt/endAt`; response uses `startAtUtc/endAtUtc` | Future range; start < end. Preview the date as well as time if it crosses midnight; no recurring-rule model exists |
| Slot list/calendar | Start/end, duration, Open/Reserved; own linked booking when permitted | Current slot + active Booking                                                              | Derived duration; reserved when a PENDING or CONFIRMED booking exists; no stored slot status                       |
| Delete slot        | Selected `slot.id`                                                    | Owner API performs soft delete                                                             | Only unreserved slots; handle 409 if reserved in the meantime; do not cascade-remove booking history               |
| Student selection  | Future open times for the chosen tutor, selected range summary        | Eligible slots returned by API                                                             | View-only, then select `slotId` for booking; show no other students' identity or booking details                   |

Examples: 2026-09-10 18:00–19:00 Bangkok is 11:00–12:00 UTC. An adjacent 19:00–20:00
slot is valid; 18:30–19:30 conflicts. A future slot with only canceled/completed history is not
reserved, but past times are never new booking options. Display loading, no slots, save conflict,
past/inverted range, reserved-delete conflict and retryable service error states.

### 9.8 Tutor search and public detail

| Block                 | Fields                                                                                                                                                                                     | Rule / action                                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Filters               | Subject label, grade label, maximum budget, minimum rating                                                                                                                                 | Send Trello query names `subject`, `grade`, `maxPrice`, and `minimumRating`; optional filters combine with AND; omit minimum rating for Any                             |
| Result card           | API returns listing `listingId`, `tutorId`, `displayName`, `subject`, `grade`, `pricePerHour`, `ratingAverage`, description, review count, experience, and next availability | Only eligible published listings of verified tutors; one card represents one matching listing                             |
| Result grouping       | Tutor + matching listing(s)                                                                                                                                                                | Proposal: display one card per matching listing or explicitly group matching offerings; never pair the lowest price from a different offering with the selected subject |
| Rating                | Cached average and count                                                                                                                                                                   | No reviews → New tutor and 0 reviews; minimum-rating filtering must not invent a score for null; demo seed ratings are labelled as demo                                 |
| Detail overview       | Name, bio, experience, Verified badge, rating/count and public offerings                                                                                                                   | Same profile/listing joins; public allowlist excludes email, consent, account internals and document files                                                              |
| Offering and schedule | Selected listing description/rate/subject/grade; next eligible slot when allowed                                                                                                           | Change listing only within the selected tutor; slot query must belong to the same tutor; full slot access for guests needs RBAC clarification (§12)                     |
| Search states         | Loading, exact results/count, no exact matches, invalid filter, service error, pagination if supported                                                                                     | Retain filters and offer Clear filters; do not substitute unrelated tutors for an empty exact result                                                                    |
| Calls to action       | View details; sign in/register to book for guest; choose slot/book for Student                                                                                                             | Tutor/Admin can browse but cannot create bookings; no role-switch-to-student control                                                                                    |

Do not add name free-text search, a lower-price bound or sorting parameters as an existing T21
contract. They need confirmation. Sprint 2 US1-2 adds deterministic ranking by lowest price,
highest rating or earliest availability plus honest reason tags. Sprint 3 US10 adds comparison.

### 9.9 Booking review, submitted result and booking list

Suggested flow: search → public detail/selected offering → available slot → review booking →
submit → persisted booking detail → My bookings. “Request submitted” is distinct from “Tutor
confirmed”; Sprint 1 booking creation returns PENDING.

| Screen / block     | Required fields / joins                                                                                                                  | Behavior                                                                                                                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before submit      | Tutor public name, subject/grade, selected listing description, local date/start/end, derived duration, quoted THB subtotal/discount/net | Read current listing/slot; show a quote only from an agreed server contract. Do not assume every slot is one hour or finalize prorating/rounding rules locally                                 |
| Create request     | Selected `listingId`, `slotId` and contract-required inputs                                                                              | Server derives student/owner identity, verifies same tutor and reserves atomically; never trust client-entered price/owner IDs                                                                 |
| Submitted result   | `Booking.status/createdAt`, tutor, listing, time, `subtotalAmount/discountAmount/netAmount/currency`; internal `id` for navigation only  | Render returned PENDING record; do not display a fabricated short reference                                                                                                                    |
| Student list       | Tutor, subject/grade, Bangkok time, status, net amount; internal `id` for navigation                                                     | Owner-scoped `studentUserId`; filter status/date and paginate when supported; empty vs error vs unavailable states                                                                             |
| Detail             | All list data plus full description as permitted, amount breakdown, last update                                                          | Join through `listingId`, `slotId`, `tutorId`; amount snapshots are authoritative, not today's listing rate                                                                                    |
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
| Identity fallback                     | Initial avatar is derived decoration. Public tutor name uses profile; tutor-facing student identity uses only the API-allowed `StudentProfile.nickname`. Do not expose or invent other personal profile data.                                                            |
| Responsive layout                     | Preserve the 300px expanded sidebar and 4.75rem collapsed rail. Stack forms/cards on narrow screens; present booking rows as readable cards or bounded tables; retain core time/status/action visibility.                                                                |
| Keyboard and language                 | EN/TH labels, placeholders, errors and empty states; labelled icon buttons, focus visibility, aria-live status and operable collapsed-rail navigation. New designs must remain usable with zoom and reduced motion.                                                      |
| Reusable building blocks              | Existing AuthShell/DashboardShell; proposed StatusBadge, Tutor/ListingCard, BookingSummary, BangkokTimeRange, MoneyBreakdown, CatalogSelect, Empty/ErrorState, DocumentRow and confirmation dialog. These names describe proposed components, not files already present. |

## 12. Contract gaps and source conflicts to resolve

These items do not prevent static design. They require matching production contracts before the
corresponding controls or query logic can ship.

Confirmed Sprint 1 decision: Booking has no public reference in the UI. Its UUID is used internally
for API calls and routes only. Tutor-facing booking and lesson rows use the API-allowed student
nickname and do not expose the student's legal name or other private profile fields.

| Finding                                 | Evidence / effect                                                                                                                                                             | Design decision for now                                                                                                                           |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current domain coverage                 | Profile and Tutor-listing controllers, clients and pages exist; availability, public search/catalog and booking controllers are absent                                        | Use implemented profile/listing APIs; keep other domain UI clearly proposed until code exists                                                     |
| Public search contract                  | Planning material lists the card fields needed by search, but no production search controller or client exists                                                                | Do not connect the search draft or present its mock results as live                                                                               |
| Booking read/write APIs                 | Planning material describes quote/create/list/detail shapes, but no production booking controller or client exists                                                            | Keep booking history, detail and dashboard booking data unavailable                                                                               |
| Catalog APIs                            | The listing editor calls legacy `/catalogs/subjects` and `/catalogs/grade-levels`, but no matching controller exists; T21 assigns `/subjects` and `/grade-levels`             | Keep selectors blocked until S1-T21/API-03 and API-04 merge; do not hardcode options or implement T21 as part of an unrelated UI fix              |
| Availability field names differ         | T18/API-02 accepts `startAt/endAt` and returns `startAtUtc/endAtUtc`; the earlier handoff used UTC suffixes in both directions                                                | Convert Bangkok inputs to UTC, send the Trello request names, and render the returned UTC fields                                                  |
| Student booking label and privacy scope | `StudentProfile` has first name, last name, nickname, school, grade level and phone; T24/API-05 now defines the participant projection                                        | Tutor-facing booking rows use only `student.nickname`; never expose phone, school, grade profile, legal name, email or account ID                 |
| Emergency telephone visibility          | `StudentProfile.phone` is collected for urgent class, safety or service incidents                                                                                             | Owner and authorised administrators only; never include it in public search or ordinary tutor booking responses                                   |
| Profile field-error mapping             | API validation returns `message: string \| string[]` without a stable field key; production has exact inline client validation and property-name matching for server messages | Request stable field/code metadata before relying on server-error mapping; always retain the form-level API message                               |
| Tutor preview subject label             | `TutorProfile` has no subject field; the draft currently shows “English tutor”                                                                                                | Derive it from a selected/published listing and Subject join, or use generic Tutor copy until listing data is available                           |
| Document scope and removal              | TutorDocument is Sprint 2; tutor RBAC grants upload/read, not persisted deletion                                                                                              | Split basic profile and document designs; queue removal only until a delete contract exists                                                       |
| Verification aggregation                | Sheet mentions document review affecting profile, but no rule for multiple accepted/rejected documents                                                                        | Display aggregate `TutorProfile.verificationStatus`; do not compute it client-side or treat email verification as qualification approval          |
| Guest availability / individual reviews | Trello T18/API-04 explicitly permits public future free slots; no individual-review endpoint is assigned                                                                      | Allow guest slot viewing without booking; keep review detail out until an API contract exists                                                     |
| Slot mutations                          | RBAC lists update, but S1-T18 is create/list/delete                                                                                                                           | Do not promise drag-to-reschedule, recurring schedules or direct slot editing in Sprint 1                                                         |
| Lesson pricing and history              | Sheet requires server amount snapshot; slots can have variable duration; listing text/time snapshots are not in schema                                                        | Confirm duration billing/rounding and whether booked listing/slot edits are prevented or snapshotted; use persisted amounts for existing bookings |
| Confirm wording                         | Product Backlog US12-4 calls confirm/reject final, while Data Model rows 26/80–84 allow confirmed → completed/canceled                                                        | Use explicit Data Model lifecycle; only canceled/completed are terminal                                                                           |
| Reschedule target wording               | Product Backlog row 39 says rejected target stays unavailable; Data Model rows 28/85–87 say target is never held and rejection changes no slot                                | Follow no-hold model: original booking stays; target availability remains independently derived; flag wording for tracker correction              |
| Attendance permission                   | RBAC row 16 is broad; US4-2 specifically permits owning tutor marking                                                                                                         | Student reads attendance only in proposed design; no student marking control                                                                      |
| Reminder wording                        | US3-2 has broad paid exclusion but explicit example/model preserves paid class reminders                                                                                      | Paid skips payment reminder only; canceled/ineligible states follow scheduler contract                                                            |
| Public/privacy language and copy        | Consent controls are EN/TH; the full modal notice remains English; some auth errors and nav aria labels are literal English                                                   | Add reviewed Thai notice copy before claiming that the legal notice is fully localised                                                            |
| Unsupported dashboard metrics           | PAID/earnings/reschedule/profile-strength placeholders lack complete data contracts                                                                                           | Gate later features; agree report period and checklist/count definitions before populating cards                                                  |
| Settings, support and admin console     | Hash links/safe admin placeholder do not establish backend workflows                                                                                                          | Keep read-only account/real privacy links; future admin screens follow explicit admin endpoints; no invented support-ticket model                 |

## 13. Design order and handoff checklist

1. Maintain `pages/student-profile.html` and `pages/tutor-profile.html` against production
   `DashboardShell`, `globals.css` and `profile-editor.tsx`. The shell includes the dashboard-linked
   expanded logo, `<` collapse control, hover-to-hamburger compact logo, SVG navigation,
   active-route state, notification menu, language control and responsive rail.
2. Treat `pages/listing-form.html` as a historical design reference. Maintain its presentation and
   validation against the production list/create/edit components. Keep selector integration blocked
   until the assigned T21 catalog contracts are implemented.
3. Draft `pages/availability.html`: Bangkok-time empty/populated list/calendar, add range,
   overlap conflict and reserved-delete refusal; include the Student picker variant.
4. Draft `pages/search.html`: four required filters, results, no matches, public detail/selected
   offering and entry into slot selection. Include guest and Student action differences.
5. Draft `pages/booking.html`: review, submitting, PENDING submitted result, 409 conflict, own
   list and detail. Reuse the summary in both dashboards.
6. Connect dashboard navigation only when matching routes, clients and server contracts exist.
7. Design Sprint 2: tutor actions/classes/mock payment, cancellation/reschedule, documents/admin
   verification, chat and notifications. Then Sprint 3: reports, detailed reviews, coupons,
   comparison, realtime chat and reminders.

For each draft, record: role, entry/exit route, primary action, exact displayed/input fields,
source entity or derived rule, dependency contract, EN/TH copy, empty/loading/error/conflict/success
states, mobile layout, and fields deliberately deferred. Use fictional data covering unverified
tutor, no reviews, no listings, no slots, inactive catalog, reserved slot, pending booking and
conflicting submission. A frontend-ready handoff additionally requires verified request/response
types, authoritative permission checks and agreed business transitions.

This revision makes the production profile shell authoritative for both profile prototypes. The
drafts use the production `dash-*` element structure and load the production stylesheet for the
sidebar/header, while keeping fictional page data and mock-only form behavior. It does not change
the profile API or database schema.
