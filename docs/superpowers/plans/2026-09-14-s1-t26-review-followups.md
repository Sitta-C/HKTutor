# S1-T26 review follow-ups implementation plan

## Implementation

1. Restore conflict behavior for repeated registration and preserve access to the verification page
   from the registration UI.
2. Extract the tutor allowlist and public-status guard into a shared API module.
3. Apply the allowlist to publish, discovery, availability, booking, and quote queries.
4. Filter and log invalid public-search rows while returning not found for an invalid detail record.
5. Make historical booking nicknames nullable in the DTO and client type, then localize the web
   fallback.
6. Update Swagger descriptions, QA evidence, and regression tests while keeping the evidence-table
   diff limited to the two changed cases.

## Verification

- Run API lint, unit tests, end-to-end tests, and production build.
- Run web lint, unit tests, and production build.
- Run the S1-T26 integration, evidence-traceability, and dashboard localization contracts.
- Run the complete workspace CI check and concurrent PostgreSQL booking verification.
