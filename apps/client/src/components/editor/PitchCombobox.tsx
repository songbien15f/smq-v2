'use client';

/**
 * Roof pitch: the book's pitches as a list, and a box that takes any pitch inside the book's range.
 *
 * ## Why a combobox and not a slider or a select
 *
 * The desktop's pitch control is an editable dropdown: the book lists a few angles per span, and an
 * operator may still quote a roof between two of them (it prices as an assumption). A select cannot
 * hold that roof; a slider fires on every pixel and asked the "removes every option" confirm on each.
 * So the list suggests, the box decides, and the value is committed **once** — on a pick, on Enter or
 * on leaving the box — never while typing.
 *
 * The markup follows `AddressField`'s combobox (ARIA 1.2: `role="combobox"` on the input, a
 * `listbox` it controls, `aria-activedescendant` for the highlighted option).
 */

import { useEffect, useId, useRef, useState, type JSX, type ReactNode } from 'react';
import { parseNumber } from './CommitNumberInput';

export interface PitchComboboxProps {
  /** The input's id — the validator's path when this is the Shed group's copy. */
  id: string;
  label: string;
  /** Degrees, or `null` when the quote has no pitch yet. */
  value: number | null;
  /** The angles the book lists for this span. */
  hints: readonly number[];
  /** The book's pitch range for this span; a typed pitch outside it is refused. */
  bounds: { min: number; max: number };
  /** Apply the pitch. `false` when it was not taken (a cancelled confirm) — the box shows `value` again. */
  onCommit: (deg: number) => boolean;
  error?: string;
  /** The validator's path when `id` cannot be it (a second copy of the field). */
  issuePath?: string;
  note?: ReactNode;
  noteTone?: 'muted' | 'attention';
}

const show = (value: number | null): string => (value === null ? '' : String(value));

export function PitchCombobox({
  id,
  label,
  value,
  hints,
  bounds,
  onCommit,
  error,
  issuePath,
  note,
  noteTone = 'muted',
}: PitchComboboxProps): JSX.Element {
  const listId = `${id}-list`;
  const errorId = `${id}-error`;
  const noteId = `${id}-note`;
  const refusalId = useId();
  const [text, setText] = useState(() => show(value));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [refusal, setRefusal] = useState<string | null>(null);
  const focused = useRef(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  /** Set by a pick or by Escape, so the blur that follows does not commit the box a second time. */
  const settled = useRef(false);

  // Follow the stored pitch when it changes elsewhere (the other copy of the field, an undo).
  useEffect(() => {
    if (!focused.current) setText(show(value));
  }, [value]);

  /*
   * Close on a press outside. Closing used to hang off the input's blur alone, so a list opened from
   * the chevron while the input never had focus stayed open until something focused and left the box.
   */
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent): void => {
      if (wrapperRef.current !== null && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
        setActive(-1);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  /** Apply `next`, or say why not. Returns the number the box should show. */
  const apply = (next: number): number | null => {
    if (next < bounds.min || next > bounds.max) {
      setRefusal(`${next}° is outside ${bounds.min}–${bounds.max}° for this span.`);
      return value;
    }
    setRefusal(null);
    // Unchanged: nothing to apply, and no reason to ask the confirm.
    if (next === value) return value;
    return onCommit(next) ? next : value;
  };

  const commitText = (raw: string): void => {
    const parsed = parseNumber(raw);
    if (parsed === null) {
      // Empty or not a number: nothing typed that means a pitch — show the stored one again.
      setRefusal(null);
      setText(show(value));
      return;
    }
    setText(show(apply(parsed)));
  };

  const pick = (hint: number): void => {
    settled.current = true;
    setOpen(false);
    setActive(-1);
    setText(show(apply(hint)));
  };

  const invalid = error !== undefined;
  const describedBy =
    [invalid ? errorId : null, refusal !== null ? refusalId : null, note !== undefined && note !== null ? noteId : null]
      .filter((part) => part !== null)
      .join(' ') || undefined;
  const activeId = open && active >= 0 && active < hints.length ? `${listId}-${active}` : undefined;

  return (
    <div className="flex flex-col gap-sq-1" data-issue-path={issuePath}>
      <label htmlFor={id} className="text-sq-micro font-medium text-sq-ink">
        {label}
      </label>
      <div className="relative" ref={wrapperRef}>
        <div
          className={[
            'flex min-h-11 items-center rounded-md border bg-sq-surface',
            'focus-within:ring-2 focus-within:ring-offset-1',
            invalid ? 'border-sq-danger focus-within:ring-sq-danger' : 'border-sq-line focus-within:ring-sq-brand',
          ].join(' ')}
        >
          <input
            ref={inputRef}
            id={id}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeId}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            value={text}
            onFocus={() => {
              focused.current = true;
              settled.current = false;
            }}
            onChange={(event) => {
              // A pick keeps focus here, so no blur cleared the flag — typing again must commit on leave.
              settled.current = false;
              setText(event.target.value);
            }}
            onBlur={(event) => {
              focused.current = false;
              // Closing later lets an option's mousedown land first (AddressField does the same).
              window.setTimeout(() => {
                setOpen(false);
                setActive(-1);
              }, 120);
              if (settled.current) {
                settled.current = false;
                return;
              }
              commitText(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                if (hints.length === 0) return;
                setOpen(true);
                setActive((current) => Math.min(current + 1, hints.length - 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                if (!open) return;
                setActive((current) => Math.max(current - 1, 0));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                if (open && active >= 0 && active < hints.length) {
                  pick(hints[active]);
                  return;
                }
                // Blur commits the typed text — committing here too would ask the confirm twice.
                event.currentTarget.blur();
              } else if (event.key === 'Escape') {
                if (open) {
                  // Close the list only — not the Building parameters popover listening on `document`.
                  // React's root *is* `document` under the App Router, so stopPropagation cannot reach a
                  // listener on the same node; `defaultPrevented` is the signal the popover reads.
                  event.preventDefault();
                  event.stopPropagation();
                  setOpen(false);
                  setActive(-1);
                  return;
                }
                settled.current = true;
                setRefusal(null);
                setText(show(value));
                event.currentTarget.blur();
              }
            }}
            className="min-w-0 flex-1 self-stretch bg-transparent px-sq-2 py-sq-1 text-sq-body text-sq-ink outline-none"
          />
          <span className="shrink-0 text-sq-micro font-medium text-sq-ink-muted" aria-hidden="true">
            °
          </span>
          <button
            type="button"
            aria-label="Show the book's pitches"
            aria-controls={listId}
            aria-expanded={open}
            disabled={hints.length === 0}
            tabIndex={-1}
            // mousedown, not click: keeps focus in the input so its blur does not commit mid-toggle.
            onMouseDown={(event) => {
              event.preventDefault();
              // Into the box, so leaving it closes the list and Arrow/Enter/Escape work from here.
              inputRef.current?.focus();
              setOpen((current) => !current);
              setActive(-1);
            }}
            className="flex h-11 w-11 shrink-0 items-center justify-center text-sq-ink-muted disabled:opacity-40"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        {open && hints.length > 0 && (
          <ul
            id={listId}
            role="listbox"
            aria-label={`${label} the book lists`}
            className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-sq-line bg-sq-surface py-1 shadow-lg"
          >
            {hints.map((hint, index) => (
              <li
                key={hint}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={hint === value}
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(hint);
                }}
                className={[
                  'flex min-h-11 cursor-pointer items-center px-sq-2 py-sq-1 text-sq-body',
                  index === active ? 'bg-sq-brand/10' : '',
                ].join(' ')}
              >
                {hint}°
              </li>
            ))}
          </ul>
        )}
      </div>
      {refusal !== null && (
        <p id={refusalId} role="alert" className="text-sq-micro text-sq-danger">
          {refusal}
        </p>
      )}
      {invalid && (
        <p id={errorId} className="text-sq-micro text-sq-danger">
          {error}
        </p>
      )}
      {note !== undefined && note !== null && (
        <p id={noteId} className={`text-sq-micro ${noteTone === 'attention' ? 'text-sq-attention' : 'text-sq-ink-muted'}`}>
          {note}
        </p>
      )}
    </div>
  );
}
