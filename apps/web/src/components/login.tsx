'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import AuthShell, { EyeIcon } from '@/components/auth-shell';
import {
  NotebookButton,
  NotebookField,
  NotebookHeading,
  PaperCard,
  StickyNote,
  WashiTape,
  notebookInputClass,
} from '@/components/ui/notebook';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/lib/i18n';
import { sanitizeReturnTo } from '@/lib/return-to';

import type { FormEvent } from 'react';

export default function Login() {
  const { copy } = useLanguage();
  const { isLoading: isAuthLoading, login, user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = sanitizeReturnTo(searchParams.get('returnTo'));

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthLoading && user) router.replace(returnTo);
  }, [isAuthLoading, returnTo, router, user]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isAuthLoading) return;

    setIsLoading(true);
    setErrorMessage(null);

    try {
      await login(email, password);
      router.replace(returnTo);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : copy.login.failed);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthShell page="login">
      <PaperCard className="w-full max-w-[624px] px-6 py-10 sm:px-12 sm:py-14 lg:px-[4.25rem] lg:py-[4.5rem]">
        <WashiTape tone="blue" className="left-1/2 top-0 -translate-x-1/2 -translate-y-1/2" />
        <div className="mx-auto max-w-[490px]">
          <NotebookHeading
            eyebrow={copy.login.eyebrow}
            title={copy.login.title}
            description={copy.login.subtitle}
            align="center"
            className="mb-8 sm:mb-9"
          />

          <form onSubmit={handleSubmit} className="space-y-4">
            {errorMessage && (
              <p
                className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700"
                role="alert"
              >
                {errorMessage}
              </p>
            )}

            <NotebookField htmlFor="email" label={copy.login.emailLabel}>
              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder={copy.login.emailPlaceholder}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={notebookInputClass({ className: 'h-[3.65rem]' })}
                required
              />
            </NotebookField>

            <NotebookField htmlFor="password" label={copy.login.passwordLabel}>
              <div className="relative">
                <input
                  id="password"
                  type={isPasswordVisible ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder={copy.login.passwordPlaceholder}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className={notebookInputClass({ className: 'h-[3.65rem] pr-14' })}
                  required
                />
                <button
                  type="button"
                  aria-label={isPasswordVisible ? copy.login.hidePassword : copy.login.showPassword}
                  aria-pressed={isPasswordVisible}
                  onClick={() => setIsPasswordVisible((visible) => !visible)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 rounded-md p-1 text-notebook-muted transition-colors hover:text-notebook-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-notebook-ink/20"
                >
                  <EyeIcon visible={isPasswordVisible} />
                </button>
              </div>
            </NotebookField>

            <StickyNote tone="pink" className="!mt-5 -rotate-1 px-4 py-3">
              <p className="font-note text-lg font-semibold leading-snug text-stone-700">
                {copy.login.trouble}
              </p>
            </StickyNote>

            <NotebookButton
              type="submit"
              disabled={isLoading || isAuthLoading}
              className="!mt-6 h-[3.65rem] w-full text-base"
            >
              {isLoading ? copy.login.loading : copy.login.submit}
            </NotebookButton>
          </form>

          <p className="mt-8 text-center text-sm text-notebook-muted">
            {copy.login.newTo}{' '}
            <Link
              href="/register"
              className="font-bold text-notebook-ink underline decoration-margin-guide decoration-2 underline-offset-4 hover:text-amber-700"
            >
              {copy.login.createAccount}
            </Link>
          </p>
        </div>
      </PaperCard>
    </AuthShell>
  );
}
