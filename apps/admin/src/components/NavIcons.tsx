/**
 * The admin nav's icons: 24 × 24, stroke 1.75 (MASTER "Icons"), drawn in `currentColor` so the active
 * and hover colours come from the link. Each is decorative — the link beside it carries the name.
 *
 * They live in the admin app rather than `@sq/ui` because nothing else draws a nav like this one, and a
 * package rebuild for nine paths is a cost with no second user.
 */

import type { ReactNode } from 'react';

export type NavIconName =
  | 'overview'
  | 'companies'
  | 'seats'
  | 'enquiries'
  | 'priceBooks'
  | 'companyPrices'
  | 'usage'
  | 'audit';

const PATHS: Record<NavIconName | 'menu', ReactNode> = {
  overview: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>
  ),
  companies: (
    <>
      <path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16" />
      <path d="M16 9h2a2 2 0 0 1 2 2v10" />
      <path d="M3 21h18M8 7h4M8 11h4M8 15h4" />
    </>
  ),
  seats: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M2 20h20" />
    </>
  ),
  enquiries: (
    <>
      <path d="M3 13h5l1.5 3h5l1.5-3h5" />
      <path d="M5.5 5h13L21 13v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Z" />
    </>
  ),
  priceBooks: (
    <>
      <path d="M4 19.5V5a2 2 0 0 1 2-2h13v16H6.5A2.5 2.5 0 0 0 4 21.5v-2Z" />
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H19M9 7h6" />
    </>
  ),
  companyPrices: (
    <>
      <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z" />
      <circle cx="7.5" cy="7.5" r="1.5" />
    </>
  ),
  usage: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  audit: (
    <>
      <path d="M8 3h8l4 4v14H4V3h4Z" />
      <path d="M8 11h8M8 15h8M8 7h4" />
    </>
  ),
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
};

export function NavIcon({ name, size = 20 }: { name: NavIconName | 'menu'; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      {PATHS[name]}
    </svg>
  );
}
