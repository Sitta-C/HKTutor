import { LanguageProvider } from '@/lib/i18n';

import './globals.css';

import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: {
    default: 'HKTutor',
    template: '%s | HKTutor',
  },
  description: 'HKTutor Platform',
  icons: {
    icon: '/favicon.ico', // TODO: might have to change for actual logo
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-gray-900 antialiased">
        {/* TODO: Toasters and auth provider */}
        <LanguageProvider>{children}</LanguageProvider>
      </body>
    </html>
  );
}
