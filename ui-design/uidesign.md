# HKTutor — UI Design (page inventory + draft workspace)

Two roles in one file:

- **Sections 1–3** = the authoritative **page inventory** for Sprint 1 (what exists, what's
  required, dependency chain).
- **Sections 4–8** = conventions and status for this folder (`ui-design/`), which holds
  **static HTML UI prototypes** drafted before real implementation in `apps/web`.

Sources: sprint sheet (gid=1146751862) + repo tree at `main` commit `9984289`, verified
2026-09-08. That commit replaced the earlier Clerk work with application-owned email/password,
JWT, refresh-session, and Resend verification flows. Current pages were verified from
`apps/web/src/app/**/page.tsx`.

This folder is versioned in the repository as a design reference. It does not ship to production;
real pages are implemented in `apps/web`.

## Snapshot

|                         | Count                                                  |
| ----------------------- | ------------------------------------------------------ |
| Pages now               | **7 routes** (including one legacy verification alias) |
| Required after Sprint 1 | **~13**                                                |
| Missing                 | **5–6 pages** (T09, T16 ×2, T19, T22, T25)             |

---

## 1. Existing pages (7 routes)

| #   | Route                  | File(s)                                             | Task | Status          | Purpose                                                                                                                             |
| --- | ---------------------- | --------------------------------------------------- | ---- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `/`                    | `app/page.tsx` + `components/login.tsx`             | T06  | ✅ Done         | Email/password login. Successful login stores the access token in memory and routes to `/dashboard`.                                |
| 2   | `/register`            | `app/register/page.tsx` + `components/register.tsx` | T06  | ✅ Done         | Registration form for student/tutor role and privacy consent. The API creates the local user and sends a Resend verification link.  |
| 3   | `/register/verify`     | `page.tsx` + `components/verify.tsx`                | T06  | ✅ Done         | Consumes the one-time `token` query parameter, starts the session, and supports resending verification by email.                    |
| 4   | `/register/verifypage` | `page.tsx` + `components/verify.tsx`                | T06  | ⚠️ Legacy alias | Renders the same verification component; new email links use `/register/verify`.                                                    |
| 5   | `/dashboard`           | `app/dashboard/page.tsx`                            | T09  | ⚠️ **Stub**     | Protected demo showing the current local user from `GET /api/v1/auth/me`. **Replace with the role-aware student/tutor dashboards.** |
| 6   | `/privacy`             | `app/privacy/page.tsx`                              | T11  | ✅ Done         | Server component rendering the current local-auth privacy notice and policy version.                                                |
| 7   | `/about-me`            | `app/about-me/page.tsx`                             | —    | ⚠️ Static       | Informational page; not part of the core transaction flow.                                                                          |

Shared plumbing: `lib/auth-client.ts` (in-memory access token, credentialed refresh),
`lib/auth-context.tsx`, `lib/i18n.tsx` (hand-rolled EN/TH), `lib/privacy-notice.ts`,
`components/auth-shell.tsx`, and `proxy.ts` for coarse cookie-based route redirects. API
authorization remains authoritative.

---

## 2. Pages required after Sprint 1 (from the sheet's UI tasks)

| #   | Page                                               | Task       | Owner             | Sheet status | Depends on                  | Details                                                                                                                                                                                                 |
| --- | -------------------------------------------------- | ---------- | ----------------- | ------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8   | **Role-aware dashboards** (student vs tutor views) | **S1-T09** | **Tonnam/Korpai** | ⬜ To do     | Local auth foundation ✅    | Read the role from `GET /api/v1/auth/me` through `AuthContext` and render the matching navigation/layout. Replaces the `/dashboard` stub. Drafts below are the agreed design.                           |
| 9   | **Tutor profile form**                             | S1-T16     | First/P           | ⬜ To do     | Profile API                 | Create/edit `displayName`, `bio`, `experienceYears`, plus multiple tutor documents/certificates.                                                                                                        |
| 10  | **Teaching listing form + cards**                  | S1-T16     | First/P           | ⬜ To do     | Listing API                 | Create listings (subject, grade level, price, description), manage cards, and publish/unpublish.                                                                                                        |
| 11  | **Availability manager (Bangkok time)**            | **S1-T19** | **Korpai/Tonnam** | ⬜ To do     | **T18 (Jojo, in progress)** | Create/delete `AvailabilitySlot` ranges; display times in **Bangkok time (UTC+7)** while the DB stores UTC (`timestamptz`). Blocked until T18 API merges.                                               |
| 12  | **Tutor search + filter results**                  | S1-T22     | Model             | ⬜ To do     | T21 (→ T15, T20)            | Filter controls (subject / grade level / price range) over the published-verified-tutor endpoint (T21), result cards, and a no-match empty state. Uses the composite search index on `TeachingListing`. |
| 13  | **Booking confirmation + student booking list**    | S1-T25     | Model             | ⬜ To do     | T24 (→ T18, T23)            | Confirmation screen after the transactional create-booking POST (T24), plus a student-facing list of their bookings with `BookingStatus` (PENDING/CONFIRMED/COMPLETED/CANCELED).                        |

(E2E glue task S1-T26 integrates auth → listing → availability → search → booking across these pages; S1-T27 adds regression tests. No new page of their own.)

---

## 3. Dependency chain (UI-relevant)

The local JWT authentication foundation is merged. UI implementation can use
`AuthContext` + `GET /api/v1/auth/me` now; domain pages still depend on their corresponding APIs:

```text
local auth → role-aware dashboards
profile/listing API → tutor profile + listing UI → search API → tutor search UI
availability API → availability UI
availability + booking API → booking UI
all flows → end-to-end integration and regression testing
```

**Gaps / risks:**

1. `/dashboard` is still the demo stub in `apps/web` — the replacement design is agreed
   (v3 dashboard drafts, §7); implementation belongs to T09.
2. Re-read the current task row before coding; the sheet may still use wording from the retired Clerk architecture. Treat the repository's local-auth contract as current.
3. T16/T22/T25 UI work is entirely dependent on teammates' API tasks (T15/T21/T24) — none of those are merged yet.
4. Web work rule: read `apps/web/node_modules/next/dist/docs/` first (Next 16 has breaking changes vs training data).

---

## 4. Visual style guide (extracted from existing pages, 2026-09-08)

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
**Every new logged-in draft MUST define these same tokens** — copy the `:root` block from either
draft verbatim (only the role accent block differs):

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
  with crossfade logo↔burger — never a layout morph): logo, `user-chip` (gradient avatar +
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
- i18n: ALL copy comes from `copy.<section>.<key>` (`lib/i18n.tsx`, EN/TH via `useLanguage()`,
  persisted in `localStorage['hktutor-language']`). Drafts must show both languages — same
  section/key names as the real copy object.

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
- **Secondary/social buttons**: `h-12 rounded-xl border border-[#e2dfd8] bg-white`, 3-col grid
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
  error banners (no toasts — layout has a "TODO: Toasters" note); password visibility toggles;
  role picker (student/tutor radio cards) + privacy consent checkbox with version number
  interpolated via `.replace('{version}', ...)`.

### Anti-patterns to avoid in drafts

- No default Tailwind gray/blue palette — the design language is warm cream + amber, with
  role accents (teal student / blue tutor) and dark-gradient action buttons.
- No dark mode handling anywhere yet.
- Logged-in look is now ESTABLISHED by the v3 dashboard drafts (§4 "Logged-in design
  language") — new pages must reuse those tokens, not invent new ones.
- No animation library — only Tailwind `transition-*` + small hover transforms.

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

1. **Stack per draft:** a single self-contained `.html` file (inline `<style>` + `<script type="module">`
   TS-compiled-or-plain JS is fine for mocks). No build step, no framework — drafts must open
   directly in a browser via `file://` or the gallery `index.html`.
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
6. **Not a spec of record.** Sections 1–3 above are the page inventory of record; the draft
   index (§7) is exploration tracking. When a draft is accepted, mark it in §7 and implement
   in `apps/web` on the owning task's branch.

## 7. Page drafts index

| Draft file                     | Real route                                  | Owning task | Status                                                                                                                                                                     |
| ------------------------------ | ------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.html`                   | — (gallery)                                 | —           | ✅ scaffold                                                                                                                                                                |
| `pages/dashboard-student.html` | `/dashboard` (student view)                 | S1-T09      | ✅ **agreed (v3 polished)** — shared sidebar shell + 4 summary cards → your-tutors panel w/ search & table; teal accents; this is the design of record, ready to implement |
| `pages/dashboard-tutor.html`   | `/dashboard` (tutor view)                   | S1-T09      | ✅ **agreed (v3 polished)** — same shell (blue accents): 4 summary cards, booking-request actions, listings + today timeline; design of record, ready to implement         |
| `pages/tutor-profile.html`     | profile form                                | S1-T16      | 🟡 **draft v4 ready for review** — profile fields + multi-file TutorDocument upload (PDF/JPG/PNG, 5 MB each) and review statuses                                           |
| `pages/listing-form.html`      | listing form + cards                        | S1-T16      | ⬜ not started                                                                                                                                                             |
| `pages/availability.html`      | availability manager (Bangkok time UTC+7)   | S1-T19      | ⬜ not started                                                                                                                                                             |
| `pages/search.html`            | tutor search + filters + no-match state     | S1-T22      | ⬜ not started                                                                                                                                                             |
| `pages/booking.html`           | booking confirmation + student booking list | S1-T25      | ⬜ not started                                                                                                                                                             |

## 8. Acceptance flow (draft → real page)

1. **Draft the page here** (layout + copy EN/TH + mock data) using the design language in §4 —
   copy the dashboard `:root` token block and reuse the component patterns; do not invent
   new tokens.
2. Review in chat; iterate until agreed.
3. Hand to the owning task's TDD branch in `apps/web` (read `apps/web/node_modules/next/dist/docs/`
   first — Next 16 breaking changes).
4. Mark the draft row in §7 ✅ implemented (keep the draft; don't delete).
