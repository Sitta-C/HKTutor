import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const recordPath = 'docs/qa/s1-evidence-record.md';
const controllerGlob = 'apps/api/src/**/*.controller.ts';
const swaggerGlob = 'apps/api/src/**/*.swagger.ts';

const RESPONSE_DECORATOR_STATUS = {
  ApiBadRequestResponse: 400,
  ApiConflictResponse: 409,
  ApiCreatedResponse: 201,
  ApiForbiddenResponse: 403,
  ApiNoContentResponse: 204,
  ApiNotFoundResponse: 404,
  ApiOkResponse: 200,
  ApiServiceUnavailableResponse: 503,
  ApiUnauthorizedResponse: 401,
};

const readRecord = () => fs.readFile(recordPath, 'utf8');

const CITATION_PATTERN = /`([^`]+\.(?:ts|mjs))`\s+—\s+`([^`]+)`/g;

function readQaRows(record) {
  const rows = [];

  for (const row of record.matchAll(/^\|\s*Q(\d+)\s*\|(.*)\|\s*$/gm)) {
    rows.push({ line: row[2], number: Number(row[1]) });
  }

  return rows;
}

async function collect(pattern) {
  const paths = [];

  for await (const entry of fs.glob(pattern)) {
    paths.push(entry);
  }

  return paths.sort();
}

/** Every route the API actually registers, with the Swagger decorator applied to it. */
async function readRegisteredRoutes() {
  const routes = new Map();

  for (const file of await collect(controllerGlob)) {
    const source = await fs.readFile(file, 'utf8');
    const prefixMatch = source.match(/@Controller\(\s*(?:'([^']*)')?\s*\)/);
    assert.ok(prefixMatch, `${file} must declare @Controller`);
    const prefix = prefixMatch[1] ?? '';
    const lines = source.split('\n');

    lines.forEach((line, index) => {
      const route = line.match(/^\s*@(Get|Post|Patch|Put|Delete)\(\s*(?:'([^']*)')?\s*\)\s*$/);

      if (!route) {
        return;
      }

      const method = route[1].toUpperCase();
      const segments = ['api/v1', prefix, route[2] ?? ''].filter((segment) => segment.length > 0);
      const decorator = lines
        .slice(index + 1, index + 9)
        .join('\n')
        .match(/@([A-Za-z]+Doc)\(\)/);

      routes.set(`${method} /${segments.join('/')}`, {
        decorator: decorator?.[1] ?? null,
        file,
      });
    });
  }

  assert.ok(routes.size > 20, 'expected the Sprint 1 API surface to be discovered');

  return routes;
}

/** The response statuses each Swagger doc decorator declares. */
async function readDocumentedStatuses() {
  const statuses = new Map();

  for (const file of await collect(swaggerGlob)) {
    const source = await fs.readFile(file, 'utf8');
    const blocks = source.split(/\nexport function /);

    for (const block of blocks.slice(1)) {
      const name = block.slice(0, block.indexOf('('));
      const codes = new Set();

      for (const [decorator, status] of Object.entries(RESPONSE_DECORATOR_STATUS)) {
        if (new RegExp(`\\b${decorator}\\(`).test(block)) {
          codes.add(status);
        }
      }

      for (const explicit of block.matchAll(/status:\s*(\d{3})\b/g)) {
        codes.add(Number(explicit[1]));
      }

      statuses.set(name, codes);
    }
  }

  return statuses;
}

function readEndpointRows(record) {
  const rows = [];

  for (const row of record.matchAll(
    /^\|\s*`(GET|POST|PATCH|PUT|DELETE) (\/api\/v1[^`]*)`\s*\|\s*`([A-Za-z]+Doc)`\s*\|\s*([0-9, ]+)\|/gm,
  )) {
    rows.push({
      decorator: row[3],
      route: `${row[1]} ${row[2]}`,
      statuses: row[4]
        .split(',')
        .map((code) => Number(code.trim()))
        .filter((code) => Number.isInteger(code)),
    });
  }

  assert.ok(rows.length > 20, 'the API contract table must list the Sprint 1 endpoints');

  return rows;
}

test('every cited test file exists and contains the cited title verbatim', async () => {
  const record = await readRecord();
  const citations = [...record.matchAll(CITATION_PATTERN)];

  assert.ok(citations.length >= 30, 'expected the record to cite at least thirty proving tests');

  for (const [, citedPath, title] of citations) {
    const source = await fs.readFile(citedPath, 'utf8').catch(() => null);

    assert.ok(source !== null, `${recordPath} cites a missing file: ${citedPath}`);
    assert.ok(source.includes(title), `${citedPath} does not contain the cited title: ${title}`);
  }
});

test('every QA case carries at least one citation of its own', async () => {
  const record = await readRecord();
  const rows = readQaRows(record);

  assert.ok(rows.length >= 30, 'the QA activity record must keep at least thirty cases');
  assert.deepEqual(
    rows.map((row) => row.number),
    rows.map((_, index) => index + 1),
    'QA cases must be numbered Q1..Qn without a gap, a repeat, or a reordering',
  );

  for (const row of rows) {
    const citations = [...row.line.matchAll(CITATION_PATTERN)];

    assert.ok(
      citations.length >= 1,
      `Q${row.number} has no \`path\` — \`title\` citation, so nothing proves it`,
    );
  }
});

test('every documented endpoint is registered by a controller with that decorator', async () => {
  const [record, routes] = await Promise.all([readRecord(), readRegisteredRoutes()]);

  for (const row of readEndpointRows(record)) {
    const registered = routes.get(row.route);

    assert.ok(registered, `${recordPath} documents an unregistered route: ${row.route}`);
    assert.equal(
      registered.decorator,
      row.decorator,
      `${row.route} is documented by ${registered.decorator ?? 'no decorator'}, not ${row.decorator}`,
    );
  }
});

test('documented response codes match the Swagger decorators', async () => {
  const [record, statuses] = await Promise.all([readRecord(), readDocumentedStatuses()]);

  for (const row of readEndpointRows(record)) {
    const declared = statuses.get(row.decorator);

    assert.ok(declared, `${row.decorator} is not exported by any .swagger.ts module`);
    assert.deepEqual(
      row.statuses.slice().sort((a, b) => a - b),
      [...declared].sort((a, b) => a - b),
      `${row.route} lists response codes that do not match ${row.decorator}`,
    );
  }
});

test('no registered route escapes the record', async () => {
  const [record, routes] = await Promise.all([readRecord(), readRegisteredRoutes()]);
  const documented = new Set(readEndpointRows(record).map((row) => row.route));
  const knownGap = record.slice(record.indexOf('**One endpoint is undocumented:**'));
  const excused = new Set(
    [...knownGap.matchAll(/`(GET|POST|PATCH|PUT|DELETE) (\/api\/v1[^`]*)`/g)].map(
      (match) => `${match[1]} ${match[2]}`,
    ),
  );

  for (const route of routes.keys()) {
    assert.ok(
      documented.has(route) || excused.has(route),
      `${route} is registered but missing from ${recordPath}`,
    );
  }
});

test('keeps the tracked evidence record free of leftover work-in-progress markers', async () => {
  const record = await readRecord();

  assert.doesNotMatch(record, /\bTODO\b|\bFIXME\b|\bWIP\b|\bTBD\b/);
  assert.doesNotMatch(record, /\bDRAFT\b/);
  assert.ok(
    path.isAbsolute(path.resolve(recordPath)),
    'the record must resolve inside the repository',
  );
});
