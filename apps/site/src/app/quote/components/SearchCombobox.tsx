'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { SearchResult } from '../addressSearch';
import { IconSearch } from './icons';

export interface ComboOption<T> {
  key: string;
  primary: string;
  secondary: string;
  value: T;
}

const DEBOUNCE_MS = 300;

type Status =
  | { kind: 'idle' }
  | { kind: 'searching' }
  | { kind: 'done'; count: number }
  | { kind: 'message'; text: string };

/**
 * A WAI-ARIA 1.2 combobox with a list popup ("editable combobox with list autocomplete"), on any
 * search function: the Guest page's address and suburb boxes.
 *
 * - Typing waits 300 ms, then searches; a newer keystroke aborts the request still in flight (P11).
 * - ↓/↑ move through the options (focus stays in the box, `aria-activedescendant` points at the
 *   option), Enter picks, Esc closes the list and, pressed again, clears the box.
 * - The number of results is announced in a polite live region; the options themselves are not.
 * - `search` returning `fallback: true` hands the reason to `onFallback` — the box does not decide
 *   what the page does next.
 */
export function SearchCombobox<T>({
  id,
  label,
  hint,
  placeholder,
  minChars,
  search,
  onPick,
  onFallback,
  footer,
  initialText = '',
  autoComplete = 'off',
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  placeholder?: string;
  minChars: number;
  search: (q: string, signal: AbortSignal) => Promise<SearchResult<ComboOption<T>[]>>;
  onPick: (option: ComboOption<T>) => void;
  onFallback: (message: string) => void;
  /** Shown under the options while the list is open (Google's attribution). */
  footer?: ReactNode;
  initialText?: string;
  autoComplete?: string;
}) {
  const [text, setText] = useState(initialText);
  const [options, setOptions] = useState<ComboOption<T>[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controller = useRef<AbortController | null>(null);
  const listId = `${id}-list`;
  const hintId = useId();
  const optionId = (i: number) => `${id}-opt-${i}`;

  const cancel = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    controller.current?.abort();
    controller.current = null;
  };
  useEffect(() => cancel, []);

  // Arrow keys move the highlight; keep it inside the list's own scroll area.
  useEffect(() => {
    if (active >= 0) document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' });
    // optionId only depends on `id`, which never changes for a mounted box.
  }, [active]);

  const close = () => {
    setOpen(false);
    setActive(-1);
  };

  const run = (q: string) => {
    cancel();
    if (q.trim().length < minChars) {
      setOptions([]);
      setStatus({ kind: 'idle' });
      close();
      return;
    }
    timer.current = setTimeout(() => {
      const c = new AbortController();
      controller.current = c;
      setStatus({ kind: 'searching' });
      search(q.trim(), c.signal).then(
        (result) => {
          if (c.signal.aborted) return;
          controller.current = null;
          if (!result.ok) {
            setOptions([]);
            close();
            if (result.fallback) {
              setStatus({ kind: 'idle' });
              onFallback(result.message);
            } else {
              setStatus({ kind: 'message', text: result.message });
            }
            return;
          }
          setOptions(result.data);
          setActive(-1);
          setOpen(true);
          setStatus({ kind: 'done', count: result.data.length });
        },
        (error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') return;
          setStatus({ kind: 'message', text: 'Something went wrong. Please try again.' });
        },
      );
    }, DEBOUNCE_MS);
  };

  const pick = (option: ComboOption<T>) => {
    cancel();
    setText(option.secondary === '' ? option.primary : `${option.primary}, ${option.secondary}`);
    setOptions([]);
    setStatus({ kind: 'idle' });
    close();
    onPick(option);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const count = options.length;
    switch (event.key) {
      case 'ArrowDown':
        if (count === 0) return;
        event.preventDefault();
        setOpen(true);
        setActive((a) => (a + 1) % count);
        return;
      case 'ArrowUp':
        if (count === 0) return;
        event.preventDefault();
        setOpen(true);
        setActive((a) => (a <= 0 ? count - 1 : a - 1));
        return;
      case 'Enter':
        if (open && active >= 0 && active < count) {
          event.preventDefault();
          pick(options[active]!);
        }
        return;
      case 'Escape':
        if (open) {
          event.preventDefault();
          close();
        } else if (text !== '') {
          event.preventDefault();
          cancel();
          setText('');
          setOptions([]);
          setStatus({ kind: 'idle' });
        }
        return;
      default:
    }
  };

  const expanded = open && options.length > 0;
  const statusText =
    status.kind === 'searching'
      ? 'Searching…'
      : status.kind === 'done'
        ? status.count === 0
          ? 'No matches.'
          : `${status.count} ${status.count === 1 ? 'suggestion' : 'suggestions'}. Use the arrow keys to choose.`
        : status.kind === 'message'
          ? status.text
          : '';

  return (
    <div className="g-combo">
      <label className="g-label" htmlFor={id}>
        {label}
      </label>
      {hint === undefined ? null : (
        <p id={hintId} className="g-hint">
          {hint}
        </p>
      )}
      <div className="g-combo-box">
        <IconSearch className="g-combo-icon" />
        <input
          id={id}
          className="g-input g-combo-input"
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
          aria-describedby={hint === undefined ? undefined : hintId}
          autoComplete={autoComplete}
          spellCheck={false}
          placeholder={placeholder}
          value={text}
          maxLength={100}
          onChange={(event) => {
            setText(event.target.value);
            run(event.target.value);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => {
            if (options.length > 0) setOpen(true);
          }}
          onBlur={close}
        />
        <div className="g-combo-popup" hidden={!expanded}>
          <ul id={listId} role="listbox" aria-label={label} className="g-combo-list">
            {options.map((option, i) => (
              <li
                key={option.key}
                id={optionId(i)}
                role="option"
                aria-selected={i === active}
                className="g-combo-option"
                // Keep focus in the box: a mousedown would blur it and close the list before the click.
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => setActive(i)}
                onClick={() => pick(option)}
              >
                <span className="g-combo-primary">{option.primary}</span>
                {option.secondary === '' ? null : <span className="g-combo-secondary">{option.secondary}</span>}
              </li>
            ))}
          </ul>
          {footer}
        </div>
      </div>
      <p className="g-combo-status" role="status" aria-live="polite">
        {statusText}
      </p>
    </div>
  );
}
