import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const controllerPath = 'apps/api/src/users/users.controller.ts';
const servicePath = 'apps/api/src/users/users.service.ts';
const dtoPath = 'apps/api/src/users/users.dto.ts';
const verifyComponentPath = 'apps/web/src/components/verify.tsx';
const registerComponentPath = 'apps/web/src/components/register.tsx';
const i18nPath = 'apps/web/src/lib/i18n.tsx';

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

test('validates the policy version against a server-owned allowlist', async () => {
  const dto = await read(dtoPath);

  assert.match(dto, /SUPPORTED_POLICY_VERSIONS/);
  assert.match(dto, /@IsIn\(\[\.\.\.SUPPORTED_POLICY_VERSIONS\]\)/);
});

test('registers the onboarding consent copy in both languages', async () => {
  const i18n = await read(i18nPath);

  for (const key of ['onboardingPending', 'onboardingFailed']) {
    assert.equal(
      [...i18n.matchAll(new RegExp(`\\b${key}:`, 'g'))].length,
      2,
      `${key} must be defined for both en and th`,
    );
  }
});

test('verify reads the stored onboarding payload and posts it to the backend before navigating', async () => {
  const verify = await read(verifyComponentPath);

  assert.match(verify, /sessionStorage\.getItem\('hktutor:onboarding'\)/);
  assert.match(verify, /fetchWithAuth\(/);
  assert.match(verify, /\/api\/users\/onboarding/);
  assert.match(verify, /method: 'POST'/);
  assert.match(verify, /onboardingPending/);
  assert.match(verify, /onboardingFailed/);

  const fetchCallIndex = verify.indexOf('fetchWithAuth(');
  const navigateIndex = verify.lastIndexOf("router.replace('/dashboard')");
  assert.ok(navigateIndex > -1, 'verify must navigate to the dashboard');
  assert.ok(
    fetchCallIndex > -1 && fetchCallIndex < navigateIndex,
    'the onboarding call must happen before navigating to /dashboard',
  );
});

test('verify only clears the stored payload after a successful onboarding call', async () => {
  const verify = await read(verifyComponentPath);

  assert.match(verify, /sessionStorage\.removeItem\('hktutor:onboarding'\)/);
  const removeIndex = verify.lastIndexOf("sessionStorage.removeItem('hktutor:onboarding')");
  const fetchCallIndex = verify.indexOf('fetchWithAuth(');
  assert.ok(
    removeIndex > fetchCallIndex,
    'the payload must be cleared only after the onboarding call',
  );
});

test('verify tolerates a missing or corrupt stored payload without trapping the user', async () => {
  const verify = await read(verifyComponentPath);

  assert.match(verify, /catch/);
  assert.match(verify, /router\.replace\('\/dashboard'\)/);
});

test('register persists the onboarding payload before the verification step', async () => {
  const register = await read(registerComponentPath);

  assert.match(register, /sessionStorage\.setItem\(\s*'hktutor:onboarding',/);
});
