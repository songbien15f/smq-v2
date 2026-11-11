/**
 * The values the price book suggests for a new shed, and what filling them would change.
 *
 * ## Why a function rather than defaults baked into `ShedConfig`
 *
 * `DEFAULT_SHED` has to hold *something* — the drawing code, the BOM and the price engine all read
 * `config.span` as a number, in twenty-seven files, and a `null` there would be a null check in every
 * one of them. So a new quote necessarily starts with numbers in it.
 *
 * What those numbers must not be is a claim. A 12 000 mm span typed into a form looks like a building
 * somebody chose. This module turns the starting numbers into **an offer**: here is what this book
 * sells for a shed like yours, and here is the button that applies it. Until then the operator knows
 * the figure came from the software.
 *
 * ## Why the book, and not constants
 *
 * `DEFAULT_SHED` hard-coded 12 000 / 4 200 / 24 000. The reference book states 6 000 / 3 000 and
 * bounds span at 1 800–15 000 — so the old default was plausible while a 24 000 mm span was outside
 * what the book can price at all. Reading the book removes the whole category.
 */

import type { ShedConfig } from './types';

/**
 * The book's bounds and default for one dimension.
 *
 * Declared **here** rather than imported from `lib/pricing/catalogues`, because `domain/` must not
 * depend on `pricing/` — that barrel reaches `node:fs` through the database, and pulling it into a
 * domain module is how the browser bundle once came to import `fs` and the whole client failed to
 * load. `ShedDimension` in `catalogues.ts` is structurally identical, so a `Catalogue` can be passed
 * to these functions without a cast.
 */
export interface BookDimension {
  defaultValue: number | null;
  min: number;
  max: number;
  hints: number[];
}

/** The four dimensions a shed is described by. */
export interface BookDimensions {
  span: BookDimension;
  height: BookDimension;
  baySpacing: BookDimension;
  roofPitch: BookDimension;
}

/** One field the book can suggest a value for. */
export interface SuggestedValue {
  /** The config key, so a caller can group by field and a test can name it. */
  field: 'span' | 'height' | 'nomBaySpacing' | 'roofPitchDeg';
  /** What the book states. Applied only when it differs from the current value. */
  value: number;
  /** The value on screen now, so the UI can show "12 000 → 6 000" instead of a silent jump. */
  current: number;
}

/**
 * What the book suggests for this building, and only where it differs.
 *
 * ## Why "only where it differs"
 *
 * A fill button that rewrites a field the operator already set is the worst kind of helper: it looks
 * like it does nothing when the values already match, and silently undoes work when they do not. So
 * the list is the **difference**, and an empty list means "nothing to suggest" — which the button
 * renders as unavailable rather than as a no-op.
 *
 * ## Why roof pitch is usually absent
 *
 * Every row of the reference book has `roof_pitch_default = NULL`. That means the book states no
 * preference — not that it prefers zero. The pitch depends on the span (a wider portal needs more
 * fall), which is why the desktop filtered its pitch list by span; a single default would be right for
 * one span and wrong for the rest. `null` is therefore reported as **no suggestion**, and the operator
 * picks from the hints.
 */
export function suggestedValues(
  config: Pick<ShedConfig, 'span' | 'height' | 'nomBaySpacing' | 'roofPitchDeg'>,
  dimensions: BookDimensions,
): SuggestedValue[] {
  const candidates: Array<{ field: SuggestedValue['field']; value: number | null; current: number }> = [
    { field: 'span', value: dimensions.span.defaultValue, current: config.span },
    { field: 'height', value: dimensions.height.defaultValue, current: config.height },
    { field: 'nomBaySpacing', value: dimensions.baySpacing.defaultValue, current: config.nomBaySpacing },
    { field: 'roofPitchDeg', value: dimensions.roofPitch.defaultValue, current: config.roofPitchDeg },
  ];

  return candidates
    .filter(
      (entry): entry is { field: SuggestedValue['field']; value: number; current: number } =>
        entry.value !== null && entry.value !== entry.current,
    )
    .map((entry) => ({ field: entry.field, value: entry.value, current: entry.current }));
}

/**
 * Whether a dimension's value is one the book can price.
 *
 * `min`/`max` from the book are the real rule: the editor used to accept 2 000–30 000 mm for span,
 * while the book's own rows cap it at 15 000. A building outside those bounds has no frame row — the
 * engine falls back to an assumed section and the quote is indicative — so the screen should say so
 * at the field rather than two steps later on the BOM.
 *
 * A book that states no bounds (`min === 0 && max === 0`) accepts anything: silence is not a refusal.
 */
export function outsideBookBounds(
  value: number,
  bounds: { min: number; max: number },
): 'below' | 'above' | null {
  if (bounds.min === 0 && bounds.max === 0) return null;
  if (bounds.min > 0 && value < bounds.min) return 'below';
  if (bounds.max > 0 && value > bounds.max) return 'above';
  return null;
}
