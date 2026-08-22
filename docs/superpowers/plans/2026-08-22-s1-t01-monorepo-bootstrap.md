# S1-T01 Monorepo Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a reproducible pnpm monorepo in which the Next.js web app and NestJS API app install, lint, test, and build successfully.

**Architecture:** Keep web and API as independent workspace applications in one Git repository and one pnpm lockfile. Share only strict TypeScript compiler defaults through `packages/tsconfig`; keep framework-specific configuration within each app.

**Tech Stack:** Node.js 24.19.0, pnpm 11.19.0, TypeScript, Next.js App Router, React, NestJS, Jest, ESLint

**Spec:** `docs/superpowers/specs/2026-08-22-s1-t01-monorepo-design.md`

## Global Constraints

- Node.js is pinned to `24.19.0`.
- pnpm is pinned to `11.19.0` through the root `packageManager` field.
- Use pnpm workspaces without Turborepo or Nx.
- Web must not import source files from the API workspace.
- S1-T01 must not add Docker, Supabase, Prisma, authentication, Swagger, CI, or domain features.
- Completion requires `pnpm install --frozen-lockfile` and `pnpm check` to succeed.

---

### Task 1: Repository Contract Test

**Files:**
- Create: `tests/workspace-structure.test.mjs`

**Interfaces:**
- Consumes: the approved repository design.
- Produces: `node --test tests/workspace-structure.test.mjs`, the executable S1-T01 repository contract.

- [ ] **Step 1: Write the failing contract test**

Create a Node test that reads the root and workspace package manifests, asserts the expected package names and build scripts, verifies both app TypeScript configs extend `@hktutor/tsconfig/base.json`, and rejects Redis, queue, Socket.IO, Prisma, Supabase, and Docker dependencies from S1-T01.

```javascript
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const readJson = async (path) => JSON.parse(await fs.readFile(path, "utf8"));

test("defines the approved pnpm workspace", async () => {
  const root = await readJson("package.json");
  const workspace = await fs.readFile("pnpm-workspace.yaml", "utf8");
  assert.equal(root.private, true);
  assert.match(root.packageManager, /^pnpm@11\./);
  assert.match(workspace, /apps\/\*/);
  assert.match(workspace, /packages\/\*/);
  for (const script of ["dev", "build", "test", "lint", "check"]) {
    assert.equal(typeof root.scripts[script], "string");
  }
});

test("defines buildable web and API packages", async () => {
  const web = await readJson("apps/web/package.json");
  const api = await readJson("apps/api/package.json");
  assert.equal(web.name, "@hktutor/web");
  assert.equal(api.name, "@hktutor/api");
  assert.equal(typeof web.scripts.build, "string");
  assert.equal(typeof api.scripts.build, "string");
  assert.equal(web.devDependencies["@hktutor/tsconfig"], "workspace:*");
  assert.equal(api.devDependencies["@hktutor/tsconfig"], "workspace:*");
});

test("extends the shared strict TypeScript baseline", async () => {
  const shared = await readJson("packages/tsconfig/base.json");
  const web = await readJson("apps/web/tsconfig.json");
  const api = await readJson("apps/api/tsconfig.json");
  assert.equal(shared.compilerOptions.strict, true);
  assert.equal(web.extends, "@hktutor/tsconfig/base.json");
  assert.equal(api.extends, "@hktutor/tsconfig/base.json");
});

test("does not pull later-sprint infrastructure into S1-T01", async () => {
  const manifests = await Promise.all([
    readJson("package.json"),
    readJson("apps/web/package.json"),
    readJson("apps/api/package.json"),
  ]);
  const forbidden = /redis|bullmq|socket\.io|prisma|supabase/i;
  for (const manifest of manifests) {
    const names = Object.keys({
      ...manifest.dependencies,
      ...manifest.devDependencies,
    });
    assert.equal(names.some((name) => forbidden.test(name)), false);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/workspace-structure.test.mjs`

Expected: FAIL because root `package.json` and the workspaces do not exist.

### Task 2: Framework Scaffolds and Workspace Configuration

**Files:**
- Create: `apps/web/**`
- Create: `apps/api/**`
- Create: `packages/tsconfig/package.json`
- Create: `packages/tsconfig/base.json`
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `.node-version`
- Create: `.editorconfig`
- Create: `.gitignore`

**Interfaces:**
- Consumes: the repository contract from Task 1.
- Produces: workspace packages named `@hktutor/web`, `@hktutor/api`, and `@hktutor/tsconfig` plus root `dev`, `build`, `test`, `lint`, `verify:workspace`, and `check` commands.

- [ ] **Step 1: Generate framework source without installing dependencies**

Run:

```bash
pnpm dlx create-next-app@latest apps/web --typescript --eslint --app --src-dir --import-alias '@/*' --no-tailwind --use-pnpm --skip-install --yes
pnpm dlx @nestjs/cli@latest new apps/api --package-manager pnpm --language ts --skip-git --skip-install --strict
```

- [ ] **Step 2: Add the root workspace and shared TypeScript package**

Create the root manifest with pnpm workspace scripts, pin Node/pnpm versions, and add `packages/tsconfig/base.json` with `strict`, `skipLibCheck`, `forceConsistentCasingInFileNames`, `noUncheckedIndexedAccess`, and `resolveJsonModule` enabled.

```json
{
  "name": "hktutor",
  "private": true,
  "packageManager": "pnpm@11.19.0",
  "engines": { "node": "24.19.0" },
  "scripts": {
    "dev": "pnpm --parallel --filter @hktutor/web --filter @hktutor/api dev",
    "build": "pnpm -r --if-present build",
    "test": "pnpm -r --if-present test",
    "lint": "pnpm -r --if-present lint",
    "verify:workspace": "node --test tests/workspace-structure.test.mjs",
    "check": "pnpm verify:workspace && pnpm lint && pnpm test && pnpm build"
  }
}
```

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

```json
{
  "compilerOptions": {
    "strict": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noUncheckedIndexedAccess": true,
    "resolveJsonModule": true
  }
}
```

- [ ] **Step 3: Connect app TypeScript configs to the shared package**

Rename the app packages to `@hktutor/web` and `@hktutor/api`, add `@hktutor/tsconfig: workspace:*` as a development dependency in each app, and extend `@hktutor/tsconfig/base.json` from both app TypeScript configurations without removing framework-specific compiler options.

- [ ] **Step 4: Run the contract test**

Run: `node --test tests/workspace-structure.test.mjs`

Expected: PASS.

### Task 3: Reproducible Install and Developer Documentation

**Files:**
- Create: `pnpm-lock.yaml`
- Create: `README.md`
- Modify: framework manifests only if pnpm reports incompatible or duplicate workspace metadata.

**Interfaces:**
- Consumes: all workspace manifests from Task 2.
- Produces: a single committed lockfile and documented clean setup commands.

- [ ] **Step 1: Install the workspace**

Run: `pnpm install`

Expected: one root `pnpm-lock.yaml` and no nested lockfiles.

- [ ] **Step 2: Verify frozen installation**

Run: `pnpm install --frozen-lockfile`

Expected: exit 0 with the lockfile unchanged.

- [ ] **Step 3: Document setup and commands**

Document Node/pnpm prerequisites, `pnpm install --frozen-lockfile`, root commands, individual package filters, web/API local URLs, repository boundaries, and deferred Sprint tasks in `README.md`.

### Task 4: Full S1-T01 Verification

**Files:**
- Modify: only files required to fix failures exposed by verification.

**Interfaces:**
- Consumes: the complete workspace.
- Produces: evidence that both apps build and the API tests pass.

- [ ] **Step 1: Run the full quality gate**

Run: `pnpm check`

Expected: workspace contract PASS, lint PASS, NestJS tests PASS, Next.js build PASS, NestJS build PASS.

- [ ] **Step 2: Confirm repository scope**

Run: `git status --short` and inspect `git diff --check`.

Expected: only S1-T01 source/configuration, approved documentation, and the root lockfile are candidates for the initial commit; `.DS_Store`, the workbook containing team member names and student IDs, build output, and `node_modules` are ignored.

- [ ] **Step 3: Create the initial commit**

Run:

```bash
git add .
git commit -m "chore: bootstrap HKTutor monorepo"
```

Expected: an initial commit on `main` with the verified S1-T01 workspace.
