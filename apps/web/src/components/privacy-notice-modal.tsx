'use client';

import { useEffect, useRef } from 'react';

import { NotebookButton, WashiTape } from '@/components/ui/notebook';
import { useLanguage } from '@/lib/i18n';
import { privacyNoticeCopy } from '@/lib/privacy-notice-copy';

export interface PrivacyNoticeModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

export default function PrivacyNoticeModal({ open, onClose }: PrivacyNoticeModalProps) {
  const { language } = useLanguage();
  const notice = privacyNoticeCopy[language];
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
      className="m-auto max-h-[88dvh] w-[min(92vw,760px)] overflow-visible rounded-[1.5rem] border border-paper-edge bg-paper p-0 text-notebook-ink shadow-paper backdrop:bg-stone-900/45"
    >
      <WashiTape tone="yellow" className="left-1/2 top-0 z-20 -translate-x-1/2 -translate-y-1/2" />
      <div className="sticky top-0 z-10 flex items-start justify-between gap-5 rounded-t-[1.5rem] border-b border-paper-edge bg-paper px-6 py-5 sm:px-8">
        <div>
          <p className="font-note text-xl font-semibold text-amber-700">HKTutor</p>
          <h2 id="privacy-notice-title" className="mt-1 text-2xl font-bold tracking-[-0.04em]">
            {notice.title}
          </h2>
          <p className="mt-1 text-xs text-notebook-muted">
            {notice.versionLabel} {notice.version} · {notice.effectiveLabel} {notice.effectiveDate}
          </p>
        </div>
        <button
          type="button"
          autoFocus
          aria-label={notice.closeLabel}
          onClick={onClose}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-paper-edge text-lg font-bold text-notebook-muted hover:bg-sticky-yellow/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-notebook-ink/30"
        >
          ×
        </button>
      </div>

      <div className="max-h-[calc(88dvh-104px)] overflow-y-auto px-6 py-6 sm:px-8 sm:py-8">
        <p id="privacy-notice-summary" className="leading-7 text-notebook-muted">
          {notice.summary}
        </p>

        <div className="mt-8 space-y-8">
          {notice.sections.map((section) => (
            <section key={section.heading}>
              <h3 className="text-lg font-bold tracking-[-0.02em]">{section.heading}</h3>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph} className="mt-3 leading-7 text-notebook-muted">
                  {paragraph}
                </p>
              ))}
              {section.bullets.length > 0 && (
                <ul className="mt-3 list-disc space-y-2 pl-5 leading-7 text-notebook-muted marker:text-margin-guide">
                  {section.bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>

        <div className="mt-9 border-t border-paper-edge pt-6 text-right">
          <NotebookButton type="button" onClick={onClose}>
            {notice.close}
          </NotebookButton>
        </div>
      </div>
    </dialog>
  );
}
