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
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <header className="mb-8 border-b border-gray-200 pb-6">
        <h1 className="text-2xl font-semibold text-gray-900 sm:text-3xl">{PRIVACY_NOTICE.title}</h1>
        <p className="mt-2 text-sm text-gray-600">
          Version {PRIVACY_NOTICE.version} · Effective {PRIVACY_NOTICE.effectiveDate}
        </p>
        <p className="mt-4 text-sm leading-6 text-gray-800">{PRIVACY_NOTICE.summary}</p>
      </header>

      <div className="space-y-8">
        {PRIVACY_NOTICE.sections.map((section) => (
          <section key={section.heading} aria-labelledby={sectionId(section.heading)}>
            <h2
              id={sectionId(section.heading)}
              className="text-base font-semibold text-gray-900 sm:text-lg"
            >
              {section.heading}
            </h2>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph} className="mt-3 text-sm leading-6 text-gray-800">
                {paragraph}
              </p>
            ))}
            {section.bullets.length > 0 && (
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-gray-800">
                {section.bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      <footer className="mt-10 border-t border-gray-200 pt-6">
        <Link
          href="/register"
          className="text-sm font-medium text-tutor underline underline-offset-4 hover:text-gray-900"
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
