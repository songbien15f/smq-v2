'use client';

/**
 * An address field with Google Places suggestions, filling the four parts a quote keeps.
 *
 * ## Why four fields and not one string
 *
 * The upstream project resolved a picked suggestion to a single formatted address. That works for one
 * text box; this product has four — address, suburb, state, postcode — because an Australian quote
 * states them separately and **the state selects the price table**. A suggestion that fills only the
 * street line leaves the operator retyping the state, which is exactly the field a typo makes
 * expensive.
 *
 * ## Why it degrades to a plain text box
 *
 * A missing key, a Google outage and a rate limit are all deployment facts, not the operator's
 * mistake. In every one of those cases the field still accepts typing and the address can still be
 * written by hand — the suggestion list is an accelerator, never a gate.
 *
 * ## Accessibility
 *
 * A real ARIA combobox: `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-autocomplete`,
 * `aria-activedescendant`, and a `listbox` of `option`s. Arrow keys wrap, Enter picks, Escape closes.
 * A suggestion list that can only be used with a mouse is a list half the office cannot use.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';

/** One suggestion while typing. */
interface Suggestion {
  placeId: string;
  primary: string;
  secondary: string;
}

/** The four parts a picked address resolves to. */
export interface AddressParts {
  address: string;
  suburb: string;
  state: string;
  postcode: string;
}

export interface AddressFieldProps {
  id: string;
  label: string;
  value: string;
  /** Called with the typed street line, and again with all four parts when a suggestion is picked. */
  onChange: (address: string) => void;
  onResolved?: (parts: AddressParts) => void;
  placeholder?: string;
  disabled?: boolean;
  hint?: string;
}

/** How long to wait after a keystroke before asking. */
const DEBOUNCE_MS = 250;
/** The shortest query worth sending: Places bills per request. */
const MIN_QUERY = 3;

export function AddressField({
  id,
  label,
  value,
  onChange,
  onResolved,
  placeholder,
  disabled = false,
  hint,
}: AddressFieldProps) {
  const listId = useId();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [note, setNote] = useState('');
  const abort = useRef<AbortController | null>(null);

  // Ask for suggestions only while the operator is typing, not after they pick.
  const [typed, setTyped] = useState<string | null>(null);

  useEffect(() => {
    if (typed === null || typed.trim().length < MIN_QUERY) return;

    const timer = setTimeout(() => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;

      void fetch(`/api/sq/places/autocomplete?q=${encodeURIComponent(typed.trim())}`, {
        signal: controller.signal,
        cache: 'no-store',
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((payload: { ok: boolean; data?: { configured: boolean; suggestions: Suggestion[] }; message?: string } | null) => {
          if (controller.signal.aborted) return;
          if (payload === null || !payload.ok || payload.data === undefined) {
            // A failure is not "no such address". Say the lookup is unavailable and leave the box
            // usable, so the operator does not conclude the address is wrong.
            setNote('Address suggestions are unavailable right now.');
            setSuggestions([]);
            setOpen(false);
            return;
          }
          setSuggestions(payload.data.suggestions);
          setActive(-1);
          setOpen(payload.data.suggestions.length > 0);
          setNote(payload.data.configured ? '' : 'Address suggestions are not configured on this server.');
        })
        .catch(() => {
          if (!controller.signal.aborted) setNote('Address suggestions are unavailable.');
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [typed]);

  const pick = useCallback(
    async (suggestion: Suggestion): Promise<void> => {
      // Show the picked line immediately so the field never looks like it ignored the click; the
      // resolved address replaces it a moment later.
      const immediate = [suggestion.primary, suggestion.secondary].filter((part) => part !== '').join(', ');
      onChange(immediate);
      setOpen(false);
      setTyped(null);
      setSuggestions([]);

      try {
        const response = await fetch(`/api/sq/places/details?id=${encodeURIComponent(suggestion.placeId)}`, {
          cache: 'no-store',
        });
        if (!response.ok) return;
        const payload = (await response.json()) as {
          ok: boolean;
          data?: {
            address: {
              formatted: string;
              street: string;
              suburb: string;
              state: string;
              postcode: string;
            } | null;
          };
        };
        const address = payload.data?.address ?? null;
        if (address === null) return;

        onChange(address.street !== '' ? address.street : address.formatted);
        onResolved?.({
          address: address.street !== '' ? address.street : address.formatted,
          suburb: address.suburb,
          state: address.state,
          postcode: address.postcode,
        });
      } catch {
        // The immediate value stays; the operator can correct the parts by hand.
      }
    },
    [onChange, onResolved],
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (!open || suggestions.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => (current + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => (current <= 0 ? suggestions.length - 1 : current - 1));
    } else if (event.key === 'Enter' && active >= 0) {
      event.preventDefault();
      const suggestion = suggestions[active];
      if (suggestion !== undefined) void pick(suggestion);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  const activeId = active >= 0 ? `${listId}-${active}` : undefined;

  return (
    <div className="flex flex-col gap-sq-1">
      <label htmlFor={id} className="text-sq-micro font-medium text-sq-ink">
        {label}
      </label>

      <div className="relative">
        <input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          aria-describedby={note === '' && hint === undefined ? undefined : `${id}-note`}
          autoComplete="off"
          disabled={disabled}
          placeholder={placeholder}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            setTyped(event.target.value);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => {
            // A blur closes the list, but not before a click on an option lands: the option's
            // `onMouseDown` fires first and picks.
            setTimeout(() => setOpen(false), 120);
          }}
          className="min-h-[38px] w-full rounded-md border border-sq-line bg-sq-surface px-sq-2 py-sq-1 text-sq-body text-sq-ink"
        />

        {open && suggestions.length > 0 && (
          <ul
            id={listId}
            role="listbox"
            className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-sq-line bg-sq-surface py-1 shadow-lg"
          >
            {suggestions.map((suggestion, index) => (
              <li
                key={suggestion.placeId}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                onMouseDown={(event) => {
                  // `mousedown` rather than `click`: the input's blur would close the list first.
                  event.preventDefault();
                  void pick(suggestion);
                }}
                className={[
                  'cursor-pointer px-sq-2 py-sq-1 text-sq-body',
                  index === active ? 'bg-sq-brand/10 text-sq-ink' : 'text-sq-ink hover:bg-sq-ground',
                ].join(' ')}
              >
                <span className="block font-medium">{suggestion.primary}</span>
                {suggestion.secondary !== '' && (
                  <span className="block text-sq-micro text-sq-ink-muted">{suggestion.secondary}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {(note !== '' || hint !== undefined) && (
        <p id={`${id}-note`} className="text-sq-micro text-sq-ink-muted">
          {note !== '' ? note : hint}
        </p>
      )}
    </div>
  );
}
