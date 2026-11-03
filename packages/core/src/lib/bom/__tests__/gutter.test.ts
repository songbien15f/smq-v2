import { describe, it, expect } from 'vitest';
import { DEFAULT_SHED } from '@/domain/defaults';
import type { ShedConfig } from '@/domain/types';
import type { OptimisedFrame } from '@/lib/bom/types';
import { flashingLines, gutterLines } from '@/lib/bom/groups/gutter';

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

/** A lookup that prices everything at a flat rate, so only quantities matter. */
const lookup = {
  gutter: () => ({ code: 'GUT-1', description: '115 Quad', unitCost: 410, massKg: 1 }),
  gutterBracket: () => ({ code: 'BRK-1', description: '115 Quad bracket', unitCost: 122, massKg: 0 }),
  downpipe: () => ({ code: 'DP-1', description: '90mm PVC', unitCost: 900, massKg: 2 }),
  flashing: (type: string) => ({ code: `FL-${type}`, description: type, unitCost: 600, massKg: 1 }),
} as never;

describe('gutterLines', () => {
  it('emits a gutter line and a bracket line', () => {
    const lines = gutterLines(shed({ length: 24000 }), frame(), lookup);
    expect(lines.some((l) => /gutter/i.test(l.description) && l.unit === 'm')).toBe(true);
    expect(lines.some((l) => /bracket/i.test(l.description))).toBe(true);
  });

  it('gives more gutter metres on a longer shed', () => {
    const metres = (length: number) =>
      gutterLines(shed({ length }), frame(), lookup)
        .filter((l) => l.unit === 'm')
        .reduce((n, l) => n + l.quantity, 0);
    expect(metres(48000)).toBeGreaterThan(metres(24000));
  });

  it('gives a downpipe run per corner, measured by the wall height', () => {
    const lines = gutterLines(shed({ height: 4200 }), frame(), lookup);
    const downpipes = lines.filter((l) => /downpipe/i.test(l.description));
    expect(downpipes.length).toBeGreaterThan(0);
    // Four corners, each a 4.2 m drop: pipe is sold per metre.
    expect(downpipes[0].unit).toBe('m');
    expect(downpipes[0].quantity).toBeCloseTo(4 * 4.2, 2);
  });

  it('orders more pipe for a taller shed', () => {
    const low = gutterLines(shed({ height: 3000 }), frame(), lookup);
    const high = gutterLines(shed({ height: 6000 }), frame(), lookup);
    const pipe = (lines: typeof low) =>
      lines.find((l) => /downpipe/i.test(l.description))!.quantity;
    expect(pipe(high)).toBeGreaterThan(pipe(low));
  });

  it('puts every line in the gutter group', () => {
    for (const line of gutterLines(shed(), frame(), lookup)) expect(line.group).toBe('gutter');
  });

  it('marks lines mocked when the book has no gutter price', () => {
    const empty = { gutter: () => undefined, downpipe: () => undefined } as never;
    const lines = gutterLines(shed(), frame(), empty);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.mocked === true)).toBe(true);
  });
});

describe('flashingLines', () => {
  it('emits barge flashing on both gable ends', () => {
    const lines = flashingLines(shed(), frame(), lookup);
    expect(lines.some((l) => /barge/i.test(l.description))).toBe(true);
  });

  it('runs corner flashing the full wall height at four corners', () => {
    const lines = flashingLines(shed({ height: 4200 }), frame(), lookup);
    const corner = lines.find((l) => /corner/i.test(l.description))!;
    expect(corner.unit).toBe('m');
    expect(corner.quantity).toBeCloseTo(4 * 4.2, 2);
  });

  it('caps the ridge along the whole length of a gable', () => {
    const lines = flashingLines(shed({ length: 24000 }), frame(), lookup);
    const ridge = lines.find((l) => /ridge/i.test(l.description))!;
    expect(ridge.quantity).toBeCloseTo(24, 2);
  });

  it('has no ridge on a skillion, which has no apex', () => {
    const lines = flashingLines(shed({ structureType: 'skillion' }), frame(), lookup);
    expect(lines.some((l) => /ridge/i.test(l.description))).toBe(false);
  });

  it('emits fascia or capping along the eaves', () => {
    const lines = flashingLines(shed({ length: 24000 }), frame(), lookup);
    expect(lines.some((l) => /fascia|capping/i.test(l.description))).toBe(true);
  });

  it('puts every line in the flashing group', () => {
    for (const line of flashingLines(shed(), frame(), lookup)) expect(line.group).toBe('flashing');
  });

  it('never mixes gutter items into the flashing group', () => {
    // The desktop's export puts gutter rows in the flashing section because of
    // index-swapped arrays; here the group is set when the line is created.
    const flashing = flashingLines(shed(), frame(), lookup);
    expect(flashing.every((l) => l.group === 'flashing')).toBe(true);
    expect(flashing.some((l) => /gutter|downpipe/i.test(l.description))).toBe(false);
  });

  it('rounds each amount once', () => {
    for (const line of flashingLines(shed(), frame(), lookup)) {
      expect(line.amount).toBe(Math.round(line.quantity * line.unitCost));
    }
  });
});
