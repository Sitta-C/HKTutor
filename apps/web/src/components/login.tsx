'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useSignIn, useAuth } from '@clerk/nextjs';

import AuthShell, { AuthSocialButtons, EyeIcon } from '@/components/auth-shell';
import { useLanguage } from '@/lib/i18n';

import type { FormEvent } from 'react';

export default function Login() {
  const { copy } = useLanguage();
  const { signIn, setActive, isLoaded } = useSignIn();
  const { getToken } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isLoaded) return;

    setIsLoading(true);
    setErrorMessage(null);
    
    // sign in and acquire token
    try {
      // 1. Authenticate credentials with Clerk
      const result = await signIn.create({
        identifier: email,
        password,
      });
      

      if (result.status === 'complete') {
        // 2. Set the active session in browser
        await setActive({ session: result.createdSessionId });

        // 3. Acquire a token
        const token = await getToken();
        console.log('Clerk JWT Token:', token);

        // 4. Call backend
        await fetch('/api/src/auth', {
          headers: { Authorization: `Bearer ${token}` }
        });

        router.push('/dashboard');
      } else {
        console.warn('Additional verification steps required:', result);
      }
    } catch (err: any) {
      setErrorMessage(err.errors?.[0]?.longMessage || 'Failed to sign in');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthShell page="login">
      <section className="w-full max-w-[624px] rounded-[2rem] bg-white px-6 py-10 shadow-[0_22px_65px_rgba(46,39,25,0.08)] sm:px-12 sm:py-14 lg:px-[4.25rem] lg:py-[4.5rem]">
        <div className="mx-auto max-w-[490px]">
          <div className="mb-8 text-center sm:mb-9">
            <p className="mb-3 text-[0.68rem] font-bold uppercase tracking-[0.24em] text-[#d18b43]">
              {copy.login.eyebrow}
            </p>
            <h1 className="text-[2.1rem] font-bold tracking-[-0.055em] text-[#171714] sm:text-[2.35rem]">
              {copy.login.title}
            </h1>
            <p className="mx-auto mt-3 max-w-[330px] text-[1.02rem] leading-7 text-[#5e5a52] sm:text-[1.1rem]">
              {copy.login.subtitle}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {errorMessage && (
              <p className="rounded-lg bg-red-50 p-3 text-xs text-[#c04f40]" role="alert">
                {errorMessage}
              </p>
            )}

            <div>
              <label htmlFor="email" className="sr-only">
                {copy.login.emailLabel}
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder={copy.login.emailPlaceholder}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="h-[3.9rem] w-full rounded-xl border border-[#e2dfd8] bg-white px-5 text-[0.98rem] text-[#171714] outline-none transition-colors placeholder:text-[#77736b] hover:border-[#c6c0b5] focus:border-[#171714] focus:ring-2 focus:ring-[#171714]/10"
                required
              />
            </div>

            <div className="relative">
              <label htmlFor="password" className="sr-only">
                {copy.login.passwordLabel}
              </label>
              <input
                id="password"
                type={isPasswordVisible ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder={copy.login.passwordPlaceholder}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="h-[3.9rem] w-full rounded-xl border border-[#e2dfd8] bg-white px-5 pr-14 text-[0.98rem] text-[#171714] outline-none transition-colors placeholder:text-[#77736b] hover:border-[#c6c0b5] focus:border-[#171714] focus:ring-2 focus:ring-[#171714]/10"
                required
              />
              <button
                type="button"
                aria-label={isPasswordVisible ? copy.login.hidePassword : copy.login.showPassword}
                aria-pressed={isPasswordVisible}
                onClick={() => setIsPasswordVisible((visible) => !visible)}
                className="absolute right-4 top-1/2 -translate-y-1/2 rounded-md p-1 text-[#77736b] transition-colors hover:text-[#171714] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#171714]/20"
              >
                <EyeIcon visible={isPasswordVisible} />
              </button>
            </div>

            <p className="pt-1 text-sm text-[#5e5a52]">{copy.login.trouble}</p>

            <button
              type="submit"
              disabled={isLoading || !isLoaded}
              className="mt-2 flex h-[3.9rem] w-full items-center justify-center rounded-xl bg-[#ffc57d] px-5 text-base font-bold text-[#171714] shadow-[0_8px_18px_rgba(206,145,64,0.14)] transition-all hover:-translate-y-0.5 hover:bg-[#ffbd6c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#171714]/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoading ? copy.login.loading : copy.login.submit}
            </button>
          </form>

          <div className="my-8 flex items-center gap-3 text-sm text-[#77736b]">
            <span className="h-px flex-1 bg-[#e2dfd8]" />
            <span>{copy.social.dividerLogin}</span>
            <span className="h-px flex-1 bg-[#e2dfd8]" />
          </div>

          <AuthSocialButtons />

          <p className="mt-8 text-center text-sm text-[#5e5a52]">
            {copy.login.newTo}{' '}
            <Link
              href="/register"
              className="font-bold text-[#171714] underline decoration-[#d18b43] underline-offset-4 hover:text-[#d88835]"
            >
              {copy.login.createAccount}
            </Link>
          </p>
        </div>
      </section>
    </AuthShell>
  );
}