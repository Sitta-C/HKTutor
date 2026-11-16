import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

test('Railway services select production Dockerfiles from the workspace root', async () => {
  const dockerignore = await fs.readFile('.dockerignore', 'utf8');
  assert.match(dockerignore, /^\*\*\/\.env$/m, 'nested app environments must stay out of images');
  assert.match(dockerignore, /^\*\*\/\.env\.\*$/m);
  const services = [
    ['api', 'apps/api/Dockerfile', '/api/v1/health'],
    ['web', 'apps/web/Dockerfile', '/'],
    ['gateway', 'deploy/railway/Dockerfile', '/'],
  ];

  for (const [name, dockerfile, healthcheck] of services) {
    const config = JSON.parse(await fs.readFile(`deploy/railway/${name}.json`, 'utf8'));
    assert.equal(config.build.builder, 'DOCKERFILE');
    assert.equal(config.build.dockerfilePath, dockerfile);
    await fs.access(config.build.dockerfilePath);
    const source = await fs.readFile(config.build.dockerfilePath, 'utf8');
    assert.doesNotMatch(source, /--mount=type=cache/, 'Railway cache IDs must not be shared');
    assert.equal(config.deploy.healthcheckPath, healthcheck);
    assert.equal(config.deploy.numReplicas, 1, 'chat delivery needs one API process');
    assert.equal(config.deploy.restartPolicyType, 'ON_FAILURE');
    assert.equal(config.deploy.restartPolicyMaxRetries, 3);
    assert.equal(config.deploy.preDeployCommand, undefined, 'database writes stay manual');
    assert.equal(config.deploy.startCommand, undefined, 'use the production image CMD');
  }
});
