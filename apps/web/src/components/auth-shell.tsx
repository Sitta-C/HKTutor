'use client';

import Link from 'next/link';

import { NotebookPage, StickyNote, WashiTape, notebookButtonClass } from '@/components/ui/notebook';
import { formatBangkokYear } from '@/lib/date-time';
import { useLanguage } from '@/lib/i18n';

import type { ReactNode } from 'react';

type AuthPage = 'login' | 'register';

export function ArrowIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M4 10h11M10.5 4.5 16 10l-5.5 5.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function GlobeIcon() {
  return (
    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9.25" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M2.9 12h18.2M12 2.75c2.35 2.45 3.55 5.53 3.55 9.25S14.35 18.8 12 21.25M12 2.75C9.65 5.2 8.45 8.28 8.45 12S9.65 18.8 12 21.25"
        stroke="currentColor"
        strokeWidth="1.1"
      />
    </svg>
  );
}

export function EyeIcon({ visible }: { visible: boolean }) {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M2.5 12s3.25-5 9.5-5 9.5 5 9.5 5-3.25 5-9.5 5-9.5-5-9.5-5Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      {visible ? (
        <circle cx="12" cy="12" r="2.2" stroke="currentColor" strokeWidth="1.5" />
      ) : (
        <path d="m4 4 16 16" stroke="currentColor" strokeWidth="1.5" />
      )}
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M21.35 12.27c0-.7-.06-1.36-.18-2H12v3.79h5.24a4.48 4.48 0 0 1-1.94 2.94v2.45h3.14c1.84-1.69 2.91-4.18 2.91-7.18Z"
      />
      <path
        fill="#34A853"
        d="M12 21.62c2.63 0 4.84-.87 6.45-2.35l-3.14-2.45c-.87.58-1.98.92-3.31.92-2.54 0-4.69-1.72-5.46-4.03H3.3v2.53A9.74 9.74 0 0 0 12 21.62Z"
      />
      <path
        fill="#FBBC05"
        d="M6.54 13.71A5.85 5.85 0 0 1 6.23 12c0-.59.11-1.17.31-1.71V7.76H3.3a9.74 9.74 0 0 0 0 8.48l3.24-2.53Z"
      />
      <path
        fill="#EA4335"
        d="M12 6.26c1.43 0 2.71.49 3.72 1.45l2.79-2.79C16.83 3.38 14.62 2.38 12 2.38a9.74 9.74 0 0 0-8.7 5.38l3.24 2.53C7.31 7.98 9.46 6.26 12 6.26Z"
      />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16.73 12.73c.02 2.32 2.04 3.1 2.06 3.11-.02.05-.32 1.1-1.06 2.18-.64.93-1.3 1.86-2.34 1.88-1.02.02-1.35-.61-2.52-.61-1.18 0-1.55.59-2.52.63-1.01.04-1.78-.98-2.43-1.9-1.32-1.9-2.33-5.37-.97-7.72.67-1.17 1.87-1.91 3.17-1.93 1-.02 1.95.67 2.52.67.57 0 1.64-.83 2.76-.71.47.02 1.8.19 2.65 1.43-2.45 1.35-2.05 3.96-2.05 3.97ZM14.9 5.18c.52-.63.88-1.5.78-2.37-.76.03-1.67.51-2.21 1.14-.48.55-.9 1.44-.79 2.28.85.06 1.7-.43 2.22-1.05Z" />
    </svg>
  );
}

function FacebookIcon() {
  return (
    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#1877f2] text-[15px] font-bold leading-none text-white">
      f
    </span>
  );
}

export function AuthSocialButtons() {
  const { copy } = useLanguage();
  const buttonClassName =
    'flex h-12 items-center justify-center gap-2 rounded-xl border border-[#e2dfd8] bg-white px-2 text-sm font-semibold transition-colors hover:border-[#b9b3a8] hover:bg-[#faf9f6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#171714]/20 sm:px-3';

  return (
    <div className="grid grid-cols-3 gap-2.5">
      <button type="button" aria-label={copy.social.googleAria} className={buttonClassName}>
        <GoogleIcon />
        <span className="hidden sm:inline">{copy.social.google}</span>
      </button>
      <button type="button" aria-label={copy.social.appleAria} className={buttonClassName}>
        <AppleIcon />
        <span className="hidden sm:inline">{copy.social.apple}</span>
      </button>
      <button type="button" aria-label={copy.social.facebookAria} className={buttonClassName}>
        <FacebookIcon />
        <span className="hidden sm:inline">{copy.social.facebook}</span>
      </button>
    </div>
  );
}

export function BackgroundArtwork() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className="absolute -right-16 top-32 hidden h-64 w-64 rotate-3 rounded-2xl border border-blue-200/70 bg-[linear-gradient(#dbeafe_1px,transparent_1px),linear-gradient(90deg,#dbeafe_1px,transparent_1px)] bg-[size:22px_22px] opacity-55 lg:block" />
      <StickyNote
        tone="yellow"
        className="absolute -left-8 bottom-24 hidden h-40 w-48 -rotate-6 opacity-75 xl:block"
      >
        <span className="block h-px w-24 bg-amber-700/20" />
        <span className="mt-5 block h-px w-32 bg-amber-700/20" />
        <span className="mt-5 block h-px w-20 bg-amber-700/20" />
      </StickyNote>
      <WashiTape tone="pink" className="-right-5 top-20 hidden rotate-12 lg:block" />
      <svg className="absolute bottom-8 right-10 h-24 w-24 text-stone-400/30" viewBox="0 0 96 96">
        <path
          d="M22 62c16-4 12-27 27-28 13-1 9 24 23 21 8-2 5-14 12-18"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="2"
        />
        <path d="m77 29 8 8-11 3" fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
    </div>
  );
}

export default function AuthShell({ page, children }: { page: AuthPage; children: ReactNode }) {
  const { language, copy, toggleLanguage } = useLanguage();
  const isLogin = page === 'login';
  const navHref = isLogin ? '/register' : '/';
  const secondaryHref = isLogin ? '/about-me' : navHref;
  const navCopy = isLogin ? copy.shell.login : copy.shell.register;

  return (
    <NotebookPage className="relative flex flex-col overflow-hidden">
      <BackgroundArtwork />

      <header className="relative z-10 flex items-start justify-between px-5 py-6 sm:px-8 sm:py-8 lg:px-16 lg:py-9">
        <div>
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-[1.55rem] font-black tracking-[-0.08em] text-notebook-ink"
          >
            <span className="flex h-8 w-8 -rotate-3 items-center justify-center rounded-md bg-notebook-ink text-[0.65rem] font-bold tracking-[-0.04em] text-paper shadow-[2px_2px_0_#fca5a5]">
              HK
            </span>
            <span>HKTutor</span>
          </Link>
          <div className="mt-5 hidden w-44 border-t border-dashed border-stone-400 pt-3 text-sm sm:block">
            <Link
              href={secondaryHref}
              className="group flex items-center justify-between gap-4 text-notebook-muted hover:text-amber-700"
            >
              <span>{navCopy.secondary}</span>
              <ArrowIcon className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </div>
        </div>

        <nav className="flex items-center gap-4 text-sm sm:gap-7 lg:gap-10">
          <button
            type="button"
            aria-label={copy.common.languageButtonLabel}
            aria-pressed={language === 'th'}
            title={copy.common.languageButtonLabel}
            onClick={toggleLanguage}
            className="inline-flex items-center gap-2 rounded-full p-2 text-notebook-ink transition-colors hover:bg-sticky-yellow/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-notebook-ink/25"
          >
            <GlobeIcon />
            <span className="text-xs font-semibold tracking-[0.12em]">
              {language.toUpperCase()}
            </span>
          </button>
          <Link href={navHref} className="hidden transition-colors hover:text-amber-700 sm:inline">
            {navCopy.nav}
          </Link>
          <Link
            href={navHref}
            className={notebookButtonClass({
              tone: 'secondary',
              className: 'border-amber-200 bg-sticky-yellow sm:px-6',
            })}
          >
            {navCopy.cta}
          </Link>
        </nav>
      </header>

      <main className="relative z-10 flex flex-1 items-center justify-center px-5 pb-10 pt-6 sm:px-8 lg:px-16 lg:pb-14 lg:pt-0">
        {children}
      </main>

      <footer className="relative z-10 shrink-0 px-5 pb-6 text-center text-sm text-notebook-muted sm:pb-8">
        <span>
          © {formatBangkokYear(new Date(), language)} {copy.common.copyright}
        </span>
        <span className="mx-3 text-stone-300">|</span>
        <span>{copy.common.privacySupport}</span>
      </footer>
    </NotebookPage>
  );
}
