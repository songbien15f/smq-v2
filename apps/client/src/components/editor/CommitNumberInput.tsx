'use client';

import { useEffect, useRef, useState, type InputHTMLAttributes, type JSX } from 'react';

/**
 * A number from what a person typed, or null when it is not one.
 *
 * Trims, and reads a decimal comma as a point (`12,5` is 12.5), because the people typing it use both.
 * Empty and non-finite text are null: neither is ever written to the quote.
 */
export function parseNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}


export interface CommitNumberInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'min' | 'max'> {
  id: string;
  value: number;
  min: number;
  max: number;
  /** Return false when the value was not taken (a cancelled confirm): the input shows `value` again. */
  onCommit: (next: number) => boolean | void;
  /** 'integer' rounds, 'decimal' keeps one or more decimals. Default 'integer'. */
  kind?: 'integer' | 'decimal';
  /** Called with the refusal sentence, or null, so the caller can render it under its own label. */
  onRefusal?: (message: string | null) => void;
  /** Unit for the refusal sentence, e.g. 'mm', '%', ''. */
  unit?: string;
}

/**
 * A number input that counts what was typed only when the person leaves the field (blur) or presses Enter.
 *
 * ## Why not commit on every keystroke
 *
 * Each keystroke used to be applied: typing 5000 into a bay spacing recalculated the length at 5, 50,
 * 500 and 5000; clearing a cantilever to retype it removed the cantilever; and with options placed,
 * each digit in Bays could ask the "removes every option" confirm again. Holding the text locally and
 * committing once gives one evaluation and at most one confirm per entry.
 *
 * ## What it refuses, and how
 *
 * Empty or non-numeric text is not a value, so it reverts silently. A number outside `min`–`max` is
 * refused with a sentence (via `onRefusal`) and reverted — never clamped, which would produce a
 * building nobody described. `onCommit` returning `false` (a cancelled confirm) reverts too, so the
 * box always shows what the quote holds.
 */
export function CommitNumberInput({
  id,
  value,
  min,
  max,
  onCommit,
  kind = 'integer',
  onRefusal,
  unit = '',
  onFocus,
  onBlur,
  onKeyDown,
  ...rest
}: CommitNumberInputProps): JSX.Element {
  const [text, setText] = useState(() => String(value));
  const focused = useRef(false);
  /** Set by Escape so the blur it causes reverts instead of committing what is still in the box. */
  const escaping = useRef(false);

  // Follow the stored value when it changes from elsewhere, but never over what is being typed.
  useEffect(() => {
    if (focused.current) return;
    setText(String(value));
  }, [value]);

  /** The number now stored, or null when the entry was not taken. */
  const commit = (raw: string): number | null => {
    const parsed = parseNumber(raw);
    if (parsed === null) {
      onRefusal?.(null);
      return null;
    }
    const next = kind === 'integer' ? Math.round(parsed) : parsed;
    if (next < min || next > max) {
      const u = unit === '' ? '' : ` ${unit}`;
      onRefusal?.(`${next}${u} is outside ${min}–${max}${u}.`);
      return null;
    }
    onRefusal?.(null);
    if (next === value) return next;
    return onCommit(next) === false ? null : next;
  };

  return (
    <input
      {...rest}
      id={id}
      type="text"
      inputMode={kind === 'integer' ? 'numeric' : 'decimal'}
      autoComplete="off"
      value={text}
      onChange={(event) => setText(event.target.value)}
      onFocus={(event) => {
        focused.current = true;
        onFocus?.(event);
      }}
      onBlur={(event) => {
        focused.current = false;
        if (escaping.current) {
          escaping.current = false;
        } else {
          // Show the number as the record holds it (`12,5` → `12.5`), or the stored one when not taken.
          const stored = commit(event.target.value);
          setText(String(stored ?? value));
        }
        onBlur?.(event);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          // Blur commits; committing here too would ask a confirm twice.
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          // Handled here (revert), so a flyout around this box stays open until a second Escape.
          event.preventDefault();
          escaping.current = true;
          onRefusal?.(null);
          setText(String(value));
          event.currentTarget.blur();
        }
        onKeyDown?.(event);
      }}
    />
  );
}
