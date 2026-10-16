'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useRef, useState } from 'react';

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
import { requestPasswordReset, resendPasswordReset } from '@/lib/api/auth';
import { ApiError } from '@/lib/api/error';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/lib/i18n';
import { formatResendTime, useEmailFlow } from '@/lib/use-email-flow';

import type { FormEvent } from 'react';

type RecoveryError =
  'mismatch' | 'invalidLink' | 'failed' | 'rateLimited' | 'requirements' | 'flowChanged';

export default function PasswordRecovery({ mode }: { mode: 'request' | 'reset' }) {
  const { copy } = useLanguage();
  const text = copy.passwordRecovery;
  const toast = useNotebookToast();
  const { resetPassword, isLoading: isAuthLoading } = useAuth();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const isReset = mode === 'reset';
  const malformedLink = isReset && !/^[A-Za-z0-9_-]{43}$/.test(token);
  const resend = useEmailFlow('password-reset', !isReset);
  const [newRequest, setNewRequest] = useState(false);
  const selectedFlow = newRequest ? null : resend.flow;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const [error, setError] = useState<RecoveryError | null>(null);
  const submitting = useRef(false);
  const confirmationRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const message = malformedLink
    ? text.invalidLink
    : error === 'requirements'
      ? copy.register.passwordRequirements
      : error === 'flowChanged'
        ? copy.emailResend.changed
        : error
          ? text[error]
          : null;
  const invalidLink = !succeeded && (malformedLink || error === 'invalidLink');

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (
      submitting.current ||
      malformedLink ||
      isAuthLoading ||
      (!isReset &&
        (resend.loading || (selectedFlow && (resend.failed || resend.remainingSeconds > 0))))
    ) {
      return;
    }
    setError(null);
    if (isReset && password !== confirmation) {
      setError('mismatch');
      toast.error(text.mismatch);
      confirmationRef.current?.focus();
      return;
    }
    if (isReset && (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password))) {
      setError('requirements');
      toast.error(copy.register.passwordRequirements);
      passwordRef.current?.focus();
      return;
    }
    submitting.current = true;
    setPending(true);
    try {
      if (isReset) {
        await resetPassword({ token, password });
        // Remove the credential from browser history after it is consumed.
        window.history.replaceState(null, '', '/reset-password');
      } else {
        const result = selectedFlow
          ? await resendPasswordReset(selectedFlow.id)
          : await requestPasswordReset(email);
        resend.accept(result.emailFlow);
        setNewRequest(false);
      }
      setPassword('');
      setConfirmation('');
      setSucceeded(isReset);
      toast.success(isReset ? text.success : text.sent);
    } catch (failure) {
      if (!isReset && selectedFlow) {
        resend.refresh();
      }
      const key =
        failure instanceof ApiError && failure.status === 429
          ? 'rateLimited'
          : !isReset && selectedFlow && failure instanceof ApiError && failure.status === 400
            ? 'flowChanged'
            : isReset && failure instanceof ApiError && failure.status === 400
              ? 'invalidLink'
              : 'failed';
      setError(key);
      toast.error(key === 'flowChanged' ? copy.emailResend.changed : text[key]);
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <AuthShell page="recovery">
      <PaperCard className="relative w-full max-w-[624px] px-6 py-10 sm:px-12 sm:py-12">
        <WashiTape tone="blue" className="left-1/2 top-0 -translate-x-1/2 -translate-y-1/2" />
        <NotebookHeading
          eyebrow={text.eyebrow}
          title={isReset ? text.resetTitle : text.requestTitle}
          description={isReset ? text.resetDescription : text.requestDescription}
          align="center"
          className="mb-8"
        />
        {succeeded ? (
          <StickyNote tone="yellow" className="p-4 text-sm leading-7" role="status">
            {isReset ? text.success : text.sent}
          </StickyNote>
        ) : (
          <>
            {!isReset && selectedFlow && (
              <StickyNote tone="yellow" className="mb-5 p-4 text-sm leading-7" role="status">
                {text.sent}
              </StickyNote>
            )}
            {message && (
              <StickyNote tone="pink" className="mb-5 p-4 text-sm leading-7" role="alert">
                {message}
              </StickyNote>
            )}
            {!invalidLink && (
              <form onSubmit={handleSubmit} className="space-y-5" aria-busy={pending}>
                {isReset ? (
                  <>
                    <NotebookField htmlFor="new-password" label={text.newPassword}>
                      <div className="relative">
                        <input
                          ref={passwordRef}
                          id="new-password"
                          type={visible ? 'text' : 'password'}
                          autoComplete="new-password"
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                          minLength={10}
                          maxLength={128}
                          required
                          disabled={pending}
                          aria-describedby="password-requirements"
                          aria-invalid={error === 'requirements'}
                          className={notebookInputClass({ className: 'pr-14' })}
                        />
                        <button
                          type="button"
                          aria-label={visible ? copy.login.hidePassword : copy.login.showPassword}
                          aria-pressed={visible}
                          onClick={() => setVisible((current) => !current)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-2 focus-visible:outline-2"
                        >
                          <EyeIcon visible={visible} />
                        </button>
                      </div>
                      <p id="password-requirements" className="mt-2 text-sm text-notebook-muted">
                        {copy.register.passwordRequirements}
                      </p>
                    </NotebookField>
                    <NotebookField htmlFor="confirm-password" label={text.confirmPassword}>
                      <input
                        ref={confirmationRef}
                        id="confirm-password"
                        type={visible ? 'text' : 'password'}
                        autoComplete="new-password"
                        value={confirmation}
                        onChange={(event) => setConfirmation(event.target.value)}
                        minLength={10}
                        maxLength={128}
                        required
                        disabled={pending}
                        aria-invalid={error === 'mismatch'}
                        className={notebookInputClass()}
                      />
                    </NotebookField>
                  </>
                ) : (
                  <NotebookField htmlFor="recovery-email" label={copy.login.emailLabel}>
                    <input
                      id="recovery-email"
                      type="email"
                      autoComplete="email"
                      value={selectedFlow?.email ?? email}
                      readOnly={Boolean(selectedFlow)}
                      aria-readonly={Boolean(selectedFlow)}
                      onChange={(event) => setEmail(event.target.value)}
                      maxLength={254}
                      required
                      disabled={pending}
                      className={notebookInputClass()}
                    />
                  </NotebookField>
                )}
                {!isReset && resend.failed && selectedFlow && (
                  <NotebookButton type="button" tone="secondary" onClick={resend.refresh}>
                    {copy.emailResend.retry}
                  </NotebookButton>
                )}
                <NotebookButton
                  type="submit"
                  disabled={
                    pending ||
                    isAuthLoading ||
                    (!isReset &&
                      (resend.loading ||
                        (Boolean(selectedFlow) && (resend.failed || resend.remainingSeconds > 0))))
                  }
                  className="w-full"
                >
                  {isReset
                    ? pending
                      ? text.saving
                      : text.save
                    : pending
                      ? text.sending
                      : resend.loading
                        ? copy.emailResend.loading
                        : selectedFlow && resend.remainingSeconds > 0
                          ? copy.emailResend.wait.replace(
                              '{time}',
                              formatResendTime(resend.remainingSeconds),
                            )
                          : selectedFlow
                            ? copy.emailResend.sendAgain
                            : text.send}
                </NotebookButton>
              </form>
            )}
          </>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-3 text-center text-sm">
          <Link
            href="/"
            className="rounded-sm p-2 font-bold underline underline-offset-4 focus-visible:outline-2"
          >
            {text.backToLogin}
          </Link>
          {invalidLink && (
            <Link
              href="/forgot-password"
              onClick={() => {
                setSucceeded(false);
                setError(null);
              }}
              className="rounded-sm p-2 text-amber-700 underline underline-offset-4 focus-visible:outline-2"
            >
              {text.requestAnother}
            </Link>
          )}
          {!isReset && selectedFlow && (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setNewRequest(true);
                setEmail('');
                setError(null);
              }}
              className="rounded-sm p-2 text-amber-700 underline underline-offset-4 focus-visible:outline-2"
            >
              {copy.emailResend.wrongEmail} {copy.emailResend.startAgain}
            </button>
          )}
        </div>
      </PaperCard>
    </AuthShell>
  );
}
