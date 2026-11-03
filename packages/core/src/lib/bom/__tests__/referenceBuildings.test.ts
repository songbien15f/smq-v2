import { describe, it, expect } from 'vitest';
import { buildBomWithEvidence } from '@/lib/bom/build';
import { sheetCounts } from '@/lib/bom/groups/sheeting';
import { packCount } from '@/lib/bom/groups/fixings';
import { DEFAULT_CONTRACTS } from '@/lib/pricing/catalogueManifest';
import { mergeLines } from '@/lib/bom/build';
import { bomLine } from '@/lib/bom/types';
import { plainShed, shed, syntheticLookup, SYNTHETIC_CONTRACTS } from './fixtures/referenceBuildings';

const build = (config = plainShed(), lookup = syntheticLookup()) =>
  buildBomWithEvidence(config, lookup, SYNTHETIC_CONTRACTS);

const group = (result: ReturnType<typeof build>, id: string) =>
  result.bom.groups.find((g) => g.id === id)!;

const line = (result: ReturnType<typeof build>, id: string, match: RegExp) =>
  group(result, id).lines.find((l) => match.test(l.description));

/**
 * A 6 m span at a zero pitch is a 3 m slope run. With an 80 mm end allowance the
 * roof sheet is 3080 mm long. A 10 m run over a 1 m cover is exactly 10 sheets
 * per slope, and a gable has two slopes.
 */
describe('roof sheeting geometry', () => {
  it('counts a sheet per metre of cover per slope, both slopes', () => {
    // 10 m run / 1 m cover = 10 sheets per slope, and a gable has two slopes.
    // The line's quantity is in metres because the price is per metre; the sheet
    // count is what the screws are counted from, so both are pinned.
    const result = build();
    expect(sheetCounts(plainShed(), syntheticLookup()).roof).toBe(20);
    const roof = line(result, 'sheeting', /roof/i)!;
    expect(roof.quantity).toBeCloseTo(61.6, 6);
  });

  it('prices the roof by linear metre, not by sheet', () => {
    // 20 sheets x 3.08 m = 61.6 m at $10/m = $616.
    const roof = line(build(), 'sheeting', /roof/i)!;
    expect(roof.unit).toBe('m');
    expect(roof.quantity).toBeCloseTo(61.6, 6);
    expect(roof.amount).toBe(61_600);
  });

  it('reports the mass the sheets actually weigh', () => {
    // 61.6 m at 2 kg/m.
    const roof = line(build(), 'sheeting', /roof/i)!;
    expect(roof.massKg).toBeCloseTo(123.2, 6);
  });

  it('gives a skillion one slope, falling along the length', () => {
    const skillion = build(plainShed({ structureType: 'skillion' }));
    const roof = line(skillion, 'sheeting', /roof/i)!;
    // A skillion falls along the length, so a sheet runs the 10 m length plus the
    // 80 mm allowance, and the sheets are counted across the 6 m span: 6 sheets
    // x 10.08 m = 60.48 m at $10/m.
    expect(roof.quantity).toBeCloseTo(60.48, 6);
    expect(roof.amount).toBe(60_480);
  });

  it('adds a sheet for a run that is not a whole multiple of the cover', () => {
    // 10.1 m over a 1 m cover needs 11 sheets per run.
    const roof = line(build(plainShed({ length: 10_100 })), 'sheeting', /roof/i)!;
    expect(roof.quantity).toBeCloseTo(2 * 11 * 3.08, 6);
  });

  it('blocks the quote when the cover is not a usable number', () => {
    const zeroCover = syntheticLookup({
      sheeting: () => ({
        code: 'SH-0',
        description: 'broken',
        unitCost: 1000,
        massKg: 2,
        profile: 'Corro',
        bmt: 0.42,
        coverageMm: 0,
        roofInternalSpanMm: 0,
        roofEndSpanMm: 0,
        wallInternalSpanMm: 0,
        wallEndSpanMm: 0,
        wallSideSpanMm: 0,
      }),
    });
    const result = build(plainShed(), zeroCover);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'SHEETING_COVER_MISSING', severity: 'blocker' }),
    );
    expect(result.status).toBe('blocked');
  });
});

describe('walls and carports', () => {
  it('gives an open carport no wall or end sheeting', () => {
    const carport = build(plainShed({ structureType: 'gable_carport' }));
    expect(group(carport, 'sheeting').lines.some((l) => /wall/i.test(l.description))).toBe(false);
  });

  it('gives an open carport no wall girts', () => {
    const carport = build(plainShed({ structureType: 'gable_carport' }));
    expect(group(carport, 'purlin').lines.some((l) => /girt/i.test(l.description))).toBe(false);
  });

  it('gives an enclosed shed both wall runs and both ends', () => {
    const enclosed = build();
    const walls = group(enclosed, 'sheeting').lines.filter((l) => /wall/i.test(l.description));
    expect(walls).toHaveLength(2);
  });
});

describe('option geometry', () => {
  it('measures a stable by the sides it keeps, front and back by depth', () => {
    // 4 m wide, 2 m deep, 2.4 m high, all four panels: (4 + 4 + 2 + 2) x 2.4 = 28.8 sqm.
    const stable = build(
      shed({
        options: [
          {
            id: 'st',
            kind: 'stable',
            wall: 'left',
            align: 'center',
            offset: null,
            width: 4000,
            depth: 2000,
            height: 2400,
            panels: { left: true, right: true, front: true, back: true },
          },
        ],
      }),
    );
    const sheet = line(stable, 'option', /stable/i)!;
    // 28.8 sqm over a 1 m x 2.4 m sheet = 12 sheets.
    expect(sheet.quantity).toBe(12);
  });

  it('emits no battens for a cladding band of zero height', () => {
    const cladding = build(
      shed({
        options: [
          { id: 'hc', kind: 'horizontal_cladding', wall: 'left', from: 1000, to: 1000 },
        ],
      }),
    );
    expect(group(cladding, 'option').lines).toEqual([]);
  });
});

describe('fixings', () => {
  it('rounds a screw allowance to packs once and keeps the true mass', () => {
    // 101 screws plus 10% is 112, which is three packs of 50; the mass is the
    // mass of 112 screws, not of 150.
    const result = build();
    const screws = group(result, 'screw').lines;
    expect(screws.length).toBeGreaterThan(0);
    for (const screw of screws) {
      expect(screw.unit).toBe('pack');
      expect(Number.isInteger(screw.quantity)).toBe(true);
    }
  });
});

describe('assumptions stay visible even when every price resolves', () => {
  it('is not priced while the frame section is a fixed guess', () => {
    const result = build();
    expect(result.bom.mockedLines).toBe(0);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'FRAME_SECTION_ASSUMED', severity: 'assumption' }),
    );
    expect(result.status).toBe('indicative');
  });

  it('is not priced while the footing allowance is unconditional', () => {
    const result = build();
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'FOOTING_ASSUMED', severity: 'assumption' }),
    );
  });

  it('is not priced while the terrain row is substituted', () => {
    const result = build(plainShed({ terrainCategory: 2.5 }));
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'TERRAIN_SUBSTITUTED', severity: 'assumption' }),
    );
  });
});

describe('pack rounding', () => {
  it('buys three packs of fifty for 101 screws plus a ten percent allowance', () => {
    // 101 x 1.1 = 112 needed; 112 / 50 rounds up to 3 packs, and the mass follows
    // the 112 screws, not the 150 that were bought.
    expect(packCount(Math.ceil(101 * 1.1), 50)).toBe(3);
    expect(packCount(150, 50)).toBe(3);
    expect(packCount(151, 50)).toBe(4);
  });
});

describe('downpipe', () => {
  it('prices a pipe run by the metre of drop, not by the corner', () => {
    // The book's downpipe row is a per-metre rate, so four 4.2 m drops are 16.8 m.
    // A fixed count of four would bill one metre per corner whatever the height.
    const result = build(plainShed({ height: 4200 }));
    const pipe = line(result, 'gutter', /downpipe/i)!;
    expect(pipe.unit).toBe('m');
    expect(pipe.quantity).toBeCloseTo(16.8, 6);
  });
});

describe('degenerate sizes', () => {
  it('handles two bays and thirty bays', () => {
    for (const bays of [2, 30]) {
      expect(() => build(plainShed({ bays }))).not.toThrow();
    }
  });

  it('handles a length that is not a multiple of the bay count', () => {
    const result = build(plainShed({ length: 10_001, bays: 3 }));
    expect(result.bom.totalCost).toBeGreaterThan(0);
  });
});

describe('line identity', () => {
  const base = (over: Partial<Parameters<typeof bomLine>[0]>) =>
    bomLine({
      group: 'sheeting',
      code: 'SH-1',
      description: 'Roof sheeting',
      unit: 'm',
      quantity: 10,
      unitCost: 1000,
      massKg: 2,
      ...over,
    });

  it('does not merge two cut lengths of the same product', () => {
    const merged = mergeLines([
      base({ description: 'Roof sheeting — 6173 mm' }),
      base({ description: 'Side wall sheeting — 4235 mm' }),
    ]);
    expect(merged).toHaveLength(2);
  });

  it('does not merge two rates of the same product', () => {
    // A line priced from an assumption and one priced from the book are not the
    // same line even when the amount happens to match.
    const merged = mergeLines([base({ unitCost: 1000 }), base({ unitCost: 1100 })]);
    expect(merged).toHaveLength(2);
  });
});

describe('the real price-book contracts', () => {
  it('prices sheeting per linear metre in production, not per sheet', () => {
    // The reference buildings above use a synthetic contract, so they cannot see
    // the production default. This is the assertion that would have caught a
    // per-sheet basis pricing a coil rate: a 6.1 m sheet would cost one metre.
    const contract = DEFAULT_CONTRACTS.sheeting;
    expect(contract.priceBasis).toBe('m');
    expect(contract.massBasis).toBe('sqm');
  });

  it('prices frame and purlin per metre, and fixings per pack', () => {
    expect(DEFAULT_CONTRACTS.frame.priceBasis).toBe('m');
    expect(DEFAULT_CONTRACTS.purlin.priceBasis).toBe('m');
    expect(DEFAULT_CONTRACTS.fixings.priceBasis).toBe('pack');
    expect(DEFAULT_CONTRACTS.fixings.massBasis).toBe('ea');
  });

  it('gives the sheeting group a line in metres when built with the real contracts', () => {
    const result = buildBomWithEvidence(plainShed(), syntheticLookup());
    const roof = result.bom.groups.find((g) => g.id === 'sheeting')!.lines[0];
    expect(roof.unit).toBe('m');
  });
});
