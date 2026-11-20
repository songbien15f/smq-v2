import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './guest.css';

/*
 * Archivo (display) and Inter (body), self-hosted from `src/fonts/` (plan G-a P15, override §2):
 * Fontsource 5.3.0 variable builds, Latin subset, SIL OFL (licences beside the files). No request
 * leaves for Google Fonts, and `next build` works offline.
 *
 * Loaded here and not in the root layout, so `/` and `/s` keep the system stack they had.
 */
const archivo = localFont({
  src: '../../fonts/archivo-latin-wght-normal.woff2',
  weight: '100 900',
  style: 'normal',
  display: 'swap',
  variable: '--g-font-display',
});

const inter = localFont({
  src: '../../fonts/inter-latin-wght-normal.woff2',
  weight: '100 900',
  style: 'normal',
  display: 'swap',
  variable: '--g-font-body',
});

export const metadata: Metadata = {
  title: 'Design your shed and get a quote — Smart Solutions Australia',
  description:
    'Design a shed, garage or carport in a few minutes and ask for a quote. No sign-up needed; your design is saved on this device.',
};

export default function GuestQuoteLayout({ children }: { children: React.ReactNode }) {
  return <div className={`guest-quote ${archivo.variable} ${inter.variable}`}>{children}</div>;
}
