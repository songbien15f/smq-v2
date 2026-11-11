import { describe, it, expect } from 'vitest';
import {
  bayWidthsFor,
  clampBays,
  computeBayPositions,
  computeBayWidths,
  positionsFromWidths,
} from '../bays';

describe('clampBays', () => {
  it('clamps to the 2..30 range', () => {
    expect(clampBays(1)).toBe(2);
    expect(clampBays(0)).toBe(2);
    expect(clampBays(-5)).toBe(2);
    expect(clampBays(500)).toBe(30);
    expect(clampBays(4)).toBe(4);
  });
  it('rounds a fractional count', () => {
    expect(clampBays(3.7)).toBe(4);
  });
});

describe('computeBayPositions', () => {
  it('returns n+1 grid lines with the last equal to length', () => {
    const p = computeBayPositions(24000, 4);
    expect(p).toEqual([0, 6000, 12000, 18000, 24000]);
  });
  it('absorbs a non-divisible remainder in the last bay', () => {
    const p = computeBayPositions(10000, 3);
    expect(p).toEqual([0, 3333, 6666, 10000]);   // floor(10000/3) = 3333
  });
  it('clamps the bay count before computing', () => {
    expect(computeBayPositions(24000, 1)).toHaveLength(3);
  });
});

describe('computeBayWidths', () => {
  it('sums exactly to the overall length when not divisible', () => {
    const w = computeBayWidths(10000, 3);
    expect(w.reduce((a, b) => a + b, 0)).toBe(10000);
    expect(w).toEqual([3333, 3333, 3334]);   // last bay absorbs the remainder
  });
});

describe('bayWidthsFor', () => {
  /*
   * Bays are an array, not a division. Equal division is only the starting point — the desktop's
   * `ResetBayUnitsToNomBay` — and after one bay is edited the array can be 4 000/4 000/6 000.
   * That is a valid building, and it prices from a different frame row: the table is keyed by the
   * **largest** bay.
   */
  it('honours a stored array that sums to the length', () => {
    expect(
      bayWidthsFor({ length: 14000, bays: 3, bayWidths: [4000, 4000, 6000] }),
    ).toEqual([4000, 4000, 6000]);
  });

  it('divides equally when there is no stored array', () => {
    expect(bayWidthsFor({ length: 14000, bays: 2 })).toEqual([7000, 7000]);
  });

  it('drops an array whose count disagrees with the bay count', () => {
    // A person lowered the bay count and the array still has three entries. Keeping it would draw a
    // bay that is not in the building.
    expect(bayWidthsFor({ length: 14000, bays: 2, bayWidths: [4000, 4000, 6000] })).toEqual([
      7000, 7000,
    ]);
  });

  it('drops an array that does not sum to the length', () => {
    // The length changed after the array was written. Pricing from it would describe a 15 m building
    // as 14 m.
    expect(bayWidthsFor({ length: 15000, bays: 3, bayWidths: [4000, 4000, 6000] })).toEqual([
      5000, 5000, 5000,
    ]);
  });

  it('drops an array with a zero or negative bay', () => {
    expect(bayWidthsFor({ length: 14000, bays: 2, bayWidths: [0, 14000] })).toEqual([7000, 7000]);
  });
});

describe('positionsFromWidths', () => {
  it('starts at zero and adds each width', () => {
    expect(positionsFromWidths([4000, 4000, 6000])).toEqual([0, 4000, 8000, 14000]);
  });

  it('matches the divided positions for even bays', () => {
    expect(positionsFromWidths(computeBayWidths(24000, 4))).toEqual(
      computeBayPositions(24000, 4),
    );
  });
});
