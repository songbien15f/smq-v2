/**
 * The brand mark: a shield, drawn as geometry rather than shipped as a PNG.
 *
 * Two reasons it is inline SVG. It stays sharp at any size, and it costs no request
 * on a page whose first job is to appear quickly. The gradient ids are per-instance
 * via `useId` because two logos on one page with the same id share the first
 * gradient, and the second renders with the first's colours.
 *
 * This component is intentionally server-safe (no hooks beyond `useId`, no state),
 * so both a React server component and a client component can render it.
 */

import { useId } from 'react';

export interface BrandMarkProps {
  /** Pixel size of the square mark. Default 28. */
  size?: number;
  /** `brand` draws light-on-navy; `ink` draws navy-on-light. */
  tone?: 'brand' | 'ink';
  /** Accessible name. Pass an empty string when the mark sits next to the wordmark. */
  title?: string;
}

export function BrandMark({ size = 28, tone = 'ink', title = 'SmartQuote' }: BrandMarkProps) {
  const uid = useId().replace(/:/g, '');
  const goldId = `sq-gold-${uid}`;
  const field = tone === 'brand' ? '#ffffff' : 'var(--color-sq-brand)';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role={title === '' ? 'presentation' : 'img'}
      aria-label={title === '' ? undefined : title}
      aria-hidden={title === '' || undefined}
    >
      <defs>
        <linearGradient id={goldId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f9e0a4" />
          <stop offset="100%" stopColor="#b9902f" />
        </linearGradient>
      </defs>
      {/* The shield: a rounded square with a pointed base — a roof and a wall. */}
      <path
        d="M16 2.5 28 7v9.5c0 6.2-4.6 11-12 13-7.4-2-12-6.8-12-13V7L16 2.5Z"
        fill={field}
      />
      {/* The roof line, in gold: the one element that reads as a building at 16px. */}
      <path
        d="M9.5 13 16 9.2 22.5 13"
        stroke={`url(#${goldId})`}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path d="M11 17.5h10" stroke={`url(#${goldId})`} strokeWidth="1.75" strokeLinecap="round" />
      <path d="M11 21.5h6" stroke={`url(#${goldId})`} strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

/** The mark with the product name beside it. */
export function BrandLogo({
  size = 28,
  tone = 'ink',
  showWordmark = true,
}: {
  size?: number;
  tone?: 'brand' | 'ink';
  showWordmark?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <BrandMark size={size} tone={tone} title={showWordmark ? '' : 'SmartQuote'} />
      {showWordmark && (
        <span
          className="text-sq-body font-semibold tracking-tight"
          style={{ color: tone === 'brand' ? '#ffffff' : 'var(--color-sq-brand)' }}
        >
          SmartQuote
        </span>
      )}
    </span>
  );
}
