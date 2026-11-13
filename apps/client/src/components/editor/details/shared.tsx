'use client';

/** Pieces more than one Step 1 group uses. */

import { useEffect, useId, useState } from 'react';
import { COLORBOND, COLOUR_ROLES } from '@sq/core/domain';
import {
  averageHeightMm,
  formatDimension,
  internalPressureApproximate,
  outsideBookBounds,
  ridgeHeightMm,
  suggestedValues,
} from '@sq/core/domain';
import { downpipePalette, reconcileDownpipeColour, withDimensions } from '@sq/core/domain';
import { defaultOptionsFor } from '@sq/core/domain';
import {
  QUOTE_RATE_TIERS,
  rateTierFor,
  bayWidthsFor,
  computeBayWidths,
  pitchOutsideBookSpan,
  reconcileBays,
  roofPitchBoundsForSpan,
  roofPitchHintsForSpan,
  shouldWipeOptions,
} from '@sq/core/domain';
import type { Catalogue } from '@sq/core/pricing';
import { deliveryForScope, freightScope } from '@sq/core/domain';
import type {
  DisplayUnit,
  QuoteRateTier,
  ShedColors,
  ShedConfig,
  StructureType,
} from '@sq/core/domain';
import { Field, StatusPill } from '@sq/ui';
import { AddressField } from '../AddressField';
import { DimensionField } from '../DimensionField';
import type { DraftIssue } from '../validation';
import { useDraftStore } from '@/store/useDraftStore';
import { useSiteCheck } from '../siteCheckState';
import { OPEN_GROUP_EVENT } from './SectionJump';
import { useShedStore } from '@/store/useShedStore';
import { useCatalogue } from '@/hooks/useCatalogue';
import { useCompanyPricing } from '@/hooks/useCompanyPricing';

/** A group that can be collapsed, remembering nothing between visits on purpose. */
export function Group({
  id,
  title,
  count,
  issueCount,
  defaultOpen = true,
  aside,
  children,
}: {
  /** Anchor for `SectionJump`: the section carries it and opens itself when asked. */
  id?: string;
  title: string;
  /** A short right-aligned note, e.g. "3 of 4 required". */
  count?: string;
  issueCount: number;
  defaultOpen?: boolean;
  /**
   * Status or an action beside the title. Rendered **outside** the toggle button, because a button
   * inside a button is invalid HTML and a click on it would also fold the group.
   */
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  useEffect(() => {
    if (id === undefined) return undefined;
    const onOpen = (event: Event): void => {
      if ((event as CustomEvent<string>).detail === id) setOpen(true);
    };
    window.addEventListener(OPEN_GROUP_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_GROUP_EVENT, onOpen);
  }, [id]);

  return (
    <section id={id} className="border-b border-sq-line last:border-0">
      <div className="flex items-center">
      <h3 className="min-w-0 flex-1">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
          /*
           * An explicit accessible name rather than letting the browser concatenate the parts.
           *
           * Without it the computed name is `Delivery1 to fix` — the visible pill runs into the
           * title with no separator, so a screen reader announces "Delivery one to fix" as one
           * word. The pill stays for the eye; this states the same fact in words for the ear.
           */
          aria-label={
            issueCount > 0
              ? `${title}, ${issueCount} ${issueCount === 1 ? 'item needs' : 'items need'} attention`
              : title
          }
          className="flex min-h-11 w-full cursor-pointer items-center gap-sq-2 px-sq-3 text-left transition-colors duration-sq-fast hover:bg-sq-ground/70"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            aria-hidden="true"
            className={`shrink-0 text-sq-ink-muted transition-transform duration-sq-fast ${open ? 'rotate-90' : ''}`}
          >
            <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-sq-body font-semibold text-sq-ink">{title}</span>
          {issueCount > 0 && <StatusPill tone="attention" label={`${issueCount} to fix`} />}
          {count !== undefined && (
            <span className="ml-auto text-sq-micro text-sq-ink-muted">{count}</span>
          )}
        </button>
      </h3>
      {aside !== undefined && (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-x-sq-2 gap-y-1 pr-sq-3">{aside}</div>
      )}
      </div>
      {open && (
        <div id={panelId} className="flex flex-col gap-sq-3 px-sq-3 pb-sq-3">
          {children}
        </div>
      )}
    </section>
  );
}

/**
 * Snap a thickness to one the chosen profile is sold in.
 *
 * A profile is not sold in every thickness: on the reference book `Lo-Rib` has 0.35 and 0.42 but no
 * 0.48. Asking the book for a pair it does not carry returns no row, and the whole sheeting group
 * becomes one mocked line — the failure mode is silent, so the snap happens at the moment of choosing
 * rather than being detected later.
 *
 * The nearest stocked thickness wins, and a tie goes to the thicker sheet: an under-specified roof is
 * the failure that cannot be built.
 */
export function snapBmt(
  profiles: readonly { profile: string; bmtValues: number[] }[],
  profile: string,
  wanted: number | undefined,
): number {
  const values = profiles.find((entry) => entry.profile === profile)?.bmtValues ?? [];
  if (values.length === 0) return wanted ?? 0.42;
  if (wanted !== undefined && values.includes(wanted)) return wanted;
  const target = wanted ?? 0.42;
  let best = values[0]!;
  let bestDistance = Math.abs(target - best);
  for (const value of values) {
    const distance = Math.abs(target - value);
    if (distance < bestDistance || (distance === bestDistance && value > best)) {
      best = value;
      bestDistance = distance;
    }
  }
  return best;
}

/** The thickness options a profile offers, as `value`/`label` pairs. */
export function bmtOptions(
  profiles: readonly { profile: string; bmtValues: number[] }[],
  profile: string,
): { value: string; label: string }[] {
  const values = profiles.find((entry) => entry.profile === profile)?.bmtValues ?? [];
  return values.map((bmt) => ({ value: String(bmt), label: `${bmt} BMT` }));
}

/**
 * The sentence for a value the price book cannot price.
 *
 * It names the book's range rather than saying "invalid", because the useful fact is **which** range
 * this company's book covers — a dealer who sees "1800–15000 mm" learns something; one who sees
 * "invalid" learns to guess.
 *
 * Since part 4 an out-of-book size **blocks saving** (the validator reads the same bounds), so the
 * sentence says that — it used to promise "priced from an assumed section", and Save then refused.
 * The range is written like the validator's (`1800–15000 mm`) so the two never disagree on format.
 */
export function outOfBookMessage(label: string, value: number, bounds: { min: number; max: number }): string {
  const where = outsideBookBounds(value, bounds);
  const range = `${bounds.min}–${bounds.max} mm`;
  return where === 'below'
    ? `${label} of ${value} mm is below what this price book covers (${range}). Change it before saving.`
    : `${label} of ${value} mm is above what this price book covers (${range}). Change it before saving.`;
}

/**
 * One read-only value that came from a site check.
 *
 * ## Why a component and not six copies of a `<div>`
 *
 * The three states have to be decided **once**. Six hand-written rows is six chances for one of them
 * to print a provisional reading in the same colour as a certified one — and a number in the normal
 * ink colour is a number somebody quotes from.
 *
 * `aria-describedby` points at the state sentence, so the distinction reaches a screen reader too,
 * where colour and a small grey word do not exist.
 */
export function DesignValue({
  id,
  label,
  entry,
  compact = false,
}: {
  id: string;
  label: string;
  entry: { text: string; state: 'certified' | 'provisional' | 'unchecked' };
  /**
   * Drop the visible note line under the value. The state still shows — a dashed border for
   * unchecked, an amber border and tooltip for provisional — and the note stays in the DOM for
   * `aria-describedby`, visually hidden, so a screen reader hears the same three states.
   */
  compact?: boolean;
}) {
  const note =
    entry.state === 'certified'
      ? 'from the site check'
      : entry.state === 'provisional'
        ? 'provisional — not auto calculated'
        : 'not from a site check yet';
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-sq-micro font-medium text-sq-ink">{label}</span>
      <output
        id={id}
        aria-describedby={`${id}-source`}
        title={compact && entry.state === 'provisional' ? 'Provisional — not auto calculated' : undefined}
        className={[
          'sq-numeric min-h-11 rounded-md border px-sq-2 py-sq-1 text-sq-body',
          entry.state === 'unchecked'
            ? 'border-dashed border-sq-line bg-sq-ground/40 text-sq-ink-muted'
            : entry.state === 'provisional'
              ? `border-sq-attention/40 bg-sq-attention/5 ${compact ? 'text-sq-attention' : 'text-sq-ink'}`
              : 'border-sq-line bg-sq-ground/40 text-sq-ink',
        ].join(' ')}
      >
        {entry.text}
      </output>
      <span
        id={`${id}-source`}
        className={[
          compact ? 'sr-only' : 'text-sq-micro',
          entry.state === 'provisional' ? 'text-sq-attention' : 'text-sq-ink-muted',
        ].join(' ')}
      >
        {note}
      </span>
    </div>
  );
}

/** A labelled checkbox, sized to the same touch target as the other controls. */
export function Switch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-sq-2 text-sq-body text-sq-ink">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 cursor-pointer accent-[var(--color-sq-brand)]"
      />
      {label}
    </label>
  );
}

/** A labelled select, with the error plumbing the other fields have. */
export function SelectField({
  id,
  label,
  value,
  options,
  onChange,
  hint,
  error,
  required,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  hint?: string;
  error?: string;
  required?: boolean;
}) {
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
      <select
        id={id}
        value={value}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-error` : hint !== undefined ? `${id}-hint` : undefined}
        aria-required={required === true || undefined}
        onChange={(event) => onChange(event.target.value)}
        className={[
          'min-h-11 cursor-pointer rounded-md border bg-sq-surface px-sq-2 text-sq-body outline-none',
          invalid ? 'border-sq-danger' : 'border-sq-line',
        ].join(' ')}
      >
        {/*
          A stored value the list does not offer gets its own entry.
          
          Two ways that happens: a building converted from a legacy `.sqd`, whose sheeting is
          `0.35 TL-5` where this book lists `TL-5`; and a book revision that dropped a code an old
          quote still stores. Without this the browser selects the first option, so the screen shows
          a profile the quote does not have — and the `.vqu` export, which writes the stored string,
          disagrees with what the operator read here.
        */}
        {value !== '' && !options.some((option) => option.value === value) && (
          <option value={value}>{value}</option>
        )}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {invalid ? (
        <p id={`${id}-error`} className="text-sq-micro text-sq-danger">
          {error}
        </p>
      ) : hint !== undefined ? (
        <p id={`${id}-hint`} className="text-sq-micro text-sq-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** The building, from the geometry store. */
export function useShedStoreConfig() {
  return useShedStore((state) => state.config);
}

/** Applying a partial change to the building. */
export function useApplyBuilding() {
  return useShedStore((state) => state.applyPartial);
}
