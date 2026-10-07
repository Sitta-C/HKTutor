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
language-dependent effect, without following server totals or adding requests. Loading retains the
shared shell and student Mint loading note; loading/errors keep sidebar counts unavailable and hide
summary counts/empty states. Zero appears only after a successful response. The disabled search,
quick-action block, repeated pending panel, and duplicate find-tutor CTAs are removed; a single
header find-tutor CTA and existing shell navigation remain. Styles are isolated to Student Dashboard;
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

Search pagination uses **Ticket Pair**: Previous/Next are adjacent paper tickets with inset dashed
edges, a perforated center seam and top/bottom notches. The next ticket is pale mint. Wider result
sheets show the page count left and tickets right; sheets up to 450px put the count above a full-width
pair. Both native buttons have 48px minimum height, localized text, decorative arrow icons, visible
keyboard focus and explicit disabled boundaries. Reduced motion removes transitions. Pagination
still appears only after successful results with more than one server page. These styles are local
to search in `tutor-search-pagination.module.css`, independent of the result-sheet stylesheet,
and do not change shared `NotebookPagination` consumers. Browser checks assert the actual ticket
layout and borders, alongside the keyboard and pagination flow.

Only the `/tutors` header changes: guests see Sign in and authenticated users see My bookings, with
no link back to search. Its unloaded sidebar booking count is unavailable. These search styles do not
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
error/404 retains the back link; empty listings and slots are explicit after success. The existing
detail header actions remain, and the sidebar booking count is unavailable because detail does not
load bookings. CSS, view models and bilingual copy are local to this feature; tutor editors, shared
primitives and API contracts are unchanged.

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

## Profile photos

Student and tutor onboarding/edit pages include an optional photo section with local preview,
explicit upload, cancel selection, and removal. Photos save separately from the profile form;
changing a photo preserves unsaved field edits. Thai/English copy states file limits and visibility.
The controls wrap at 320px and retain labels, visible keyboard focus, pending/error states, and a
live success notice. Saved photos appear in sidebar/account previews and the tutor course preview;
eligible tutor photos also appear in public search/detail. Private signed URLs renew while pages
stay open and when returning to a visible tab. Missing/failed images fall back to initials.
