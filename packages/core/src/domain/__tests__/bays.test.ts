import { describe, it, expect } from 'vitest';
import { clampBays, computeBayPositions, computeBayWidths } from '../bays';

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
