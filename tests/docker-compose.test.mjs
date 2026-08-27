import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const composeConfig = () =>
  spawnSync('docker', ['compose', 'config', '--format', 'json'], {
    cwd: process.cwd(),
    encoding: 'utf8',
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
  assert.equal(config.services.api.build.dockerfile, 'apps/api/Dockerfile');
  assert.equal(config.services.web.build.dockerfile, 'apps/web/Dockerfile');
  assert.deepEqual(config.services.api.volumes ?? [], []);
  assert.deepEqual(config.services.web.volumes ?? [], []);
  assert.deepEqual(config.volumes ?? {}, {});
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
