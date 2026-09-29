'use client';

import Link from 'next/link';

import { ArrowIcon, BrandMark, LanguageSwitch, PublicFooter } from '@/components/public/public-ui';
import {
  GraphPaper,
  NotebookPage,
  PaperCard,
  StatusBadge,
  StickyNote,
  WashiTape,
  notebookButtonClass,
} from '@/components/ui/notebook';
import { useLanguage } from '@/lib/i18n';

export default function AboutMePage() {
  const { copy } = useLanguage();
  const aboutCopy = copy.aboutMe;

  const principles = [
    {
      number: '01',
      tone: 'yellow' as const,
      title: aboutCopy.missionTitle,
      body: aboutCopy.missionBody,
    },
    {
      number: '02',
      tone: 'blue' as const,
      title: aboutCopy.studentTitle,
      body: aboutCopy.studentBody,
    },
    {
      number: '03',
      tone: 'pink' as const,
      title: aboutCopy.tutorTitle,
      body: aboutCopy.tutorBody,
    },
  ];

  return (
    <NotebookPage className="flex flex-col overflow-hidden">
      <header className="relative z-20 border-b border-paper-edge/70 bg-paper/85 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-[1200px] items-center justify-between px-5 py-5 sm:px-8 sm:py-6 lg:px-10">
          <BrandMark />

          <nav className="flex items-center gap-1 text-sm sm:gap-4 lg:gap-6">
            <Link
              href="#why-hktutor"
              className="hidden rounded-lg px-2 py-2 font-semibold text-notebook-muted transition-colors hover:text-notebook-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-notebook-ink/30 sm:inline"
            >
              {aboutCopy.nav}
            </Link>
            <Link
              href="/"
              className="hidden rounded-lg px-2 py-2 font-semibold text-notebook-muted transition-colors hover:text-notebook-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-notebook-ink/30 lg:inline"
            >
              {aboutCopy.back}
            </Link>
            <LanguageSwitch />
            <Link
              href="/register"
              className={notebookButtonClass({
                className: 'min-h-10 px-3.5 py-2 sm:px-5',
              })}
            >
              {aboutCopy.cta}
            </Link>
          </nav>
        </div>
      </header>

      <main className="relative z-10 flex-1">
        <section className="mx-auto grid w-full max-w-[1200px] gap-16 px-5 pb-24 pt-20 sm:px-8 sm:pb-28 sm:pt-28 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-20 lg:px-10 lg:pb-36 lg:pt-32">
          <div>
            <p className="font-note text-2xl font-semibold text-amber-700 sm:text-3xl">
              {aboutCopy.eyebrow}
            </p>
            <h1 className="mt-5 max-w-[760px] text-[3.5rem] font-bold leading-[0.98] tracking-[-0.065em] text-notebook-ink sm:text-[5rem] lg:text-[5.75rem]">
              {aboutCopy.title}
            </h1>
            <p className="mt-7 max-w-[560px] text-base leading-8 text-notebook-muted sm:text-lg">
              {aboutCopy.subtitle}
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-4">
              <Link href="/register" className={notebookButtonClass({ className: 'group px-5' })}>
                {aboutCopy.cta}
                <ArrowIcon className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Link>
              <Link href="#why-hktutor" className={notebookButtonClass({ tone: 'secondary' })}>
                {aboutCopy.nav}
              </Link>
            </div>
          </div>

          <PaperCard className="relative mx-auto w-full max-w-[520px] rotate-1 p-5 sm:p-7 lg:mx-0">
            <WashiTape tone="yellow" className="left-1/2 top-0 -translate-x-1/2 -translate-y-1/2" />
            <GraphPaper className="p-5 sm:p-6">
              <div className="flex items-center justify-between gap-4 border-b-2 border-notebook-ink pb-3">
                <p className="font-note text-2xl font-semibold text-notebook-ink">
                  {aboutCopy.nav}
                </p>
                <StatusBadge tone="student">HKTutor</StatusBadge>
              </div>
              <div className="mt-3 divide-y divide-blue-200/70">
                {principles.map((principle) => (
                  <div
                    key={principle.number}
                    className="grid grid-cols-[2.5rem_1fr] gap-3 py-4 sm:grid-cols-[3rem_1fr]"
                  >
                    <span className="font-note text-xl font-semibold text-red-400">
                      {principle.number}
                    </span>
                    <p className="font-bold text-notebook-ink">{principle.title}</p>
                  </div>
                ))}
              </div>
            </GraphPaper>
            <StickyNote
              tone="pink"
              className="absolute -bottom-8 -right-3 hidden max-w-48 -rotate-3 px-4 py-3 sm:block"
            >
              <p className="font-note text-lg font-semibold leading-snug">
                {aboutCopy.sectionTitle}
              </p>
            </StickyNote>
          </PaperCard>
        </section>

        <section
          id="why-hktutor"
          className="mx-auto w-full max-w-[1200px] scroll-mt-24 px-5 py-16 sm:px-8 sm:py-24 lg:px-10"
          aria-labelledby="why-title"
        >
          <PaperCard className="relative p-6 sm:p-10 lg:p-12">
            <WashiTape tone="blue" className="-left-5 top-8 rotate-[-36deg]" />
            <div className="grid gap-12 lg:grid-cols-[0.75fr_1.25fr] lg:gap-20">
              <div>
                <p className="font-note text-2xl font-semibold text-amber-700">
                  {aboutCopy.sectionEyebrow}
                </p>
                <h2
                  id="why-title"
                  className="mt-4 max-w-[420px] text-3xl font-bold leading-tight tracking-[-0.05em] text-notebook-ink sm:text-4xl"
                >
                  {aboutCopy.sectionTitle}
                </h2>
                <p className="mt-5 max-w-[420px] leading-7 text-notebook-muted">
                  {aboutCopy.sectionBody}
                </p>
              </div>

              <div className="grid gap-5">
                {principles.map((principle, index) => (
                  <StickyNote
                    key={principle.number}
                    tone={principle.tone}
                    className={`p-5 sm:p-6 ${index === 0 ? '-rotate-1' : index === 2 ? 'rotate-1' : ''}`}
                  >
                    <div className="flex items-start gap-4">
                      <span className="font-note text-2xl font-semibold text-notebook-muted">
                        {principle.number}
                      </span>
                      <div>
                        <h3 className="text-lg font-bold tracking-[-0.025em] text-notebook-ink">
                          {principle.title}
                        </h3>
                        <p className="mt-2 max-w-[520px] leading-7 text-stone-600">
                          {principle.body}
                        </p>
                      </div>
                    </div>
                  </StickyNote>
                ))}
              </div>
            </div>
          </PaperCard>
        </section>
      </main>

      <PublicFooter className="border-t border-paper-edge/70 bg-paper/70" />
    </NotebookPage>
  );
}
