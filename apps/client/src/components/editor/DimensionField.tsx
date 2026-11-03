'use client';

/**
 * A dimension field: millimetres in the record, whatever the operator prefers to type.
 *
 * ## Why the display unit is separate from the value
 *
 * A shed is described in metres — "nine metres wide" — but the record is millimetres, because a
 * sheet is cut to 6173 mm and a wall is 3000 mm. Storing metres means a float in the database and
 * a rounding argument on every line. So the **value is always mm** and the unit is a display
 * choice; switching it must never change the building.
 *
 * ## What this input does that a plain number input does not
 *
 * - `inputmode="decimal"` so a phone shows a numeric keypad rather than a full keyboard.
 * - Commits on blur and on Enter, not on every keystroke: typing "12000" must not fire six
 *   evaluations of "1", "12", "120"…
 * - Commits only when the text parses to a finite number, so a half-typed value is not written
 *   into the building.
 * - Says what the number will be stored as, when the unit is not mm, so a person typing `9`
 *   under "metres" is not surprised by `9000` in the record.
 */

import { useEffect, useRef, useState } from 'react';

export type DisplayUnit = 'mm' | 'm';

export interface DimensionFieldProps {
  /**
   * The element id, which **must** be the path the validator uses.
   *
   * Required, not generated. `useId()` was the first implementation and it broke the error summary:
   * the validator addresses a field as `shed-span`, the summary links to `#shed-span`, and the
   * generated id is `«r7»` — so clicking an item in the summary did nothing. A field id that the
   * validator cannot name is a field the summary cannot reach.
   */
  id: string;
  label: string;
  /** The value in millimetres, or `null` when unset. */
  valueMm: number | null;
  /** How the operator is typing. Converted to mm before `onCommit`. */
  unit: DisplayUnit;
  onCommit: (mm: number) => void;
  /** Shown under the field; also used as the accessible description. */
  hint?: string;
  error?: string;
  required?: boolean;
  /** Smallest and largest accepted, in mm. A value outside is refused rather than clamped:
   *  clamping silently produces a building nobody described. */
  minMm?: number;
  maxMm?: number;
  step?: number;
  /** A short note about what the number means (e.g. "clear span"). */
  suffixNote?: string;
}

/** Format a stored value for display in `unit`, without trailing zeros. */
function format(valueMm: number | null, unit: DisplayUnit): string {
  if (valueMm === null || !Number.isFinite(valueMm)) return '';
  const shown = unit === 'm' ? valueMm / 1000 : valueMm;
  // `String(Number(x.toFixed(3)))` drops a trailing `.0` and keeps a real decimal.
  return String(Number(shown.toFixed(3)));
}

export function DimensionField({
  id,
  label,
  valueMm,
  unit,
  onCommit,
  hint,
  error,
  required,
  minMm,
  maxMm,
  step,
  suffixNote,
}: DimensionFieldProps) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const [text, setText] = useState(() => format(valueMm, unit));

  // Follow the value when it changes from elsewhere — an undo, a preset, a normalisation clamp.
  // A ref guards against overwriting what the operator is typing: the input is only reset when
  // the text does not already mean this value.
  const focused = useRef(false);
  useEffect(() => {
    if (focused.current) return;
    setText(format(valueMm, unit));
  }, [valueMm, unit]);

  /** Parse and commit, or leave the text alone so the operator can finish typing. */
  const commit = (raw: string): void => {
    const trimmed = raw.trim();
    if (trimmed === '') return;

    const parsed = Number(trimmed.replace(',', '.'));
    if (!Number.isFinite(parsed)) return;

    const mm = Math.round(unit === 'm' ? parsed * 1000 : parsed);
    if (minMm !== undefined && mm < minMm) return;
    if (maxMm !== undefined && mm > maxMm) return;

    onCommit(mm);
  };

  const invalid = error !== undefined;

  return (
    <div className="flex flex-col gap-sq-1">
      <label htmlFor={id} className="text-sq-micro font-medium text-sq-ink">
        {label}
        {required === true && (
          <span className="ml-1 text-sq-danger" aria-hidden="true">
            *
          </span>
        )}
        {required === true && <span className="sr-only"> (required)</span>}
      </label>

      <div
        className={[
          'flex min-h-[38px] items-center rounded-md border bg-sq-surface',
          'transition-colors duration-sq-fast focus-within:ring-2 focus-within:ring-offset-1',
          invalid ? 'border-sq-danger focus-within:ring-sq-danger' : 'border-sq-line focus-within:ring-sq-brand',
        ].join(' ')}
      >
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          // `step` is meaningful only to a spinner; this input has none, so the attribute is
          // omitted rather than passed to a text input where it does nothing.
          data-step={step}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : hint !== undefined ? hintId : undefined}
          aria-required={required === true || undefined}
          value={text}
          onFocus={() => {
            focused.current = true;
          }}
          onBlur={(event) => {
            focused.current = false;
            commit(event.target.value);
            // Snap the display to the stored value, so "9.0000" becomes "9" and a refused value
            // visibly reverts rather than sitting there looking accepted.
            setText(format(valueMm, unit));
          }}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit(event.currentTarget.value);
              event.currentTarget.blur();
            }
            if (event.key === 'Escape') {
              setText(format(valueMm, unit));
              event.currentTarget.blur();
            }
          }}
          className="min-w-0 flex-1 bg-transparent px-sq-2 py-sq-1 text-sq-body text-sq-ink outline-none"
        />
        <span className="shrink-0 pr-sq-2 text-sq-micro font-medium text-sq-ink-muted" aria-hidden="true">
          {unit}
        </span>
      </div>

      {invalid ? (
        <p id={errorId} className="flex items-start gap-1 text-sq-micro text-sq-danger">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
            className="mt-0.5 shrink-0"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v5M12 16h.01" strokeLinecap="round" />
          </svg>
          {error}
        </p>
      ) : hint !== undefined ? (
        <p id={hintId} className="text-sq-micro text-sq-ink-muted">
          {hint}
          {suffixNote !== undefined && unit !== 'mm' && (
            <span className="sq-numeric"> · stored as {format(valueMm, 'mm') || '—'} mm</span>
          )}
        </p>
      ) : null}
    </div>
  );
}
