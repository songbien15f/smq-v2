import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SmartQuote — shed quoting',
  description: 'Quote a steel shed in minutes: geometry, bill of materials, price.',
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
      <head>
        {/* The mark as a data URI, so the first paint has an icon without a request. */}
        <link
          rel="icon"
          href={
            'data:image/svg+xml,' +
            encodeURIComponent(
              '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
                '<path d="M16 2.5 28 7v9.5c0 6.2-4.6 11-12 13-7.4-2-12-6.8-12-13V7L16 2.5Z" fill="#071832"/>' +
                '<path d="M9.5 13 16 9.2 22.5 13" stroke="#f4cf75" stroke-width="2" fill="none" stroke-linecap="round"/>' +
                '<path d="M11 17.5h10M11 21.5h6" stroke="#f4cf75" stroke-width="1.75" stroke-linecap="round"/>' +
                '</svg>',
            )
          }
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
