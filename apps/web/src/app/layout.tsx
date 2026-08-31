import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';

const inter = Inter({
  subsets: ['latin'],
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
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.className}>
      <body className="min-h-screen bg-white text-gray-900 antialiased">
        { /* TODO: Toasters and auth provider */}
        {children}
      </body>
    </html>
  );
}