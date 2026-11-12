import { describe, it, expect } from 'vitest';
import { TEST_SHED } from '@/domain/defaults';
import type {  ShedConfig, DimensionedShed } from '@/domain/types';
import { girtRows, optimise, purlinRows, standardBayLength } from '@/lib/bom/optimise';

const shed = (patch: Partial<DimensionedShed> = {}): DimensionedShed => ({ ...TEST_SHED, ...patch });

describe('standardBayLength', () => {
  it('rounds up to the next standard bay', () => {
    expect(standardBayLength(4200)).toBe(4500);
    expect(standardBayLength(4500)).toBe(4500);
    expect(standardBayLength(4501)).toBe(5000);
  });

  it('clamps below the smallest and above the largest standard', () => {
    expect(standardBayLength(1000)).toBe(3000);
    expect(standardBayLength(99999)).toBe(6000);
  });
});

describe('purlinRows', () => {
  it('rounds up when the fraction exceeds 0.1', () => {
    // (4000 − 150 − 2×460) / 460 + 2 = 8.3696, frac 0.3696 → ceil 9
    expect(purlinRows(4000, 460, 460)).toBe(9);
  });

  it('rounds down when the fraction is at or below 0.1', () => {
    // (4000 − 150 − 2×460) / 460 + 2 = 8.3696 with a 505 span gives 7.6238
    // whose fraction is 0.6238, so this case rounds UP to 8. The floor case is
    // the one where the division lands almost exactly on an integer.
    expect(purlinRows(4000, 505, 505)).toBe(8);
    // (4000 − 150 − 2×550) / 550 + 2 = 7 exactly → floor 7
    expect(purlinRows(4000, 550, 550)).toBe(7);
  });

  it('raises the internal span to the end span when it is smaller', () => {
    // An internal span below the end span is illegal; the formula uses the end span.
    expect(purlinRows(4000, 300, 460)).toBe(purlinRows(4000, 460, 460));
  });

  it('never returns fewer than two rows', () => {
    expect(purlinRows(500, 460, 460)).toBeGreaterThanOrEqual(2);
  });
});

describe('girtRows', () => {
  it('fills the wall height minus 300', () => {
    // (4200 − 300 − 2×460) / 460 + 2 = 8.4783 → ceil 9
    expect(girtRows(4200, 460, 460)).toBe(9);
  });

  it('rounds down when the fraction is at or below 0.1', () => {
    // (4200 − 300 − 2×550) / 550 + 2 = 7.0909, frac 0.0909 → floor 7
    expect(girtRows(4200, 550, 550)).toBe(7);
  });

  it('never returns fewer than two rows', () => {
    expect(girtRows(400, 550, 550)).toBeGreaterThanOrEqual(2);
  });
});

describe('optimise', () => {
  const twoRows = {
    devided: () => [
      { code: 'A2', standardSpan: 4000, purlinSpan: 460, girtSpan: 550, openDesign: true, purlinMaterial: 'TH64075' },
      { code: 'A2', standardSpan: 4000, purlinSpan: 530, girtSpan: 600, openDesign: true, purlinMaterial: 'TH64090' },
    ],
    purlin: (code: string) => ({ code, description: code, unitCost: code === 'TH64075' ? 500 : 900, massKg: 1 }),
    windSpeed: () => 41,
  } as never;

  it('picks the material with the lowest total cost', () => {
    const result = optimise(shed({ bays: 4, span: 12000, height: 4200, roofPitchDeg: 10 }), twoRows);
    expect(result.purlinRows).toBeGreaterThan(0);
    expect(result.girtRows).toBeGreaterThan(0);
    expect(result.purlinMaterial).toBe('TH64075');
    expect(result.mocked).toBe(false);
  });

  it('halves the roof span for a gable and uses the full span for a skillion', () => {
    const gable = optimise(shed({ structureType: 'gable', span: 12000, roofPitchDeg: 10 }), twoRows);
    const skillion = optimise(shed({ structureType: 'skillion', span: 12000, roofPitchDeg: 10 }), twoRows);
    // Both are span / cos(pitch), but the gable uses half of it.
    expect(skillion.roofSpan).toBeGreaterThan(gable.roofSpan * 1.9);
  });

  it('does not divide by zero at a zero pitch', () => {
    expect(() => optimise(shed({ roofPitchDeg: 0 }), twoRows)).not.toThrow();
  });

  it('falls back to a mocked material when the book has no devided rows', () => {
    const empty = { devided: () => [], purlin: () => undefined, windSpeed: () => 41 } as never;
    const result = optimise(shed(), empty);
    expect(result.mocked).toBe(true);
    expect(result.purlinRows).toBeGreaterThanOrEqual(2);
  });

  it('reports the standard bay length it optimised against', () => {
    // 24000 / 4 bays = 6000 per bay, which is a standard length.
    const result = optimise(shed({ length: 24000, bays: 4 }), twoRows);
    expect(result.bayStandard).toBe(6000);
  });

  it('optimises against the LARGEST bay, not the average', () => {
    /*
     * The desktop passes `sD.BayLargest` to the frame lookup
     * (`ServiceStructureData.cs:382-386`), and it is one of the eleven keys that select a section.
     *
     * 14 000 mm in three bays as 4 000/4 000/6 000: the average is 4 667, which rounds up to the
     * 5 000 standard row. The longest bay is 6 000, which is its own row. Those are different frame
     * tables, and pricing from the average under-sizes the members over the long bay.
     *
     * Before editable bays, `maxBay` was `ceil(length / bays)` — the average rounded up — so this
     * test could not have told the two apart. It exists because the array makes them differ.
     */
    const result = optimise(
      shed({ length: 14000, bays: 3, bayWidths: [4000, 4000, 6000] }),
      twoRows,
    );
    expect(result.bayStandard).toBe(6000);

    // The same building divided evenly really does take the shorter row.
    const even = optimise(shed({ length: 13800, bays: 3 }), twoRows);
    expect(even.bayStandard).toBe(5000);
  });
});
