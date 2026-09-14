# Verified tutor policy and review hardening design

## Goal

Align tutor publication and public booking behavior with US1-1, US6-2, and the RBAC contract while
closing the remaining review findings around booking validation, list pagination, and registration
account enumeration.

## Tutor eligibility

- A public tutor must have verification status `VERIFIED` and an active, non-deleted user with role
  `TUTOR`.
- The shared allowlist is reused by publishing, public search, public tutor detail, public
  availability, booking quote, and booking creation.
- `PENDING` and `REJECTED` tutors may create and edit draft listings but receive `403` when they try
  to publish.
- Public response types expose only the `VERIFIED` status. Unexpected rows fail closed and are
  logged rather than relabeled.

## Booking validation and pagination

- Quote and create use the same validation routine for student eligibility, slot state, active
  bookings, listing state and ownership, tutor eligibility, and server-authoritative amounts.
- Create keeps its row lock and database conflict mapping; quote remains read-only.
- Student and tutor booking lists accept one-based `page` and bounded `pageSize` parameters. The
  default page size is 20 and the maximum is 100. `total` remains the count before pagination.
- The student booking page provides previous/next controls; dashboard summaries request the maximum
  bounded page until dedicated aggregate endpoints exist.

## Registration privacy

- New and existing non-deleted emails return the same `201` status and generic message.
- Existing accounts are not changed and their verification tokens are not rotated by registration.
- A concurrent unique-email race returns the same generic result.
- Invalid input, email-provider failure for a newly created account, and rate limiting remain
  distinguishable operational errors.
