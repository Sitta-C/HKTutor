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
      DATABASE_URL:
        'postgresql://postgres.project-ref:password@example.test:5432/postgres?sslmode=require',
      EMAIL_FROM: 'HKTutor <no-reply@example.test>',
      JWT_ACCESS_SECRET: 'test-access-secret-that-is-at-least-32-characters',
      JWT_REFRESH_SECRET: 'test-refresh-secret-that-is-at-least-32-characters',
      NEXT_PUBLIC_BACKEND_URL: 'http://localhost:3001',
      RESEND_API_KEY: 're_test_placeholder',
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
  assert.equal(
    config.services.api.environment.JWT_ACCESS_SECRET,
    'test-access-secret-that-is-at-least-32-characters',
  );
  assert.equal(
    config.services.api.environment.JWT_REFRESH_SECRET,
    'test-refresh-secret-that-is-at-least-32-characters',
  );
  assert.equal(config.services.api.environment.RESEND_API_KEY, 're_test_placeholder');
  assert.match(config.services.api.healthcheck.test.join(' '), /\/api\/health/);
  assert.equal(config.services.api.build.dockerfile, 'apps/api/Dockerfile');
  assert.equal(config.services.web.build.dockerfile, 'apps/web/Dockerfile');
  assert.equal(
    config.services.web.build.args.NEXT_PUBLIC_BACKEND_URL,
    'http://localhost:3001',
    'the web build must receive the authentication API URL as a build argument',
  );
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

test('the web Dockerfile receives the authentication API URL before the production build', async () => {
  const dockerfile = await fs.readFile('apps/web/Dockerfile', 'utf8');

  const argIndex = dockerfile.indexOf('ARG NEXT_PUBLIC_BACKEND_URL');
  const envIndex = dockerfile.indexOf('ENV NEXT_PUBLIC_BACKEND_URL=$NEXT_PUBLIC_BACKEND_URL');
  const buildIndex = dockerfile.indexOf('RUN pnpm --filter @hktutor/web build');

  assert.ok(argIndex > -1, 'the web Dockerfile must declare ARG NEXT_PUBLIC_BACKEND_URL');
  assert.ok(envIndex > -1, 'the web Dockerfile must set ENV NEXT_PUBLIC_BACKEND_URL');
  assert.ok(buildIndex > -1, 'the web Dockerfile must build @hktutor/web');
  assert.ok(argIndex < buildIndex, 'ARG must appear before the web build');
  assert.ok(
    envIndex < buildIndex,
    'ENV must appear before the web build so next build bakes it in',
  );
});

test('the web image bakes in only the public API URL and no authentication secrets', async () => {
  const dockerfile = await fs.readFile('apps/web/Dockerfile', 'utf8');

  assert.doesNotMatch(dockerfile, /ARG (?:JWT_|RESEND_|EMAIL_FROM|DATABASE_URL)/);
  assert.doesNotMatch(dockerfile, /CLERK/i);
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
