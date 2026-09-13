'use client';

import Link from 'next/link';

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
      <div className="absolute -left-56 -top-56 h-[38rem] w-[38rem] rounded-full border border-[#e5ded2] bg-[#fbfaf7]/75" />
      <div className="absolute -bottom-52 -right-52 h-[37rem] w-[37rem] rounded-full bg-[#f1ddc4]/70" />
      <div className="absolute left-1/2 top-1/2 h-[min(48rem,82vw)] w-[min(48rem,82vw)] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/70" />

      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 1440 900"
        fill="none"
        preserveAspectRatio="none"
      >
        <defs>
          <pattern id="auth-minimal-dots" width="16" height="16" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="1.15" fill="#d4c7b5" />
          </pattern>
        </defs>
        <path d="M0 778h1440" stroke="#ded6ca" strokeWidth="1" />
        <path
          d="M1176 166c34 27 72 19 88-20 14-33 34-26 37 7 4 41 38 41 64 5 25-34 46-42 55-12 8 27 25 32 47 18"
          stroke="#d4c7b5"
          strokeWidth="1"
          strokeLinecap="round"
        />
        <path
          d="M90 652c26 23 58 19 75-10 14-24 32-16 35 8 4 31 31 34 54 8 20-23 37-25 47-6"
          stroke="#d18b43"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
        <circle cx="1288" cy="214" r="5" stroke="#d18b43" strokeWidth="1.2" />
        <circle cx="168" cy="690" r="4" stroke="#d4c7b5" />
        <rect
          x="70"
          y="704"
          width="112"
          height="74"
          rx="20"
          fill="url(#auth-minimal-dots)"
          opacity="0.72"
        />
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
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-[#f7f4ec] text-[#171714]">
      <BackgroundArtwork />

      <header className="relative z-10 flex items-start justify-between px-5 py-6 sm:px-8 sm:py-8 lg:px-16 lg:py-9">
        <div>
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-[1.55rem] font-black tracking-[-0.08em] text-[#171714]"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#171714] text-[0.65rem] font-bold tracking-[-0.04em] text-[#f7f4ec]">
              HK
            </span>
            <span>HKTutor</span>
          </Link>
          <div className="mt-5 hidden w-44 border-t border-[#9c988e] pt-3 text-sm sm:block">
            <Link
              href={secondaryHref}
              className="group flex items-center justify-between gap-4 hover:text-[#d88835]"
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
            className="inline-flex items-center gap-2 rounded-full p-2 transition-colors hover:bg-white/60"
          >
            <GlobeIcon />
            <span className="text-xs font-semibold tracking-[0.12em]">
              {language.toUpperCase()}
            </span>
          </button>
          <Link href={navHref} className="hidden transition-colors hover:text-[#d88835] sm:inline">
            {navCopy.nav}
          </Link>
          <Link
            href={navHref}
            className="rounded-xl bg-[#ffc57d] px-4 py-3 font-semibold shadow-[0_3px_10px_rgba(206,145,64,0.12)] transition-transform hover:-translate-y-0.5 sm:px-6 sm:py-3.5"
          >
            {navCopy.cta}
          </Link>
        </nav>
      </header>

      <main className="relative z-10 flex flex-1 items-center justify-center px-5 pb-10 pt-6 sm:px-8 lg:px-16 lg:pb-14 lg:pt-0">
        {children}
      </main>

      <footer className="relative z-10 shrink-0 px-5 pb-6 text-center text-sm text-[#5e5a52] sm:pb-8">
        <span>
          © {new Date().getFullYear()} {copy.common.copyright}
        </span>
        <span className="mx-3 text-[#b2ada2]">|</span>
        <span>{copy.common.privacySupport}</span>
      </footer>
    </div>
  );
}
