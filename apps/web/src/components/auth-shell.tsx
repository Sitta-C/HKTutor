'use client';

import Link from 'next/link';

import { ArrowIcon, BrandMark, LanguageSwitch, PublicFooter } from '@/components/public/public-ui';
import { NotebookPage, StickyNote, WashiTape, notebookButtonClass } from '@/components/ui/notebook';
import { useLanguage } from '@/lib/i18n';

import type { ReactNode } from 'react';

type AuthPage = 'login' | 'register';

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

function BackgroundArtwork() {
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
  const { copy } = useLanguage();
  const isLogin = page === 'login';
  const navHref = isLogin ? '/register' : '/';
  const secondaryHref = isLogin ? '/about-me' : navHref;
  const navCopy = isLogin ? copy.shell.login : copy.shell.register;

  return (
    <NotebookPage className="relative flex flex-col overflow-hidden">
      <BackgroundArtwork />

      <header className="relative z-10 flex items-start justify-between px-5 py-6 sm:px-8 sm:py-8 lg:px-16 lg:py-9">
        <div>
          <BrandMark />
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
          <LanguageSwitch />
          {!isLogin && (
            <Link
              href={navHref}
              className="hidden transition-colors hover:text-amber-700 sm:inline"
            >
              {navCopy.nav}
            </Link>
          )}
          <Link
            href={navHref}
            className={notebookButtonClass({
              tone: 'secondary',
              className: 'border-amber-200 bg-sticky-yellow sm:px-6',
            })}
          >
            {isLogin ? navCopy.nav : navCopy.cta}
          </Link>
        </nav>
      </header>

      <main className="relative z-10 flex flex-1 items-center justify-center px-5 pb-10 pt-6 sm:px-8 lg:px-16 lg:pb-14 lg:pt-0">
        {children}
      </main>

      <PublicFooter className="pb-6 sm:pb-8" />
    </NotebookPage>
  );
}
