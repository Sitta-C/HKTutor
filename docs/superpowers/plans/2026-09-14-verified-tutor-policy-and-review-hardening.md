# Verified tutor policy and review hardening implementation plan

1. Restrict the shared public tutor allowlist and public response types to `VERIFIED`.
2. Enforce the allowlist on publish, discovery, availability, quote, and create; update API and web
   copy and disable publish actions for unverified tutors.
3. Replace duplicate quote/create validation with one shared service routine while retaining the
   create transaction lock.
4. Add validated offset pagination to both booking-list endpoints and wire student list controls.
5. Return a generic registration response for both new and existing emails without mutating an
   existing account.
6. Update Swagger, QA evidence, demo guidance, workspace contracts, and unit tests.
7. Run formatting, API unit and end-to-end tests, web tests, workspace contracts, lint, and builds.
