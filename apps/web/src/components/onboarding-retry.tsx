'use client';

import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import AuthShell from '@/components/auth-shell';
import PrivacyConsent from '@/components/privacy-consent';
import { useLanguage } from '@/lib/i18n';
import { submitOnboarding } from '@/lib/onboarding';
import { buildOnboardingConsent } from '@/lib/privacy-notice';

import type { FormEvent } from 'react';

const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001';

type Role = 'student' | 'tutor';

function OnboardingRetryForm() {
  const { copy } = useLanguage();
  const { getToken } = useAuth();
  const router = useRouter();

  const [role, setRole] = useState<Role>('student');
  const [acceptedPolicy, setAcceptedPolicy] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleConsentChange = (accepted: boolean) => {
    setAcceptedPolicy(accepted);
    if (accepted) {
      setConsentError(null);
    }
  };

  const handleSubmission = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!acceptedPolicy) {
      setConsentError(copy.register.policyRequired);
      return;
    }
    setConsentError(null);
    setErrorMessage(null);

    setIsLoading(true);
    try {
      const { ok } = await submitOnboarding(getToken, backendUrl, {
        ...buildOnboardingConsent(acceptedPolicy),
        role,
      });

      if (!ok) {
        setErrorMessage(copy.register.onboardingFailed);
        return;
      }

      router.replace('/dashboard');
    } catch {
      setErrorMessage(copy.register.onboardingFailed);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthShell page="register">
      <section className="w-full max-w-[624px] rounded-[2rem] bg-white px-6 py-9 shadow-[0_22px_65px_rgba(46,39,25,0.08)] sm:px-12 sm:py-12 lg:px-[4.25rem] lg:py-14">
        <div className="mx-auto max-w-[490px]">
          <div className="mb-7 text-center sm:mb-8">
            <h1 className="text-[2rem] font-bold tracking-[-0.055em] text-[#171714] sm:text-[2.25rem]">
              {copy.register.onboardingRetryTitle}
            </h1>
          </div>

          <form onSubmit={handleSubmission} className="space-y-3.5">
            {errorMessage && (
              <p className="rounded-lg bg-red-50 p-3 text-xs text-[#c04f40]" role="alert">
                {errorMessage}
              </p>
            )}

            <div className="flex items-center justify-between gap-4">
              <span className="text-sm font-semibold text-[#171714]">
                {copy.register.joiningAs}
              </span>
              <div
                className="grid grid-cols-2 rounded-xl border border-[#e2dfd8] bg-[#faf9f6] p-1"
                role="group"
                aria-label={copy.register.chooseRole}
              >
                <button
                  type="button"
                  aria-pressed={role === 'student'}
                  onClick={() => setRole('student')}
                  className={`min-h-10 rounded-lg px-4 text-sm font-semibold transition-colors ${
                    role === 'student'
                      ? 'bg-[#171714] text-white shadow-sm'
                      : 'text-[#77736b] hover:text-[#171714]'
                  }`}
                >
                  {copy.register.student}
                </button>
                <button
                  type="button"
                  aria-pressed={role === 'tutor'}
                  onClick={() => setRole('tutor')}
                  className={`min-h-10 rounded-lg px-4 text-sm font-semibold transition-colors ${
                    role === 'tutor'
                      ? 'bg-[#171714] text-white shadow-sm'
                      : 'text-[#77736b] hover:text-[#171714]'
                  }`}
                >
                  {copy.register.tutor}
                </button>
              </div>
            </div>

            <PrivacyConsent
              accepted={acceptedPolicy}
              onAcceptedChange={handleConsentChange}
              error={consentError}
            />

            <button
              type="submit"
              disabled={isLoading}
              className="mt-2 flex h-[3.65rem] w-full items-center justify-center rounded-xl bg-[#ffc57d] px-5 text-base font-bold text-[#171714] shadow-[0_8px_18px_rgba(206,145,64,0.14)] transition-all hover:-translate-y-0.5 hover:bg-[#ffbd6c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#171714]/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoading ? copy.register.onboardingPending : copy.register.onboardingRetrySubmit}
            </button>
          </form>
        </div>
      </section>
    </AuthShell>
  );
}

export default function OnboardingRetry() {
  return <OnboardingRetryForm />;
}
