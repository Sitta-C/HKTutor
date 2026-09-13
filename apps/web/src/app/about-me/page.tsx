'use client';

import Link from 'next/link';

import { ArrowIcon, GlobeIcon } from '@/components/auth-shell';
import { useLanguage } from '@/lib/i18n';

function Logo() {
  return (
    <Link
      href="/"
      className="inline-flex items-center gap-2 rounded-lg text-[1.4rem] font-black tracking-[-0.08em] text-[#171714] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#171714]/30 focus-visible:ring-offset-4"
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#171714] text-[0.65rem] font-bold tracking-[-0.04em] text-[#f7f4ec]">
        HK
      </span>
      <span>HKTutor</span>
    </Link>
  );
}

export default function AboutMePage() {
  const { language, copy, toggleLanguage } = useLanguage();
  const aboutCopy = copy.aboutMe;

  return (
    <div className="flex min-h-dvh flex-col bg-[#fbfaf7] text-[#171714]">
      <header className="border-b border-[#e7e2d9]">
        <div className="mx-auto flex w-full max-w-[1200px] items-center justify-between px-5 py-5 sm:px-8 sm:py-6 lg:px-10">
          <Logo />

          <nav className="flex items-center gap-1 text-sm sm:gap-4 lg:gap-6">
            <Link
              href="#why-hktutor"
              className="hidden rounded-lg px-2 py-2 font-semibold text-[#68645c] transition-colors hover:text-[#171714] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#171714]/30 sm:inline"
            >
              {aboutCopy.nav}
            </Link>
            <Link
              href="/"
              className="hidden rounded-lg px-2 py-2 font-semibold text-[#68645c] transition-colors hover:text-[#171714] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#171714]/30 sm:inline"
            >
              {aboutCopy.back}
            </Link>
            <button
              type="button"
              aria-label={copy.common.languageButtonLabel}
              aria-pressed={language === 'th'}
              title={copy.common.languageButtonLabel}
              onClick={toggleLanguage}
              className="inline-flex items-center gap-2 rounded-full p-2 transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#171714]/30"
            >
              <GlobeIcon />
              <span className="text-xs font-semibold tracking-[0.12em]">
                {language.toUpperCase()}
              </span>
            </button>
            <Link
              href="/register"
              className="rounded-xl bg-[#171714] px-3.5 py-2.5 font-semibold text-white transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#171714]/30 focus-visible:ring-offset-2 sm:px-5 sm:py-3"
            >
              {aboutCopy.cta}
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto flex w-full max-w-[1200px] flex-col items-center px-5 pb-24 pt-24 text-center sm:px-8 sm:pb-32 sm:pt-32 lg:px-10 lg:pb-40 lg:pt-40">
          <p className="text-[0.65rem] font-bold uppercase tracking-[0.24em] text-[#ba7431]">
            {aboutCopy.eyebrow}
          </p>
          <h1 className="mt-6 max-w-[820px] text-[3.5rem] font-bold leading-[0.98] tracking-[-0.075em] sm:text-[5.5rem] lg:text-[6.5rem]">
            {aboutCopy.title}
          </h1>
          <p className="mt-7 max-w-[540px] text-base leading-8 text-[#68645c] sm:text-lg">
            {aboutCopy.subtitle}
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/register"
              className="group inline-flex items-center gap-3 rounded-xl bg-[#171714] px-5 py-3.5 font-semibold text-white transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#171714]/30 focus-visible:ring-offset-2"
            >
              {aboutCopy.cta}
              <ArrowIcon className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
            <Link
              href="#why-hktutor"
              className="rounded-lg px-2 py-3 font-semibold text-[#68645c] underline decoration-[#d6aa79] underline-offset-4 transition-colors hover:text-[#171714] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#171714]/30"
            >
              {aboutCopy.nav}
            </Link>
          </div>
        </section>

        <section
          id="why-hktutor"
          className="mx-auto w-full max-w-[1200px] scroll-mt-8 border-t border-[#e7e2d9] px-5 py-16 sm:px-8 sm:py-24 lg:px-10"
          aria-labelledby="why-title"
        >
          <div className="grid gap-12 lg:grid-cols-[0.7fr_1.3fr] lg:gap-24">
            <div>
              <p className="text-[0.65rem] font-bold uppercase tracking-[0.24em] text-[#ba7431]">
                {aboutCopy.sectionEyebrow}
              </p>
              <h2
                id="why-title"
                className="mt-5 max-w-[360px] text-3xl font-bold leading-tight tracking-[-0.055em] sm:text-4xl"
              >
                {aboutCopy.sectionTitle}
              </h2>
              <p className="mt-5 max-w-[380px] leading-7 text-[#68645c]">{aboutCopy.sectionBody}</p>
            </div>

            <div className="border-t border-[#e7e2d9]">
              <article className="grid gap-4 border-b border-[#e7e2d9] py-6 sm:grid-cols-[52px_190px_1fr] sm:gap-6 sm:py-7">
                <span className="text-sm font-semibold text-[#b4aea3]">01</span>
                <h3 className="text-lg font-bold tracking-[-0.03em]">{aboutCopy.missionTitle}</h3>
                <p className="max-w-[440px] leading-7 text-[#68645c]">{aboutCopy.missionBody}</p>
              </article>
              <article className="grid gap-4 border-b border-[#e7e2d9] py-6 sm:grid-cols-[52px_190px_1fr] sm:gap-6 sm:py-7">
                <span className="text-sm font-semibold text-[#b4aea3]">02</span>
                <h3 className="text-lg font-bold tracking-[-0.03em]">{aboutCopy.studentTitle}</h3>
                <p className="max-w-[440px] leading-7 text-[#68645c]">{aboutCopy.studentBody}</p>
              </article>
              <article className="grid gap-4 border-b border-[#e7e2d9] py-6 sm:grid-cols-[52px_190px_1fr] sm:gap-6 sm:py-7">
                <span className="text-sm font-semibold text-[#b4aea3]">03</span>
                <h3 className="text-lg font-bold tracking-[-0.03em]">{aboutCopy.tutorTitle}</h3>
                <p className="max-w-[440px] leading-7 text-[#68645c]">{aboutCopy.tutorBody}</p>
              </article>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#e7e2d9] px-5 py-6 text-center text-sm text-[#68645c] sm:px-8 sm:py-8 lg:px-10">
        <span>
          © {new Date().getFullYear()} {copy.common.copyright}
        </span>
        <span className="mx-3 text-[#b4aea3]">|</span>
        <span>{copy.common.privacySupport}</span>
      </footer>
    </div>
  );
}
