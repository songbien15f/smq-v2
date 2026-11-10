import type { Metadata, Viewport } from 'next';
import { PageViewRecorder } from '@/components/workspace/PageViewRecorder';
import './globals.css';

export const metadata: Metadata = {
  title: 'SmartQuote — shed quoting',
  description: 'Quote a steel shed in minutes: geometry, bill of materials, price.',
  /*
   * The company's own icon, not a drawn approximation of it.
   *
   * `favicon.ico` carries the same artwork as `public/logo.png` — eight sizes from 32×32 to 256×256,
   * so a browser can pick one that is sharp instead of rescaling a single image. `apple-touch-icon`
   * points at the 256×256 PNG because iOS ignores `.ico` and would otherwise show a blank tile when
   * somebody saves the app to their home screen.
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
  // Never disable zoom: the quote editor is used on a tablet at a customer's table,
  // and a person who needs to enlarge the price must be able to.
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU">
      <body>
        {/* Records that a screen was opened. Silent, and mounted once here rather than per page,
            so a new page cannot forget it. */}
        <PageViewRecorder />
        {children}
      </body>
    </html>
  );
}
