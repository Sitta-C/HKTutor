import { describe, expect, it } from 'vitest';

import {
  DASHBOARD_PATH,
  ONBOARDING_PROFILE_PATH,
  resolveDashboardGate,
  resolveOnboardingHandoff,
} from '@/lib/profile-navigation';

describe('dashboard gate', () => {
  it('sends a student whose profile is incomplete to onboarding', () => {
    expect(resolveDashboardGate({ consentCurrent: true, profileComplete: false })).toBe(
      ONBOARDING_PROFILE_PATH,
    );
  });

  it('sends a student whose privacy notice is stale to onboarding', () => {
    expect(resolveDashboardGate({ consentCurrent: false, profileComplete: true })).toBe(
      ONBOARDING_PROFILE_PATH,
    );
  });

  it('keeps a complete and consented profile on the dashboard', () => {
    expect(resolveDashboardGate({ consentCurrent: true, profileComplete: true })).toBeNull();
  });
});

describe('onboarding hand-off', () => {
  it('leaves onboarding for the dashboard once the profile is complete', () => {
    expect(resolveOnboardingHandoff({ consentCurrent: true, profileComplete: true })).toBe(
      DASHBOARD_PATH,
    );
  });

  it('stays in the editor while the profile is incomplete', () => {
    expect(resolveOnboardingHandoff({ consentCurrent: true, profileComplete: false })).toBeNull();
  });
});
