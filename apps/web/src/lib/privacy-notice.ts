/**
 * Privacy consent contract shared by registration and profile onboarding.
 *
 * The localized notice body lives in `privacy-notice-copy.ts`. Any material wording change in
 * either language must bump this version together with the API constant so stored consent remains
 * attributable to the exact bilingual notice that the user accepted.
 */

export const PRIVACY_POLICY_VERSION = '2026-09-30';

export const CONSENT_REQUIRED_MESSAGE =
  'You must accept the privacy notice before an HKTutor account can be created.';

export interface PrivacyNoticeSection {
  readonly heading: string;
  readonly paragraphs: readonly string[];
  readonly bullets: readonly string[];
}

export interface PrivacyNotice {
  readonly title: string;
  readonly version: string;
  readonly effectiveDate: string;
  readonly summary: string;
  readonly sections: readonly PrivacyNoticeSection[];
}

export interface OnboardingConsent {
  readonly consent: boolean;
  readonly policyVersion: string;
}

export const buildOnboardingConsent = (accepted: boolean): OnboardingConsent => ({
  consent: accepted,
  policyVersion: PRIVACY_POLICY_VERSION,
});
