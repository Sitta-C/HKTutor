# S1-T19 Bangkok availability design

## Goal

Give tutors a simple weekly availability view and form that always presents dates and times in
Asia/Bangkok while the API contract continues to use UTC ISO timestamps.

## Product requirements

- Show open and reserved slots grouped by their Bangkok calendar date.
- Summarize open slots, reserved slots, teaching hours, and the active time zone for the displayed
  week.
- Navigate by Bangkok weeks and let **Today** return to the actual Bangkok date and its week.
- Create one future time range at a time. Adjacent ranges are valid; overlapping ranges surface an
  understandable conflict.
- Delete open slots and explain why a reserved slot cannot be deleted.
- Keep the page usable when profile display-name loading fails by falling back to the authenticated
  user identity.

## Time-zone contract

- Date and time inputs are interpreted as Asia/Bangkok (UTC+7) and converted to UTC before POST.
- API query ranges use Bangkok Monday 00:00 through the following Monday 00:00, expressed in UTC.
- Returned UTC timestamps are formatted in Asia/Bangkok for the weekly view.
- The storage preview includes both UTC dates and times so a Bangkok date-boundary conversion is
  explicit.
- English presentation uses the Gregorian calendar and Thai presentation uses the Buddhist
  calendar. Both map to the same Gregorian ISO date value sent to the API.

## UI and accessibility

The production layout follows `ui-design/pages/availability.html` and uses dashboard design tokens
from `apps/web/src/app/globals.css`. The localized date picker exposes a dialog/grid structure,
Monday-first weeks, roving keyboard focus, month navigation, and a hidden Gregorian ISO value.
Loading and error states inside the dashboard are inline regions, not nested `main` landmarks.
Errors use alert semantics, success/loading messages use status semantics, and a failed
availability request exposes a retry action.

## Out of scope

Calendar drag-and-drop, recurring schedules, editing an existing slot, and booking cancellation are
not part of S1-T19.
