'use client';

/**
 * The button. Three weights, one shape, no size variants that differ by 1px.
 *
 * Rules that are enforced rather than documented:
 * - Every button carries a `type`, defaulting to `button`. A button inside a form
 *   that forgets it submits the form, which on a quote screen means a save the
 *   operator did not ask for.
 * - A `loading` button is disabled and keeps its width, so the layout does not jump
 *   when a save starts.
 * - `destructive` uses the danger colour and is never the default action.
 */

import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: ButtonVariant;
  /** Shows a determinate-looking busy state and blocks a second click. */
  loading?: boolean;
  /** Rendered before the label. Must be an SVG, never an emoji. */
  icon?: ReactNode;
  /**
   * Extra classes, appended after the variant's.
   *
   * Allowed rather than forbidden, because the one legitimate use is a control on the
   * navy bar where the light-surface variants have the wrong text colour. It is not a
   * general escape hatch: a colour set here should instead become a variant the next
   * time a second caller needs it.
   */
  className?: string;
}

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sq-body font-medium ' +
  'transition-colors duration-sq-fast cursor-pointer select-none ' +
  'disabled:cursor-not-allowed disabled:opacity-55';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-sq-brand text-white hover:bg-sq-brand-hover',
  secondary: 'bg-sq-surface text-sq-ink border border-sq-line hover:bg-sq-ground',
  ghost: 'bg-transparent text-sq-ink hover:bg-sq-ground',
  destructive: 'bg-sq-danger text-white hover:opacity-90',
};

export function Button({
  variant = 'secondary',
  loading = false,
  icon,
  children,
  type = 'button',
  disabled,
  className = '',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`${BASE} ${VARIANT[variant]} ${className}`.trim()}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
}

/** A small busy indicator. Sized to the text so the label does not shift. */
export function Spinner() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      aria-hidden="true"
      className="animate-spin"
    >
      <path d="M12 3a9 9 0 1 0 9 9" strokeLinecap="round" />
    </svg>
  );
}
