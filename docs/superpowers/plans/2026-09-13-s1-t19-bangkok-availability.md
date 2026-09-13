# S1-T19 Bangkok availability implementation plan

## Implementation

1. Keep the availability client contract limited to weekly list, create, and delete operations.
2. Add pure Bangkok date helpers for today, week boundaries, Gregorian ISO values, localized
   Gregorian/Buddhist display, and date-aware UTC previews.
3. Load each displayed week through one effect and invalidate that effect after same-week create or
   delete operations, preventing stale requests from overwriting another week.
4. Treat profile display-name lookup as optional shell enrichment rather than a prerequisite for
   availability.
5. Port the summary cards, weekly day/slot layout, form, localized accessible calendar, and reserved
   notice from the versioned UI prototype using shared dashboard tokens.
6. Keep English and Thai availability keys symmetric and use readable status and duration text.

## Verification

- Unit-test Bangkok date-boundary behavior, UTC conversion, Gregorian English/Buddhist Thai
  display, ISO calendar arithmetic, date-aware UTC formatting, and translation-key symmetry.
- Run the web lint suite, web unit tests, production build, and root workspace contract tests.
- Confirm the source contains no availability-specific hard-coded hex colors or nested `main`
  landmark.
