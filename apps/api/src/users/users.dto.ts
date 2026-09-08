import { IsBoolean, IsIn, Matches } from 'class-validator';

export const ONBOARDING_ROLES = ['student', 'tutor'] as const;

// Bump together with PRIVACY_POLICY_VERSION in apps/web/src/lib/privacy-notice.ts.
export const SUPPORTED_POLICY_VERSIONS = ['2026-08-01'] as const;

export type OnboardingRole = (typeof ONBOARDING_ROLES)[number];

export class OnboardingConsentDto {
  @IsBoolean()
  consent!: boolean;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsIn([...SUPPORTED_POLICY_VERSIONS])
  policyVersion!: string;

  @IsIn(ONBOARDING_ROLES)
  role!: OnboardingRole;
}
