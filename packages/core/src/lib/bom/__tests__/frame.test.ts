import { describe, it, expect } from 'vitest';
import { DEFAULT_SHED } from '@/domain/defaults';
import type { Opening, ShedConfig, ShedOption } from '@/domain/types';
import type { OptimisedFrame } from '@/lib/bom/types';
import { frameLines } from '@/lib/bom/groups/frame';

const shed = (patch: Partial<ShedConfig> = {}): ShedConfig => ({ ...DEFAULT_SHED, ...patch });

const frame = (patch: Partial<OptimisedFrame> = {}): OptimisedFrame => ({
  purlinMaterial: 'TH64075',
  purlinRows: 8,
  purlinInternalSpan: 460,
  purlinEndSpan: 460,
  girtMaterial: 'TH64075',
  girtRows: 8,
  girtInternalSpan: 550,
  girtEndSpan: 550,
  roofSpan: 6093,
  bayStandard: 6000,
  mocked: false,
  scheduleMissing: true,
  girtMaterialSeparate: true,
  ...patch,
});

const lookup = {
  frame: (size: string) => ({ code: `C-${size}`, description: size, unitCost: 1000, massKg: 5 }),
  purlin: (name: string) => ({ code: `P-${name}`, description: name, unitCost: 500, massKg: 2 }),
  margin: () => 1.48,
} as never;

const door = (patch: Partial<Opening> = {}): Opening => ({
  id: 'd1', type: 'pa_door', width: 900, height: 2040, sill: 0, wall: 'left',
  align: 'center', offset: null, swing: null, track: null, ...patch,
});

const beam = (patch: Partial<ShedOption> = {}): ShedOption => ({
  id: 'cb-1', kind: 'carry_beam', wall: 'front', beginBay: 0, openingId: null, ...patch,
} as ShedOption);

/**
 * How many members of a kind the lines represent.
 *
 * A frame line's quantity is **metres** (length material), so counting members
 * means dividing the metres back by the member length. The tests know each
 * member's length, so they pass it in.
 */
const members = (lines: ReturnType<typeof frameLines>, match: RegExp, lengthMm: number): number => {
  const total = lines.filter((l) => match.test(l.description)).reduce((n, l) => n + l.quantity, 0);
  return Math.round((total * 1000) / lengthMm);
};

describe('frameLines', () => {
  it('counts main columns as (bays − 1) × 2', () => {
    // 4 bays → 3 internal frame lines → 6 columns, two per line.
    // Height 4200 + 600 footing = 4800 mm per column.
    expect(members(frameLines(shed({ bays: 4 }), frame(), lookup), /Main column/, 4800)).toBe(6);
  });

  it('adds two columns for each side wall that has an opening', () => {
    const withDoor = shed({ bays: 4, openings: [door({ wall: 'left' })] });
    expect(members(frameLines(withDoor, frame(), lookup), /Main column/, 4800)).toBe(8);
  });

  it('subtracts one column per carry beam on the front or back wall', () => {
    const withBeam = shed({ bays: 4, options: [beam({ wall: 'front' })] });
    expect(members(frameLines(withBeam, frame(), lookup), /Main column/, 4800)).toBe(5);
  });

  it('ignores a carry beam on an end wall, which does not remove a main column', () => {
    const withBeam = shed({ bays: 4, options: [beam({ wall: 'left' })] });
    expect(members(frameLines(withBeam, frame(), lookup), /Main column/, 4800)).toBe(6);
  });

  it('counts end-wall columns as two per end', () => {
    // 4 bays, no openings: two ends × two columns = 4.
    expect(members(frameLines(shed({ bays: 4 }), frame(), lookup), /End wall column/, 4800)).toBe(4);
  });

  it('reduces end-wall columns for an opening on a side wall', () => {
    const withDoor = shed({ bays: 4, openings: [door({ wall: 'left' })] });
    // One side has an opening, so one column per end is removed: (2 − 1) × 2 = 2.
    expect(members(frameLines(withDoor, frame(), lookup), /End wall column/, 4800)).toBe(2);
  });

  it('counts main rafters like main columns', () => {
    // span 12000 at 10°: slope run 6093, plus 25 clearance and the apex and
    // haunch offsets (35 + 35) → 6188 mm per rafter.
    expect(members(frameLines(shed({ bays: 4 }), frame(), lookup), /Main rafter/, 6188)).toBe(6);
  });

  it('lengthens a rafter past the slope run by its allowances', () => {
    const lines = frameLines(shed({ span: 12000, roofPitchDeg: 10 }), frame(), lookup);
    const rafter = lines.find((l) => /Main rafter/.test(l.description))!;
    // 6 rafters × 6.188 m each.
    expect(rafter.quantity).toBeCloseTo(37.13, 1);
    expect(rafter.unit).toBe('m');
    expect(rafter.massKg).toBeGreaterThan(0);
  });

  it('does not fold the knee brace into the rafter length', () => {
    // The brace is its own member. Folding 2 × 2.5 m into the rafter made a
    // 6.1 m slope order 11.1 m of steel — 82% too much on every portal frame.
    const lines = frameLines(shed({ span: 12000, roofPitchDeg: 10 }), frame(), lookup);
    const rafter = lines.find((l) => /Main rafter/.test(l.description))!;
    const slopeRun = 12000 / 2 / Math.cos((10 * Math.PI) / 180);
    const perRafter = (rafter.quantity * 1000) / 6;
    expect(perRafter).toBeLessThan(slopeRun + 200);
    expect(perRafter).toBeGreaterThan(slopeRun);
  });

  it('gives every line a positive quantity, a unit and a rounded amount', () => {
    for (const line of frameLines(shed(), frame(), lookup)) {
      expect(line.group).toBe('frame');
      expect(line.quantity).toBeGreaterThan(0);
      expect(line.unitCost).toBeGreaterThan(0);
      expect(line.amount).toBe(Math.round(line.quantity * line.unitCost));
    }
  });

  it('marks a line mocked when the price book has no frame row', () => {
    const empty = { frame: () => undefined } as never;
    const lines = frameLines(shed(), frame(), empty);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.mocked === true)).toBe(true);
  });

  it('never emits a negative quantity, even with many carry beams', () => {
    const manyBeams = shed({
      bays: 2,
      options: [beam({ wall: 'front' }), beam({ id: 'cb-2', wall: 'back' })],
    });
    for (const line of frameLines(manyBeams, frame(), lookup)) {
      expect(line.quantity).toBeGreaterThanOrEqual(0);
    }
  });
});

/**
 * The frame takes its section from the book's structure table.
 *
 * This is the difference between a quote and a guess. Pricing every member from
 * one 100 × 100 SHS understates a 15 m portal by more than half — the book frames
 * it in `C35030` at $38.61/m against $16.96/m — and overstates a 6 m one, which
 * the book frames in `C15019` at $12.18/m.
 */
describe('frame schedule', () => {
  /** A lookup whose structure table names a section per member. */
  const scheduled = (sections: {
    mainColumn: string;
    endWallColumn: string;
    mainRafter: string;
    endWallRafter: string;
    kneeBrace: string | null;
  }) =>
    ({
      ...(lookup as object),
      structureId: () => 1,
      frameSchedule: () => ({ ...sections, embedment: 450 }),
    }) as never;

  const sections = {
    mainColumn: 'C35030',
    endWallColumn: 'C15012',
    mainRafter: 'C35030',
    endWallRafter: 'C15012',
    kneeBrace: 'Z15019' as string | null,
  };

  it('prices each member from the section the book names, not one fixed size', () => {
    const lines = frameLines(shed({ span: 15_000 }), frame(), scheduled(sections));
    const descriptions = lines.map((line) => line.description).join(' | ');
    expect(descriptions).toContain('C35030');
    expect(descriptions).toContain('C15012');
    // The fixed section is gone: no member is priced as the fallback.
    expect(descriptions).not.toContain('100 x 100 x 2.0 SHS');
  });

  it('omits the knee brace when the design has none', () => {
    // A short-span portal needs no brace, and the table says so with a null.
    const lines = frameLines(
      shed({ span: 6000 }),
      frame(),
      scheduled({ ...sections, kneeBrace: null }),
    );
    expect(lines.some((line) => line.description.startsWith('Knee brace'))).toBe(false);
  });

  it('uses the design embedment for the column length instead of a flat 600 mm', () => {
    const lines = frameLines(shed({ height: 3000 }), frame(), scheduled(sections));
    const column = lines.find((line) => line.description.startsWith('Main column'));
    // 3 000 mm wall + 450 mm embedment = 3.45 m per column, not the 3.6 m the
    // flat 600 mm allowance would give. Six main columns on the default shed.
    expect(column?.quantity).toBeCloseTo(3.45 * 6, 2);
  });

  it('falls back to one fixed section when the book has no table', () => {
    // `scheduleMissing` is the flag that makes the quote say so; the frame still
    // prices rather than failing.
    const lines = frameLines(shed(), frame(), lookup);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((line) => line.description.includes('100 x 100 x 2.0 SHS'))).toBe(true);
  });
});
