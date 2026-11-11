import { describe, expect, it } from 'vitest';
import {
  pitchOutsideBookSpan,
  roofPitchBoundsForSpan,
  roofPitchHintsForSpan,
  type RoofPitchGroup,
} from '../roofPitch';

/**
 * Roof pitch is a list **per span band**, not one list for the book.
 *
 * The desktop rebuilds the dropdown on every span change (`GetHintListRoofPitch`,
 * `ShedConfigCombo.cs:66-102`). On the reference book every band is 1 800–15 000, so the answer never
 * changes — the query still exists because the table is organised that way, and a supplier whose bands
 * differ would get a wrong suggestion list from a single constant.
 */

/** Two bands that really do differ, which the reference book does not. */
const BANDS: RoofPitchGroup[] = [
  { spanMin: 1800, spanMax: 9000, pitchMin: 7.5, pitchMax: 15, hints: [7.5, 10, 15] },
  { spanMin: 9001, spanMax: 15000, pitchMin: 20, pitchMax: 30, hints: [20, 25, 30] },
];

describe('roofPitchHintsForSpan', () => {
  it('offers only the band the span falls in', () => {
    expect(roofPitchHintsForSpan(BANDS, 6000)).toEqual([7.5, 10, 15]);
    expect(roofPitchHintsForSpan(BANDS, 12000)).toEqual([20, 25, 30]);
  });

  it('treats both edges of a band as inside it', () => {
    // Inclusive on both ends: a 9 000 mm span is a real building and the band states 1 800–9 000.
    expect(roofPitchHintsForSpan(BANDS, 9000)).toEqual([7.5, 10, 15]);
    expect(roofPitchHintsForSpan(BANDS, 9001)).toEqual([20, 25, 30]);
  });

  it('offers everything for a span no band covers, rather than nothing', () => {
    // An empty list would leave the slider at whatever it was with no explanation. A span outside every
    // band is a gap in the book, not a building without a roof.
    expect(roofPitchHintsForSpan(BANDS, 40000)).toEqual([7.5, 10, 15, 20, 25, 30]);
  });

  it('unions the bands when they overlap', () => {
    const overlapping: RoofPitchGroup[] = [
      { spanMin: 1800, spanMax: 10000, pitchMin: 7.5, pitchMax: 15, hints: [7.5, 15] },
      { spanMin: 8000, spanMax: 15000, pitchMin: 10, pitchMax: 20, hints: [10, 20] },
    ];
    // De-duplicated and sorted: a dropdown showing 10° twice looks broken.
    expect(roofPitchHintsForSpan(overlapping, 9000)).toEqual([7.5, 10, 15, 20]);
  });

  it('is empty for a book with no bands at all', () => {
    expect(roofPitchHintsForSpan([], 6000)).toEqual([]);
  });
});

describe('roofPitchBoundsForSpan', () => {
  it('bounds the slider by the band for that span', () => {
    expect(roofPitchBoundsForSpan(BANDS, 6000)).toEqual({ min: 7.5, max: 15 });
    expect(roofPitchBoundsForSpan(BANDS, 12000)).toEqual({ min: 20, max: 30 });
  });

  it('widens to cover every band when they overlap', () => {
    const overlapping: RoofPitchGroup[] = [
      { spanMin: 1800, spanMax: 10000, pitchMin: 7.5, pitchMax: 15, hints: [7.5, 15] },
      { spanMin: 8000, spanMax: 15000, pitchMin: 3, pitchMax: 20, hints: [3, 20] },
    ];
    // Narrowing to one band would refuse an angle the book sells at that span.
    expect(roofPitchBoundsForSpan(overlapping, 9000)).toEqual({ min: 3, max: 20 });
  });

  it('is null for a book with no bands, so the caller keeps its own range', () => {
    expect(roofPitchBoundsForSpan([], 6000)).toBeNull();
  });
});

describe('pitchOutsideBookSpan', () => {
  it('reports a pitch between two listed angles', () => {
    // 12.5° is between 10 and 15; the desktop's editable dropdown allows it, so it is reported rather
    // than snapped — the roof may already be on a customer's drawing.
    expect(pitchOutsideBookSpan(BANDS, 6000, 12.5)).toBe(true);
  });

  it('accepts a pitch the book lists, including a decimal one', () => {
    expect(pitchOutsideBookSpan(BANDS, 6000, 7.5)).toBe(false);
    expect(pitchOutsideBookSpan(BANDS, 12000, 25)).toBe(false);
  });

  it('says nothing when the book states no pitch list', () => {
    // Without a list there is no fact to report, and a warning nobody can act on is noise.
    expect(pitchOutsideBookSpan([], 6000, 12.5)).toBe(false);
  });
});
