import Link from 'next/link';

import { PRIVACY_NOTICE } from '@/lib/privacy-notice';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Notice',
  description:
    'How HKTutor collects and uses personal data, and how Clerk processes sign-in credentials.',
};

export default function PrivacyNoticePage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-12 text-[#171714] sm:px-8 sm:py-16">
      <header className="mb-9 border-b border-[#e2dfd8] pb-7">
        <p className="mb-3 text-[0.68rem] font-bold tracking-[0.24em] text-[#d18b43] uppercase">
          HKTutor
        </p>
        <h1 className="text-[2rem] font-bold tracking-[-0.045em] sm:text-[2.25rem]">
          {PRIVACY_NOTICE.title}
        </h1>
        <p className="mt-3 text-sm text-[#77736b]">
          Version {PRIVACY_NOTICE.version} · Effective {PRIVACY_NOTICE.effectiveDate}
        </p>
        <p className="mt-5 text-[1.02rem] leading-7 text-[#5e5a52]">{PRIVACY_NOTICE.summary}</p>
      </header>

      <div className="space-y-9">
        {PRIVACY_NOTICE.sections.map((section) => (
          <section key={section.heading} aria-labelledby={sectionId(section.heading)}>
            <h2 id={sectionId(section.heading)} className="text-lg font-bold tracking-[-0.02em]">
              {section.heading}
            </h2>
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

      <footer className="mt-12 border-t border-[#e2dfd8] pt-7">
        <Link
          href="/register"
          className="font-bold underline decoration-[#d18b43] underline-offset-4 hover:text-[#d88835]"
        >
          Back to registration
        </Link>
      </footer>
    </main>
  );
}

const sectionId = (heading: string) =>
  `privacy-${heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')}`;
