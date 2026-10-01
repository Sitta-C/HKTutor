import { Caveat, Mali } from 'next/font/google';
import localFont from 'next/font/local';

import { NotebookToastProvider } from '@/components/ui/notebook-toast';
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

const caveat = Caveat({
  subsets: ['latin'],
  variable: '--font-caveat',
  display: 'swap',
});

const mali = Mali({
  subsets: ['latin', 'thai'],
  weight: ['500', '600'],
  variable: '--font-mali',
  display: 'swap',
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
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${baiJamjuree.variable} ${caveat.variable} ${mali.variable}`}>
      <body className="min-h-screen bg-white text-gray-900 antialiased">
        <AuthProvider>
          <LanguageProvider>
            <NotebookToastProvider>{children}</NotebookToastProvider>
          </LanguageProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
