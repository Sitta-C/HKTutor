# Sprint 1 Evidence Record (S1-T28 — DRAFT)

**Owner:** Kin · **Task:** S1-T28 · **Depends on:** S1-T26 (integration), S1-T27 (authorization and
double-booking test run)

**Status:** DRAFT skeleton. The structure, the task/owner rows, and the Swagger checklist are
final; result columns stay empty until the work they describe is merged. Fill rows as tasks land
rather than in one pass at the end of the sprint.

## 1. Swagger / API contract checklist

One row per Sprint 1 endpoint. "Documented" means the operation, its parameters, its success
response with an example payload, and its documented error responses all appear at
`http://localhost:3001/api/docs`, and that a malformed request returns a documented 400 rather than
a 500.

| Endpoint                                    | Task           | Documented       | Example payload | Error responses       | Checked by / date |
| ------------------------------------------- | -------------- | ---------------- | --------------- | --------------------- | ----------------- |
| `GET /health`                               | S1-T05         | yes              | yes             | n/a                   | —                 |
| `GET /tutors`                               | S1-T05, S1-T21 | boilerplate only |                 | 400                   |                   |
| `POST /onboarding`                          | S1-T12         |                  |                 | 400 / 401 / 403       |                   |
| `POST /tutors/me/profile`, `PATCH`, publish | S1-T15         |                  |                 | 400 / 401 / 403       |                   |
| `POST /availability`, `GET`, `DELETE`       | S1-T18         |                  |                 | 400 / 401 / 403 / 409 |                   |
| `POST /bookings`                            | S1-T24         |                  |                 | 400 / 401 / 403 / 409 |                   |
| `PATCH /bookings/:id` (confirm / reject)    | S1-T24         |                  |                 | 401 / 403 / 409       |                   |

Rule carried from the workbook: no session token, database URL, or service key ever appears in a
Swagger example, an error body, or a log line.

## 2. QA activity record

| #   | User story | Case                  | Steps                                                             | Expected                                                  | Actual | Result | Evidence |
| --- | ---------- | --------------------- | ----------------------------------------------------------------- | --------------------------------------------------------- | ------ | ------ | -------- |
| Q1  | US11-2     | Consent refused       | Submit registration with the notice unaccepted                    | Submission blocked, message shown, no request sent        |        |        |          |
| Q2  | US11-2     | Consent accepted      | Accept notice v2026-08-01 and onboard                             | Local User stores `consentAcceptedAt` and `policyVersion` |        |        | S1-T12   |
| Q3  | US11-1     | Invalid/expired token | Call a protected endpoint with a bad Clerk token                  | 401, nothing stored                                       |        |        | S1-T10   |
| Q4  | US11-1     | Idempotent onboarding | Submit onboarding twice for one Clerk identity                    | Existing Local User returned, no duplicate                |        |        | S1-T12   |
| Q5  | US11-3     | Cross-owner access    | Student requests another user's booking                           | 403/404 without private details                           |        |        | S1-T27   |
| Q6  | US11-3     | Admin-only route      | Student calls `/admin/verifications`                              | 403                                                       |        |        | S1-T27   |
| Q7  | US12-1     | Publish gate          | Unverified tutor publishes a listing                              | 403                                                       |        |        | S1-T15   |
| Q8  | US12-2     | Overlap rejection     | Create an overlapping availability slot                           | Rejected with a documented error                          |        |        | S1-T18   |
| Q9  | US1-1      | Filter match          | subject=Mathematics, grade=Grade 10, maxBudget=500, minRating=4.0 | Only published verified matches                           |        |        | S1-T21   |
| Q10 | US1-1      | No match              | subject=Physics, maxBudget=100                                    | Empty result and "No exact matches found"                 |        |        | S1-T22   |
| Q11 | US12-3     | Double booking        | Two students book one slot concurrently                           | One succeeds, one gets 409, no partial record             |        |        | S1-T27   |
| Q12 | US0-2      | Validation            | `GET /tutors?maxPrice=abc`                                        | Documented 400 validation details                         |        |        | S1-T05   |

## 3. Issue log

| ID  | Found in | Severity | Description | Owner | Status | Fix / PR |
| --- | -------- | -------- | ----------- | ----- | ------ | -------- |
| I1  |          |          |             |       |        |          |

Severity guide: blocker (demo cannot proceed), major (story unusable), minor (cosmetic or
documentation).

## 4. Contribution evidence

Rows are seeded from the Sprint 1 backlog owner columns. Fill commits/PRs and points at close.

| Member  | GitHub       | Sprint 1 tasks owned                           | PRs   | Status                      |
| ------- | ------------ | ---------------------------------------------- | ----- | --------------------------- |
| First   | wakesup1     | S1-T01, S1-T06, S1-T16                         |       |                             |
| Korpai  | 12pailnwza   | S1-T11, S1-T19, S1-T26                         |       |                             |
| Starter | starter2157  | S1-T07                                         |       |                             |
| It      | Sitta-C      | S1-T01–S1-T05, S1-T14, S1-T17, S1-T20, S1-T23  | #6–#9 | mostly Done                 |
| Kin     | Sherneys     | S1-T04, S1-T05, S1-T11, S1-T12, S1-T28, S1-T29 |       | T04/T05 Done, T11 in review |
| Model   | KModel212    | S1-T21, S1-T22, S1-T25                         |       |                             |
| Tonnam  | 789852tonnam | S1-T02, S1-T03, S1-T09, S1-T12, S1-T13         |       |                             |
| Jojo    | Jojo-Supawit | S1-T08, S1-T15, S1-T18                         |       |                             |
| P       | Peerapatwong | S1-T06, S1-T08, S1-T10, S1-T16                 |       |                             |
| Birdie  | IbirdieU     | S1-T24, S1-T27                                 |       |                             |

## 5. Definition of done for S1-T28

- [ ] Every endpoint row in section 1 is documented and checked by a second person.
- [ ] Every QA case in section 2 has an actual result and linked evidence.
- [ ] Every issue found during S1-T26/S1-T27 has an entry and an owner.
- [ ] Contribution table reconciles with the merged PR list.
