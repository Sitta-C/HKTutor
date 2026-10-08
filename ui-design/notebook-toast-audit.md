# NotebookToast action audit

The user requested an audit and completion of success/error NotebookToast feedback for both
Student and Tutor on 2026-10-07. Reuse the existing taped paper, green check/red cross, bilingual
messages, live announcements, two-second duration and reduced-motion behavior.

| Action                                         | Before audit                                | Current behavior                                                                                                   |
| ---------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Sign in                                        | Inline failure only                         | Success after login, error after rejection; original alert and return link remain                                  |
| Register Student/Tutor                         | Inline failure or verification-page handoff | Created-account success, rejection error, truthful partial-delivery error on the existing 503 handoff              |
| Verify email / resend verification             | Verification-page messages only             | Success/error once per attempt, with the existing token guard and tab handoff                                      |
| Sign out from shared shell / onboarding header | No toast; shell rejection was unhandled     | Success after completion, server-confirmation error on rejection; existing local cleanup and redirects remain      |
| Save Student/Tutor profile                     | Edit success only                           | Success for edit and onboarding; failed saves and custom field-validation errors also notify                       |
| Accept updated privacy notice                  | Inline failure only                         | Success after acceptance is confirmed by the existing reload; failure and missing-consent errors notify            |
| Upload/replace/remove profile photo            | Persistent inline notices/errors only       | Matching success/error toast, preserving the saved photo, unsaved profile fields and existing inline help          |
| Create/edit/publish/restore from course editor | Existing mutation toasts                    | Retain them; add a summary toast when custom field validation blocks submission                                    |
| Publish/archive/restore from course ledger     | Inline errors; no success toast             | Operation-specific success and error toasts, preserving confirmation, retry and returned course state              |
| Add teaching availability                      | Success and general-error toasts            | Also notify for overlap and custom validation errors while retaining selected endpoints                            |
| Delete teaching availability                   | Existing success/error toasts               | Retained, including reserved-slot conflicts and time/state guards                                                  |
| Send student lesson request                    | Inline success/error docket only            | Sent-request success and API-error toast; pending means awaiting confirmation, with the same docket/recovery links |

Notifications are emitted from the existing action handlers after their outcome, never from a
generic API interceptor. Navigation, selection, filtering, pagination, search results, initial loads,
background refreshes and photo-URL renewal keep their existing local feedback. Native required-field
validation retains the browser's field feedback. No read is added to populate a toast, and no request,
payload, authentication decision, price calculation or business action changes.
Verification responses read the current translation through a ref, so initial English hydration
cannot leave Thai users with English outcome messages. The original one-attempt token guard remains.

The toast viewport portals into the most recently opened native dialog while one is open, then
returns to the body on close/unmount. This puts confirmation failures in the native top layer,
where a normal body z-index cannot reach. Timers and the global provider survive these host changes
and normal client navigation. Decorative icons remain hidden from assistive technology; success
uses polite status and error uses an assertive alert. Persistent inline errors and recovery actions
remain available after the toast expires.

Browser tests intercept API traffic and check both roles/languages, profile and onboarding outcomes,
consent, login/logout, registration partial delivery, verification/resend, photo mutations and
validation, course actions, availability conflicts and booking duplicate-submit/auth recovery. They
also check one toast per outcome, retained data, expiry after navigation, reduced motion, mobile fit
and actual hit-testing above an open confirmation dialog. Existing auth-client unit tests retain
refresh/session-expiry coverage; no real service is mutated by these browser checks.

Validation completed: 145 web unit tests and 173 browser tests passed; one existing availability
touch-gesture test was skipped by the desktop browser project. Web lint, production build, repository
formatting and diff whitespace checks passed. Browser coverage includes 320px, 768px and 1440px modal
toast checks in Thai and English. API/database checks were outside this frontend-only change.
