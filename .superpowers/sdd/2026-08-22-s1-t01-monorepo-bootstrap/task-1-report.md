# Task 1 Report: Repository Contract Test

## Status

RED confirmed. The repository contract test fails because the approved workspace manifests and TypeScript configuration do not yet exist. No implementation files were created.

## Files changed

- `tests/workspace-structure.test.mjs` — added the S1-T01 Node repository contract test.
- `.superpowers/sdd/2026-08-22-s1-t01-monorepo-bootstrap/task-1-report.md` — this report.

## Test command

```text
node --test tests/workspace-structure.test.mjs
```

## Exit status

`1`

## Observed expected RED failure

All four tests failed because the workspace has not been bootstrapped yet:

- `defines the approved pnpm workspace`: `ENOENT: no such file or directory, open 'package.json'`
- `defines buildable web and API packages`: `ENOENT: no such file or directory, open 'apps/web/package.json'`
- `extends the shared strict TypeScript baseline`: `ENOENT: no such file or directory, open 'packages/tsconfig/base.json'`
- `does not pull later-sprint infrastructure into S1-T01`: `ENOENT: no such file or directory, open 'package.json'`

Summary: 4 tests, 0 passed, 4 failed, exit status 1.

## Commit

`839f961ea3e63becf9e97d34e1eee71b634c0b9b`

## Fix Report

### Files changed

- `tests/workspace-structure.test.mjs` — require exact `pnpm@11.19.0` and reject Docker tooling plus `bee-queue` and `amqplib` dependencies, retaining the original prohibited infrastructure checks.
- `.superpowers/sdd/2026-08-22-s1-t01-monorepo-bootstrap/task-1-report.md` — appended this fix report.

### Verification

Command: `node --test tests/workspace-structure.test.mjs`

Exit status: `1`

Observed output: 4 tests failed, 0 passed. Failures remain RED solely because the workspace files are absent: `package.json`, `apps/web/package.json`, and `packages/tsconfig/base.json` each report `ENOENT: no such file or directory`. No assertion failure was reached.
