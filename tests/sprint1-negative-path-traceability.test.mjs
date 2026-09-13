import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const traceabilityDoc = 'docs/S1-T27-negative-path-evidence.md';
const read = (filePath) => fs.readFile(filePath, 'utf8');

async function readDoc() {
  return read(traceabilityDoc);
}

test('documents every S1-T27 evidence case', async () => {
  const doc = await readDoc();
  const cases = [
    'Missing bearer token',
    'Invalid signature',
    'Expired access token',
    'Expired refresh token',
    'Revoked session',
    'Refresh-token reuse',
    'Login before email verification',
    'Unverified user on any authenticated route',
    'Wrong role',
    "Not the resource owner, or resource doesn't exist",
    'Concurrent double-booking on the same slot',
    'Failed booking (missing listing/slot) leaves no row (rollback)',
  ];

  for (const negativePathCase of cases) {
    assert.match(
      doc,
      new RegExp(`\\|\\s*${negativePathCase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\|`),
      `traceability doc must map the "${negativePathCase}" case to a proving test`,
    );
  }

  for (const status of ['`401`', '`403`', '`404`', '`409`']) {
    assert.match(doc, new RegExp(status), `traceability doc must cover status ${status}`);
  }

  assert.match(doc, /S1-T13/);
  assert.match(doc, /S1-T24/);
  assert.match(
    doc,
    /- \*\*User Story:\*\* US11-3/,
    'the Sprint 1 backlog maps S1-T27 to US11-3; the doc must cite that story',
  );
});

test('cites only proving-test files that exist in the repository', async () => {
  const doc = await readDoc();
  const citedTests = [
    ...new Set(doc.match(/apps\/api\/(?:test|src)\/[\w./-]+\.(?:tsx|ts)/g) ?? []),
  ];

  assert.ok(citedTests.length > 0, 'the doc should cite at least one proving-test path');

  for (const citedTest of citedTests) {
    await fs.access(citedTest).catch(() => {
      assert.fail(`traceability doc cites a path that does not exist: ${citedTest}`);
    });
  }

  for (const requiredTest of [
    'apps/api/test/unit/auth/auth.guard.spec.ts',
    'apps/api/test/unit/auth/jwt.service.spec.ts',
    'apps/api/test/unit/auth/auth.service.spec.ts',
    'apps/api/test/unit/auth/roles.guard.spec.ts',
    'apps/api/test/unit/auth/ownership.guard.spec.ts',
    'apps/api/test/auth-authorization.e2e-spec.ts',
    'apps/api/src/scripts/verify-booking-endpoint-concurrency.ts',
  ]) {
    assert.ok(
      citedTests.includes(requiredTest),
      `traceability doc must cite the proving test ${requiredTest}`,
    );
  }
});

test('names real test cases that still exist in the cited proving tests', async () => {
  const doc = await readDoc();
  const namedCases = [...(doc.match(/`([a-z][^`]{10,120})`/g) ?? [])]
    .map((match) => match.slice(1, -1))
    .filter((text) => /^(rejects|revokes|returns)\b/.test(text));

  assert.ok(namedCases.length > 0, 'the doc should quote specific test-case names, not just files');

  const authGuardSpec = await read('apps/api/test/unit/auth/auth.guard.spec.ts');
  const authServiceSpec = await read('apps/api/test/unit/auth/auth.service.spec.ts');
  const jwtServiceSpec = await read('apps/api/test/unit/auth/jwt.service.spec.ts');
  const rolesGuardSpec = await read('apps/api/test/unit/auth/roles.guard.spec.ts');
  const ownershipGuardSpec = await read('apps/api/test/unit/auth/ownership.guard.spec.ts');
  const authorizationE2e = await read('apps/api/test/auth-authorization.e2e-spec.ts');
  const concurrencyScript = await read(
    'apps/api/src/scripts/verify-booking-endpoint-concurrency.ts',
  );
  const haystack = [
    authGuardSpec,
    authServiceSpec,
    jwtServiceSpec,
    rolesGuardSpec,
    ownershipGuardSpec,
    authorizationE2e,
    concurrencyScript,
  ].join('\n');

  for (const namedCase of namedCases) {
    assert.ok(
      haystack.includes(namedCase),
      `traceability doc quotes "${namedCase}", which no longer appears in any cited test file`,
    );
  }
});

test('keeps tracked traceability docs free of personal work state', async () => {
  const doc = await readDoc();

  assert.doesNotMatch(doc, /Tonnam|First\/P|Korpai|reviewed through/);
  assert.match(doc, /Evidence \/ Done output/);
});
