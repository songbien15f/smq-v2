import { describe, it, expect } from 'vitest';
import { TEST_SHED } from '@/domain/defaults';
import type {  ShedConfig, ShedOption, DimensionedShed } from '@/domain/types';
import type { OptimisedFrame } from '@/lib/bom/types';
import { sheetingGroup, sheetingLines } from '@/lib/bom/groups/sheeting';
import { DEFAULT_CONTRACTS } from '@/lib/pricing/catalogueManifest';

const CONTRACT = DEFAULT_CONTRACTS.sheeting;

const shed = (patch: Partial<DimensionedShed> = {}): DimensionedShed => ({ ...TEST_SHED, ...patch });

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

const sheetingRow = (profile: string, bmt: number, cost: number) => ({
  code: `${profile}-${bmt}`,
  description: `${bmt} ${profile}`,
  unitCost: cost,
  massKg: 3,
  profile,
  bmt,
  coverageMm: 762,
  roofInternalSpanMm: 900,
  roofEndSpanMm: 1200,
  wallInternalSpanMm: 1700,
  wallEndSpanMm: 1700,
  wallSideSpanMm: 1860,
});

const lookup = {
  sheeting: (profile: string, bmt: number) =>
    profile === 'Corro' && bmt === 0.42 ? sheetingRow('Corro', 0.42, 1150) : undefined,
} as never;

const skylight = (id: string): ShedOption => ({
  id, kind: 'skylight', bay: 0, alongBay: 0.5, width: 900, height: 900,
});

const byKind = (lines: ReturnType<typeof sheetingLines>, match: RegExp) =>
  lines.filter((l) => match.test(l.description));

describe('sheetingLines', () => {
  it('computes roof sheets from the length and the cover width', () => {
    // 24000 / 762 = 31.49 → 31 sheets, doubled for two slopes.
    const lines = sheetingLines(shed({ length: 24000 }), frame(), lookup, CONTRACT);
    const roof = byKind(lines, /roof/i)[0];
    expect(roof.quantity).toBeGreaterThanOrEqual(31);
  });

  it('divides by the cover in millimetres, not by a truncated metre value', () => {
    // The desktop casts 0.762 m to int → 0 and the division is undefined. Here
    // the cover is 762 mm, so a 24 m roof is 32 sheets per slope. The quantity is
    // metres because the price is per metre: 64 sheets x 6.093 m.
    const lines = sheetingLines(shed({ length: 24000 }), frame(), lookup, CONTRACT);
    const roof = byKind(lines, /roof/i)[0];
    expect(Number.isFinite(roof.quantity)).toBe(true);
    expect(roof.unit).toBe('m');
    expect(roof.quantity).toBeGreaterThan(300);
    expect(roof.quantity).toBeLessThan(450);
  });

  it('subtracts a sheet for each skylight', () => {
    const base = sheetingLines(shed({ length: 24000 }), frame(), lookup, CONTRACT);
    const withOne = sheetingLines(
      shed({ length: 24000, options: [skylight('sk-1')] }),
      frame(),
      lookup,
      CONTRACT,
    );
    const roof = (ls: typeof base) => byKind(ls, /roof/i)[0].quantity;
    // One sheet is one sheet's worth of metres: the roof line is measured in
    // metres, so removing a sheet removes its length, not one metre.
    const perSheet = roof(base) / 64;
    expect(roof(withOne)).toBeCloseTo(roof(base) - perSheet, 2);
  });

  it('emits wall sheeting for the side walls and the end walls', () => {
    const lines = sheetingLines(shed(), frame(), lookup, CONTRACT);
    expect(byKind(lines, /side wall/i).length).toBeGreaterThan(0);
    expect(byKind(lines, /end wall/i).length).toBeGreaterThan(0);
  });

  it('lengthens a roof sheet by the pitch rise', () => {
    // The count is the same; what changes is the sheet length, which the
    // description carries. A steeper roof needs longer sheets.
    const lengthOf = (pitch: number): number => {
      const roof = byKind(sheetingLines(shed({ roofPitchDeg: pitch }), frame(), lookup, CONTRACT), /roof/i)[0];
      const match = /(\d+) mm/.exec(roof.description);
      return match === null ? 0 : Number(match[1]);
    };
    expect(lengthOf(25)).toBeGreaterThan(lengthOf(0));
  });

  it('marks every line mocked when the sheeting profile has no price', () => {
    // With no row there is also no cover, so the run cannot be counted. The group
    // must still say what it could not price rather than return an empty list: an
    // empty list reads as "this shed needs no sheets".
    const empty = { sheeting: () => undefined } as never;
    const result = sheetingGroup(shed(), frame(), empty, CONTRACT);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'SHEETING_COVER_MISSING', severity: 'blocker' }),
    );
    expect(result.lines.every((line) => line.mocked === true)).toBe(true);
  });

  it('gives every line the sheeting group and a rounded amount', () => {
    for (const line of sheetingLines(shed(), frame(), lookup, CONTRACT)) {
      expect(line.group).toBe('sheeting');
      expect(line.amount).toBe(Math.round(line.quantity * line.unitCost));
    }
  });

  it('never emits a negative or non-finite quantity', () => {
    for (const line of sheetingLines(shed({ bays: 30, length: 60000 }), frame(), lookup, CONTRACT)) {
      expect(line.quantity).toBeGreaterThan(0);
      expect(Number.isFinite(line.quantity)).toBe(true);
    }
  });
});
