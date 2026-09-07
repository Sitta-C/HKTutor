'use client';

import { useAuth, useSignUp } from '@clerk/nextjs';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

import { fetchWithAuth } from '@/api/Token';
import AuthShell from '@/components/auth-shell';
import { useLanguage } from '@/lib/i18n';

import type { FormEvent } from 'react';

const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;

type OnboardingPayload = {
  consent: boolean;
  policyVersion: string;
  role: 'student' | 'tutor';
};

function readOnboardingPayload(): OnboardingPayload | null {
  try {
    const raw = sessionStorage.getItem('hktutor:onboarding');
    if (!raw) return null;

    const payload = JSON.parse(raw) as Partial<OnboardingPayload> | null;
    if (
      payload?.consent !== true ||
      typeof payload.policyVersion !== 'string' ||
      (payload.role !== 'student' && payload.role !== 'tutor')
    ) {
      return null;
    }

    return {
      consent: payload.consent,
      policyVersion: payload.policyVersion,
      role: payload.role,
    };
  } catch {
    return null;
  }
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message || fallback;
  if (typeof error === 'object' && error !== null && 'errors' in error) {
    const errors = error.errors;
    if (Array.isArray(errors) && errors[0] && typeof errors[0] === 'object') {
      const longMessage = 'longMessage' in errors[0] ? errors[0].longMessage : undefined;
      if (typeof longMessage === 'string') return longMessage;
    }
  }
  return fallback;
}

function VerifyForm() {
  const { copy } = useLanguage();
  const { signUp } = useSignUp();
  const { getToken } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get('email') ?? '';
  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isOnboarding, setIsOnboarding] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleVerification = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!signUp || !code.trim()) return;

    setIsLoading(true);
    setErrorMessage(null);
    setResendSuccess(false);

    try {
      const result = await signUp.verifications.verifyEmailCode({ code: code.trim() });

      if (result && 'error' in result && result.error) {
        setErrorMessage(result.error.longMessage || result.error.message || 'Verification failed');
        return;
      }

      await signUp.finalize({
        navigate: ({ session }) => {
          if (session?.currentTask) return;
        },
      });

      setIsOnboarding(true);
      try {
        const payload = readOnboardingPayload();

        if (!payload) {
          // Never trap a verified user: drop a missing or corrupt payload and move on.
          sessionStorage.removeItem('hktutor:onboarding');
          router.replace('/dashboard');
          return;
        }

        const response = await fetchWithAuth(getToken, `${backendUrl}/api/users/onboarding`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          setErrorMessage(copy.register.onboardingFailed);
          return;
        }

        // Only clear the payload after the onboarding call succeeded, so a
        // failure leaves the user on this page able to retry the code.
        sessionStorage.removeItem('hktutor:onboarding');
        router.replace('/dashboard');
      } catch {
        setErrorMessage(copy.register.onboardingFailed);
      } finally {
        setIsOnboarding(false);
      }
    } catch (error: unknown) {
      setErrorMessage(getErrorMessage(error, 'Verification failed'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendCode = async () => {
    if (!signUp) return;

    setIsResending(true);
    setErrorMessage(null);
    setResendSuccess(false);

    try {
      const result = await signUp.verifications.sendEmailCode();
      if (result && 'error' in result && result.error) {
        setErrorMessage(
          result.error.longMessage || result.error.message || 'Failed to resend verification code',
        );
      } else {
        setResendSuccess(true);
      }
    } catch (error: unknown) {
      setErrorMessage(getErrorMessage(error, 'Failed to resend code'));
    } finally {
      setIsResending(false);
    }
  };

  return (
    <AuthShell page="register">
      <section className="w-full max-w-[624px] rounded-[2rem] bg-white px-6 py-9 shadow-[0_22px_65px_rgba(46,39,25,0.08)] sm:px-12 sm:py-12 lg:px-[4.25rem] lg:py-14">
        <div className="mx-auto max-w-[490px]">
          <div className="mb-7 text-center sm:mb-8">
            <p className="mb-3 text-[0.68rem] font-bold uppercase tracking-[0.24em] text-[#d18b43]">
              {copy.register.otpEyebrow}
            </p>
            <h1 className="text-[2rem] font-bold tracking-[-0.055em] text-[#171714] sm:text-[2.25rem]">
              {copy.register.otpTitle}
            </h1>
            <p className="mx-auto mt-3 max-w-[380px] text-[1.02rem] leading-7 text-[#5e5a52]">
              {copy.register.otpSubtitle.replace('{email}', email)}
            </p>
          </div>

          <form onSubmit={handleVerification} className="space-y-4">
            {errorMessage && (
              <p className="rounded-lg bg-red-50 p-3 text-xs text-[#c04f40]" role="alert">
                {errorMessage}
              </p>
            )}
            {resendSuccess && (
              <p className="rounded-lg bg-emerald-50 p-3 text-xs text-[#2e7d32]" role="status">
                {copy.register.otpResent}
              </p>
            )}
            <div>
              <label htmlFor="code" className="sr-only">
                {copy.register.otpLabel}
              </label>
              <input
                id="code"
                name="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder={copy.register.otpPlaceholder}
                value={code}
                onChange={(event) => {
                  setCode(event.target.value);
                  if (errorMessage) setErrorMessage(null);
                }}
                className="h-[3.65rem] w-full rounded-xl border border-[#e2dfd8] bg-white px-5 text-center font-mono text-xl tracking-[0.25em] text-[#171714] outline-none transition-colors placeholder:font-sans placeholder:tracking-normal placeholder:text-[#77736b] hover:border-[#c6c0b5] focus:border-[#171714] focus:ring-2 focus:ring-[#171714]/10"
                required
                autoFocus
              />
            </div>
            <button
              type="submit"
              disabled={!signUp || isLoading || isOnboarding || !code.trim()}
              className="mt-2 flex h-[3.65rem] w-full items-center justify-center rounded-xl bg-[#ffc57d] px-5 text-base font-bold text-[#171714] shadow-[0_8px_18px_rgba(206,145,64,0.14)] transition-all hover:-translate-y-0.5 hover:bg-[#ffbd6c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#171714]/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isOnboarding
                ? copy.register.onboardingPending
                : isLoading
                  ? copy.register.otpLoading
                  : copy.register.otpSubmit}
            </button>
          </form>

          <div className="mt-6 flex flex-col items-center justify-center gap-3 text-sm text-[#5e5a52]">
            <div className="flex items-center gap-1.5">
              <span>{copy.register.otpResendPrompt}</span>
              <button
                type="button"
                disabled={!signUp || isResending}
                onClick={handleResendCode}
                className="font-bold text-[#171714] underline decoration-[#d18b43] underline-offset-4 hover:text-[#d88835] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isResending ? copy.register.otpResending : copy.register.otpResend}
              </button>
            </div>
            <button
              type="button"
              onClick={() => router.push('/register')}
              className="text-xs text-[#77736b] transition-colors hover:text-[#171714] hover:underline"
            >
              ← {copy.register.otpBack}
            </button>
          </div>
        </div>
      </section>
    </AuthShell>
  );
}

export default function Verify() {
  return (
    <Suspense fallback={null}>
      <VerifyForm />
    </Suspense>
  );
}
