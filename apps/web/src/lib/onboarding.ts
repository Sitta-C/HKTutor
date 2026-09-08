export interface OnboardingPayload {
  consent: boolean;
  policyVersion: string;
  role: 'student' | 'tutor';
}

export interface SubmitOnboardingResult {
  ok: boolean;
  status: number;
}

export class OnboardingTokenError extends Error {
  override name = 'OnboardingTokenError';
}

export const ONBOARDING_ENDPOINT_PATH = '/api/users/onboarding';

export async function submitOnboarding(
  getToken: () => Promise<string | null>,
  baseUrl: string,
  payload: OnboardingPayload,
): Promise<SubmitOnboardingResult> {
  const token = await getToken();

  if (!token) {
    throw new OnboardingTokenError();
  }

  const response = await fetch(`${baseUrl}${ONBOARDING_ENDPOINT_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });

  return { ok: response.ok, status: response.status };
}
