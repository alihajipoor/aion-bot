import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

// Every page is rendered per request: the CSP nonce (middleware.ts) is new each
// time, and a page prerendered at build time would carry scripts without it.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'AION Panel',
  description: 'Control panel for the AION Discord server',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-dvh antialiased">
        <div className="relative z-10">{children}</div>
      </body>
    </html>
  );
}
