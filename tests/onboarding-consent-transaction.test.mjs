import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const controllerPath = 'apps/api/src/users/users.controller.ts';
const servicePath = 'apps/api/src/users/users.service.ts';
const dtoPath = 'apps/api/src/users/users.dto.ts';
const verifyComponentPath = 'apps/web/src/components/verify.tsx';
const retryComponentPath = 'apps/web/src/components/onboarding-retry.tsx';
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

test('registers the onboarding recovery copy in both languages', async () => {
  const i18n = await read(i18nPath);

  for (const key of ['onboardingRetryTitle', 'onboardingRetrySubmit']) {
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
  assert.match(verify, /submitOnboarding\(/);
  assert.match(verify, /onboardingPending/);
  assert.match(verify, /onboardingFailed/);

  const submitCallIndex = verify.indexOf('submitOnboarding(');
  const navigateIndex = verify.lastIndexOf("router.replace('/dashboard')");
  assert.ok(navigateIndex > -1, 'verify must navigate to the dashboard');
  assert.ok(
    submitCallIndex > -1 && submitCallIndex < navigateIndex,
    'the onboarding call must happen before navigating to /dashboard',
  );
});

test('verify only clears the stored payload after a successful onboarding call', async () => {
  const verify = await read(verifyComponentPath);

  assert.match(verify, /sessionStorage\.removeItem\('hktutor:onboarding'\)/);
  const removeIndex = verify.lastIndexOf("sessionStorage.removeItem('hktutor:onboarding')");
  const submitCallIndex = verify.indexOf('submitOnboarding(');
  assert.ok(
    removeIndex > submitCallIndex,
    'the payload must be cleared only after the onboarding call',
  );
});

test('verify routes a missing or corrupt stored payload to the recovery step, never the dashboard', async () => {
  const verify = await read(verifyComponentPath);

  const branchStart = verify.indexOf('if (!payload) {');
  assert.ok(branchStart > -1, 'verify must branch on a missing or corrupt payload');
  const branchEnd = verify.indexOf('return;', branchStart) + 'return;'.length;
  const branch = verify.slice(branchStart, branchEnd);

  assert.match(branch, /router\.replace\('\/register\/onboarding'\)/);
  assert.doesNotMatch(branch, /router\.replace\('\/dashboard'\)/);
});

test('the dedicated verify retry handler re-runs only the onboarding POST', async () => {
  const verify = await read(verifyComponentPath);

  const handlerStart = verify.indexOf('retryOnboarding = async');
  assert.ok(handlerStart > -1, 'verify must define a retryOnboarding handler');
  const handlerEnd = verify.indexOf('\n  };', handlerStart);
  const handler = verify.slice(handlerStart, handlerEnd);

  assert.match(handler, /submitOnboarding\(/);
  assert.doesNotMatch(handler, /verifyEmailCode/, 'the retry must not re-run Clerk verification');
  assert.doesNotMatch(handler, /finalize/, 'the retry must not re-finalize the Clerk signup');
  assert.match(handler, /router\.replace\('\/dashboard'\)/);
});

test('the recovery step collects consent and role and posts through submitOnboarding', async () => {
  const retryPage = await read(retryComponentPath);

  assert.match(retryPage, /^'use client';/m);
  assert.match(retryPage, /import PrivacyConsent from '@\/components\/privacy-consent';/);
  assert.match(retryPage, /<PrivacyConsent/);
  assert.match(retryPage, /buildOnboardingConsent\(acceptedPolicy\)/);
  assert.match(retryPage, /submitOnboarding\(/);
  assert.doesNotMatch(retryPage, /sessionStorage/, 'the recovery step uses no stored payload');

  const handlerStart = retryPage.indexOf('handleSubmission = async');
  assert.ok(handlerStart > -1, 'the recovery step must define a submission handler');
  const handlerEnd = retryPage.indexOf('\n  };', handlerStart);
  const handler = retryPage.slice(handlerStart, handlerEnd);

  assert.match(handler, /submitOnboarding\(/);
  const successIndex = handler.indexOf('!ok');
  const navigateIndex = handler.indexOf("router.replace('/dashboard')");
  assert.ok(navigateIndex > -1, 'the recovery step must navigate to the dashboard on success');
  assert.ok(
    successIndex > -1 && successIndex < navigateIndex,
    'the recovery step must reach /dashboard only on a successful POST',
  );
});

test('register persists the onboarding payload before the verification step', async () => {
  const register = await read(registerComponentPath);

  assert.match(register, /sessionStorage\.setItem\(\s*'hktutor:onboarding',/);
});
