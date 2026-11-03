'use client';

/**
 * A money field: typed in dollars, stored in cents.
 *
 * ## Why the storage unit is not the display unit
 *
 * Every amount in this product is whole cents. Storing dollars as a float is the defect that makes
 * a total disagree with the sum of its parts, and on a quote that difference is visible to a
 * customer. So the field parses what a person types into cents and formats cents back into
 * dollars — the conversion happens in exactly two functions, here.
 *
 * ## What it does that a number input does not
 *
 * - Accepts `1,234.50`, `$1234.5` and `1234` — people type all three, and refusing two of them is
 *   a form that argues about punctuation.
 * - Commits on blur and Enter, not per keystroke. Typing `1200` must not calculate
 *   $1, $12, $120.
 * - Says when the figure is the operator's rather than the engine's, and offers a way back. A
 *   negotiated number that cannot be un-negotiated is a number nobody will try.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { money } from '@sq/ui';

export interface MoneyFieldProps {
  id: string;
  label: string;
  /** The amount in **cents**. */
  valueCents: number;
  onChange: (cents: number) => void;
  hint?: string;
  error?: string;
  required?: boolean;
  /** True when this figure is the operator's rather than a computed one. */
  overridden?: boolean;
  /** Offered when `overridden` — returns the field to the computed figure. */
  onReset?: () => void;
  /** Renders the field larger, for the contract price. */
  emphasis?: boolean;
}

/** Cents to a string a person would type: `1234.5` becomes `1,234.50`. */
function toDisplay(cents: number): string {
  if (!Number.isFinite(cents)) return '';
  return (cents / 100).toLocaleString('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Anything a person might type into cents, or `null` when it is not a number. */
export function parseMoneyCents(input: string): number | null {
  // Currency symbols, spaces and thousands separators are all noise. A comma is ambiguous — it is
  // a thousands separator in `1,234` and a decimal mark in `1234,50` — and the position decides:
  // a comma with three digits after it and no dot is a separator, anything else is a decimal.
  let text = input.trim().replace(/[$€£\s]/g, '');
  if (text === '') return null;

  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  const commaIsDecimal = lastComma > lastDot && text.length - lastComma - 1 !== 3;
  text = commaIsDecimal ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');

  const value = Number(text);
  if (!Number.isFinite(value)) return null;

  // `Math.round` rather than a float multiply-then-floor: 1234.5 × 100 is 123449.9999… in binary
  // floating point, and flooring that loses a cent on a figure a customer will check.
  return Math.round(value * 100);
}

export function MoneyField({
  id,
  label,
  valueCents,
  onChange,
  hint,
  error,
  required,
  overridden = false,
  onReset,
  emphasis = false,
}: MoneyFieldProps) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const [text, setText] = useState(() => toDisplay(valueCents));
  const focused = useRef(false);

  useEffect(() => {
    if (focused.current) return;
    setText(toDisplay(valueCents));
  }, [valueCents]);

  const commit = (raw: string): void => {
    const cents = parseMoneyCents(raw);
    if (cents === null) return;
    onChange(cents);
  };

  const invalid = error !== undefined;

  return (
    <div className="flex flex-col gap-sq-1">
      <label htmlFor={id} className="flex items-center gap-sq-2 text-sq-micro font-medium text-sq-ink">
        <span>
          {label}
          {required === true && (
            <span className="ml-1 text-sq-danger" aria-hidden="true">
              *
            </span>
          )}
          {required === true && <span className="sr-only"> (required)</span>}
        </span>
        {overridden && (
          <span className="rounded-full border border-sq-info/25 bg-sq-info/10 px-2 text-sq-micro font-medium text-sq-info">
            your figure
          </span>
        )}
      </label>

      <div
        className={[
          'flex items-center rounded-md border bg-sq-surface transition-colors duration-sq-fast focus-within:ring-2 focus-within:ring-offset-1',
          invalid ? 'border-sq-danger focus-within:ring-sq-danger' : 'border-sq-line focus-within:ring-sq-brand',
        ].join(' ')}
      >
        <span className="pl-sq-2 text-sq-body text-sq-ink-muted" aria-hidden="true">
          $
        </span>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={text}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : hint !== undefined ? hintId : undefined}
          aria-required={required === true || undefined}
          onFocus={() => {
            focused.current = true;
          }}
          onBlur={(event) => {
            focused.current = false;
            commit(event.target.value);
            setText(toDisplay(valueCents));
          }}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit(event.currentTarget.value);
              event.currentTarget.blur();
            }
            if (event.key === 'Escape') {
              setText(toDisplay(valueCents));
              event.currentTarget.blur();
            }
          }}
          className={[
            'min-w-0 flex-1 bg-transparent px-sq-2 py-sq-1 outline-none',
            emphasis ? 'sq-numeric text-sq-display font-semibold' : 'sq-numeric text-sq-body',
          ].join(' ')}
        />
        {onReset !== undefined && (
          <button
            type="button"
            onClick={onReset}
            className="mr-sq-1 min-h-11 shrink-0 cursor-pointer rounded-md px-sq-2 text-sq-micro font-medium text-sq-info transition-colors duration-sq-fast hover:bg-sq-info/10"
          >
            Reset to {money(valueCents === 0 ? 0 : valueCents)}
          </button>
        )}
      </div>

      {invalid ? (
        <p id={errorId} className="text-sq-micro text-sq-danger">
          {error}
        </p>
      ) : hint !== undefined ? (
        <p id={hintId} className="text-sq-micro text-sq-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
