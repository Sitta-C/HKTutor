import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const composeConfig = () =>
  spawnSync('docker', ['compose', 'config', '--format', 'json'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      CLERK_SECRET_KEY: 'sk_test_placeholder',
      DATABASE_URL:
        'postgresql://postgres.project-ref:password@example.test:5432/postgres?sslmode=require',
      NEXT_PUBLIC_BACKEND_URL: 'https://api.example.test',
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_Y2xlcmsuZXhhbXBsZS50ZXN0JA==',
      WEB_ORIGIN: 'https://web.example.test',
    },
  });

const publishedPorts = (service) =>
  service.ports.map(({ protocol, published, target }) => `${published}:${target}/${protocol}`);

test('defines web and API services with health checks and no local data service', () => {
  const result = composeConfig();
  const output = `${result.stdout}${result.stderr}`;

  assert.equal(result.status, 0, output);

  const config = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(config.services).sort(), ['api', 'web']);
  assert.deepEqual(publishedPorts(config.services.web), ['3000:3000/tcp']);
  assert.deepEqual(publishedPorts(config.services.api), ['3001:3001/tcp']);
  assert.ok(config.services.web.healthcheck, 'web health check is required');
  assert.ok(config.services.api.healthcheck, 'API health check is required');
  assert.equal(config.services.web.depends_on.api.condition, 'service_healthy');
  assert.equal(
    config.services.api.environment.DATABASE_URL,
    'postgresql://postgres.project-ref:password@example.test:5432/postgres?sslmode=require',
  );
  assert.equal(config.services.api.environment.CLERK_SECRET_KEY, 'sk_test_placeholder');
  assert.equal(
    config.services.api.environment.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    'pk_test_Y2xlcmsuZXhhbXBsZS50ZXN0JA==',
  );
  assert.equal(config.services.api.environment.WEB_ORIGIN, 'https://web.example.test');
  assert.equal(config.services.web.build.args.NEXT_PUBLIC_BACKEND_URL, 'https://api.example.test');
  assert.equal(
    config.services.web.build.args.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    'pk_test_Y2xlcmsuZXhhbXBsZS50ZXN0JA==',
  );
  assert.equal(config.services.web.environment.CLERK_SECRET_KEY, 'sk_test_placeholder');
  assert.match(config.services.api.healthcheck.test.join(' '), /\/api\/health/);
  assert.equal(config.services.api.build.dockerfile, 'apps/api/Dockerfile');
  assert.equal(config.services.web.build.dockerfile, 'apps/web/Dockerfile');
  assert.deepEqual(config.services.api.volumes ?? [], []);
  assert.deepEqual(config.services.web.volumes ?? [], []);
  assert.deepEqual(config.volumes ?? {}, {});
});

test('the API image generates Prisma Client without copying environment files', async () => {
  const dockerfile = await fs.readFile('apps/api/Dockerfile', 'utf8');
  const dockerignore = await fs.readFile('.dockerignore', 'utf8');

  assert.match(dockerfile, /pnpm --filter @hktutor\/api db:generate/);
  assert.match(dockerfile, /apt-get install[^\n]*openssl/);
  assert.match(dockerfile, /FROM base AS runtime/);
  assert.match(dockerignore, /^\.env$/m);
  assert.match(dockerignore, /^\.env\.\*$/m);
});

test('the web image receives browser-visible settings at build time without baking in secrets', async () => {
  const dockerfile = await fs.readFile('apps/web/Dockerfile', 'utf8');

  assert.match(dockerfile, /ARG NEXT_PUBLIC_BACKEND_URL/);
  assert.match(dockerfile, /ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY/);
  assert.doesNotMatch(dockerfile, /ARG CLERK_SECRET_KEY/);
});

test('every Compose build resolves to an existing Dockerfile', async () => {
  const result = composeConfig();
  const output = `${result.stdout}${result.stderr}`;

  assert.equal(result.status, 0, output);

  const config = JSON.parse(result.stdout);
  for (const [serviceName, service] of Object.entries(config.services)) {
    const dockerfile = path.resolve(service.build.context, service.build.dockerfile);
    await assert.doesNotReject(
      fs.access(dockerfile),
      `${serviceName} Dockerfile does not exist at ${dockerfile}`,
    );
  }
});
