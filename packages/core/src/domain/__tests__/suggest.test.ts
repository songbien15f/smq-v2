import { describe, expect, it } from 'vitest';
import { outsideBookBounds, suggestedValues, type BookDimensions } from '../suggest';

/**
 * The book's own numbers, as measured on the reference book (2026-11-10).
 *
 * These are the real values, not invented fixtures: span 1 800–15 000 with a 6 000 default, height
 * 2 200–6 000 with 3 000, bay spacing 1 000–4 000 with 3 000, and **no** roof-pitch default on any row.
 */
const BOOK: BookDimensions = {
  span: { defaultValue: 6000, min: 1800, max: 15000, hints: [6000, 7500, 9000, 10500, 12000, 13500, 15000] },
  height: { defaultValue: 3000, min: 2200, max: 6000, hints: [3000, 3600, 4200, 4800, 6000] },
  baySpacing: { defaultValue: 3000, min: 1000, max: 4000, hints: [3000, 3500, 4000] },
  roofPitch: { defaultValue: null, min: 7.5, max: 30, hints: [7.5, 10, 15, 20, 25, 30] },
};

describe('suggestedValues — an offer, never a silent rewrite', () => {
  it('reports the three dimensions the hard-coded defaults disagreed with', () => {
    // `DEFAULT_SHED` used 12 000 / 4 200 / 6 000 / 10°, none of them from the book.
    const out = suggestedValues(
      { span: 12000, height: 4200, nomBaySpacing: 6000, roofPitchDeg: 10 },
      BOOK,
    );
    expect(out).toEqual([
      { field: 'span', value: 6000, current: 12000 },
      { field: 'height', value: 3000, current: 4200 },
      { field: 'nomBaySpacing', value: 3000, current: 6000 },
    ]);
  });

  it('says nothing when the screen already matches the book', () => {
    // An empty list is what makes the button unavailable rather than a no-op that looks broken.
    const out = suggestedValues(
      { span: 6000, height: 3000, nomBaySpacing: 3000, roofPitchDeg: 10 },
      BOOK,
    );
    expect(out).toEqual([]);
  });

  it('never suggests a roof pitch, because the book states no default for one', () => {
    /*
     * `roof_pitch_default` is NULL on every row of the reference book. That is "no preference", not
     * "prefer zero" — and the pitch depends on the span, which is why the desktop filtered its pitch
     * list by span. A suggestion of 0° would be a flat roof nobody asked for.
     */
    const out = suggestedValues({ span: 6000, height: 3000, nomBaySpacing: 3000, roofPitchDeg: 0 }, BOOK);
    expect(out.map((entry) => entry.field)).not.toContain('roofPitchDeg');
  });

  it('does not suggest a value that is already current, even among other differences', () => {
    const out = suggestedValues(
      { span: 6000, height: 4200, nomBaySpacing: 6000, roofPitchDeg: 10 },
      BOOK,
    );
    expect(out.map((entry) => entry.field)).toEqual(['height', 'nomBaySpacing']);
  });
});

describe('outsideBookBounds — the book is the valid range', () => {
  it('rejects the span the editor used to accept', () => {
    /*
     * The editor bounded span at 2 000–30 000. The book caps it at 15 000, so 24 000 was accepted here
     * and then had no frame row — surfacing two steps later as a BOM assumption.
     */
    expect(outsideBookBounds(24000, BOOK.span)).toBe('above');
    expect(outsideBookBounds(16000, BOOK.span)).toBe('above');
  });

  it('accepts a span inside the book', () => {
    expect(outsideBookBounds(6000, BOOK.span)).toBeNull();
    expect(outsideBookBounds(1800, BOOK.span)).toBeNull();
    expect(outsideBookBounds(15000, BOOK.span)).toBeNull();
  });

  it('reports the low side separately', () => {
    // A distinct answer, because the sentence differs: "below" and "above" send a person in opposite
    // directions.
    expect(outsideBookBounds(1000, BOOK.height)).toBe('below');
    expect(outsideBookBounds(2199, BOOK.height)).toBe('below');
    expect(outsideBookBounds(2200, BOOK.height)).toBeNull();
  });

  it('treats a book with no stated bounds as no opinion', () => {
    // Silence is not a refusal: a partial book must still draw a shed.
    expect(outsideBookBounds(999999, { min: 0, max: 0 })).toBeNull();
  });
});
