import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const traceabilityDoc = 'docs/S1-T33-profile-traceability.md';
const read = (filePath) => fs.readFile(filePath, 'utf8');

async function readDoc() {
  return read(traceabilityDoc);
}

test('documents every S1-T33 evidence item', async () => {
  const doc = await readDoc();
  const evidenceItems = [
    'create',
    'update',
    'validation',
    'access',
    'consent',
    'privacy',
    'redirects',
    'migration',
  ];

  for (const item of evidenceItems) {
    assert.match(
      doc,
      new RegExp(`\\|\\s*${item}\\s*\\|`, 'i'),
      `traceability doc must map the "${item}" evidence item to a proving test`,
    );
  }
  assert.match(doc, /S1-T31/);
  assert.match(doc, /S1-T32/);
});

test('cites only test files that exist in the repository', async () => {
  const doc = await readDoc();
  const citedPaths = [
    ...new Set([
      ...(doc.match(/(?:apps|packages)\/[\w./-]+\.(?:tsx|ts)/g) ?? []),
      ...(doc.match(/tests\/[\w./-]+\.mjs/g) ?? []),
    ]),
  ];

  assert.ok(citedPaths.length >= 6, 'the doc must cite the proving test files');
  for (const citedPath of citedPaths) {
    await fs.access(citedPath).catch(() => {
      assert.fail(`traceability doc cites a path that does not exist: ${citedPath}`);
    });
  }
});

test('names the tests that prove the redirect decisions', async () => {
  const doc = await readDoc();
  const dashboard = await read('apps/web/src/app/dashboard/page.tsx');
  const editor = await read('apps/web/src/components/profile/profile-editor.tsx');
  const helper = await read('apps/web/src/lib/profile-navigation.ts');

  assert.match(helper, /export function resolveDashboardGate/);
  assert.match(helper, /export function resolveOnboardingHandoff/);
  assert.match(
    dashboard,
    /resolveDashboardGate\(/,
    'the dashboard must gate on the extracted redirect decision',
  );
  assert.match(
    editor,
    /resolveDashboardGate\(/,
    'the onboarding page must hand off through the extracted redirect decision',
  );
  assert.match(
    editor,
    /resolveOnboardingHandoff\(/,
    'the post-consent hand-off must use the extracted redirect decision',
  );
  assert.match(doc, /apps\/web\/test\/profile-navigation\.test\.ts/);
});

test('keeps tracked traceability docs free of personal work state', async () => {
  const doc = await readDoc();

  assert.doesNotMatch(doc, /Tonnam|First\/P|Korpai|reviewed through/);
  assert.match(doc, /Evidence \/ Done output/);
});
