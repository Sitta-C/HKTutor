import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const traceabilityDoc = 'docs/qa/S1-T27-negative-path-evidence.md';
const read = (filePath) => fs.readFile(filePath, 'utf8');

async function readDoc() {
  return read(traceabilityDoc);
}

/**
 * Parses the "Evidence: status code -> proving test" table into one record per row,
 * keeping status, case, and proving-test citations tied together — a swapped status on
 * one row (or a case with no citations) fails structurally, not just "somewhere in the
 * doc, both a 401 and this case text exist independently".
 */
function parseEvidenceRows(doc) {
  const rows = [];
  for (const line of doc.split(/\r?\n/)) {
    const cells = line.match(/^\|(.+)\|$/);
    if (!cells) continue;
    const [status, caseText, provingTest] = cells[1].split('|').map((cell) => cell.trim());
    if (!status?.startsWith('`') || status.includes('---')) continue;

    const citations = [...provingTest.matchAll(/`([\w./-]+\.tsx?)`\s*—\s*`([^`]+)`/g)].map(
      ([, path, title]) => ({ path, title }),
    );

    rows.push({ status, caseText, provingTest, citations });
  }
  return rows;
}

test('parses the evidence table into status/case/citation rows', async () => {
  const doc = await readDoc();
  const rows = parseEvidenceRows(doc);

  assert.ok(rows.length >= 12, `expected at least 12 evidence rows, found ${rows.length}`);
  for (const row of rows) {
    assert.ok(
      row.citations.length > 0,
      `row "${row.caseText}" (status ${row.status}) cites no \`path\` — \`title\` pairs`,
    );
  }
});

test('every cited status is one of the four this task covers', async () => {
  const doc = await readDoc();
  const rows = parseEvidenceRows(doc);
  const statusesSeen = new Set(rows.flatMap((row) => row.status.match(/`(\d{3})`/g) ?? []));

  for (const status of ['`401`', '`403`', '`404`', '`409`']) {
    assert.ok(statusesSeen.has(status), `no evidence row is tagged with status ${status}`);
  }

  assert.match(doc, /S1-T13/);
  assert.match(doc, /S1-T24/);
  assert.match(
    doc,
    /- \*\*User Story:\*\* US11-3/,
    'the Sprint 1 backlog maps S1-T27 to US11-3; the doc must cite that story',
  );
});

test('every citation points at a path that exists and a title that appears in that exact file', async () => {
  const doc = await readDoc();
  const rows = parseEvidenceRows(doc);
  const fileCache = new Map();
  const readCached = async (path) => {
    if (!fileCache.has(path)) fileCache.set(path, await read(path).catch(() => null));
    return fileCache.get(path);
  };

  for (const row of rows) {
    for (const { path, title } of row.citations) {
      const contents = await readCached(path);
      assert.ok(
        contents !== null,
        `row "${row.caseText}" cites a path that does not exist: ${path}`,
      );
      assert.ok(
        contents.includes(title),
        `row "${row.caseText}" quotes "${title}" as living in ${path}, but that exact text does not appear there`,
      );
    }
  }

  const requiredFiles = [
    'apps/api/test/unit/auth/auth.guard.spec.ts',
    'apps/api/test/unit/auth/jwt.service.spec.ts',
    'apps/api/test/unit/auth/auth.service.spec.ts',
    'apps/api/test/unit/auth/roles.guard.spec.ts',
    'apps/api/test/unit/auth/ownership.guard.spec.ts',
    'apps/api/test/auth-authorization.e2e-spec.ts',
    'apps/api/src/scripts/verify-booking-endpoint-concurrency.ts',
  ];
  const citedFiles = new Set(rows.flatMap((row) => row.citations.map((c) => c.path)));
  for (const requiredFile of requiredFiles) {
    assert.ok(citedFiles.has(requiredFile), `no evidence row cites ${requiredFile}`);
  }
});

test('flags a swapped status the same way a reviewer would', async () => {
  // Regression check for the parser itself: swapping two rows' status columns while
  // keeping their case/citations intact must change which status each case maps to.
  const doc = await readDoc();
  const rows = parseEvidenceRows(doc);
  const byCase = new Map(rows.map((row) => [row.caseText, row.status]));

  assert.equal(
    byCase.get('Unverified user on any authenticated route'),
    '`401`',
    'this case is proven by a test that throws UnauthorizedException, not ForbiddenException',
  );
  assert.equal(
    byCase.get('Failed booking (missing listing/slot) leaves no row'),
    '`404`',
    'this case is proven by a script assertion on response.status === 404, not 409',
  );
});

test('keeps the tracked traceability doc free of leftover work-in-progress markers', async () => {
  const doc = await readDoc();

  assert.doesNotMatch(doc, /\bTODO\b|\bFIXME\b|\bWIP\b|reviewed through/i);
  assert.match(doc, /Evidence \/ Done output/);
});
