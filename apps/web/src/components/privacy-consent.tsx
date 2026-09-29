'use client';

import { useState } from 'react';

import PrivacyNoticeModal from '@/components/privacy-notice-modal';
import { useLanguage } from '@/lib/i18n';
import { PRIVACY_POLICY_VERSION } from '@/lib/privacy-notice';

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
 * pass `copy.register.policyRequired` through `error`.
 */
export default function PrivacyConsent({ accepted, onAcceptedChange, error }: PrivacyConsentProps) {
  const { copy } = useLanguage();
  const [noticeOpen, setNoticeOpen] = useState(false);
  const errorId = 'policy-error';

  return (
    <div>
      <div className="flex items-start gap-3 text-sm leading-6 text-notebook-muted">
        <input
          id="policy"
          name="policy"
          type="checkbox"
          checked={accepted}
          onChange={(event) => onAcceptedChange(event.target.checked)}
          aria-describedby={error ? errorId : undefined}
          aria-invalid={error ? true : undefined}
          className={`mt-1 h-4 w-4 shrink-0 cursor-pointer accent-notebook-ink ${
            error ? 'outline outline-2 outline-offset-2 outline-red-500' : ''
          }`}
        />
        <span>
          <label htmlFor="policy" className="cursor-pointer">
            {copy.register.policyBefore}
          </label>{' '}
          <button
            type="button"
            className="font-bold text-notebook-ink underline decoration-margin-guide decoration-2 underline-offset-4 hover:text-amber-700"
            onClick={(event) => {
              event.preventDefault();
              setNoticeOpen(true);
            }}
          >
            {copy.register.policyLink}
          </button>
          <label htmlFor="policy" className="cursor-pointer">
            {copy.register.policyAfter.replace('{version}', PRIVACY_POLICY_VERSION)}
          </label>
        </span>
      </div>
      {error && (
        <p id={errorId} role="alert" className="mt-1.5 pl-7 text-xs font-medium text-red-700">
          {error}
        </p>
      )}
      <PrivacyNoticeModal open={noticeOpen} onClose={() => setNoticeOpen(false)} />
    </div>
  );
}
