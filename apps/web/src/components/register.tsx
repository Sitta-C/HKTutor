'use client';

const apiBaseUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useSignUp, useAuth, useClerk, SignUp } from '@clerk/nextjs';

import AuthShell, { AuthSocialButtons, EyeIcon } from '@/components/auth-shell';
import PrivacyConsent from '@/components/privacy-consent';
import { useLanguage } from '@/lib/i18n';
import { buildOnboardingConsent } from '@/lib/privacy-notice';

import type { FormEvent } from 'react';

type Role = 'student' | 'tutor';

export default function Register() {
  const { copy } = useLanguage();
  const { signUp, fetchStatus, errors } = useSignUp();
  const { setActive } = useClerk();
  const { getToken } = useAuth();
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
  const [ code ] = useState('');

  const handleConsentChange = (accepted: boolean) => {
    setAcceptedPolicy(accepted);
    if (accepted) {
      setConsentError(null);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    console.log('Form submit triggered. fetchStatus:', fetchStatus);

    if (password !== confirmPassword) {
      setPasswordError(copy.register.passwordMismatch);
      return;
    }
    setPasswordError('');

    // TODO: Weak Password check (or just let Clerk do it)
    if (!acceptedPolicy) {
      setConsentError(copy.register.policyRequired);
      return;
    }
    setConsentError(null);
    setErrorMessage(null);
    
    // authentication with Clerk
    setIsLoading(true);
    try {
      // Create user in Clerk with with password
      const { error } = await signUp.password({
        emailAddress: email,
        password,
      });

      if (error) {
        setErrorMessage(error.longMessage || error.message || 'Registration failed');
        setIsLoading(false);
        return;
      }

      // email verification
      await signUp.verifications.sendEmailCode();
      console.log('verification email sent')
      setIsLoading(false);

      

    } catch (err: any) {
      console.error('Registration Error:', err);
      setErrorMessage(err.errors?.[0]?.longMessage || err.message || 'Registration failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerification = async () => {
    await signUp.verifications.verifyEmailCode({code});

    if (signUp.status === 'complete') {
      await signUp.finalize({
        navigate: ({ session, decorateUrl }) => {
          if (session?.currentTask) {
            console.log(session?.currentTask);
            return;
          }

          const url = decorateUrl('/');
          if (url.startsWith('http')) {
            window.location.href = url;
          }
          else {
            router.push(url); 
          }
        }
      })
    }
    // sign-up fails
    else {
      console.error("sign-up fail: ", signUp)
    }
  }
  

  return (
    <AuthShell page="register">
      <section className="w-full max-w-[624px] rounded-[2rem] bg-white px-6 py-9 shadow-[0_22px_65px_rgba(46,39,25,0.08)] sm:px-12 sm:py-12 lg:px-[4.25rem] lg:py-14">
        <div className="mx-auto max-w-[490px]">
          <div className="mb-7 text-center sm:mb-8">
            <p className="mb-3 text-[0.68rem] font-bold uppercase tracking-[0.24em] text-[#d18b43]">
              {copy.register.eyebrow}
            </p>
            <h1 className="text-[2rem] font-bold tracking-[-0.055em] text-[#171714] sm:text-[2.25rem]">
              {copy.register.title}
            </h1>
            <p className="mx-auto mt-3 max-w-[360px] text-[1.02rem] leading-7 text-[#5e5a52]">
              {copy.register.subtitle}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3.5">
            {errorMessage && (
              <p className="rounded-lg bg-red-50 p-3 text-xs text-[#c04f40]" role="alert">
                {errorMessage}
              </p>
            )}

            <div>
              <label htmlFor="email" className="sr-only">
                {copy.register.emailLabel}
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder={copy.register.emailPlaceholder}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="h-[3.65rem] w-full rounded-xl border border-[#e2dfd8] bg-white px-5 text-[0.98rem] text-[#171714] outline-none transition-colors placeholder:text-[#77736b] hover:border-[#c6c0b5] focus:border-[#171714] focus:ring-2 focus:ring-[#171714]/10"
                required
              />
            </div>

            <div className="relative">
              <label htmlFor="password" className="sr-only">
                {copy.register.passwordLabel}
              </label>
              <input
                id="password"
                type={isPasswordVisible ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder={copy.register.passwordPlaceholder}
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  if (passwordError) setPasswordError('');
                }}
                className="h-[3.65rem] w-full rounded-xl border border-[#e2dfd8] bg-white px-5 pr-14 text-[0.98rem] text-[#171714] outline-none transition-colors placeholder:text-[#77736b] hover:border-[#c6c0b5] focus:border-[#171714] focus:ring-2 focus:ring-[#171714]/10"
                required
              />
              <button
                type="button"
                aria-label={
                  isPasswordVisible ? copy.register.hidePassword : copy.register.showPassword
                }
                aria-pressed={isPasswordVisible}
                onClick={() => setIsPasswordVisible((visible) => !visible)}
                className="absolute right-4 top-1/2 -translate-y-1/2 rounded-md p-1 text-[#77736b] transition-colors hover:text-[#171714] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#171714]/20"
              >
                <EyeIcon visible={isPasswordVisible} />
              </button>
            </div>

            <div className="relative">
              <label htmlFor="confirmPassword" className="sr-only">
                {copy.register.confirmPasswordLabel}
              </label>
              <input
                id="confirmPassword"
                type={isConfirmPasswordVisible ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder={copy.register.confirmPasswordPlaceholder}
                value={confirmPassword}
                onChange={(event) => {
                  setConfirmPassword(event.target.value);
                  if (passwordError) setPasswordError('');
                }}
                className={`h-[3.65rem] w-full rounded-xl border bg-[#faf9f6] px-5 pr-14 text-[0.98rem] text-[#171714] outline-none transition-colors placeholder:text-[#77736b] hover:border-[#c6c0b5] focus:ring-2 focus:ring-[#171714]/10 ${
                  passwordError
                    ? 'border-[#d96452] focus:border-[#d96452]'
                    : 'border-[#e2dfd8] focus:border-[#171714]'
                }`}
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
                className="absolute right-4 top-1/2 -translate-y-1/2 rounded-md p-1 text-[#77736b] transition-colors hover:text-[#171714] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#171714]/20"
              >
                <EyeIcon visible={isConfirmPasswordVisible} />
              </button>
              {passwordError && (
                <p className="mt-1.5 text-xs text-[#c04f40]" role="alert">
                  {passwordError}
                </p>
              )}
            </div>

            <div className="space-y-3 pt-2">
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
            </div>

            {/* Clerk's CAPTCHA widget */}
            <div className="my-3 flex justify-center min-h-[65px]">
              <div id="clerk-captcha"></div>
            </div>

            <button
              type="submit"
              disabled={isLoading /* || !(fetchStatus === 'fetching') */}
              className="mt-2 flex h-[3.65rem] w-full items-center justify-center rounded-xl bg-[#ffc57d] px-5 text-base font-bold text-[#171714] shadow-[0_8px_18px_rgba(206,145,64,0.14)] transition-all hover:-translate-y-0.5 hover:bg-[#ffbd6c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#171714]/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoading ? copy.register.loading : copy.register.submit}
            </button>

            {/* OTP verification */}
            <div>
              <label htmlFor='code' className='sr-only'>
                
              </label>
              <input
              id='code'
              
              value={code}
              onKeyDown={(e) => { if (e.key === "Enter") handleVerification();}}
              className="h-[3.65rem] w-full rounded-xl border border-[#e2dfd8] bg-white px-5 text-[0.98rem] text-[#171714] outline-none transition-colors placeholder:text-[#77736b] hover:border-[#c6c0b5] focus:border-[#171714] focus:ring-2 focus:ring-[#171714]/10"
              />
            </div>
          </form>

          <div className="my-7 flex items-center gap-3 text-sm text-[#77736b]">
            <span className="h-px flex-1 bg-[#e2dfd8]" />
            <span>{copy.social.dividerRegister}</span>
            <span className="h-px flex-1 bg-[#e2dfd8]" />
          </div>

          <AuthSocialButtons />

          <p className="mt-7 text-center text-sm text-[#5e5a52]">
            {copy.register.already}{' '}
            <Link
              href="/"
              className="font-bold text-[#171714] underline decoration-[#d18b43] underline-offset-4 hover:text-[#d88835]"
            >
              {copy.register.signIn}
            </Link>
          </p>
        </div>
      </section>
    </AuthShell>
  );
}