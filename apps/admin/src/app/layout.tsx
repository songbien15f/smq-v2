import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  // Every page names itself ("Companies · SmartQuote admin"), so several open tabs can be told apart;
  // the sign-in screen, which sets no title, keeps the default.
  title: { template: '%s · SmartQuote admin', default: 'SmartQuote — licence administration' },
  description: 'Companies, seats, price books and templates.',
  // An administration surface must never be indexed. A crawler that finds this page
  // finds the list of customers.
  robots: { index: false, follow: false },
  // The same artwork as the product app, so a person with both open can tell them apart in the tab
  // bar by the icon they already know. Eight sizes inside the `.ico`; iOS takes the PNG.
  icons: {
    icon: [{ url: '/favicon.ico', sizes: '32x32 48x48 256x256', type: 'image/x-icon' }],
    apple: [{ url: '/logo.png', sizes: '256x256', type: 'image/png' }],
    shortcut: ['/favicon.ico'],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU">
      <body>{children}</body>
    </html>
  );
}
