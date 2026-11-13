import { roofPitchBoundsForSpan } from '@sq/core/domain';
import type { Catalogue } from '@sq/core/pricing';

export interface Range {
  min: number;
  max: number;
}

export interface BookBounds {
  span: Range;
  height: Range;
  pitch: Range;
  length: Range;
  bays: Range;
  /** null when the book states no bay bounds — then the validator does not check bay size. */
  baySpacing: Range | null;
  /** Per field: true when the range is the book's, false when it is the fallback. Drives the wording. */
  fromBook: { span: boolean; height: boolean; pitch: boolean };
}

/**
 * The limits used when there is no book, or the book states none.
 *
 * Loose on purpose: they are the editor's old constants, kept so a form validated before the catalogue
 * loads does not flag a building the book will turn out to accept. Length and bay count are always
 * these — the book states neither.
 */
export const FALLBACK_BOUNDS = {
  span: { min: 2000, max: 30000 },
  height: { min: 2000, max: 12000 },
  pitch: { min: 0, max: 45 },
  length: { min: 2000, max: 120000 },
  bays: { min: 1, max: 30 },
} as const;

type BookFacts = Pick<Catalogue, 'dimensions' | 'roofPitchGroups'>;

/**
 * One range from the book, or the fallback.
 *
 * `||` rather than `??`: a `0` from the book means "not stated", and a `min` of 0 would make every
 * field report "below the minimum".
 */
function fromBookOr(book: Range | undefined, fallback: Range): { range: Range; fromBook: boolean } {
  const min = book?.min || 0;
  const max = book?.max || 0;
  return {
    range: { min: min || fallback.min, max: max || fallback.max },
    fromBook: min > 0 && max > 0,
  };
}

/**
 * The size limits for this quote — the single source for the field inputs and the validator.
 *
 * The book's numbers are the valid range, because the desktop's shed-config lookup keeps only rows
 * whose span, height, bay and pitch bands contain the building (`ShedConfigCache.cs:47-54`): outside
 * them there is no row to price from. Pitch follows the span, since each span band sells its own
 * pitch range.
 */
export function bookBounds(catalogue: BookFacts | null | undefined, spanMm: number | null): BookBounds {
  const dims = catalogue?.dimensions;
  const span = fromBookOr(dims?.span, FALLBACK_BOUNDS.span);
  const height = fromBookOr(dims?.height, FALLBACK_BOUNDS.height);

  const groups = catalogue?.roofPitchGroups ?? [];
  const bandPitch = spanMm !== null && groups.length > 0 ? roofPitchBoundsForSpan(groups, spanMm) : null;
  const pitch = bandPitch !== null
    ? { range: bandPitch, fromBook: true }
    : fromBookOr(dims?.roofPitch, FALLBACK_BOUNDS.pitch);

  const bay = dims?.baySpacing;
  const baySpacing = bay !== undefined && bay.min > 0 && bay.max > 0 ? { min: bay.min, max: bay.max } : null;

  return {
    span: span.range,
    height: height.range,
    pitch: pitch.range,
    length: { ...FALLBACK_BOUNDS.length },
    bays: { ...FALLBACK_BOUNDS.bays },
    baySpacing,
    fromBook: { span: span.fromBook, height: height.fromBook, pitch: pitch.fromBook },
  };
}

/**
 * The largest bay, which is the one the book's bay band must contain.
 *
 * The desktop keeps a `BayLargest` and splits the length so no bay exceeds `BayMax`
 * (`ServiceStructureData.cs:313-324, 382-386`). `index` is the 0-based bay when the bays differ, and
 * null when they are equal (then every bay is that size).
 */
export function largestBay(config: {
  length: number | null;
  bays: number;
  bayWidths?: readonly number[];
}): { mm: number; index: number | null } | null {
  const widths = config.bayWidths;
  if (Array.isArray(widths) && widths.length === config.bays && widths.length > 0) {
    let index = 0;
    widths.forEach((width, i) => {
      if (width > widths[index]!) index = i;
    });
    return { mm: widths[index]!, index };
  }
  if (config.length !== null && config.bays > 0) {
    return { mm: config.length / config.bays, index: null };
  }
  return null;
}
