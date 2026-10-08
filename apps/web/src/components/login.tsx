'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

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
import { useNotebookToast } from '@/components/ui/notebook-toast';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/lib/i18n';
import { sanitizeReturnTo } from '@/lib/return-to';

import type { FormEvent } from 'react';

export default function Login() {
  const { copy } = useLanguage();
  const toast = useNotebookToast();
  const { isLoading: isAuthLoading, login, user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = sanitizeReturnTo(searchParams.get('returnTo'));

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const passwordHelpRef = useRef<HTMLDialogElement>(null);

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
      toast.success(copy.login.signedIn);
      router.replace(returnTo);
    } catch {
      setErrorMessage(copy.login.failed);
      toast.error(copy.login.failed);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthShell page="login">
      <PaperCard className="w-full max-w-[624px] px-6 pb-6 pt-10 sm:px-12 sm:pb-8 sm:pt-14 lg:px-[4.25rem] lg:pb-8 lg:pt-[4.5rem]">
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
              <StickyNote
                tone="pink"
                className="px-4 py-3 text-sm leading-relaxed text-stone-700"
                role="alert"
              >
                {errorMessage}
              </StickyNote>
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

            <div className="!mt-2 flex justify-end">
              <button
                type="button"
                aria-haspopup="dialog"
                aria-controls="password-help"
                onClick={() => passwordHelpRef.current?.showModal()}
                className="min-h-10 cursor-pointer rounded-sm px-1 !text-sm font-medium text-amber-700 underline decoration-amber-700/40 underline-offset-4 transition-colors hover:text-amber-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-notebook-ink/30 focus-visible:ring-offset-2"
              >
                {copy.login.forgotPassword}
              </button>
            </div>

            <NotebookButton
              type="submit"
              disabled={isLoading || isAuthLoading}
              className="!mt-4 h-[3.65rem] w-full text-base"
            >
              {isLoading ? copy.login.loading : copy.login.submit}
            </NotebookButton>
          </form>

          <p className="mt-6 text-center text-sm text-notebook-muted">
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
      <dialog
        id="password-help"
        ref={passwordHelpRef}
        aria-labelledby="password-help-title"
        aria-describedby="password-help-description"
        className="m-auto w-[min(92vw,420px)] rounded-[1.5rem] border border-paper-edge bg-paper p-6 text-notebook-ink shadow-paper backdrop:bg-stone-900/45 sm:p-8"
      >
        <h2 id="password-help-title" className="text-xl font-bold">
          {copy.login.forgotPassword}
        </h2>
        <p id="password-help-description" className="mt-3 text-sm leading-7 text-notebook-muted">
          {copy.login.passwordResetUnavailable}
        </p>
        <form method="dialog" className="mt-6 text-right">
          <NotebookButton type="submit">{copy.login.closePasswordHelp}</NotebookButton>
        </form>
      </dialog>
    </AuthShell>
  );
}
