/**
 * Redirect decisions shared by the dashboard and the profile onboarding editor.
 *
 * These are pure functions so the decision logic can be unit-tested without a DOM:
 * the web test runner executes in a node environment and renders no React tree.
 */

export const ONBOARDING_PROFILE_PATH = '/onboarding/profile';
export const DASHBOARD_PATH = '/dashboard';

export interface ProfileGateStatus {
  consentCurrent: boolean;
  profileComplete: boolean;
}

/**
 * Guards the dashboard: an incomplete profile or a stale privacy notice must finish
 * onboarding first. Returns the target to redirect to, or null to stay on the dashboard.
 */
export function resolveDashboardGate(status: ProfileGateStatus): string | null {
  return status.consentCurrent && status.profileComplete ? null : ONBOARDING_PROFILE_PATH;
}

/**
 * Hand-off from onboarding: a complete profile leaves onboarding for the dashboard.
 * Returns the target to redirect to, or null to stay in the editor.
 */
export function resolveOnboardingHandoff(status: ProfileGateStatus): string | null {
  return status.profileComplete ? DASHBOARD_PATH : null;
}
