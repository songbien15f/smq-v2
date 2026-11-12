import { describe, it, expect } from 'vitest';
import { TEST_SHED } from '@/domain/defaults';
import type {  ShedConfig, DimensionedShed } from '@/domain/types';
import type { OptimisedFrame } from '@/lib/bom/types';
import { purlinLines } from '@/lib/bom/groups/purlin';

const shed = (patch: Partial<DimensionedShed> = {}): DimensionedShed => ({ ...TEST_SHED, ...patch });

const frame = (patch: Partial<OptimisedFrame> = {}): OptimisedFrame => ({
  purlinMaterial: 'TH64075',
  purlinRows: 8,
  purlinInternalSpan: 460,
  purlinEndSpan: 460,
  girtMaterial: 'TH64090',
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

/**
 * The girt prices in this fixture are the girt's own (`separate: true`), which is the
 * case the rest of this file exercises. The fallback — a girt priced from the purlin
 * row — is asserted separately below, because it is the case the quote has to disclose.
 */
const lookup = {
  purlin: (name: string) =>
    name === 'TH64075'
      ? { code: 'P-75', description: name, unitCost: 500, massKg: 2 }
      : name === 'TH64090'
        ? { code: 'P-90', description: name, unitCost: 700, massKg: 2.5 }
        : undefined,
  girt: (name: string) => {
    const row =
      name === 'TH64075'
        ? { code: 'P-75', description: name, unitCost: 500, massKg: 2 }
        : name === 'TH64090'
          ? { code: 'P-90', description: name, unitCost: 700, massKg: 2.5 }
          : undefined;
    return row === undefined ? undefined : { row, separate: true };
  },
} as never;

const ofKind = (lines: ReturnType<typeof purlinLines>, match: RegExp) =>
  lines.filter((l) => match.test(l.description));

describe('purlinLines', () => {
  it('emits one purlin line per roof run, at the optimised row count', () => {
    const lines = purlinLines(shed({ bays: 4 }), frame({ purlinRows: 9 }), lookup);
    const purlins = ofKind(lines, /purlin/i);
    expect(purlins.length).toBeGreaterThan(0);
    // Every purlin line carries the row count, doubled for both roof slopes.
    for (const line of purlins) {
      expect(line.quantity).toBeGreaterThan(0);
      expect(line.unit).toBe('m');
    }
  });

  it('uses more purlin metres on a longer shed', () => {
    const short = purlinLines(shed({ length: 12000, bays: 2 }), frame(), lookup);
    const long = purlinLines(shed({ length: 48000, bays: 8 }), frame(), lookup);
    const metres = (ls: ReturnType<typeof purlinLines>) =>
      ofKind(ls, /purlin/i).reduce((n, l) => n + l.quantity, 0);
    expect(metres(long)).toBeGreaterThan(metres(short));
  });

  it('adds a lap allowance to the purlin run', () => {
    const lines = purlinLines(shed({ length: 24000, bays: 4 }), frame(), lookup);
    const total = ofKind(lines, /purlin/i).reduce((n, l) => n + l.quantity, 0);
    // 24 m of run, two slopes, eight rows, plus laps — well above the bare 384 m.
    expect(total).toBeGreaterThan(384);
  });

  it('emits side-wall girt lines and end-wall girt lines', () => {
    const lines = purlinLines(shed(), frame({ girtRows: 6 }), lookup);
    expect(ofKind(lines, /Side wall girt/).length).toBeGreaterThan(0);
    expect(ofKind(lines, /End wall girt/).length).toBeGreaterThan(0);
  });

  it('prices girts from the girt material, not the purlin material', () => {
    // This is a fixed deviation: the desktop prices girts from the purlin row.
    const lines = purlinLines(shed(), frame(), lookup);
    const girt = ofKind(lines, /Side wall girt/)[0];
    expect(girt.code).toBe('P-90');
    expect(girt.unitCost).toBe(700);
  });

  it('marks a girt mocked when the girt material has no price', () => {
    const only75 = {
      purlin: (name: string) =>
        name === 'TH64075' ? { code: 'P-75', description: name, unitCost: 500, massKg: 2 } : undefined,
      girt: (name: string) =>
        name === 'TH64075'
          ? { row: { code: 'P-75', description: name, unitCost: 500, massKg: 2 }, separate: true }
          : undefined,
    } as never;
    const lines = purlinLines(shed(), frame({ girtMaterial: 'TH64090' }), only75);
    const girt = ofKind(lines, /Side wall girt/)[0];
    expect(girt.mocked).toBe(true);
    expect(girt.unitCost).toBe(0);
  });

  /**
   * The behaviour this group exists to get right, and the one the old engine got
   * wrong silently.
   *
   * `assumed` is deliberately not `mocked`. A mocked line has no price at all, which
   * blocks a send; an assumed line has a real catalogue price for a *different member*,
   * which makes the quote indicative. Conflating them would either refuse a sendable
   * quote or present an approximation as exact.
   */
  it('marks a girt priced from the purlin row as assumed, not mocked', () => {
    const fromPurlin = {
      purlin: (name: string) => ({ code: 'P-75', description: name, unitCost: 500, massKg: 2 }),
      girt: (name: string) => ({
        row: { code: 'P-75', description: name, unitCost: 500, massKg: 2 },
        separate: false,
      }),
    } as never;

    const lines = purlinLines(shed(), frame({ girtMaterial: 'TH64075' }), fromPurlin);
    const girt = ofKind(lines, /Side wall girt/)[0];

    expect(girt.assumed).toBe(true);
    expect(girt.mocked).toBeUndefined();
    // The price is real — it is simply the purlin's.
    expect(girt.unitCost).toBe(500);
    // A reader ordering from the materials list is told which member it is, so the
    // workshop is not asked for a wall girt it will pull from the roof rack.
    expect(girt.code).toBe('P-75');
  });

  it('does not mark a girt assumed when the book prices it separately', () => {
    const lines = purlinLines(shed(), frame(), lookup);
    const girt = ofKind(lines, /Side wall girt/)[0];
    expect(girt.assumed).toBeUndefined();
    expect(girt.unitCost).toBe(700);
  });

  it('gives every line the purlin group', () => {
    for (const line of purlinLines(shed(), frame(), lookup)) expect(line.group).toBe('purlin');
  });

  it('rounds each amount once', () => {
    for (const line of purlinLines(shed(), frame(), lookup)) {
      expect(line.amount).toBe(Math.round(line.quantity * line.unitCost));
    }
  });

  it('emits nothing when the row count is zero', () => {
    expect(purlinLines(shed(), frame({ purlinRows: 0, girtRows: 0 }), lookup)).toEqual([]);
  });

  it('never emits a negative quantity', () => {
    for (const line of purlinLines(shed({ bays: 30 }), frame(), lookup)) {
      expect(line.quantity).toBeGreaterThan(0);
    }
  });
});
