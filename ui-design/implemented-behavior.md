# Implemented frontend behavior

Updated 2026-10-06. This describes the current implementation, including interaction and layout
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
