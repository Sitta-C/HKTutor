import localFont from 'next/font/local';

import { AuthProvider } from '@/lib/auth-context';
import { LanguageProvider } from '@/lib/i18n';

import './globals.css';

import type { Metadata, Viewport } from 'next';

const baiJamjuree = localFont({
  src: [
    {
      path: './fonts/BaiJamjuree-Regular.ttf',
      weight: '400',
      style: 'normal',
    },
    {
      path: './fonts/BaiJamjuree-Medium.ttf',
      weight: '500',
      style: 'normal',
    },
    {
      path: './fonts/BaiJamjuree-SemiBold.ttf',
      weight: '600',
      style: 'normal',
    },
    {
      path: './fonts/BaiJamjuree-Bold.ttf',
      weight: '700',
      style: 'normal',
    },
  ],
  variable: '--font-bai-jamjuree',
  display: 'swap',
  fallback: ['Arial', 'Helvetica', 'sans-serif'],
});

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
    <html lang="en" className={baiJamjuree.variable}>
      <body className="min-h-screen bg-white text-gray-900 antialiased">
        <AuthProvider>
          <LanguageProvider>{children}</LanguageProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
