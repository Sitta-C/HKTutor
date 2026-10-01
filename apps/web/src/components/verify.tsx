'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';

import AuthShell from '@/components/auth-shell';
import {
  NotebookButton,
  NotebookField,
  NotebookHeading,
  PaperCard,
  WashiTape,
  notebookInputClass,
} from '@/components/ui/notebook';
import { resendVerification } from '@/lib/api/auth';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/lib/i18n';

const EMAIL_VERIFICATION_CHANNEL = 'hktutor-email-verification';
const ORIGINAL_TAB_RESPONSE_TIMEOUT_MS = 1_500;

type VerificationTabMessage =
  | { eventId: string; type: 'email-verified' }
  | { eventId: string; type: 'email-verified-acknowledged' };

function isVerificationTabMessage(value: unknown): value is VerificationTabMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<VerificationTabMessage>;
  return (
    typeof message.eventId === 'string' &&
    (message.type === 'email-verified' || message.type === 'email-verified-acknowledged')
  );
}

function notifyOriginalTab(): Promise<boolean> {
  if (typeof BroadcastChannel === 'undefined') return Promise.resolve(false);

  return new Promise((resolve) => {
    const channel = new BroadcastChannel(EMAIL_VERIFICATION_CHANNEL);
    const eventId = window.crypto.randomUUID();
    let settled = false;

    const finish = (acknowledged: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      channel.close();
      resolve(acknowledged);
    };

    const timeoutId = window.setTimeout(() => finish(false), ORIGINAL_TAB_RESPONSE_TIMEOUT_MS);

    channel.addEventListener('message', (event: MessageEvent<unknown>) => {
      if (
        isVerificationTabMessage(event.data) &&
        event.data.type === 'email-verified-acknowledged' &&
        event.data.eventId === eventId
      ) {
        finish(true);
      }
    });

    channel.postMessage({ eventId, type: 'email-verified' } satisfies VerificationTabMessage);
  });
}

function VerifyForm() {
  const { verify } = useAuth();
  const { copy } = useLanguage();
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const initialEmail = searchParams.get('email') ?? '';
  const deliveryFailed = searchParams.get('delivery') === 'failed';
  const attemptedToken = useRef<string | null>(null);
  const handledVerificationEvent = useRef(false);
  const [email, setEmail] = useState(initialEmail);
  const [status, setStatus] = useState<'waiting' | 'verifying' | 'verified' | 'error'>(
    token ? 'verifying' : 'waiting',
  );
  const [message, setMessage] = useState(
    token
      ? copy.register.otpLoading
      : deliveryFailed
        ? copy.register.verificationDeliveryFailed
        : copy.register.otpSubtitle.replace('{email}', initialEmail || copy.register.emailLabel),
  );
  const [isResending, setIsResending] = useState(false);

  useEffect(() => {
    if (token || typeof BroadcastChannel === 'undefined') return;

    const channel = new BroadcastChannel(EMAIL_VERIFICATION_CHANNEL);
    const handleMessage = (event: MessageEvent<unknown>) => {
      if (
        handledVerificationEvent.current ||
        !isVerificationTabMessage(event.data) ||
        event.data.type !== 'email-verified'
      ) {
        return;
      }

      handledVerificationEvent.current = true;
      channel.postMessage({
        eventId: event.data.eventId,
        type: 'email-verified-acknowledged',
      } satisfies VerificationTabMessage);

      // A full navigation makes this tab bootstrap auth from the refresh cookie
      // that the verification request set in the other tab.
      window.setTimeout(() => window.location.replace('/onboarding/profile'), 50);
    };

    channel.addEventListener('message', handleMessage);
    return () => {
      channel.removeEventListener('message', handleMessage);
      channel.close();
    };
  }, [token]);

  useEffect(() => {
    if (!token || attemptedToken.current === token) return;
    attemptedToken.current = token;
    verify(token)
      .then(async () => {
        setStatus('verified');
        const originalTabAcknowledged = await notifyOriginalTab();

        if (!originalTabAcknowledged) {
          router.replace('/onboarding/profile');
          return;
        }

        setMessage(copy.register.verificationReturningToOriginalTab);
        window.close();

        // Some browsers refuse programmatic closing. Keep a clear manual fallback
        // instead of opening a second dashboard in that tab.
        window.setTimeout(() => {
          setMessage(copy.register.verificationCloseTab);
        }, 250);
      })
      .catch(() => {
        setStatus('error');
        setMessage(copy.register.verificationFailed);
      });
  }, [
    copy.register.verificationCloseTab,
    copy.register.verificationFailed,
    copy.register.verificationReturningToOriginalTab,
    router,
    token,
    verify,
  ]);

  const handleResend = async () => {
    if (!email.trim()) return;
    setIsResending(true);
    try {
      await resendVerification(email.trim());
      setStatus('waiting');
      setMessage(copy.register.otpResent);
    } catch {
      setStatus('error');
      setMessage(copy.register.resendFailed);
    } finally {
      setIsResending(false);
    }
  };

  return (
    <AuthShell page="register">
      <PaperCard className="w-full max-w-[624px] px-6 py-10 sm:px-12 sm:py-14 lg:px-[4.25rem] lg:py-[4.5rem]">
        <WashiTape tone="yellow" className="left-1/2 top-0 -translate-x-1/2 -translate-y-1/2" />
        <div className="mx-auto max-w-[490px] text-center">
          <NotebookHeading
            eyebrow={copy.register.otpEyebrow}
            title={status === 'verifying' ? copy.register.otpLoading : copy.register.otpTitle}
            align="center"
          />
          <p
            className={`mx-auto mt-4 max-w-[390px] leading-7 ${status === 'error' ? 'text-red-700' : 'text-notebook-muted'}`}
            role={status === 'error' ? 'alert' : 'status'}
          >
            {message}
          </p>

          {(status === 'waiting' || status === 'error') && (
            <div className="mt-8 space-y-3">
              <NotebookField
                htmlFor="verificationEmail"
                label={copy.register.emailLabel}
                className="text-left"
              >
                <input
                  id="verificationEmail"
                  type="email"
                  autoComplete="email"
                  placeholder={copy.register.emailPlaceholder}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className={notebookInputClass({ className: 'h-[3.65rem] text-left' })}
                />
              </NotebookField>
              <NotebookButton
                type="button"
                onClick={handleResend}
                disabled={isResending || !email.trim()}
                className="h-[3.65rem] w-full text-base"
              >
                {isResending ? copy.register.otpResending : copy.register.otpResend}
              </NotebookButton>
            </div>
          )}

          {status === 'verified' && (
            <NotebookButton
              type="button"
              onClick={() => window.close()}
              className="mt-8 h-[3.65rem] w-full text-base"
            >
              {copy.register.closeVerificationTab}
            </NotebookButton>
          )}

          {status !== 'verified' && (
            <Link
              href="/"
              className="mt-7 inline-block text-sm font-bold text-notebook-ink underline decoration-margin-guide decoration-2 underline-offset-4 hover:text-amber-700"
            >
              {copy.register.signIn}
            </Link>
          )}
        </div>
      </PaperCard>
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
