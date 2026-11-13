import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import test from 'node:test';

/**
 * S3-T38: user-written text (chat messages, review feedback, tutor names and bios) reaches the web
 * client as plain JSON strings and is rendered only through React text nodes, which escape it.
 * This contract fails if any web source introduces a raw-HTML or dynamic-code sink.
 */
const WEB_SOURCE = join(process.cwd(), 'apps/web/src');
const SINKS = [
  ['dangerouslySetInnerHTML', /dangerouslySetInnerHTML/],
  ['innerHTML/outerHTML assignment', /\.(?:inner|outer)HTML\s*=/],
  ['insertAdjacentHTML', /\.insertAdjacentHTML\s*\(/],
  ['document.write', /\bdocument\.write(?:ln)?\s*\(/],
  ['eval', /(?<![\w.])eval\s*\(/],
  ['new Function', /\bnew\s+Function\s*\(/],
  ['javascript: URL', /['"`]javascript:/i],
];

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return sourceFiles(path);
      }
      return /\.(?:ts|tsx|js|jsx|mjs)$/.test(entry.name) ? [path] : [];
    }),
  );
  return nested.flat();
}

test('web source renders user text without raw-HTML or dynamic-code sinks', async () => {
  const files = await sourceFiles(WEB_SOURCE);
  assert.ok(files.length > 100, 'expected to scan the whole web source tree');
  const findings = [];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const [name, pattern] of SINKS) {
      if (pattern.test(source)) {
        findings.push(`${relative(process.cwd(), file)}: ${name}`);
      }
    }
  }
  assert.deepEqual(findings, []);
});

test('the sink patterns catch the constructs they name', () => {
  const samples = {
    dangerouslySetInnerHTML: '<div dangerouslySetInnerHTML={{ __html: text }} />',
    'innerHTML/outerHTML assignment': 'node.innerHTML = text;',
    insertAdjacentHTML: "node.insertAdjacentHTML('beforeend', text);",
    'document.write': 'document.write(text);',
    eval: 'eval(text);',
    'new Function': 'new Function(text)();',
    'javascript: URL': "href={'javascript:alert(1)'}",
  };
  for (const [name, pattern] of SINKS) {
    assert.match(samples[name], pattern, name);
  }
  assert.doesNotMatch('retrieval(text); interval(text);', SINKS[4][1]);
});
