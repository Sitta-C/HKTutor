import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const controllerPath = 'apps/api/src/users/users.controller.ts';
const servicePath = 'apps/api/src/users/users.service.ts';
const dtoPath = 'apps/api/src/users/users.dto.ts';

const read = (path) => fs.readFile(path, 'utf8');

test('exposes the guarded onboarding endpoint on the users controller', async () => {
  const controller = await read(controllerPath);

  assert.match(controller, /@Post\('onboarding'\)/);
  assert.match(controller, /@UseGuards\(ClerkAuthGuard\)/);
});

test('rejects a request without a verified Clerk user id before calling the service', async () => {
  const controller = await read(controllerPath);

  assert.match(controller, /request\.auth\?\.userId/);
  assert.match(controller, /UnauthorizedException/);
});

test('persists consent inside one transaction and never writes Role.ADMIN', async () => {
  const service = await read(servicePath);

  assert.match(service, /\$transaction/);
  assert.doesNotMatch(service, /Role\.ADMIN/);
});

test('limits the onboarding role whitelist to student and tutor', async () => {
  const dto = await read(dtoPath);

  assert.match(dto, /ONBOARDING_ROLES = \['student', 'tutor'\]/);
  assert.doesNotMatch(dto, /admin/);
});
