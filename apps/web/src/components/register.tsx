'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import AuthShell, { EyeIcon } from '@/components/auth-shell';
import PrivacyConsent from '@/components/privacy-consent';
import {
  NotebookButton,
  NotebookField,
  NotebookHeading,
  PaperCard,
  WashiTape,
  notebookInputClass,
} from '@/components/ui/notebook';
import { useNotebookToast } from '@/components/ui/notebook-toast';
import { ApiError } from '@/lib/api/error';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/lib/i18n';
import { buildOnboardingConsent } from '@/lib/privacy-notice';

import type { FormEvent } from 'react';

type Role = 'student' | 'tutor';

export default function Register() {
  const { copy } = useLanguage();
  const toast = useNotebookToast();
  const { register } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [role, setRole] = useState<Role>('student');
  const [acceptedPolicy, setAcceptedPolicy] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isConfirmPasswordVisible, setIsConfirmPasswordVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleConsentChange = (accepted: boolean) => {
    setAcceptedPolicy(accepted);
    if (accepted) {
      setConsentError(null);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (password !== confirmPassword) {
      setPasswordError(copy.register.passwordMismatch);
      toast.error(copy.register.passwordMismatch);
      return;
    }
    setPasswordError('');

    if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      setPasswordError(copy.register.passwordRequirements);
      toast.error(copy.register.passwordRequirements);
      return;
    }

    if (!acceptedPolicy) {
      setConsentError(copy.register.policyRequired);
      toast.error(copy.register.policyRequired);
      return;
    }
    setConsentError(null);
    setErrorMessage(null);

    setIsLoading(true);
    try {
      await register({
        email,
        password,
        role,
        ...buildOnboardingConsent(acceptedPolicy),
      });
      toast.success(copy.register.accountCreated);
      router.push(`/register/verify?email=${encodeURIComponent(email)}`);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 503) {
        toast.error(copy.register.verificationDeliveryFailed);
        router.push(`/register/verify?email=${encodeURIComponent(email)}&delivery=failed`);
        return;
      }
      setErrorMessage(copy.register.registrationFailed);
      toast.error(copy.register.registrationFailed);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthShell page="register">
      <PaperCard className="w-full max-w-[624px] px-6 py-9 sm:px-12 sm:py-12 lg:px-[4.25rem] lg:py-14">
        <WashiTape
          tone="pink"
          className="left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 rotate-1"
        />
        <div className="mx-auto max-w-[490px]">
          <div>
            <NotebookHeading
              eyebrow={copy.register.eyebrow}
              title={copy.register.title}
              description={copy.register.subtitle}
              align="center"
              className="mb-7 sm:mb-8"
            />

            <form onSubmit={handleSubmit} className="space-y-3.5">
              {errorMessage && (
                <p
                  className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700"
                  role="alert"
                >
                  {errorMessage}
                </p>
              )}

              <NotebookField htmlFor="email" label={copy.register.emailLabel}>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder={copy.register.emailPlaceholder}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className={notebookInputClass({ className: 'h-[3.65rem]' })}
                  required
                />
              </NotebookField>

              <NotebookField htmlFor="password" label={copy.register.passwordLabel}>
                <div className="relative">
                  <input
                    id="password"
                    type={isPasswordVisible ? 'text' : 'password'}
                    autoComplete="new-password"
                    minLength={10}
                    placeholder={copy.register.passwordPlaceholder}
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      if (passwordError) setPasswordError('');
                    }}
                    className={notebookInputClass({ className: 'h-[3.65rem] pr-14' })}
                    required
                  />
                  <button
                    type="button"
                    aria-label={
                      isPasswordVisible ? copy.register.hidePassword : copy.register.showPassword
                    }
                    aria-pressed={isPasswordVisible}
                    onClick={() => setIsPasswordVisible((visible) => !visible)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 rounded-md p-1 text-notebook-muted transition-colors hover:text-notebook-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-notebook-ink/20"
                  >
                    <EyeIcon visible={isPasswordVisible} />
                  </button>
                </div>
              </NotebookField>

              <NotebookField
                htmlFor="confirmPassword"
                label={copy.register.confirmPasswordLabel}
                error={passwordError || undefined}
              >
                <div className="relative">
                  <input
                    id="confirmPassword"
                    type={isConfirmPasswordVisible ? 'text' : 'password'}
                    autoComplete="new-password"
                    minLength={10}
                    placeholder={copy.register.confirmPasswordPlaceholder}
                    value={confirmPassword}
                    aria-invalid={Boolean(passwordError)}
                    onChange={(event) => {
                      setConfirmPassword(event.target.value);
                      if (passwordError) setPasswordError('');
                    }}
                    className={notebookInputClass({
                      error: Boolean(passwordError),
                      className: 'h-[3.65rem] pr-14',
                    })}
                    required
                  />
                  <button
                    type="button"
                    aria-label={
                      isConfirmPasswordVisible
                        ? copy.register.hideConfirmPassword
                        : copy.register.showConfirmPassword
                    }
                    aria-pressed={isConfirmPasswordVisible}
                    onClick={() => setIsConfirmPasswordVisible((visible) => !visible)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 rounded-md p-1 text-notebook-muted transition-colors hover:text-notebook-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-notebook-ink/20"
                  >
                    <EyeIcon visible={isConfirmPasswordVisible} />
                  </button>
                </div>
              </NotebookField>

              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm font-semibold text-notebook-ink">
                    {copy.register.joiningAs}
                  </span>
                  <div
                    className="grid grid-cols-2 rounded-lg border border-paper-edge bg-paper-deep p-1"
                    role="group"
                    aria-label={copy.register.chooseRole}
                  >
                    <button
                      type="button"
                      aria-pressed={role === 'student'}
                      onClick={() => setRole('student')}
                      className={`min-h-10 rounded-lg px-4 text-sm font-semibold transition-colors ${
                        role === 'student'
                          ? 'bg-notebook-ink text-paper shadow-sm'
                          : 'text-notebook-muted hover:text-notebook-ink'
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
                          ? 'bg-notebook-ink text-paper shadow-sm'
                          : 'text-notebook-muted hover:text-notebook-ink'
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
              </div>

              <NotebookButton
                type="submit"
                disabled={isLoading}
                className="!mt-5 h-[3.65rem] w-full text-base"
              >
                {isLoading ? copy.register.loading : copy.register.submit}
              </NotebookButton>
            </form>

            <p className="mt-7 text-center text-sm text-notebook-muted">
              {copy.register.already}{' '}
              <Link
                href="/"
                className="font-bold text-notebook-ink underline decoration-margin-guide decoration-2 underline-offset-4 hover:text-amber-700"
              >
                {copy.register.signIn}
              </Link>
            </p>
          </div>
        </div>
      </PaperCard>
    </AuthShell>
  );
}
