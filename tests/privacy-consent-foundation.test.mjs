import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const noticeModulePath = 'apps/web/src/lib/privacy-notice.ts';
const noticePagePath = 'apps/web/src/app/privacy/page.tsx';
const consentComponentPath = 'apps/web/src/components/privacy-consent.tsx';
const registerComponentPath = 'apps/web/src/components/register.tsx';

const read = (path) => fs.readFile(path, 'utf8');

test('pins the S1-T11 privacy policy version and consent contract', async () => {
  const notice = await read(noticeModulePath);

  assert.match(notice, /export const PRIVACY_POLICY_VERSION = '2026-08-01';/);
  assert.match(notice, /export const PRIVACY_NOTICE_PATH = '\/privacy';/);
  assert.match(notice, /export const CONSENT_REQUIRED_MESSAGE =/);
  assert.match(
    notice,
    /export const buildOnboardingConsent = \(accepted: boolean\): OnboardingConsent/,
  );
  assert.match(notice, /consent: accepted/);
  assert.match(notice, /policyVersion: PRIVACY_POLICY_VERSION/);
});

test('names Clerk as the credential processor and excludes local password storage', async () => {
  const notice = await read(noticeModulePath);

  assert.match(notice, /Clerk as its identity and authentication provider/);
  assert.match(notice, /HKTutor never receives or stores your password/);
  assert.match(notice, /no local password hash, JWT secret, or refresh token/);
  assert.match(notice, /Clerk user identifier/);
  assert.match(notice, /Clerk acts as a processor for HKTutor/);
});

test('covers every required disclosure topic exactly once per heading', async () => {
  const notice = await read(noticeModulePath);
  const headings = [...notice.matchAll(/heading: '([^']+)'/g)].map((match) => match[1]);

  assert.equal(headings.length, 10, 'the notice must keep its ten numbered sections');
  assert.equal(new Set(headings).size, headings.length, 'section headings must be unique');
  assert.deepEqual(
    headings.map((heading) => heading.split('.')[0]),
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
  );

  for (const topic of [
    /Clerk processes your sign-in credentials/,
    /What HKTutor stores about you/,
    /Why HKTutor needs this data/,
    /Consent is required before your account is created/,
    /Who else can see your data/,
    /How long data is kept/,
    /Your choices and how to contact us/,
    /How your data is protected/,
    /Changes to this notice/,
  ]) {
    assert.match(notice, topic);
  }

  assert.match(notice, /Supabase PostgreSQL database/);
  assert.match(notice, /private Supabase storage bucket/);
  assert.match(notice, /HKTutor does not sell personal data and shows no advertising/);
});

test('states that no account record exists without consent', async () => {
  const notice = await read(noticeModulePath);

  assert.match(notice, /Accepting this notice is a required step of onboarding/);
  assert.match(notice, /creates no account record and no tutor or student profile/);
  assert.match(notice, /records the moment of acceptance and the version of this notice/);
});

test('renders the notice route from the shared content module', async () => {
  const page = await read(noticePagePath);

  assert.match(page, /import \{ PRIVACY_NOTICE \} from '@\/lib\/privacy-notice';/);
  assert.match(page, /export const metadata: Metadata/);
  assert.match(page, /title: 'Privacy Notice'/);
  assert.match(page, /PRIVACY_NOTICE\.sections\.map/);
  assert.match(page, /\{PRIVACY_NOTICE\.version\}/);
  assert.doesNotMatch(
    page,
    /'use client'/,
    'the notice is static and must stay a server component',
  );
});

test('requires an explicit consent decision in the onboarding control', async () => {
  const consent = await read(consentComponentPath);

  assert.match(consent, /^'use client';/m);
  assert.match(consent, /readonly accepted: boolean;/);
  assert.match(consent, /readonly onAcceptedChange: \(accepted: boolean\) => void;/);
  assert.match(consent, /readonly error: string \| null;/);
  assert.match(consent, /type="checkbox"/);
  assert.match(consent, /checked=\{accepted\}/);
  assert.match(consent, /href=\{PRIVACY_NOTICE_PATH\}/);
  assert.match(consent, /rel="noopener noreferrer"/);
  assert.match(consent, /version \{PRIVACY_POLICY_VERSION\}/);
  assert.match(consent, /processing of my sign-in details by\s*\n?\s*Clerk/);
  assert.match(consent, /role="alert"/);
  assert.match(consent, /aria-invalid=/);
  assert.match(consent, /className="peer sr-only"/);
  assert.match(consent, /peer-focus-visible:ring-2/);
  assert.doesNotMatch(consent, /checked=\{true\}/);
});

test('blocks registration submission until the notice is accepted', async () => {
  const register = await read(registerComponentPath);

  assert.match(register, /import PrivacyConsent from '@\/components\/privacy-consent';/);
  assert.match(register, /import \{ CONSENT_REQUIRED_MESSAGE \} from '@\/lib\/privacy-notice';/);
  assert.match(register, /TODO\(S1-T12\)[\s\S]*?buildOnboardingConsent\(acceptedPolicy\)/);
  assert.match(register, /useState\(false\);[\s\S]*?consentError/);
  assert.doesNotMatch(register, /useState\(true\)/, 'consent must never start pre-accepted');
  assert.match(
    register,
    /if \(!acceptedPolicy\) \{\s*setConsentError\(CONSENT_REQUIRED_MESSAGE\);\s*return;\s*\}/,
  );
  assert.match(register, /<PrivacyConsent/);
  assert.match(register, /error=\{consentError\}/);
  assert.doesNotMatch(register, /I accept the policy/, 'the placeholder consent copy is replaced');
});

test('adds no environment variable or secret surface for the notice', async () => {
  for (const path of [noticeModulePath, noticePagePath, consentComponentPath]) {
    const source = await read(path);
    assert.doesNotMatch(source, /process\.env/);
    assert.doesNotMatch(source, /NEXT_PUBLIC_/);
    assert.doesNotMatch(source, /SUPABASE_SECRET_KEY|DATABASE_URL|CLERK_SECRET/);
  }
});
