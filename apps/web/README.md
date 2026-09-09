# HKTutor web

This is the HKTutor Next.js client. The repository root [README](../../README.md) is the authoritative guide for installation, workspace commands, and development checks.

From the repository root, run `pnpm --filter @hktutor/web dev` to start the web application on [http://localhost:3000](http://localhost:3000).

Browser API requests use the same-origin `/api/v1` path. In development, Next.js rewrites that path
to `API_INTERNAL_URL` (default `http://localhost:3001`); the Compose gateway routes it directly to
the API service in production-style runs.
