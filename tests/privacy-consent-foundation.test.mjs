import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const noticeModulePath = 'apps/web/src/lib/privacy-notice.ts';
const noticeModalPath = 'apps/web/src/components/privacy-notice-modal.tsx';
const consentComponentPath = 'apps/web/src/components/privacy-consent.tsx';
const registerComponentPath = 'apps/web/src/components/register.tsx';
const i18nPath = 'apps/web/src/lib/i18n.tsx';

const read = (path) => fs.readFile(path, 'utf8');

test('pins the S1-T11 privacy policy version and consent contract', async () => {
  const notice = await read(noticeModulePath);

  assert.match(notice, /export const PRIVACY_POLICY_VERSION = '2026-09-09';/);
  assert.doesNotMatch(notice, /PRIVACY_NOTICE_PATH/);
  assert.match(notice, /export const CONSENT_REQUIRED_MESSAGE =/);
  assert.match(
    notice,
    /export const buildOnboardingConsent = \(accepted: boolean\): OnboardingConsent/,
  );
  assert.match(notice, /consent: accepted/);
  assert.match(notice, /policyVersion: PRIVACY_POLICY_VERSION/);
});

test('describes local password storage and Resend email delivery', async () => {
  const notice = await read(noticeModulePath);

  assert.match(notice, /stores a one-way password hash rather than your password/);
  assert.match(notice, /uses Resend to deliver account verification emails/);
  assert.match(notice, /short-lived access '[\s\S]*tokens plus a refresh-session cookie/);
  assert.match(notice, /Verification links are random, expire/);
});

test('discloses the new personal, education, and emergency-contact data', async () => {
  const notice = await read(noticeModulePath);

  assert.match(notice, /Student profile: first name, last name, nickname, school, grade level/);
  assert.match(notice, /telephone number is treated as a private emergency contact field/);
  assert.match(notice, /Tutor profile: first name, last name, nickname, public display name/);
  assert.match(notice, /Student telephone numbers are not used for marketing/);
  assert.match(notice, /are not part of a public tutor or search response/);
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
    /How sign-in credentials are processed/,
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

  assert.match(
    notice,
    /Accepting this notice is a required step of registration and profile onboarding/,
  );
  assert.match(notice, /creates no account record and saves no tutor or student profile/);
  assert.match(notice, /records the moment of acceptance and the version of this notice/);
});

test('renders a closable modal instead of a separate privacy route', async () => {
  const modal = await read(noticeModalPath);

  assert.match(modal, /^'use client';/m);
  assert.match(modal, /<dialog/);
  assert.match(modal, /dialog\.showModal\(\)/);
  assert.match(modal, /onClose=\{onClose\}/);
  assert.match(modal, /PRIVACY_NOTICE\.sections\.map/);
  await assert.rejects(fs.stat('apps/web/src/app/privacy/page.tsx'));
});

test('requires an explicit consent decision in the onboarding control', async () => {
  const consent = await read(consentComponentPath);

  assert.match(consent, /^'use client';/m);
  assert.match(consent, /readonly accepted: boolean;/);
  assert.match(consent, /readonly onAcceptedChange: \(accepted: boolean\) => void;/);
  assert.match(consent, /readonly error: string \| null;/);
  assert.match(consent, /type="checkbox"/);
  assert.match(consent, /checked=\{accepted\}/);
  assert.match(consent, /<PrivacyNoticeModal/);
  assert.match(consent, /setNoticeOpen\(true\)/);
  assert.doesNotMatch(consent, /href=/);
  assert.match(
    consent,
    /copy\.register\.policyAfter\.replace\('\{version\}', PRIVACY_POLICY_VERSION\)/,
  );
  assert.match(consent, /role="alert"/);
  assert.match(consent, /aria-invalid=/);
  assert.doesNotMatch(consent, /checked=\{true\}/);
});

test('translates the consent line in both languages', async () => {
  const i18n = await read(i18nPath);
  const keys = ['policyBefore', 'policyLink', 'policyAfter', 'policyRequired'];

  for (const key of keys) {
    assert.equal(
      [...i18n.matchAll(new RegExp(`\\b${key}:`, 'g'))].length,
      2,
      `${key} must be defined for both en and th`,
    );
  }

  assert.equal(
    [...i18n.matchAll(/\{version\}/g)].length,
    2,
    'both languages must interpolate the accepted policy version',
  );
  assert.equal([...i18n.matchAll(/Clerk/g)].length, 0);
  assert.doesNotMatch(i18n, /^\s*policy:/m, 'the pre-S1-T11 placeholder copy is replaced');
});

test('blocks registration submission until the notice is accepted', async () => {
  const register = await read(registerComponentPath);

  assert.match(register, /import PrivacyConsent from '@\/components\/privacy-consent';/);
  assert.match(register, /const \[acceptedPolicy, setAcceptedPolicy\] = useState\(false\);/);
  assert.match(
    register,
    /const \[consentError, setConsentError\] = useState<string \| null>\(null\);/,
  );
  assert.match(
    register,
    /if \(!acceptedPolicy\) \{\s*setConsentError\(copy\.register\.policyRequired\);\s*return;\s*\}/,
  );
  assert.match(register, /<PrivacyConsent/);
  assert.match(register, /error=\{consentError\}/);
  assert.match(register, /buildOnboardingConsent\(acceptedPolicy\)/);
  assert.doesNotMatch(register, /void consent/);
  assert.match(register, /await register\(/);
  assert.match(register, /router\.push\(`\/register\/verify\?email=/);
  assert.doesNotMatch(
    register,
    /copy\.register\.policy\}/,
    'the placeholder consent copy is replaced',
  );
});

test('adds no environment variable or secret surface for the notice', async () => {
  for (const path of [noticeModulePath, noticeModalPath, consentComponentPath]) {
    const source = await read(path);
    assert.doesNotMatch(source, /process\.env/);
    assert.doesNotMatch(source, /NEXT_PUBLIC_/);
    assert.doesNotMatch(source, /SUPABASE_SECRET_KEY|DATABASE_URL|CLERK_SECRET/);
  }
});
