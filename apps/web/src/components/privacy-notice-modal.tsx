'use client';

import { useEffect, useRef } from 'react';

import { PRIVACY_NOTICE } from '@/lib/privacy-notice';

export interface PrivacyNoticeModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

export default function PrivacyNoticeModal({ open, onClose }: PrivacyNoticeModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-describedby="privacy-notice-summary"
      aria-labelledby="privacy-notice-title"
      onClose={onClose}
      className="m-auto max-h-[88dvh] w-[min(92vw,760px)] rounded-[1.75rem] bg-white p-0 text-[#171714] shadow-[0_16px_40px_rgba(23,23,20,0.16)] backdrop:bg-black/45"
    >
      <div className="sticky top-0 z-10 flex items-start justify-between gap-5 border-b border-[#e2dfd8] bg-white px-6 py-5 sm:px-8">
        <div>
          <p className="text-[0.68rem] font-bold uppercase tracking-[0.24em] text-[#d18b43]">
            HKTutor
          </p>
          <h2 id="privacy-notice-title" className="mt-1 text-2xl font-bold tracking-[-0.04em]">
            {PRIVACY_NOTICE.title}
          </h2>
          <p className="mt-1 text-xs text-[#77736b]">
            Version {PRIVACY_NOTICE.version} · Effective {PRIVACY_NOTICE.effectiveDate}
          </p>
        </div>
        <button
          type="button"
          autoFocus
          aria-label="Close privacy notice"
          onClick={onClose}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#e2dfd8] text-lg font-bold text-[#5e5a52] hover:bg-[#f7f4ec] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#171714]/30"
        >
          ×
        </button>
      </div>

      <div className="max-h-[calc(88dvh-104px)] overflow-y-auto px-6 py-6 sm:px-8 sm:py-8">
        <p id="privacy-notice-summary" className="leading-7 text-[#5e5a52]">
          {PRIVACY_NOTICE.summary}
        </p>

        <div className="mt-8 space-y-8">
          {PRIVACY_NOTICE.sections.map((section) => (
            <section key={section.heading}>
              <h3 className="text-lg font-bold tracking-[-0.02em]">{section.heading}</h3>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph} className="mt-3 leading-7 text-[#5e5a52]">
                  {paragraph}
                </p>
              ))}
              {section.bullets.length > 0 && (
                <ul className="mt-3 list-disc space-y-2 pl-5 leading-7 text-[#5e5a52]">
                  {section.bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>

        <div className="mt-9 border-t border-[#e2dfd8] pt-6 text-right">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-[#171714] px-5 py-3 text-sm font-bold text-white hover:bg-[#34332e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#171714]/30 focus-visible:ring-offset-2"
          >
            Close
          </button>
        </div>
      </div>
    </dialog>
  );
}
