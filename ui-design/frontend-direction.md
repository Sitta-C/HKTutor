# HKTutor frontend direction — Notebook Focus

Updated 2026-10-07. This describes the implemented Notebook Focus direction and component
patterns in this repository. Maintainers review changes to shared design conventions through the
normal PR process; this guide does not assert team approval of decisions from an individual chat.
Read it as implementation context before UI work. The current task's explicit requirements take
precedence. Follow the source for exact behavior; older prototypes remain historical references.
See [implemented frontend behavior](implemented-behavior.md) for detailed interactions and layout.

## Visual direction

- Continue **Notebook Focus**: warm paper, subtle ruled lines, small tabs, folder edges, bookmarks,
  restrained tape, and thin borders. Make the paper details serve grouping and hierarchy.
- Keep the tutor accent blue. Use a warm secondary accent for booked/waiting information and red
  for destructive actions/errors. Pair color with text or an icon, and keep subject colors stable.
- Reuse the tokens in `apps/web/src/app/globals.css`, the existing dashboard shell, and notebook
  primitives. Use Bai Jamjuree for body text and the existing note fonts for appropriate accents.
  Do not replace the established design with a generic dashboard template or introduce a new palette.
- Prefer compact, content-sized surfaces and soft shadows. Avoid tall empty containers, dark
  overlays that obscure readable content, large decorative corner circles, and equal emphasis for
  every metric. Counts should be easier to scan than supporting timezone information.
- Creative details are welcome; they should remain readable, consistent, and lightweight.
  Reuse or extend a component when the same pattern recurs rather than duplicating its markup.
- Loading follows the implemented hierarchy: use `NotebookLoading` sticky notes only while a page
  or all primary dashboard content is unavailable. Keep the dashboard shell visible during content
  loading. Use `NotebookLoadingRegion` skeletons or compact text for lists, timetable changes, tutor
  results/catalogs, booking details, and booking quotes. Action buttons keep their existing pending
  label/disabled behavior. Student dashboard counts and empty states wait for a successful response;
  loading/error counts stay unavailable. Errors show an alert rather than a spinning loading note.
- Each sticky-note loading context has a distinct reserved color in `notebook-loading-palette.ts`:
  dashboard session Apricot, tutor dashboard Sky, student dashboard Mint, profile edit Butter,
  onboarding Lavender, availability Aqua, listing list Sand, new listing Rose, edit listing
  Periwinkle, booking list Pistachio, booking detail Dusty rose, booking confirmation Lemon,
  tutor search Coral, and tutor detail Fog. Do not reuse a loading color for a new loading context.
  The colors are scoped to loading notes; other implemented sticky-note components keep their colors.

## Information and actions

- A dashboard should help the tutor understand teaching activity and pending work. Remove shortcut
  collections and repeated CTAs when they only duplicate the sidebar or another visible action.
- Make the primary action clear. Display-only statistics should look like information, and an
  actual action should look operable. Do not add hover lift or button styling to passive summaries.
- Keep one necessary registration/login CTA in public headers. Password recovery is a small
  accent text link beside the password label, not a large pink assistance banner. Pink paper can
  support an actual error state. The current recovery link explains that reset is not supported.
- Dashboard headers use the same `LanguageSwitch` as the login/public header: a globe icon with the
  TH/EN label and a light rounded hover state, without the former boxed button or colored role dot.
- Keep the “Why HKTutor?” navigation in the about page's top section; repeated clicks must scroll
  to its target again. Do not restore the removed duplicate CTA.
- Profile editing at `/dashboard/profile` has no “Back to dashboard” header button; use the shell's
  existing navigation. Keep the sign-out control in profile onboarding.
- The tutor profile's student-view preview uses **Profile Page**, selected on 2026-10-06.
  Keep its heading/helper outside one paper surface, with tutor identity and a plain verification
  line at the top, teaching experience on a small yellow sticky note, and biography on subtle ruled
  lines. Place the yellow writing tip below the paper. Stack the experience note when the preview
  column is narrow, including desktop sidebars. Preserve live form updates, empty placeholders,
  all verification states, bilingual copy, and the existing student-account summary.

## Selected patterns

| Area                         | Implemented direction                                                                                                                                                | Implementation reference                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Tutor dashboard              | Notebook Focus; teaching overview, pending requests, analytics, and course performance                                                                               | `apps/web/src/components/dashboard/tutor-dashboard.tsx`                                 |
| Student dashboard            | **Desk Spread**: two notebook sheets joined by closely spaced wire loops; next booking and compact count strip on the left, booking-derived tutor index on the right | `apps/web/src/components/dashboard/student-dashboard.tsx` and its stylesheet            |
| Student course search        | **Course Index**: left filter memo, continuous ruled course rows, grade tabs, yellow rate notes, and plain verification tags; mobile filters collapse                | `apps/web/src/components/tutors/tutor-search-page.tsx` and its stylesheet               |
| Public tutor detail          | **Appointment Pad**: Profile Page above a course directory and mint-bound date/time pad; selected course remains visible above the ruled appointment rows            | `apps/web/src/components/tutors/public-tutor-availability.tsx` and its stylesheet       |
| Course management            | **Course Ledger**: one compact count strip, status tabs/search, and continuous ruled rows with a binding margin; grade above subject, rate/date/actions below        | `apps/web/src/components/listings/tutor-listings-page.tsx` and its stylesheet           |
| Past requests                | Hidden by default; blue bookmark-note switch shows them; pale paper/perforated styling keeps past rows readable                                                      | `apps/web/src/components/ui/bookmark-note-switch.tsx`, `notebook.module.css`            |
| Course performance selection | **Subject Index** with a subject directory and stable subcolors; show all courses of the selected subject without pagination                                         | `apps/web/src/components/ui/subject-course-index.tsx` and its stylesheet                |
| Course details               | One course expanded at a time, directly beneath the clicked row; clicking again collapses it, with a light height transition                                         | `apps/web/src/components/ui/subject-course-index.tsx`                                   |
| Month selection              | **Ruler Reel**, a compact single horizontal row with native scrolling/snap; preserve its original compact height                                                     | `apps/web/src/components/date-time/month-ruler.tsx` and its stylesheet                  |
| Availability summary         | **Ledger Strip**: two counts in one ruled-paper surface; blue open-time icon, warm booked-time icon, a small timezone tag in the footer                              | `apps/web/src/components/availability/availability-summary.tsx` and its stylesheet      |
| Availability header          | No redundant “My courses” header button; course navigation remains in the existing shell                                                                             | `apps/web/src/components/availability/manage-tutor-availability.tsx`                    |
| Availability ranges          | Continuous notebook rows across dates, binding margin, compact status/delete controls, and explicit ended state                                                      | `apps/web/src/components/availability/manage-tutor-availability.tsx` and its stylesheet |

The course selector evolved from Binder Drawer to Subject Index. Do not revert to the earlier
paginated drawer or nested-folder proposal just because an older preview shows it. Request-list
pagination is separate and remains in place; the no-pagination decision applies to course selection.

## Student stationery baseline

The user selected **Desk Spread** for the student dashboard on 2026-10-06 and requested implementation
with ring binding and frontend tutor pagination. This is the implemented starting point for the
remaining student redesign work; their individual layouts still require selection.

- Keep the existing student mint, warm paper, shared shell, Bai Jamjuree body type, and note fonts.
  Mint identifies student context and grouping; booking status keeps the shared badge's meaning.
- Use restrained stationery: small passive category tabs, a compact calendar tile, thin paper
  separators, subtle ruled list rows, one short tape accent, and a memo explaining the next booking's
  actual status. Do not rotate dates, names, copy, or actions. Note typography is limited to the memo
  heading. Yellow supports a pending-request explanation; confirmed copy uses a pale green memo.
- The next appointment uses a compact mint surface: a month/day/year calendar tile on the left,
  with time, tutor name, and subject/grade on the right. Keep the localized start date readable to
  assistive technology; show the full date range beneath it when a booking crosses Bangkok midnight.
- The dashboard sheets use 8px corners, soft existing shadows, and 22px inner spacing (16px on
  small screens). The desktop split favors the appointment sheet slightly. Closely spaced flat wire
  loops follow the user's spiral-notebook reference and repeat every 24px along the binding. Their
  length follows the sheets without a fixed ring count. Below 1024px the sheets stack in reading
  order with the same wire pattern running horizontally between them.
  Rings and this two-sheet composition are dashboard details, not required decorations on every
  student page. These styles remain scoped to the student dashboard's CSS module.
- Show next booking first, then one passive three-count strip. Place one compact deep-mint
  **Find a tutor** paper ticket to the right of the dashboard greeting as the page's primary booking
  entry point. Below 640px, stack it beneath the greeting, aligned left. Keep an upright label,
  dashed arrow stub, visible focus and a 48px target. It opens `/tutors` and stays in the same location
  during loading/errors/empty results, independent of the tutor index.
  The dashboard header has no find-tutor action; the overview has no My bookings action, and existing
  shell navigation remains. The disabled tutor search and duplicate quick actions are
  removed. The right sheet is a tutor index from bookings, with four tutors per page using the
  shared `NotebookPagination`'s opt-in **paper-turn** variant. Previous/next are small icon-only
  circles with 44px touch targets, localized accessible names, keyboard focus, and disabled boundary
  states. The tab reads “Your tutors” / “ติวเตอร์ของคุณ”. A passive mint bookmark ribbon hangs
  from the right sheet's top edge and shows the unique tutor count. Record-range and page-count numbers are
  visually hidden and remain available to assistive technology. The
  standard text-button pagination remains the default for other consumers. Hide pagination when
  one page suffices.
- Counts and tutors describe only loaded booking records (up to 100), never lifetime activity or
  favorites. Preserve the existing pending/confirmed next-booking selection and booking-detail links.

## Student course search

The user selected **Course Index** for `/tutors` on 2026-10-07, with filters on the left,
existing `NotebookSelect` dropdowns, more dimensional price paper, and verification as a text tag
without a checkmark. This is implemented for guests and signed-in students.

- Use one continuous result sheet with a restrained binding margin and ruled separators. Keep the
  filter memo on the left from 768px; below that width it sits above results and starts collapsed.
  The native toggle preserves mounted field values, explicit Apply/Clear controls, keyboard focus,
  and validation messages. Successful Apply collapses mobile filters; invalid Apply keeps them open
  and focuses the first invalid control.
- Each row remains one course/listing. Lead with tutor identity and a small passive verification
  tag, rating/review count and experience; show a blue grade tab above subject, yellow rate paper,
  description, next availability and the original view-times link. The paper beneath the price tilts
  slightly and has a subtle fold/shadow; price text and actions stay upright. Do not add tape or a
  separate lifted card to each result. Container queries stack row anatomy when the result sheet
  is narrow, including tablet and desktop columns.
- Reuse `PaperCard`, `NotebookHeading`, `StatusBadge`, `NotebookSelect` and loading regions.
  Styling is scoped to search; shared primitives and the tutor editor's **Note Window** are unchanged.
  Grade/subject/rate/description provide continuity with Note Window and the public tutor detail's
  Appointment Pad. These layouts do not establish a shared global course component.
- The user selected **Paper Tickets** for search actions on 2026-10-07: Apply filters and View times
  use compact deep-mint tickets with a right icon stub, dashed seam, small notches and a 2px paper
  edge. Clear and empty-result Clear all filters use quieter underlined mint actions with a
  decorative eraser. Apply and Clear always occupy the same horizontal row, including Thai/English
  at 320px. The mobile Show/Hide filters ticket is pale mint with a dashed border. Keep native
  button/link semantics, upright text, visible focus and at least 44px targets; narrow result sheets
  place the view-times ticket below availability. Guest sign-in stays in the existing header only.
  Action styling remains local to search, separate from detail tickets and shared buttons.
- The search header keeps one sign-in action for guests and no booking action for authenticated
  users. Remove its self-link to search. My bookings is omitted from all student/public headers,
  including the booking list, request and detail pages; the sidebar booking link remains available.
  The search booking badge uses the global student booking total described below.
- The user selected **Ticket Pair** pagination on 2026-10-07: connected paper Previous/Next
  buttons with an inset dashed edge, a perforated center seam and small seam notches. The next
  ticket uses pale student mint. Keep the page count left and the pair right on wider sheets;
  on narrow sheets, center the count above a full-width pair. Text stays upright and bilingual,
  targets are at least 44px, and native disabled states and visible keyboard focus remain explicit.
  This presentation is scoped to search; shared `NotebookPagination` consumers are unchanged.
- Preserve four filters, validation, query parameters, page size 10, server pagination, cancellation
  and stale-response guards. Do not group by tutor, merge pages, add unsupported controls, or change
  availability formatting. Keep explicit null-rating/no-availability states and unavailable result
  counts until a successful response; zero belongs only to successful empty results.

## Public tutor detail

The user selected **Appointment Pad** (option 3) and requested implementation on 2026-10-07 for
`/tutors/[tutorId]?listingId=...`, for guests and signed-in students.

- Begin with one **Profile Page** paper: tutor identity, plain verification, actual rating/review
  aggregate, a yellow teaching-experience note, and ruled biography. Null rating displays New tutor;
  no review detail action or invented metadata is added.
- Place the continuous course directory left of a mint-bound appointment pad from 768px. Below
  768px, stack profile, courses and times. Use blue grade tabs, subject, a slightly tilted yellow
  price paper with upright text, full descriptions, and explicit selected-course text/button state.
  Narrow directory columns stack price beneath the subject, as in **Note Window**.
- Choice controls use **Paper Tickets**, selected on 2026-10-07: compact, content-sized course and
  time tickets with narrow stubs, connected day tickets and a mint time action with a perforated
  arrow stub and seam notches. Use 4px corners, soft 2px paper edges and at least 44px targets. Keep upright
  bilingual labels, explicit pressed/disabled states, visible focus and reduced motion. These
  styles remain local to public tutor detail, independent of search's **Ticket Pair** pagination.
- Keep the selected subject/grade/rate at the top of the pad. Group existing slots by their Bangkok
  start date, with a shared date gutter and ruled time/action rows. Follow tutor availability's
  endpoint labels for ranges occupying multiple dates: Start/End (เริ่ม/จบ), time and full localized
  date joined by a thin vertical connector. Exact midnight displays as 24:00 on the last occupied
  date; a one-day range ending at midnight stays concise. Each range remains one slot/action.
  Accessible ranges retain the actual endpoint dates/times, including next-day 00:00. A local
  native-button day index filters loaded slots only; All dates restores them without fetching.
  Compact day/month ticket labels retain full dates in accessible names and day gutters, with
  Thai Buddhist/English Gregorian years.
- Course pagination uses the selected **Page Tabs / Scrolling Ruler**, with three already loaded
  courses per page. Keep the ruler compact: page number and course range share one line, with the
  existing centered pointer, ruler ticks, scroll snap, mouse dragging and native touch/trackpad
  scrolling. Arrow keys, Home and End stay within the finite page range. There is no visible
  record-range/page-count footer; a localized live status remains available to assistive technology.
  Hide the ruler when three or fewer courses suffice. Open the page containing the effective
  requested/fallback course. Browsing pages keeps the selected course and appointment pad intact;
  an off-page selection note can return to its page and focus its selected ticket. Choosing another
  course updates the pad normally. Page state and mint styles remain scoped to public tutor detail;
  tutor calendar rulers and API pagination are unchanged.
- Use 8px paper corners, thin borders, existing paper shadows, subtle stacked pad edges and one
  blue tape accent. Reuse notebook primitives and tokens; feature styles/copy/models stay local.
  The chosen tutor profile/listing editors and shared primitives remain unchanged.
- Preserve the original detail and 30-day availability requests, requested/fallback listing
  selection, encoded booking link, guest login return path, wrong-role guards, conflict recovery,
  and loading/error/404/empty states. The detail header has no Find a tutor or My bookings action;
  its sidebar uses the global student booking total. Do not extend the fetched range or add
  reviews/slot actions.
- Tutor identity, blue grade tab, upright price, selected subject/grade and Bangkok date/time are
  the reference anatomy for booking presentation. The request page uses Appointment Docket below;
  booking list/detail layouts still require selection.

## Student booking request

The user selected **Appointment Docket** and requested implementation on 2026-10-07 for
`/dashboard/bookings/new?listingId=...&slotId=...`.

- Use one content-sized paper: a mint date/time rail on the left, tutor identity and plain
  verification, blue grade tab, subject, upright hourly amount on slightly tilted yellow paper,
  ruled description and amount breakdown on the right. Below a dashed seam, place a short
  waiting-for-confirmation note, the prominent request total and one send action. Narrow paper
  containers stack the rail above the same content, then total and full-width send action.
  Use 8px corners, thin borders and existing paper/note shadows. Dates, amounts and actions stay upright.
- Send request and View booking details use deep-mint **Paper Tickets** with a narrow right icon
  stub, dashed seam, small notches and a 2px paper edge, matching tutor/search actions. Keep 44px
  minimum targets, full-width mobile actions, visible focus and explicit disabled sending styling.
  Secondary recovery actions remain text links; ticket styling is local to the request page.
- Continue the public tutor detail's Appointment Pad anatomy. Cross-day times show Start/End and
  both localized dates; exact midnight uses 24:00 on the last occupied date, with actual endpoints
  retained in the accessible range. Keep Thai Buddhist/English Gregorian years and Bangkok time.
- Quote loading keeps the shell and one inline loading region inside the paper. Missing-selection
  and quote errors retain their existing recovery links; submit errors sit beside the action.
  Keep sending labels/disabled behavior, change-time, 409 recovery with `conflict=1`, sign-in,
  booking-detail/list and find-tutor links. The sidebar uses the global student booking total described below.
- After submission, keep the same docket with the response status and created-response amounts.
  PENDING explicitly says **Awaiting tutor confirmation / รอติวเตอร์ยืนยัน**, with warm status styling;
  success never implies payment or confirmation. Other returned statuses use their own localized
  label and neutral follow-up copy. Verification is translated when supplied; absent verification
  is unavailable, never assumed verified. Do not add rating, experience or photos absent from the quote.
- `BookingDocketSummary`, `BookingDocketTotal` and `BookingDocketStatus` are booking-only presentation
  components available to the later list/detail work. Summary accepts existing tutor/listing/slot
  data and separate response amounts; it fetches nothing. Existing `booking-ui` formatting/error
  helpers and dashboard status consumers are unchanged. The request remains the default composition; list/detail use the selected Margin Index below.
- Preserve quote/create requests, selectionKey guards, createBookingOnce and the duplicate-submit
  gate. No API/client/payload/price-calculation, payment, coupon or scheduling workflow changes.

## Student booking list and detail

The user selected **Margin Index** and requested implementation on 2026-10-07 for
`/dashboard/bookings` and `/dashboard/bookings/[bookingId]`.

- Put the six existing server status filters in a narrow left index on desktop, and a two-column
  native-button index above the paper below 640px. Use mint selection, explicit pressed states,
  upright bilingual labels, visible focus and at least 44px targets. Status categories have no
  invented per-status counts, and switching status resets the existing server page to one.
- Keep one continuous ruled ledger with a punched binding margin. Each booking leads with Bangkok
  date/time, then a blue grade tab, subject and tutor; the actual business status, persisted net
  amount and pale-mint View details ticket sit in a perforated right stub. Narrow paper
  containers stack the same information and full-width ticket without nested cards or per-row tape.
  Preserve API order and each underlying booking as one row, including cross-day lessons.
- Detail reuses `BookingDocketSummary`'s opt-in detail presentation: tutor/course/description first,
  one horizontal mint date/time band next, then status explanation and persisted subtotal, discount
  and total beneath a dashed seam. Omit the current hourly rate from this historical booking view.
  Keep request summaries' default layout, rate paper, quote/create amounts and submitting flow intact.
  `BookingDocketAmounts` shares the existing amount markup; no component fetches or calculates prices.
- Time uses the request docket's Bangkok helper, Start/End dates for occupied cross-day ranges,
  24:00 on the last occupied date for exact midnight endings, Thai Buddhist/English Gregorian years
  and the actual complete endpoints in the accessible range. Show time once in the detail summary.
- PENDING explicitly reads Awaiting tutor confirmation / รอติวเตอร์ยืนยัน; confirmed and other
  statuses use their own labels and explanations. List/detail status tags match the selected preview:
  a 4px corner, thin border, light paper fill and decorative clock/check/double-check/slash icon.
  Use warm amber for pending, green for confirmed, stone for completed and muted red for canceled/expired.
  The opt-in tag appearance leaves the request docket's default badge intact. Keep the
  dashboard's existing `BookingStatusBadge` unchanged. Role selection and business status remain
  distinct; no payment, cancellation, rescheduling, attendance, meeting or chat controls are added.
- Heading counts describe the selected server status only. Counts remain unavailable during loading,
  retries, filter/page changes and errors; zero appears only after a successful empty response.
  The sidebar uses the global student booking total, independent of the selected status count. Loading/error/empty/detail-not-found content retains the shell and paper.
- Reuse `NotebookPagination` with its opt-in **ticket** variant. The user refined booking pagination
  to the supplied **Ticket Pair** reference on 2026-10-07: connected Previous/Next tickets, inset
  dashed edges, a perforated center seam, seam notches and one soft paper edge. Previous is warm
  paper; Next is pale mint, with left/right arrows beside upright labels. Show the page count at
  left and the pair at right; narrow paper containers put the count above a full-width pair.
  Keep the record range available to screen readers, muted disabled boundaries, 48px targets and focus outline.
  Standard and paper-turn consumers retain their existing presentation. Keep the original page size 10
  and server page/total; hide pagination when one page suffices. Preserve original API clients/queries, active-response and current-ID guards,
  retry, session expiry, encoded detail links, back-to-bookings and find-tutor destinations.
  List/detail styles are scoped to `student-bookings.module.css`; shared primitives and tutor UI
  retain their existing behavior. Browser checks cover TH/EN at 320px, 768px and 1440px, long text,
  all statuses, loading/error/empty/404, session expiry, stale filter responses and persisted amounts.

## Student profile and onboarding

The user selected the **tutor-aligned Profile Page** and requested implementation for
`/dashboard/profile` and `/onboarding/profile` on 2026-10-08.

- Keep the shared tutor form paper, label/input dimensions, black primary/secondary actions and
  optional existing photo editor. Group the student's six fields into Identity, Learning information
  and Emergency contact, with dashed section divisions. Grade/class remains free-form text.
- Match tutor account fields: labels above a 48px plain-paper readonly email and a standalone
  completion badge, in the same responsive columns. Completion and unsaved changes remain distinct.
- Place the private account-summary heading/helper outside a compact 10px-corner paper. Use the
  tutor Profile Page's identity scale, restrained yellow tape and ruled school/class values, with a
  mint lock line explaining that information stays in the private profile. Stack below the form on
  narrow layouts; wrap long names, education values and email. Size both papers to their contents.
- Place the yellow privacy note below the summary paper, like the tutor's writing tip. Explain that
  only nickname can appear to a tutor linked to a booking; legal name, school, class, telephone and
  email remain hidden. This is an owner-only account summary, not a public student profile.
- Preserve consent/notice modal, validation and first-error focus, save/cancel/reset, saving/error/
  dirty states, profile gating, sanitized returnTo and onboarding sign-out. Keep the authenticated
  student shell while loading profile data; its booking badge uses the global student booking total. Do not add
  fields, catalog requests, profile/API contracts or photo behavior. Tutor edit/onboarding, its
  selected Profile Page preview and rating/verification summary remain unchanged.

## Profile photo editor

The user selected **Ink Portrait Index**, combining Ink & Sketch and Portrait Index, on
2026-10-08 for student and tutor profile editing and onboarding.

- Use a compact paper with a brush-highlighted heading, role tab, punched binding margin and
  subtle ruled lines. The circular portrait sits in a small paint wash, with its handwritten caption
  below. The user removed the rectangular dashed photo frame on 2026-10-08; keep this area unframed.
  Finish with a thin ruler edge; student accents are mint and tutor accents blue.
- Keep the portrait caption **this is me** in English in both interface languages. Show the
  localized separate-saving explanation directly, without a Little note prefix.
- Choose photo uses a pale mint/blue brush stroke with a small painted brush, subtle dry-brush edge
  and accent-colored text, refined on 2026-10-08. Keep a 46px target and visible keyboard focus.
  Keep existing upload, cancel and remove actions, disabled/saving states, validation, previews
  and success/error toasts.
  Stack the portrait above the copy in narrow containers, including desktop form columns.
- Keep bilingual text and the actual role-specific privacy explanation: student photos are private;
  tutor photos can appear publicly when eligible. Photo saving remains separate from profile fields.
  Styles stay local to `avatar-editor.module.css`; public avatars and profile previews are unchanged.

## Global student booking count

On 2026-10-08 the user requested one global state for the student sidebar booking count.
`DashboardShell` reads the authenticated student's unfiltered server `total`, using the existing
`getMyBookings({ page: 1, pageSize: 1 })` client. Dashboard, profile, booking list/detail/request and
public search/detail share that state; page components do not supply separate booking badges.
The count is independent of loaded item limits and status/date filters. Requests are deduplicated;
refresh occurs on route changes, visible window focus/visibility and successful booking creation.
A known count stays visible while refreshing with an accessible busy state. Initial unavailable/error
states show —; zero follows a successful empty response. Clear on login, verification, logout and
session expiry, isolate by user ID and reject late results from older sessions or pre-create reads.
Guests, tutors and onboarding do not request a student count. This adds a frontend read through the
existing API, with no backend/client contract or booking payload changes.

## Action notifications

The user approved completing **NotebookToast** success/error feedback across Student and Tutor
on 2026-10-07. Reuse the existing taped paper and check/cross appearance. Mutating commands,
authentication actions, consent and custom submission/file-validation errors use bilingual toasts;
success follows the actual response, and booking submission does not imply tutor confirmation or payment.
Keep persistent inline details, field focus and recovery actions. The shared viewport follows the
most recently opened native dialog so modal failures are visible above it, and survives client navigation.
Keep navigation/results/loading feedback in the page and retain the existing toast timing/reduced motion.
See [NotebookToast action audit](notebook-toast-audit.md) for the completed action inventory and checks.

## Scope and data

- For UI/UX redesign, keep the existing API, requests, payloads, business rules, authentication,
  database, and calculations unchanged unless the user explicitly expands the scope. Do not add
  features or new actions merely to fill the layout.
- If the user requests future analytics without available data, design the container and a clear
  unavailable state. Do not ship fabricated revenue, reviews, trends, progress percentages, or
  mock charts as if they came from the user's account. Preview data must be clearly identified.
- Existing dashboard summaries are derived from existing bookings/listings. Booking value is not
  received income. Preserve the established distinction between confirmed/completed and pending.
- While loading or after a load error, show unavailable counts, not a misleading zero. Zero is
  appropriate when a successful response is empty. Preserve the existing counts' weekly/monthly scope.

## Design and implementation workflow

1. Use this direction and the relevant existing component as the starting point. Ask about missing
   product decisions when needed; do not make the user restate the entire visual language.
2. Before a substantial aesthetic redesign, use **Visualize** to offer several meaningfully different
   options with useful tweaks such as color, spacing, corner radius, shadows, and paper details.
   If Visualize is unavailable, explain that and provide a reviewable local preview.
3. Wait for the user's explicit choice before applying a proposed design to the app. Selecting or
   browsing a carousel alone does not authorize implementation. A simple requested removal or an
   adjustment to an already selected design can proceed directly.
4. Implement only the selected scope. Reuse native controls, scrolling, CSS transitions, and the
   existing icon system; avoid heavy animation dependencies and updates on every scroll frame.
5. Preserve Thai/English copy, Bangkok timezone, keyboard operation, visible focus, non-color status
   cues, and reduced-motion preferences. Check mobile (including 320px), tablet, and desktop.
6. Verify the relevant flow and layout, and preserve unrelated working-tree changes. Keep conventional
   commits focused. Commit locally without pushing unless explicitly requested.

## References and unselected proposals

- Availability week navigation uses the selected **Week Reel** in place of the previous/current/next
  button group. Keep it small: one ruler row at the dashboard ruler's height (about 64px), at most
  26rem wide, aligned to the right edge of the schedule card, with only 8px spacing above it and a
  compact heading/helper. Week labels show day ranges
  over localized month/year context, including both months/years when a week crosses a boundary.
  Preserve Monday-starting Bangkok weeks, the existing availability requests, current-week refresh,
  keyboard focus, mouse dragging, native touch/trackpad scrolling, and reduced motion. Month and week
  rulers share their interaction and styles through `CalendarRuler`; the dashboard month ruler keeps
  its existing size and behavior. Arrow Ruler and Open Ruler remain unselected alternatives.

- Existing source and this guide are the portable reference for new chats.
- `ui-design/uidesign.md` supplies page/data mapping and historical prototypes. Use this newer guide
  and current source for the visual direction when older descriptions conflict.
- **Global confirmation component is still a proposal**, not an approved global implementation.
  Paper Dialog, Sticky Memo, Binder Notice, and Decision Sheet were previewed; no explicit design
  choice has been given. The existing availability delete dialog remains its own implemented flow.
- `/dashboard/listings` uses the implemented **Course Ledger** design, selected on 2026-10-06.
  Keep the existing course-management search, publication filters, editing links, publication,
  archive confirmation, and restoration. Published badges are blue, drafts warm, and archived
  badges neutral; archived courses remain editable. Loading/error counts are unavailable rather
  than zero. On mobile, use the existing native status select and wrap actions within each row.
  The create action uses the selected **Page Header** placement: one tutor-blue button with a plus
  icon beside the page heading on desktop, full width beneath the introduction on mobile. Keep it
  in the page content rather than the global navigation; preserve the existing create route.
  Archive and publish confirmation use one native alert dialog with the same composed paper,
  binding, summary, button, and responsive styles as the availability delete alert. Use tutor blue for
  publishing and the existing muted red warning for archiving; scope each accent by action so composed
  styles cannot override it through CSS load order. Show the selected subject/grade/rate. Archive copy
  explains restoration; publish copy explains student visibility. Publishing from either a draft or an archived course sends the
  existing request only after explicit confirmation; verification requirements remain unchanged.
  Cancel receives initial focus; Escape/cancel restores trigger focus. Keep failures visible inside
  the dialog and prevent dismissal while the request is in progress.
  Do not add analytics or course-performance selectors to this page. Course Slips and Margin Notes
  remain unselected alternatives.
- The tutor listing editor's **Before publishing** checklist is the selected first incremental
  update from Sticky Studio. Place it directly beneath the student preview in the right-hand column,
  before the existing yellow writing tips. Use one blue sticky note with centered blue tape, a note-font
  heading and prominent ready count, four continuous ruled checklist rows, and publication eligibility
  in its footer. Move eligibility out of the form into this note. Keep the existing form, student
  preview, validation, and publication behavior; the rest of Sticky Studio remains a proposal.
- Listing subject and grade fields use the shared `NotebookSelect` native dropdown, with a 48px
  regular size and 44px compact size, a single blue chevron, and visible focus/error/disabled states.
  Group subject, grade, and hourly rate in three columns when space permits and stack on mobile.
  Keep the form paper sized to its own contents instead of stretching to the preview column.
  Hourly rate buttons and keyboard arrows increment/decrement by 50 baht while manual entry still
  accepts positive prices with up to two decimal places. Keep the description field compact and
  manually resizable.
- The tutor listing editor's student preview uses **Note Window**, selected on 2026-10-06.
  Place the preview heading/helper and current publication badge outside one compact paper surface.
  Show the publication badge only beside the preview heading; omit the duplicate in the page header.
  Lead with tutor identity and experience, followed by compact verification/review metadata.
  Show grade as a blue tab above the subject, with hourly price on a yellow sticky note and the
  description on subtle ruled lines. Stack the price beneath the subject when the preview column
  is narrow, including narrow desktop sidebars. Preserve actual profile data, live form updates,
  empty placeholders, and all publication statuses. Course Slip and Binder Preview remain unselected.
