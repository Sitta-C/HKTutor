'use client';

import Link from 'next/link';

import { formatBangkokYear } from '@/lib/date-time';
import { useLanguage } from '@/lib/i18n';

export function ArrowIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M4 10h11M10.5 4.5 16 10l-5.5 5.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function GlobeIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9.25" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M2.9 12h18.2M12 2.75c2.35 2.45 3.55 5.53 3.55 9.25S14.35 18.8 12 21.25M12 2.75C9.65 5.2 8.45 8.28 8.45 12S9.65 18.8 12 21.25"
        stroke="currentColor"
        strokeWidth="1.1"
      />
    </svg>
  );
}

export function BrandMark({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={`inline-flex items-center gap-2 rounded-lg text-[1.45rem] font-black tracking-[-0.08em] text-notebook-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-notebook-ink/30 focus-visible:ring-offset-4 ${className ?? ''}`}
    >
      <span className="flex h-8 w-8 -rotate-3 items-center justify-center rounded-md bg-notebook-ink text-[0.65rem] font-bold tracking-[-0.04em] text-paper shadow-[2px_2px_0_#fca5a5]">
        HK
      </span>
      <span>HKTutor</span>
    </Link>
  );
}

export function LanguageSwitch({ className }: { className?: string }) {
  const { language, copy, toggleLanguage } = useLanguage();

  return (
    <button
      type="button"
      aria-label={copy.common.languageButtonLabel}
      aria-pressed={language === 'th'}
      title={copy.common.languageButtonLabel}
      onClick={toggleLanguage}
      className={`inline-flex min-h-10 items-center gap-2 rounded-full px-3 py-2 text-notebook-ink transition-colors hover:bg-sticky-yellow/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-notebook-ink/25 ${className ?? ''}`}
    >
      <GlobeIcon />
      <span className="text-xs font-semibold tracking-[0.12em]">{language.toUpperCase()}</span>
    </button>
  );
}

export function PublicFooter({ className }: { className?: string }) {
  const { language, copy } = useLanguage();

  return (
    <footer
      className={`relative z-10 shrink-0 px-5 py-6 text-center text-sm text-notebook-muted sm:px-8 sm:py-8 ${className ?? ''}`}
    >
      <span>
        © {formatBangkokYear(new Date(), language)} {copy.common.copyright}
      </span>
      <span className="mx-3 text-stone-300">|</span>
      <span>{copy.common.privacySupport}</span>
    </footer>
  );
}
