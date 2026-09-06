import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

const lintSource = ({ filename, source, workspace }) => {
  const result = spawnSync(
    pnpm,
    ['--filter', workspace, 'exec', 'eslint', '--stdin', '--stdin-filename', filename],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      input: source,
      shell: true
    },
  );

  return {
    output: `${result.stdout}${result.stderr}`,
    status: result.status,
  };
};

test('rejects imports outside the approved group order', () => {
  const result = lintSource({
    filename: 'src/app.module.ts',
    source: `import { AppService } from './app.service';
import { join } from 'node:path';

void AppService;
void join;
`,
    workspace: '@hktutor/api',
  });

  assert.notEqual(result.status, 0, result.output);
  assert.match(result.output, /import\/order/);
});

test('prevents the web app from importing API source', () => {
  const result = lintSource({
    filename: 'src/app/page.tsx',
    source: `import { AppService } from '../../../api/src/app.service';

void AppService;
`,
    workspace: '@hktutor/web',
  });

  assert.notEqual(result.status, 0, result.output);
  assert.match(result.output, /import\/no-restricted-paths/);
});

test('prevents the API from importing web source', () => {
  const result = lintSource({
    filename: 'src/main.ts',
    source: `import Home from '../../web/src/app/page';

void Home;
`,
    workspace: '@hktutor/api',
  });

  assert.notEqual(result.status, 0, result.output);
  assert.match(result.output, /import\/no-restricted-paths/);
});
