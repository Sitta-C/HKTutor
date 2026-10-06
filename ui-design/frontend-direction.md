# HKTutor frontend direction — Notebook Focus

Updated 2026-10-06. This records the user's design decisions from the dashboard and public-page
redesign conversation. Read it before proposing or implementing UI changes, including in a new chat.
The user's current request takes precedence. Follow the implemented components for exact behavior;
older prototypes remain references, not instructions to restore superseded layouts.

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

## Information and actions

- A dashboard should help the tutor understand teaching activity and pending work. Remove shortcut
  collections and repeated CTAs when they only duplicate the sidebar or another visible action.
- Make the primary action clear. Display-only statistics should look like information, and an
  actual action should look operable. Do not add hover lift or button styling to passive summaries.
- Keep one necessary registration/login CTA in public headers. Password recovery is a small
  accent text link beside the password label, not a large pink assistance banner. Pink paper can
  support an actual error state. The current recovery link explains that reset is not supported.
- Keep the “Why HKTutor?” navigation in the about page's top section; repeated clicks must scroll
  to its target again. Do not restore the removed duplicate CTA.

## Selected patterns

| Area                         | User-selected direction                                                                                                                                       | Implementation reference                                                                |
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
   commits focused; the user's established workflow is commit locally without pushing unless asked.

## References and unselected proposals

- Existing source and this guide are the portable reference for new chats.
- The original **Notebook Focus** exploration is in
  `/Users/1st/Documents/HKTutor/Documents/dashboard-redesign`. This local folder is optional when
  unavailable in another checkout; it contains illustrative data and proposed interactions.
- `ui-design/uidesign.md` supplies page/data mapping and historical prototypes. Use this newer guide
  and current source for the visual direction when older descriptions conflict.
- **Global confirmation component is still a proposal**, not an approved global implementation.
  Paper Dialog, Sticky Memo, Binder Notice, and Decision Sheet were previewed; no explicit design
  choice has been given. The existing availability delete dialog remains its own implemented flow.
- `/dashboard/listings` uses the approved **Course Ledger** design, selected on 2026-10-06.
  Keep the existing course-management search, publication filters, editing links, publication,
  archive confirmation, and restoration. Published badges are blue, drafts warm, and archived
  badges neutral; archived courses remain editable. Loading/error counts are unavailable rather
  than zero. On mobile, use the existing native status select and wrap actions within each row.
  Do not add analytics or course-performance selectors to this page. Course Slips and Margin Notes
  remain unselected alternatives.
