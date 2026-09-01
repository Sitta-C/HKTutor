'use client';

import Link from 'next/link';

import {
  CONSENT_REQUIRED_MESSAGE,
  PRIVACY_NOTICE_PATH,
  PRIVACY_POLICY_VERSION,
} from '@/lib/privacy-notice';

export interface PrivacyConsentProps {
  readonly accepted: boolean;
  readonly onAcceptedChange: (accepted: boolean) => void;
  readonly error: string | null;
}

/**
 * S1-T11 onboarding consent control.
 *
 * Consent starts unaccepted, names the version being accepted, and links to the full notice so the
 * user can read it before agreeing. The caller must block submission while `accepted` is false and
 * surface `CONSENT_REQUIRED_MESSAGE` through `error`.
 */
export default function PrivacyConsent({ accepted, onAcceptedChange, error }: PrivacyConsentProps) {
  const errorId = 'policy-error';

  return (
    <div className="mb-7">
      <label className="flex cursor-pointer items-start gap-2.5 py-1 select-none">
        <input
          id="policy"
          name="policy"
          type="checkbox"
          checked={accepted}
          onChange={(e) => onAcceptedChange(e.target.checked)}
          aria-describedby={error ? errorId : undefined}
          aria-invalid={error ? true : undefined}
          className="peer sr-only"
        />
        <div
          aria-hidden="true"
          className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded transition-all peer-focus-visible:ring-2 peer-focus-visible:ring-gray-800 peer-focus-visible:ring-offset-2 ${
            accepted
              ? 'bg-gradient-to-br from-student to-tutor text-white shadow-xs'
              : `border bg-white ${error ? 'border-red-500' : 'border-gray-300 hover:border-gray-400'}`
          }`}
        >
          {accepted && (
            <svg
              className="pointer-events-none h-3 w-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={3}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>
        <span className="cursor-pointer text-sm leading-5 text-gray-800 select-none">
          I have read and accept the{' '}
          <Link
            href={PRIVACY_NOTICE_PATH}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-tutor underline underline-offset-2"
            onClick={(e) => e.stopPropagation()}
          >
            HKTutor privacy notice
          </Link>{' '}
          (version {PRIVACY_POLICY_VERSION}), including the processing of my sign-in details by
          Clerk.
        </span>
      </label>
      {error && (
        <p id={errorId} role="alert" className="mt-1.5 pl-[28px] text-xs text-red-500">
          {error}
        </p>
      )}
    </div>
  );
}

export { CONSENT_REQUIRED_MESSAGE };
