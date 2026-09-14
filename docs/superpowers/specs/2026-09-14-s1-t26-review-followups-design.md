# S1-T26 review follow-ups design

## Goal

Close the authentication and tutor-access gaps identified after S1-T26 was merged without changing
the intended product decision that pending and verified tutors may participate in the walking
skeleton.

## Authentication contract

- Repeated registration for any existing non-deleted email returns a conflict and never changes the
  stored password, role, consent, policy version, or verification tokens.
- The registration page routes a conflict to the existing verification page so the user can use the
  dedicated resend action and its stricter throttle.
- Verification resend continues to use a generic response so it does not disclose account state.

## Tutor eligibility contract

- One shared allowlist defines an eligible tutor as pending or verified with an active, non-deleted
  tutor account.
- Publishing, public discovery, public availability, booking creation, and booking quotes all use
  that allowlist.
- Public search skips and logs an unexpected tutor status per row so one invalid record cannot turn
  the complete search request into a server error.
- Public tutor detail hides an unexpected status behind the existing not-found response.

## Historical booking presentation

Student profiles can be removed after a booking was created. The API therefore returns a nullable
student nickname, and the web dashboard supplies localized English and Thai fallback text.

## Out of scope

Changing the pending-tutor product rule and redesigning verification-token invalidation are separate
team decisions. The latter is tracked as Sprint 2 follow-up work.
