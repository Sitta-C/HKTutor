import { IsBoolean, IsIn, Matches } from 'class-validator';

export const ONBOARDING_ROLES = ['student', 'tutor'] as const;

export type OnboardingRole = (typeof ONBOARDING_ROLES)[number];

export class OnboardingConsentDto {
  @IsBoolean()
  consent!: boolean;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  policyVersion!: string;

  @IsIn(ONBOARDING_ROLES)
  role!: OnboardingRole;
}
