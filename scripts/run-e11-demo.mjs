import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';

/** Use the development target in the file, even if this shell exported another DATABASE_URL. */
export function createE11DemoEnvironment(source, inherited = process.env) {
  const databaseUrl = parseEnv(source).DATABASE_URL;
  if (!databaseUrl || !URL.canParse(databaseUrl)) {
    throw new Error('The root .env must contain a valid development DATABASE_URL');
  }
  if (!['postgres:', 'postgresql:'].includes(new URL(databaseUrl).protocol)) {
    throw new Error('The development DATABASE_URL must use PostgreSQL');
  }
  return {
    ...inherited,
    DATABASE_URL: databaseUrl,
    HKTUTOR_E11_DEMO_TARGET: 'development',
    HKTUTOR_E11_DEMO_RUN_ID: randomUUID(),
    HKTUTOR_E11_DEMO_PASSWORD: `E11-${randomBytes(24).toString('base64url')}-1a`,
    HKTUTOR_E11_DEMO_TOKEN_SECRET: randomBytes(32).toString('base64url'),
    HKTUTOR_E11_DEMO_ACCESS_SECRET: randomBytes(32).toString('base64url'),
    HKTUTOR_E11_DEMO_REFRESH_SECRET: randomBytes(32).toString('base64url'),
  };
}

async function main() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const env = createE11DemoEnvironment(readFileSync(new URL('../.env', import.meta.url), 'utf8'));
  const cleanupOnly = process.argv[2] === '--cleanup';
  if (cleanupOnly) {
    const runId = process.argv[3];
    if (!runId || !/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/.test(runId)) {
      throw new Error('Cleanup requires the E11 run ID printed by the original run');
    }
    env.HKTUTOR_E11_DEMO_RUN_ID = runId;
  }
  const pnpm = process.env.npm_execpath;
  if (!pnpm) {
    throw new Error('Run this script through pnpm test:demo:playwright');
  }
  let child;
  let interrupted = false;
  const stop = (signal) => {
    interrupted = true;
    child?.kill(signal);
  };
  const interrupt = () => stop('SIGINT');
  const terminate = () => stop('SIGTERM');
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', terminate);
  const run = (args) =>
    new Promise((resolve, reject) => {
      child = spawn(process.execPath, [pnpm, ...args], { cwd: root, env, stdio: 'inherit' });
      child.once('error', reject);
      child.once('exit', (code) => resolve(code ?? 1));
    });

  let status = 1;
  try {
    process.stdout.write('E11 demo: using development DATABASE_URL from the root .env.\n');
    process.stdout.write(`E11 run ID: ${env.HKTUTOR_E11_DEMO_RUN_ID}\n`);
    status = cleanupOnly ? 0 : await run(['--filter', '@hktutor/api', 'test:demo:prepare']);
    if (!cleanupOnly && status === 0 && !interrupted) {
      status = await run(['--filter', '@hktutor/web', 'test:e2e:demo', ...process.argv.slice(2)]);
    }
  } finally {
    const cleanup = await run(['--filter', '@hktutor/api', 'test:demo:prepare', '--cleanup']);
    if (cleanup !== 0) {
      process.stderr.write(
        `E11 fixture cleanup failed. Retry: pnpm test:demo:cleanup ${env.HKTUTOR_E11_DEMO_RUN_ID}\n`,
      );
      status = cleanup;
    }
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', terminate);
  }
  if (!cleanupOnly && status === 0 && !interrupted && !process.argv.includes('--list')) {
    status = await run(['test:demo:video:export']);
  }
  process.exitCode = interrupted ? 130 : status;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    process.stderr.write('E11 demo could not finish. Check the root .env and database access.\n');
    process.exitCode = 1;
  });
}
