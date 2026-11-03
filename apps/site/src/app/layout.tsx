import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Steel sheds — quoted properly',
  description:
    'A shed quote built from the building: every purlin, sheet and fixing priced from the geometry, with the wind rating stated.',
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
