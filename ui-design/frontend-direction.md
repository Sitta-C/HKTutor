# HKTutor frontend direction — Notebook Focus

Updated 2026-10-06. This describes the implemented Notebook Focus direction and component
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

| Area                         | Implemented direction                                                                                                                                         | Implementation reference                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Tutor dashboard              | Notebook Focus; teaching overview, pending requests, analytics, and course performance                                                                        | `apps/web/src/components/dashboard/tutor-dashboard.tsx`                                 |
| Course management            | **Course Ledger**: one compact count strip, status tabs/search, and continuous ruled rows with a binding margin; grade above subject, rate/date/actions below | `apps/web/src/components/listings/tutor-listings-page.tsx` and its stylesheet           |
| Past requests                | Hidden by default; blue bookmark-note switch shows them; pale paper/perforated styling keeps past rows readable                                               | `apps/web/src/components/ui/bookmark-note-switch.tsx`, `notebook.module.css`            |
| Course performance selection | **Subject Index** with a subject directory and stable subcolors; show all courses of the selected subject without pagination                                  | `apps/web/src/components/ui/subject-course-index.tsx` and its stylesheet                |
| Course details               | One course expanded at a time, directly beneath the clicked row; clicking again collapses it, with a light height transition                                  | `apps/web/src/components/ui/subject-course-index.tsx`                                   |
| Month selection              | **Ruler Reel**, a compact single horizontal row with native scrolling/snap; preserve its original compact height                                              | `apps/web/src/components/date-time/month-ruler.tsx` and its stylesheet                  |
| Availability summary         | **Ledger Strip**: two counts in one ruled-paper surface; blue open-time icon, warm booked-time icon, a small timezone tag in the footer                       | `apps/web/src/components/availability/availability-summary.tsx` and its stylesheet      |
| Availability header          | No redundant “My courses” header button; course navigation remains in the existing shell                                                                      | `apps/web/src/components/availability/manage-tutor-availability.tsx`                    |
| Availability ranges          | Continuous notebook rows across dates, binding margin, compact status/delete controls, and explicit ended state                                               | `apps/web/src/components/availability/manage-tutor-availability.tsx` and its stylesheet |

The course selector evolved from Binder Drawer to Subject Index. Do not revert to the earlier
paginated drawer or nested-folder proposal just because an older preview shows it. Request-list
pagination is separate and remains in place; the no-pagination decision applies to course selection.

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
