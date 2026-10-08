# Implemented frontend behavior

Updated 2026-10-07. This describes the current implementation, including interaction and layout
details moved from the root README. Follow the source for exact behavior and update this reference
when behavior changes. See [frontend direction](frontend-direction.md) for design patterns and workflow.

The implemented web flow is login (`/`), registration (`/register`), email verification
(`/register/verify`, with `/register/verifypage` redirected as a legacy alias), role-specific profile
onboarding (`/onboarding/profile`), a protected dashboard (`/dashboard`), profile editing
(`/dashboard/profile`), tutor availability management (`/dashboard/availability`), and the
informational `/about-me` page. The availability screen creates and deletes future Bangkok-time
ranges while exchanging UTC timestamps with the API, protecting reserved slots, and presenting a
Gregorian calendar in English or a Buddhist calendar in Thai. Separate start/end dates support
overnight and multi-day availability. Time fields expand into three-row hour/minute wheels with vertical-only
touch, mouse, trackpad, scrollbar, and keyboard operation; their gentle opening transition respects
reduced-motion preferences. Clicking the time field again or outside the picker closes it and
removes its space from the layout. The date/time groups use explicit gaps. The availability
page shows time ranges without duration totals, a timezone preview box, or a reset action.
The weekly summary uses a compact ruled-paper ledger for open and reserved slot counts, with a
single timezone tag in its footer. Counts remain unavailable while loading or after a load error;
an empty week displays zero. The ledger stacks its metrics on mobile and supports both languages.
Weekly slots use ruled notebook rows with punched binding margins, green open statuses, and one
booking status instead of a redundant disabled action. Ended ranges receive a muted overlay and an
explicit label, updated while the page is open; ended cards have no interactive actions and cannot
be deleted, including if a range expires while its confirmation is open. Statuses and compact delete
buttons sit at the top right of each card. Delete buttons open a keyboard-accessible confirmation
dialog styled as a notebook slip, with separate start/end dates and prominent times; canceling does
not send a delete request, and reserved slots remain protected.
Cross-day slots render as one continuous notebook card spanning the occupied Bangkok date rows and
covering their separators, with the start at the top, the end at the bottom, and one status/action.
Localized endpoint dates and the shared day gutter remain visible on mobile. Midnight endings display
as 24:00 and do not create an empty row on the next date. Weekly
views query only overlapping ranges through the private availability API's optional `rangeMode=overlap`
with both `from` and `to`, including incoming portions from earlier weeks without loading all history;
summaries count each underlying slot once, and confirmed deletion removes the whole slot.
The bilingual privacy notice opens
as a closable modal from registration and the dashboard instead of using a separate route.

The tutor profile's read-only account summary places labels above plain paper fields, matching
the profile form's typography, spacing, field height, and responsive columns. Tutor verification
uses a standalone status badge; the score, five stars, review count, and review action share one
compact row. Stars fill proportionally from the existing profile rating, and ratings, review counts,
and verification states update from the existing profile API responses. Tutors without
reviews see an explicit new-tutor state.
The bilingual “Read all reviews” control currently explains that individual reviews are unavailable;
it does not submit the profile form or call an unsupported reviews endpoint.

The student dashboard at `/dashboard` uses **Desk Spread**: two warm-paper sheets connected by closely
spaced flat wire loops on desktop, stacked in reading order with a horizontal wire connector on
narrow screens. The decorative pattern repeats every 24px and follows the sheet length.
The left sheet shows the next booking's month/day/year calendar tile beside start/end time, tutor,
and subject/grade on one compact mint surface. Dates use Bangkok time, Thai Buddhist years, and English
Gregorian years, with an accessible full-date label and a full date range for cross-day bookings.
The shared business-status badge and a short memo explicitly distinguish a pending request's proposed
time from a confirmed appointment. The existing selection stays unchanged: earliest start strictly
after dashboard mount among PENDING and CONFIRMED bookings. A compact strip beneath it shows upcoming,
all pending, and completed counts from loaded records, explicitly scoped to at most 100 bookings;
pending and upcoming can overlap. It does not provide learning analytics or lifetime statistics.
The overview has no My bookings action. One deep-mint **Find a tutor** paper ticket sits to the right
of the dashboard greeting as the page's primary booking entry point. Below 640px, it stacks beneath
the greeting, aligned left. Its upright bilingual label and dashed arrow stub lead to `/tutors`,
with a 48px target, visible keyboard focus and reduced motion. The action remains in the same
location during loading/errors/empty results, independent of the tutor index. The dashboard's
global header has no find-tutor action; header booking actions remain removed.

The right sheet lists tutors derived from that same booking response. The existing Map preserves
first tutor insertion order and retains the last encountered booking for each tutor; each row still
opens that booking's encoded detail URL. Four tutors appear per page through the shared
`NotebookPagination`'s student-only opt-in paper-turn presentation, with a live range, icon-only
previous/next buttons, localized accessible names, keyboard focus, and disabled boundaries. The small
visible controls retain 44px touch targets; record-range and page-count numbers are visually hidden
and remain accessible. The sheet tab reads “Your tutors” / “ติวเตอร์ของคุณ”. The unique tutor
count appears on a passive mint bookmark ribbon at the sheet's top-right edge, without changing
the existing count or adding an action.
It is entirely frontend pagination: changing tutor pages does not fetch more records or change the
left sheet. Pagination is hidden for zero to four tutors and resets to page one after the existing
booking load succeeds. The dashboard keeps the original `getMyBookings({ pageSize: 100 })` load and
language-dependent effect for dashboard content. The sidebar uses the global unfiltered total below.
Loading retains the shared shell and student Mint loading note, and hides summary counts/empty states. Zero appears only after a successful response. The disabled search,
quick-action block, repeated pending panel, and duplicate find-tutor CTAs are removed; a single
find-tutor CTA beside the greeting and existing shell navigation remain. Styles are isolated to Student Dashboard;
shared shell and tutor layouts remain unchanged, and the pagination's standard text-button mode
remains the default for other consumers. Thai/English copy and reduced-motion
preferences are preserved.

The public/student search page at `/tutors` uses **Course Index**. A filter memo sits left of one
continuous ruled result sheet from 768px. Below 768px, the filter memo appears above results with a
native Show/Hide button and begins collapsed. Hidden fields stay mounted, preserving draft values;
changes alone do not search. Apply retains the original validation, closes valid mobile filters and
returns focus to the visible toggle. Invalid Apply expands the filters, focuses the first invalid
control, and keeps the result count unavailable. Clear resets all four fields and searches page one.
Subject, grade and minimum rating use the existing shared `NotebookSelect`; maximum price retains
its existing number input, step, hint and validation. Catalog loading/errors keep the two catalog
selects disabled, independently of result loading/errors.

Each search row is keyed by listing ID: the same tutor can have multiple separate courses, including
across pages. Tutor identity, a plain mint verification tag without a checkmark, rating/reviews and
experience accompany a blue grade tab, subject, upright hourly price on slightly tilted yellow paper,
two-line description, Bangkok next availability and the view-times action. Null ratings show New tutor;
missing future availability remains explicit. Narrow result sheets stack the same anatomy through a
container query. No per-row tape or hover lift is used. The original encoded tutor/listing detail link
is preserved. Pagination uses the response's page, totalPages and total with pageSize 10, fetching
only the selected server page with the last applied query. Abort controllers and request IDs still
protect against cancelled/stale responses; no API client, request contract or authentication changes
were introduced. Loading retains the shell and inline result skeleton; result counts are unavailable
until success, including validation/search errors, with zero only after successful empty results.

Search actions use **Paper Tickets**. Apply filters and View times are content-sized deep-mint
tickets with a decorative right icon stub, dashed seam, small notches and a 2px bottom paper edge.
Clear and empty-result Clear all filters are quieter underlined mint actions with a decorative eraser.
Apply and Clear stay on one horizontal row in both languages, including at 320px; both have 44px
minimum targets. The mobile Show/Hide filters ticket uses pale mint and a dashed border. Result
sheets up to 350px place the view-times ticket below availability so its label remains legible.
Native disabled Apply, enabled Clear during loading, keyboard focus and all original handlers remain
unchanged. Styling is local to `tutor-search-page.module.css`; guest sign-in remains in its existing
header position. Browser checks cover action alignment, target sizes, unclipped labels and focus
alongside the existing request, validation, pagination and loading/error/empty flows.

Search pagination uses **Ticket Pair**: Previous/Next are adjacent paper tickets with inset dashed
edges, a perforated center seam and top/bottom notches. The next ticket is pale mint. Wider result
sheets show the page count left and tickets right; sheets up to 450px put the count above a full-width
pair. Both native buttons have 48px minimum height, localized text, decorative arrow icons, visible
keyboard focus and explicit disabled boundaries. Reduced motion removes transitions. Pagination
still appears only after successful results with more than one server page. These styles are local
to search in `tutor-search-pagination.module.css`, independent of the result-sheet stylesheet,
and do not change shared `NotebookPagination` consumers. Browser checks assert the actual ticket
layout and borders, alongside the keyboard and pagination flow.

The `/tutors` header shows Sign in for guests and no booking action for authenticated users, with
no link back to search. My bookings is omitted from all student/public headers, including the booking
list, request and detail pages. The sidebar booking link remains available. Its booking badge uses the global student total described below. These search styles do not
alter shared primitives or tutor UI.

Public tutor detail at `/tutors/[tutorId]?listingId=...` uses **Appointment Pad**, selected as option 3
on 2026-10-07. One profile paper leads with tutor name, initial avatar and plain verification, actual
rating/review aggregate, a yellow experience note and ruled biography. Null rating shows New tutor
alongside the actual review count. Individual reviews remain unavailable; no endpoint or action is
added. The profile composition follows the tutor's selected **Profile Page** preview.

From 768px, a continuous course directory sits left of a mint-bound appointment pad with subtle
stacked paper edges. Below 768px, profile, courses and times stack in reading order. Each course keeps
the **Note Window**/**Course Index** anatomy: blue grade tab, subject, upright hourly rate on slightly
tilted yellow paper, and description. Narrow directory columns stack the price beneath the subject.
Selection has explicit text and a native button's pressed state, with the currently selected
subject/grade/rate repeated in a polite live region above the appointment rows.

The course directory displays three loaded listings per page using **Page Tabs / Scrolling Ruler**.
The effective requested/fallback listing determines the initial page. A single-line page number and
course range sit beneath ruler ticks and a centered pointer, with 32px buttons for fine pointers and
44px touch buttons. Native scroll snap, mouse dragging, touch/trackpad scrolling and clicking select
the page after scrolling settles; keyboard arrows, Home and End stay within the finite page range.
There is no visible range/page-count footer; a bilingual screen-reader live status announces the
current page and range. The ruler is omitted for zero to three courses. Browsing pages leaves the
selected listing, date filter and booking action unchanged, even when the selected course is off
page. An off-page note returns to its page and restores focus to the selected ticket. Choosing a
different course updates the pad normally. Page state follows the current tutor and effective
listing, and paging does not change the URL or fetch more records. This component and its mint
styles are local to detail; the tutor's month/week rulers remain unchanged.

Choice buttons use **Paper Tickets**, selected on 2026-10-07. Course and time tickets fit their labels,
with compact padding and narrow stubs. Course tickets have an empty circle or selected check in a
perforated stub and one explicit selection label.
Day tickets connect along dashed seams, with a mint pressed state and underline; their compact
day/month text retains the complete localized date in its accessible name. Time actions are mint
tickets with a separate arrow stub, seam notches and soft paper-edge shadows. Labels stay upright;
native controls retain at least 44px targets, visible keyboard focus and explicit muted disabled
states. These styles are scoped to detail and preserve the existing selection/navigation behavior.

Loaded slots are grouped by their Bangkok start date, preserving API day/slot order. Each date has
one shared gutter beside ruled time/action rows. Ranges occupying multiple dates follow tutor
availability's Start/End (เริ่ม/จบ) labels, each with a time and full localized date, connected by a
thin vertical line. Exact midnight ends display as 24:00 on the last occupied Bangkok date, including
multi-day/year-boundary ranges. A range occupying only one date remains a concise time pair, such as
23:00–24:00. Semantic time values and accessible ranges retain the actual UTC endpoints and next-day
00:00. Every range remains one underlying slot/action; no empty midnight day or continuation action
is added. Thai uses Buddhist years and English Gregorian years. Native day-index buttons filter the
already loaded dates only;
All dates restores the full loaded set. Changing course or date does not fetch availability again.
The ticket action sits beneath the time information, retaining visible focus and reduced motion.

The original public detail and availability requests still load the same 30-day window, with the same
stale-response guard. Requested listing IDs, effective/fallback selection, encoded listing/slot
booking URLs, guest login/onboarding return paths and disabled non-STUDENT actions are preserved.
`conflict=1` retains its recovery notice. Loading retains the existing shell and inline skeleton;
error/404 retains the back link; empty listings and slots are explicit after success. The detail
header has no Find a tutor or My bookings action. The sidebar uses the global student booking total described below. CSS, view models and bilingual copy are local to this feature; tutor editors, shared
primitives and API contracts are unchanged.

The student request page at `/dashboard/bookings/new?listingId=...&slotId=...` uses
**Appointment Docket**, selected on 2026-10-07. One paper combines a mint calendar/time rail,
tutor initials/name and plain localized verification, blue grade tab, subject, upright hourly
amount on subtly tilted yellow paper, full ruled description and subtotal/discount rows. A dashed
footer contains the waiting explanation, prominent total and original submit/change-time actions.
Container queries stack the date rail first and full-width actions last below 600px of paper width.
The existing notebook primitives, role colors and shell are retained; styling is scoped to bookings.
Send request and View booking details use deep-mint Paper Tickets, with a right icon stub,
perforated seam, small notches and 2px paper edges. They retain native button semantics, 44px minimum
targets, visible focus, reduced motion and disabled sending styling, and fill the width on mobile.
Secondary recovery actions remain text links. The styles stay local to the request page.

Time presentation follows Appointment Pad: both date/time endpoints for lessons occupying multiple
Bangkok dates, 24:00 for exact midnight on the last occupied date, with actual endpoint dates and
00:00 in the accessible range. Date tiles are decorative duplicates of the accessible range.
Duration still uses the existing helper; no monetary value is calculated in the browser.

Quote loading retains the shell and an inline skeleton within the paper. Missing selection and
quote errors retain their existing find-tutor/sign-in recovery. Submit errors remain by the send
action; 409 still offers the encoded tutor/listing link with `conflict=1`. The send button retains its
pending label and disabled behavior. The success heading reads Lesson request sent / ส่งคำขอเรียนแล้ว;
its status region uses the exact returned status and a warm **Awaiting tutor confirmation /
รอติวเตอร์ยืนยัน** label for PENDING. Other statuses keep their own localized label and a neutral
follow-up explanation. It never claims payment or treats successful submission as confirmation.
The same summary remains visible, with breakdown and total from the created response. Detail,
booking-list and find-tutor recovery links and the created timestamp remain available.

`booking-docket.tsx` contains presentation-only summary, total and status components for subsequent
booking-list/detail reuse. It accepts existing response data without fetching. Absent quote
verification shows unavailable; no tutor photo, rating or experience request is added. The original
quote effect, selectionKey guards, createBookingOnce, duplicate-submit gate, API clients and POST
listingId/slotId payload remain unchanged, including existing authentication retry/session-expiry
behavior. The request and list/detail sidebar badges use the global student booking total described below. Existing shared booking
helpers and the request's default docket presentation are preserved.

The student booking list and detail use **Margin Index**, selected on 2026-10-07. List filters are
six native pressed-state buttons in a desktop left index, with a two-column grid above the ledger
below 640px. They preserve ALL/PENDING/CONFIRMED/COMPLETED/CANCELED/EXPIRED and the original server
status query, page size 10 and page-one reset. Rows keep the exact API order; there is no frontend
sorting, grouping or cross-page filtering. Each continuous ruled row has a binding margin,
Bangkok date/time, blue grade tab, subject, tutor, localized business-status badge and persisted
net amount. A dashed right stub contains the pale-mint detail ticket, with the same encoded URL.
Narrow paper containers stack course, status/amount and a full-width 44px action.

List counts use the selected status response's total, and remain unavailable until that particular
filter/page/retry request succeeds. Native event handlers mark content loading immediately, including
when returning to a previously loaded filter while another request is pending. The selection key and
existing active-response guard prevent previous counts or late responses from appearing as current
results. Errors retain the existing retry/sign-in behavior; empty states appear only after success,
with zero only then. Filtered empty copy suggests another status without implying an empty account.
The shell's sidebar badge uses the global all-status total below, separately from list filter counts. Shared
`NotebookPagination` uses page/total with page size 10; previous/next remain disabled at boundaries,
and pagination is omitted for one page. The user refined its opt-in ticket variant to **Ticket Pair**
on 2026-10-07: connected warm-paper Previous and pale-mint Next buttons with inset dashed edges,
a perforated center seam, top/bottom seam notches and a shared 3px paper edge. Both buttons have
48px targets, decorative left/right arrows and visible keyboard focus; disabled boundaries use muted
paper. Page count appears left of the pair on wide paper and above the full-width pair in containers
up to 450px. The record range remains in a polite screen-reader live region. Shared standard/paper-turn
consumers retain their existing presentation, and the original server paging/filter behavior remains.

Detail keeps `getMyBooking`, its active-response/current-ID guards, existing resource error messages,
session-expiry behavior and original back/find-tutor links. Loading and errors retain the shared
shell, heading and one paper. The opt-in `BookingDocketSummary` detail presentation reuses tutor
identity, verification/unavailable copy, grade, subject, full ruled description and the date/time
anatomy from the request. Its DOM order is course information then one mint time band. The current
hourly rate is omitted; persisted subtotal/discount/currency and net total appear beneath a dashed
seam through `BookingDocketAmounts`/`BookingDocketTotal`. No money is recomputed. PENDING explicitly
means awaiting tutor confirmation and uses requested-time copy; other statuses use their real label
and an appropriate confirmed/neutral explanation. No paid/meeting/cancel/reschedule affordance is added.
List/detail status tags match the selected preview's 4px corners, thin border, light fill and decorative
clock/check/double-check/slash icons, with amber/green/stone/muted-red business tones. The optional
`BookingDocketStatus` tag appearance keeps the request's default badge and dashboard badge unchanged.

List and detail use the docket's Bangkok helper for cross-day Start/End dates, exact-midnight 24:00
and accessible actual endpoints, with Thai Buddhist and English Gregorian years. Detail has one time
presentation, plus its decorative calendar tile. New styles stay local to bookings. The request's
default docket composition and shared `booking-ui` helpers/dashboard badge remain intact. Browser
checks intercept all API traffic and cover both languages at 320/768/1440px, responsive filters,
long content, loading/error/empty/404, all statuses, session expiry, order, pagination, keyboard focus,
midnight, stale filter responses and persisted amounts that differ from the current hourly price.

The tutor dashboard follows the Notebook Focus layout: the next confirmed session, today's
availability, pending requests, monthly teaching analytics, and course performance. Today's availability
uses the same overlap query and clips cross-day slots to the Bangkok day; midnight endings show 24:00. Monthly
analytics show confirmed/completed lessons, scheduled hours, booking value, and a weekly-hours
chart based on Bangkok lesson dates. A compact, single-row Ruler Reel selects the centered month when
scrolling stops. It supports mouse dragging, native touch/trackpad scrolling, clicking, and keyboard
navigation, keeps 25 months mounted, and replenishes the range at its ends. It uses native scroll
snap, honors reduced motion, and updates analytics once per settled selection rather than during
every scroll frame. Earnings and review containers display an unavailable state
until real data is supplied; booking value is not treated as received revenue. It uses the existing
read-only endpoints: pending requests are loaded separately from future confirmed lessons, and
analytics load only the selected Bangkok month through the existing `from`/`to` filters. Monthly
loading and errors stay within analytics, with unavailable metrics and a retry action; the teaching
overview and request list remain usable. Dashboard summary errors also offer a retry action.
Requests use five-item pagination. Scoped booking loads deduplicate IDs and bound pagination to
the first response's page count, so newly inserted bookings do not cause duplicate-row errors or
an indefinitely growing load. Offset pagination remains a best-effort view while bookings change;
reopening the dashboard or reselecting a month fetches fresh data. Course performance uses a Subject Index: subjects appear in a color-coded directory
beside a ruled paper folder containing all courses for the selected subject, without pagination.
On narrow screens the directory sits above the folder. Subject groups come from existing listing
IDs and retain stable accent colors. Keyboard navigation and native buttons support selecting
one course at a time. Clicking a course row expands its summary directly beneath that row with a
lightweight CSS height transition; clicking it again collapses the summary, and selecting a different
course opens that row instead. Collapsed details are excluded from focus and accessibility navigation.
Reduced-motion preferences disable the transition.
Changing subjects clears unrelated course details; changing the month keeps
the selected subject and course. Changing the past-request filter resets requests to their first page.
Course/profile/availability management stays in existing routes;
the create-course action appears only when the tutor has no listings.
Past lesson requests are hidden by default. A reusable blue bookmark-note switch can include
them in the request list. Pale blue paper and a perforated margin distinguish past lessons
without reducing the readability of their details.

## Action feedback

Student and Tutor commands use the existing `NotebookToast` success/error paper, as requested on
2026-10-07. Profile edit/onboarding, consent, photo upload/removal, ledger course publication/archive/
restore, availability conflicts/validation, booking submission and authentication actions now provide
the missing feedback. Existing course-editor and availability mutation toasts are retained.
Results are emitted only after the existing command settles; original guards, API calls, inline
errors/recovery links, local logout cleanup and redirects remain unchanged. The toast viewport
portals into the most recently opened native dialog to keep feedback above its top layer, returning
to the body when the dialog closes. Global timers persist across client navigation and dialog changes.
See [the action audit](notebook-toast-audit.md) for the full inventory and verification scope.

## Student profile and onboarding

`/dashboard/profile` and `/onboarding/profile` use the selected tutor-aligned **Profile Page**.
Identity, learning information and emergency contact have separate dashed sections. The readonly
account email and completion badge share the tutor summary's typography, 48px field rhythm and
responsive columns; the existing form controls and actions remain shared. The private summary has
an external heading, one compact paper with nickname and ruled school/class values, a mint lock
explanation and a separate yellow privacy note. It updates from local form values and resets on
cancel; no public student profile or additional personal data is introduced. The note explicitly
limits linked tutors to nickname and keeps legal name, school, class, phone and email hidden.

The form and summary keep their own content height, sitting beside each other above 1060px and
stacking below that width. Long summary values and readonly email wrap at 320px. Authenticated
student profile loading retains the dashboard shell and onboarding sign-out; the sidebar booking
badge uses the global student booking total described below. Consent remains a
separate required notice/checkbox step and uses the existing modal and request. Validation, trimmed
six-field student payload (including string gradeLevel), focus, dirty state, cancel, inline/toast
errors, saving buttons, profile gating and sanitized returnTo retain their existing behavior.
Tutor fields, public preview, metadata, save contract and optional photo workflow are unchanged.

Browser checks use intercepted preview API fixtures, including TH/EN long text at 320/768/1440px,
empty/validation/saving/error/dirty states, consent and its notice modal, returnTo, sign-out,
loading/load failure, student save payload, tutor onboarding and existing tutor/photo regressions.

## Global student booking count

All authenticated student shells subscribe to one in-memory state via `useSyncExternalStore`.
A small unfiltered read of the existing booking API supplies `response.total`, regardless of the
Dashboard's 100-item limit or the list's selected status/page. A route change, visible window focus
or visibility change refreshes the count; concurrent triggers share a request. Booking success
starts a fresh authoritative read and prevents pre-create responses from overwriting it. The last
known total stays visible with `aria-busy` during refresh; initial/error results show — and a
successful empty result shows 0. The live badge stays in the existing sidebar layout.

State is isolated by authenticated student ID and cleared on login, verification, logout and
session expiry. Late responses cannot repopulate cleared state or overwrite a newer account.
Guest/tutor shells and onboarding never fetch the student total. No local storage, backend change,
new API endpoint or booking payload change is introduced. Browser checks cover cross-page totals,
status-filter independence, counts above 100, focus refresh, booking success, errors/zero and
mobile sidebar operation; unit checks cover deduplication and account/mutation response races.

## Profile photos

Student and tutor onboarding/edit pages include an optional photo section with local preview,
explicit upload, cancel selection, and removal. Photos save separately from the profile form;
changing a photo preserves unsaved field edits. Thai/English copy states file limits and visibility.
The controls wrap at 320px and retain labels, visible keyboard focus, pending/error states, and a
live success notice. Saved photos appear in sidebar/account previews and the tutor course preview;
eligible tutor photos also appear in public search/detail. Private signed URLs renew while pages
stay open and when returning to a visible tab. Missing/failed images fall back to initials.

## Private messaging (S2-T17)

`/dashboard/messages` uses the shared authenticated Notebook Focus shell and **Margin Inbox**.
Students can start from a tutor's public profile without a booking; guests retain this destination
through login, and incomplete profiles/current-consent gates retain it through onboarding. Admins
are redirected to their dashboard and never request conversation data. A failed profile check
shows recovery rather than opening private chat. The server remains authoritative for role and
participant access; 401/403/404 failures never expose raw API details.

The list uses opaque API cursors with a More conversations action and deduplication. Contact names
are the server's tutor display name or private student nickname; absent names use a localized role
fallback. The selected thread displays plain text only, Bangkok date/time and role-colored bubbles.
A content container at or below 760px shows the index or transcript separately. Back restores index
scroll and contact focus. The transcript scrolls independently of the composer. Drafts, history,
reading offsets and new-message counts are scoped to the mounted user's page, retained per
conversation while switching, and never written to local/session storage.

Initial history follows forward API pages of 50 to the end; unavailable history leaves the composer
disabled and provides retry. Refresh loads after the last GET cursor. New messages append without
moving a reader browsing older history, with a floating latest-message button; a reader already at
the bottom follows the new messages. Cached reentry restores the reading position and checks for
updates. Refresh failures retain fetched history. Switching conversations aborts their reads, and
late send results are ignored after the authenticated view unmounts.

The composer trims only when sending and validates 1–2,000 Unicode code points. Enter adds a line;
submission uses the Send button/native form. While sending, disable the input, back and contact
selection and guard repeated form submissions synchronously. Success clears the draft and displays
the actual returned message plus NotebookToast. A failed/uncertain send retains the draft, shows
inline and toast recovery and performs no automatic retry. The outgoing response never advances the
GET cursor, preserving concurrent incoming messages for a later refresh, with ID deduplication.

Automatic polling, mark-read commands, sent/read receipts and an incremental older-history interface
remain S2-T20. Inbox unread counts are server values; opening/GET does not clear them. With the current
forward-only contract, initial reads/memory scale with full history length. Browser verification uses
intercepted APIs (including two-page history, concurrent incoming, permissions and auth/profile gates)
on desktop, 768px tablet and 320px/mobile. It does not verify a live database or migration rollout.

The 2026-10-09 messaging refinement makes both pane headers 72px, uses compact page/index headings,
and lays out contacts in two rows with localized last-message time/date and an accessible full date.
Participant initials use their role color. With a thread open, the index refresh is hidden and the
thread refresh checks both inbox and message history; closing it exposes index refresh again.
Short message histories sit above the composer and the stream width is capped at 52rem. Consecutive
same-sender messages within three minutes and one Bangkok date use a smaller gap. The textarea grows
from 48px to 112px, then scrolls internally, with Send beside it. Limit/count instructions show when
focused, a draft exists or sending fails; errors and full control names remain accessible. Workspace
height uses the actual header offset and window/visual viewport size, with a 360px minimum for a
usable transcript and 760px maximum. Very short/landscape viewports retain native page scrolling.
Bilingual browser geometry checks include a 1920px screen and 320px mobile with a three-message thread.
