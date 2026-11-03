import { describe, it, expect } from 'vitest';
import { DEFAULT_SHED } from '@/domain/defaults';
import type { ShedConfig } from '@/domain/types';
import type { OptimisedFrame } from '@/lib/bom/types';
import { bracketLines, flatFlyLines } from '@/lib/bom/groups/bracket';
import { bracingLines } from '@/lib/bom/groups/bracing';
import { fixingLines, packCount } from '@/lib/bom/groups/fixings';

const shed = (patch: Partial<ShedConfig> = {}): ShedConfig => ({ ...DEFAULT_SHED, ...patch });

const frame = (patch: Partial<OptimisedFrame> = {}): OptimisedFrame => ({
  purlinMaterial: 'TH64075',
  purlinRows: 8,
  purlinInternalSpan: 460,
  purlinEndSpan: 460,
  girtMaterial: 'TH64075',
  girtRows: 6,
  girtInternalSpan: 550,
  girtEndSpan: 550,
  roofSpan: 6093,
  bayStandard: 6000,
  mocked: false,
  scheduleMissing: true,
  girtMaterialSeparate: true,
  ...patch,
});

/** Pack sizes the fixture book uses, so the arithmetic below can be checked by hand. */
const WALL_SCREW_PACK = 50;
const ROOF_SCREW_PACK = 100;
const BOLT_PACK = 20;

const row = (code: string, description: string, unitCost: number, massKg: number) => ({
  code,
  description,
  unitCost,
  massKg,
});

/** A lookup that prices everything, with the pack sizes stated per type. */
const lookup = {
  purlinDepth: () => 64,
  bracket: (prefix: string, web: number) =>
    row(`BR-${prefix}-${web}`, `${prefix}${web}`, 1200, 1.5),
  bracing: () => ({ ...row('BS-30', '30x1.2mm', 1873, 10), rollMetres: 30 }),
  bolt: () => ({ ...row('BOLT-1', 'M16x40-8.8', 534, 0.125), qtyPerPack: BOLT_PACK }),
  screw: (type: string) =>
    type === 'ROOF_SCREW'
      ? { ...row('SC-ROOF', 'ZIPxx', 2103, 0.0116), qtyPerPack: ROOF_SCREW_PACK }
      : { ...row(`SC-${type}`, type, 300, 0.011), qtyPerPack: WALL_SCREW_PACK },
  sheeting: () => ({ coverageMm: 762 }),
} as never;

describe('packCount', () => {
  it('rounds up to the smallest number of packs that covers the need', () => {
    expect(packCount(0, 50)).toBe(0);
    expect(packCount(1, 50)).toBe(1);
    expect(packCount(50, 50)).toBe(1);
    expect(packCount(51, 50)).toBe(2);
  });

  it('returns zero rather than dividing by a nonsense pack size', () => {
    expect(packCount(100, 0)).toBe(0);
    expect(packCount(100, Number.NaN)).toBe(0);
  });
});

describe('fixingLines', () => {
  it('rounds bolts up to whole packs exactly once', () => {
    const lines = fixingLines(shed(), frame(), lookup);
    const bolt = lines.find((l) => l.group === 'bolt');
    expect(bolt).toBeDefined();
    expect(bolt!.unit).toBe('pack');
    expect(Number.isInteger(bolt!.quantity)).toBe(true);
  });

  it('gives a pack count that covers the true count, and one pack fewer does not', () => {
    const lines = fixingLines(shed(), frame(), lookup);
    const bolt = lines.find((l) => l.group === 'bolt' && /M16x40/.test(l.description))!;
    // A 4-bay shed has 3 internal grid lines x 2 walls = 6 main columns, plus 2
    // per gable end x 2 ends = 4 end columns. Four bolts each.
    const needed = 4 * (6 + 4);
    expect(bolt.quantity * BOLT_PACK).toBeGreaterThanOrEqual(needed);
    expect((bolt.quantity - 1) * BOLT_PACK).toBeLessThan(needed);
  });

  it('counts roof screws per purlin row and per sheet', () => {
    const lines = fixingLines(shed(), frame(), lookup);
    const roof = lines.find((l) => /roof screw/i.test(l.description))!;
    // 64 roof sheets (24 m over a 762 mm cover, both slopes already counted by
    // the second-pass rule), 9 rows of purlin including the ridge line, 4 screws
    // a sheet, plus the 10% cut allowance.
    const trueCount = (8 + 1) * 64 * 4;
    const needed = Math.ceil(trueCount * 1.1);
    expect(roof.quantity * ROOF_SCREW_PACK).toBeGreaterThanOrEqual(needed);
    expect((roof.quantity - 1) * ROOF_SCREW_PACK).toBeLessThan(needed);
  });

  it('reports mass from the true count, not the pack count', () => {
    const lines = fixingLines(shed(), frame(), lookup);
    const bolt = lines.find((l) => /M16x40/.test(l.description))!;
    // 40 bolts of 0.125 kg is 5 kg. The desktop's `TotalMass` multiplies by the
    // pack count instead, which would say 2 packs x 0.125 kg = 0.25 kg.
    expect(bolt.massKg).toBeCloseTo(0.125 * 40, 6);
    expect(bolt.quantity).toBe(2);
  });

  it('marks a fixing mocked when the book has no pack row', () => {
    const empty = { bolt: () => undefined, screw: () => undefined } as never;
    const lines = fixingLines(shed(), frame(), empty);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.mocked === true)).toBe(true);
  });
});

describe('bracketLines', () => {
  it('emits a base bracket, an eave bracket and knee brace connectors', () => {
    const lines = bracketLines(shed(), frame(), lookup);
    expect(lines.some((l) => /base plate/i.test(l.description))).toBe(true);
    expect(lines.some((l) => /eave/i.test(l.description))).toBe(true);
    expect(lines.some((l) => /knee/i.test(l.description))).toBe(true);
  });

  it('gives one base bracket per column', () => {
    const lines = bracketLines(shed({ bays: 4 }), frame(), lookup);
    const base = lines.find((l) => /base plate/i.test(l.description))!;
    // 3 internal grid lines × 2 walls + 2 per gable end × 2 ends.
    expect(base.quantity).toBe(6 + 4);
  });

  it('gives (bays + 1) × 2 eave brackets, less one per carry beam', () => {
    const plain = bracketLines(shed({ bays: 4 }), frame(), lookup);
    const eave = plain.find((l) => /eave/i.test(l.description))!;
    expect(eave.quantity).toBe((4 + 1) * 2);

    const withBeam = bracketLines(
      shed({
        bays: 4,
        options: [
          { id: 'cb1', kind: 'carry_beam', wall: 'front', beginBay: 1, openingId: null },
        ],
      }),
      frame(),
      lookup,
    );
    expect(withBeam.find((l) => /eave/i.test(l.description))!.quantity).toBe((4 + 1) * 2 - 1);
  });

  it('marks brackets mocked when the book has no bracket', () => {
    const empty = { purlinDepth: () => 64, bracket: () => undefined } as never;
    const lines = bracketLines(shed(), frame(), empty);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.mocked === true)).toBe(true);
  });
});

describe('flatFlyLines', () => {
  it('gives more flies as the purlin rows increase', () => {
    const few = flatFlyLines(shed(), frame({ purlinRows: 2 }), lookup);
    const many = flatFlyLines(shed(), frame({ purlinRows: 8 }), lookup);
    const total = (lines: { quantity: number }[]) =>
      lines.reduce((sum, line) => sum + line.quantity, 0);
    expect(total(many)).toBeGreaterThan(total(few));
  });

  it('emits a rafter fly and a column fly', () => {
    const lines = flatFlyLines(shed(), frame(), lookup);
    expect(lines.some((l) => /rafter/i.test(l.description))).toBe(true);
    expect(lines.some((l) => /column/i.test(l.description))).toBe(true);
  });
});

describe('bracingLines', () => {
  it('emits a wind bracing line in rolls', () => {
    const lines = bracingLines(shed(), frame(), lookup);
    expect(lines).toHaveLength(1);
    expect(lines[0].unit).toBe('roll');
    expect(Number.isInteger(lines[0].quantity)).toBe(true);
    expect(lines[0].quantity).toBeGreaterThan(0);
  });

  it('needs more bracing on a taller shed', () => {
    const low = bracingLines(shed({ height: 3000 }), frame(), lookup);
    const high = bracingLines(shed({ height: 6000 }), frame(), lookup);
    expect(high[0].quantity).toBeGreaterThanOrEqual(low[0].quantity);
    expect(high[0].massKg).toBeGreaterThan(low[0].massKg);
  });

  it('prices bracing per roll, not per metre', () => {
    // BUG #5 in the desktop divides the roll count by 1000 again, so a 30 m roll
    // becomes 0.03 of a roll. Three rolls must cost three rolls.
    const lines = bracingLines(shed(), frame(), lookup);
    expect(lines[0].amount).toBe(lines[0].quantity * lines[0].unitCost);
  });

  it('marks bracing mocked when the book has no roll', () => {
    const empty = { bracing: () => undefined } as never;
    const lines = bracingLines(shed(), frame(), empty);
    expect(lines[0].mocked).toBe(true);
  });
});
