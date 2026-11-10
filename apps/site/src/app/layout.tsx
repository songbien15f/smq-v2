import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Steel sheds — quoted properly',
  description:
    'A shed quote built from the building: every purlin, sheet and fixing priced from the geometry, with the wind rating stated.',
  /*
   * The same icon as the product app, deliberately.
   *
   * This page is where a customer lands from a share link, and the tab they leave open is the one
   * they come back to. A different mark there would be a second brand for the same company.
   */
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
      <body className="text-sq-body-lg">{children}</body>
    </html>
  );
}
