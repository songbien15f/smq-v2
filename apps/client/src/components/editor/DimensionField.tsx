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
import { parseNumber } from './CommitNumberInput';

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
  /**
   * Called with the accepted value in mm. Return `false` when it was not taken — the person cancelled
   * the "removes every option" confirm — and the field shows the stored value again.
   */
  onCommit: (mm: number) => boolean | void;
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
  /**
   * The validator's path for this field when `id` cannot be it — a second copy of a field, such as the
   * Building parameters popover's span, whose id must differ from the Shed group's `shed-span`.
   * Leaving the field then marks that path touched (see `QuoteEditor`'s `markTouched`).
   */
  issuePath?: string;
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
  issuePath,
}: DimensionFieldProps) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const [text, setText] = useState(() => format(valueMm, unit));

  // Follow the value when it changes from elsewhere — an undo, a preset, a normalisation clamp.
  // A ref guards against overwriting what the operator is typing: the input is only reset when
  // the text does not already mean this value.
  const focused = useRef(false);
  /** Set by Escape so the blur it causes reverts instead of committing what was typed. */
  const escaping = useRef(false);
  useEffect(() => {
    if (focused.current) return;
    setText(format(valueMm, unit));
  }, [valueMm, unit]);

  /**
   * Why the last entry was refused, or `null`.
   *
   * ## Why a refusal has to say something
   *
   * `commit` used to `return` on an out-of-range value, which leaves the field showing what was typed
   * while the quote keeps the old number — a silent divergence. Measured 2026-11-10: typing 24 000 into
   * span (the book caps it at 15 000) left the box reading 24 000 and the config at 6 000, with nothing
   * on screen explaining it. The operator's next action is to type it again.
   *
   * Clamping would be worse: it produces a building nobody described. So the value is refused **and**
   * the reason is printed under the field, which is the only version of "no" a person can act on.
   */
  const [refusal, setRefusal] = useState<string | null>(null);

  /** Parse and commit. True when the value is now the stored one; false when it was not taken. */
  const commit = (raw: string): boolean => {
    const parsed = parseNumber(raw);
    if (parsed === null) {
      setRefusal(null);
      return false;
    }

    const mm = Math.round(unit === 'm' ? parsed * 1000 : parsed);
    const shown = (value: number) => `${unit === 'm' ? (value / 1000).toFixed(2) : value} ${unit}`;
    if (minMm !== undefined && mm < minMm) {
      setRefusal(`${shown(mm)} is below the smallest this book sells (${shown(minMm)}).`);
      return false;
    }
    if (maxMm !== undefined && mm > maxMm) {
      setRefusal(`${shown(mm)} is above the largest this book sells (${shown(maxMm)}).`);
      return false;
    }

    setRefusal(null);
    // Unchanged: nothing to apply, and no reason to ask the confirm.
    if (mm === valueMm) return true;
    return onCommit(mm) !== false;
  };

  const invalid = error !== undefined;

  return (
    <div className="flex flex-col gap-sq-1" data-issue-path={issuePath}>
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
          'flex min-h-11 items-center rounded-md border bg-sq-surface',
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
            if (escaping.current) {
              escaping.current = false;
              return;
            }
            /*
             * Snap the display back to the **stored** value whenever the entry was not taken — refused
             * (and `refusal` says why), empty, not a number, or a cancelled confirm — and leave the typed
             * text alone when it was accepted, so the box always shows what the quote holds.
             *
             * This used to read `refusal` here, which is the state from **before** `commit` ran, so a
             * fresh refusal left the typed number in the box; and a cancelled confirm was not seen at
             * all, leaving the box at the number the quote did not keep.
             */
            if (!commit(event.target.value)) setText(format(valueMm, unit));
          }}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              // Blur commits. Committing here as well asked the wipe confirm twice: once for Enter,
              // then again from blur, whose closure still held the pre-change config.
              event.currentTarget.blur();
            }
            if (event.key === 'Escape') {
              // Revert without committing: the DOM still holds the typed text when blur fires.
              escaping.current = true;
              setRefusal(null);
              setText(format(valueMm, unit));
              event.currentTarget.blur();
            }
          }}
          // `self-stretch`: the 44 px is the wrapper's; without it the input is ~29 px tall and a tap
          // on the wrapper's top or bottom strip focuses nothing.
          className="min-w-0 flex-1 self-stretch bg-transparent px-sq-2 py-sq-1 text-sq-body text-sq-ink outline-none"
        />
        <span className="shrink-0 pr-sq-2 text-sq-micro font-medium text-sq-ink-muted" aria-hidden="true">
          {unit}
        </span>
      </div>

      {/*
        The refusal, above the field's own error.

        It is the same shape as the error so a person reads one kind of message here, but it is a
        different fact: an error is "this value is not valid for the building", this is "I could not
        accept what you typed at all". Both say what to do — the bound is named in the sentence.
      */}
      {refusal !== null && (
        <p role="alert" className="text-sq-micro text-sq-danger">
          {refusal}
        </p>
      )}

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
