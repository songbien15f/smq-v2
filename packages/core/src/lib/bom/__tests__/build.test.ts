import { describe, it, expect } from 'vitest';
import { DEFAULT_SHED } from '@/domain/defaults';
import type { ShedConfig, ShedOption } from '@/domain/types';
import type { OptimisedFrame } from '@/lib/bom/types';
import { buildBom, mergeLines } from '@/lib/bom/build';
import { sellingChargesCents } from '@/lib/estimating/validate';
import { optionLines } from '@/lib/bom/options';
import { bomLine, type BomLine } from '@/lib/bom/types';

const shed = (patch: Partial<ShedConfig> = {}): ShedConfig => ({ ...DEFAULT_SHED, ...patch });

const frame = (patch: Partial<OptimisedFrame> = {}): OptimisedFrame => ({
  purlinMaterial: 'Z15019',
  purlinRows: 4,
  purlinInternalSpan: 1490,
  purlinEndSpan: 1490,
  girtMaterial: 'Z15019',
  girtRows: 3,
  girtInternalSpan: 1740,
  girtEndSpan: 1740,
  roofSpan: 6093,
  bayStandard: 6000,
  mocked: false,
  scheduleMissing: true,
  girtMaterialSeparate: true,
  ...patch,
});

const row = (code: string, description: string, unitCost: number, massKg: number) => ({
  code,
  description,
  unitCost,
  massKg,
});

/** A lookup that prices everything, so a mocked line means a real gap. */
const lookup = {
  frame: () => row('FR-1', '100 x 100 SHS', 1696, 5.64),
  purlin: (code: string) => row(`PU-${code}`, code, 1218, 4.5),
  purlinDepth: () => 150,
  sheeting: () => ({
    ...row('SH-1', '0.42 Corro', 1150, 3.2),
    profile: 'Corro',
    bmt: 0.42,
    coverageMm: 762,
    roofInternalSpanMm: 900,
    roofEndSpanMm: 1200,
    wallInternalSpanMm: 1700,
    wallEndSpanMm: 1700,
    wallSideSpanMm: 1860,
  }),
  door: (kind: string) =>
    kind === 'roller' ? row('RD-1', 'Roller door', 237375, 52) : row('DR-1', 'PA door', 51167, 25),
  window: () => row('WN-1', 'H790xW816', 16312, 8),
  colour: () => undefined,
  colourName: (hex: string) => (hex === '#bdbfba' ? 'Shale Grey' : undefined),
  margin: () => 1,
  devided: () => [],
  windSpeed: () => 41,
  delivery: () => 0,
  gutter: () => row('GU-1', '115 Quad', 410, 0),
  gutterBracket: () => row('GB-1', '115 Quad bracket', 122, 0),
  downpipe: () => row('DP-1', '90mm RND', 1097, 1.4),
  flashing: (type: string) => row(`FL-${type}`, type, 686, 0),
  bracket: () => row('BR-1', 'BP89A', 2619, 2),
  bracketExact: () => row('BR-K', 'KBC20-7.5L', 1985, 1),
  bracketForPurlin: () => row('BR-F', 'EPHB15-Z150', 430, 0.47),
  bracing: () => ({ ...row('BS-1', '30x1.2mm', 1873, 10), rollMetres: 30 }),
  bolt: () => ({ ...row('BO-1', 'M16x40-8.8', 534, 0.125), qtyPerPack: 20 }),
  screw: () => ({ ...row('SC-1', 'ZIPxx', 2103, 1.16), qtyPerPack: 100 }),
  miscOption: (name: string) => (name === 'Shed Safe fee' ? row('', name, 1500, 0) : undefined),
} as never;

describe('mergeLines', () => {
  const line = (over: Partial<BomLine>): BomLine =>
    bomLine({
      group: 'purlin',
      code: 'P-1',
      description: 'Roof purlin',
      unit: 'm',
      quantity: 10,
      unitCost: 1000,
      massKg: 5,
      ...over,
    });

  it('sums the quantity of two lines for the same material', () => {
    const merged = mergeLines([line({ quantity: 10 }), line({ quantity: 5 })]);
    expect(merged).toHaveLength(1);
    expect(merged[0].quantity).toBe(15);
  });

  it('rounds the merged amount once, not once per contribution', () => {
    // Three thirds of a metre at 100 cents: rounding each line gives 33+33+33=99,
    // rounding the merged 1 m gives 100. The second is the correct answer.
    const third = line({ quantity: 1 / 3, unitCost: 100 });
    expect(mergeLines([third, third, third])[0].amount).toBe(100);
  });

  it('keeps the same code in different units apart', () => {
    const merged = mergeLines([line({ unit: 'm' }), line({ unit: 'ea' })]);
    expect(merged).toHaveLength(2);
  });

  it('keeps two cut lengths of one material apart', () => {
    // A sheet cut to 6173 mm is not the same product as one cut to 4235 mm, even
    // though both are the same profile at the same price per sheet.
    const merged = mergeLines([
      line({ unit: 'ea', description: 'Roof sheeting — 0.42 Corro, 6173 mm' }),
      line({ unit: 'ea', description: 'Roof sheeting — 0.42 Corro, 4235 mm' }),
    ]);
    expect(merged).toHaveLength(2);
  });

  it('keeps two roles of one section apart', () => {
    const merged = mergeLines([
      line({ description: 'Main column — 100 x 100 x 2.0 SHS' }),
      line({ description: 'Main rafter — 100 x 100 x 2.0 SHS' }),
    ]);
    expect(merged).toHaveLength(2);
  });

  it('never merges a mocked line into a priced one', () => {
    const mocked = line({ code: 'MOCK', unitCost: 0, mocked: true });
    const priced = line({ code: 'P-1' });
    const merged = mergeLines([mocked, priced]);
    expect(merged).toHaveLength(2);
  });

  it('marks a merged line mocked if any contribution was', () => {
    const merged = mergeLines([line({ mocked: true }), line({})]);
    expect(merged).toHaveLength(1);
    expect(merged[0].mocked).toBe(true);
  });
});

describe('buildBom', () => {
  it('returns every group, including empty ones', () => {
    const result = buildBom(shed(), lookup);
    expect(result.groups.map((g) => g.id)).toEqual([
      'frame', 'purlin', 'sheeting', 'gutter', 'flashing',
      'bracket', 'flatfly', 'bracing', 'bolt', 'screw', 'option', 'misc',
    ]);
  });

  it('merges duplicate materials into one line per group', () => {
    const result = buildBom(shed(), lookup);
    for (const group of result.groups) {
      const keys = group.lines.map((l) => `${l.code}|${l.unit}|${l.description}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('never merges two roof-sheet lengths into one line', () => {
    const result = buildBom(shed(), lookup);
    const sheets = result.groups.find((g) => g.id === 'sheeting')!.lines;
    const lengths = sheets.map((l) => /(\d+) mm/.exec(l.description)?.[1]);
    // The roof is longer than the wall, so the two lengths must survive separately.
    expect(new Set(lengths).size).toBeGreaterThan(1);
  });

  it('sums the amounts of its own lines into totalCost', () => {
    const result = buildBom(shed(), lookup);
    const lineSum = result.groups.flatMap((g) => g.lines).reduce((n, l) => n + l.amount, 0);
    expect(result.totalCost).toBe(lineSum);
  });

  it('keeps operator charges out of material cost', () => {
    // A charge on the Charges tab is a selling amount that already carries its
    // own margin and GST. Putting it in the BOM would run it through the material
    // margin and add the tax a second time.
    const charged = buildBom(
      shed({
        charges: [
          { id: 'c1', label: 'Crane hire', quantity: 1, unit: 'ea', unitPriceCents: 150_000 },
          { id: 'c2', label: 'Council permit', quantity: 1, unit: 'ea', unitPriceCents: 45_000 },
        ],
      }),
      lookup,
    );
    expect(charged.totalCost).toBe(buildBom(shed(), lookup).totalCost);
    // The ShedSafe fee is the one `misc` line, and it is not a charge: it comes
    // from the book and is the same whether or not the operator typed any.
    const misc = charged.groups.find((g) => g.id === 'misc')!.lines;
    expect(misc.some((line) => line.description.includes('Crane'))).toBe(false);
  });

  it('reports the charges separately so the evaluator can add them once', () => {
    const config = shed({
      charges: [{ id: 'c1', label: 'Crane hire', quantity: 1, unit: 'ea', unitPriceCents: 150_000 }],
    });
    expect(sellingChargesCents(config)).toBe(150_000);
  });

  it('prices the ShedSafe fee from the book into the miscellaneous section', () => {
    // Every shed quote in the market carries it, so a quote that omits it hides
    // the fee and recovers it out of the margin instead.
    const misc = buildBom(shed(), lookup).groups.find((g) => g.id === 'misc')!;
    const fee = misc.lines.find((line) => line.description.includes('ShedSafe'));
    expect(fee).toBeDefined();
    expect(fee!.quantity).toBe(1);
    expect(fee!.amount).toBeGreaterThan(0);
  });

  it('is deterministic: the same config produces byte-identical output', () => {
    const a = JSON.stringify(buildBom(shed(), lookup));
    const b = JSON.stringify(buildBom(shed(), lookup));
    expect(a).toBe(b);
  });

  it('counts mocked lines', () => {
    const empty = {} as never;
    expect(buildBom(shed(), empty).mockedLines).toBeGreaterThan(0);
  });

  it('prices every line of a default shed against a complete book', () => {
    expect(buildBom(shed(), lookup).mockedLines).toBe(0);
  });

  it('adds cost for each option that consumes material', () => {
    const base = buildBom(shed(), lookup);
    const more = buildBom(
      shed({
        options: [
          { id: 'sk-1', kind: 'skylight', bay: 0, alongBay: 0.5, width: 900, height: 900 },
          { id: 'mz-1', kind: 'mezzanine', corner: 'back_left', width: 3000, depth: 3000, level: 2400 },
        ],
      }),
      lookup,
    );
    expect(more.totalCost).toBeGreaterThan(base.totalCost);
  });

  it('handles a 2-bay shed and a 30-bay shed without throwing', () => {
    expect(() => buildBom(shed({ bays: 2 }), lookup)).not.toThrow();
    expect(() => buildBom(shed({ bays: 30 }), lookup)).not.toThrow();
  });

  it('gives a 30-bay shed more steel than a 2-bay shed', () => {
    const small = buildBom(shed({ bays: 2 }), lookup);
    const large = buildBom(shed({ bays: 30 }), lookup);
    expect(large.totalMassKg).toBeGreaterThan(small.totalMassKg);
  });

  it('prices a door on the quote', () => {
    // A door is the dearest single item on most sheds. A BOM that omits it is
    // confidently and badly wrong, and reports itself complete.
    const withDoor = buildBom(
      shed({
        openings: [
          { id: 'd1', type: 'roller_door', width: 3000, height: 2400, sill: 0,
            wall: 'front', align: 'center', offset: null, swing: null, track: null },
          { id: 'd2', type: 'pa_door', width: 820, height: 2040, sill: 0,
            wall: 'back', align: 'center', offset: null, swing: null, track: null },
        ],
      }),
      lookup,
    );
    const options = withDoor.groups.find((g) => g.id === 'option')!.lines;
    expect(options.some((l) => /roller door/i.test(l.description))).toBe(true);
    expect(options.some((l) => /PA door/i.test(l.description))).toBe(true);
    expect(withDoor.totalCost).toBeGreaterThan(buildBom(shed(), lookup).totalCost);
  });

  it('does not price a plain opening, which has nothing fitted into it', () => {
    const withHole = buildBom(
      shed({
        openings: [
          { id: 'h1', type: 'opening', width: 900, height: 2040, sill: 0,
            wall: 'front', align: 'center', offset: null, swing: null, track: null },
        ],
      }),
      lookup,
    );
    expect(withHole.groups.find((g) => g.id === 'option')!.lines).toEqual([]);
  });

  it('prices a carport as a roof on columns, with no walls', () => {
    const garage = buildBom(shed({ structureType: 'gable', span: 6000, length: 6000, height: 2400, bays: 2 }), lookup);
    const carport = buildBom(shed({ structureType: 'gable_carport', span: 6000, length: 6000, height: 2400, bays: 2 }), lookup);

    // A carport has no wall or end sheeting, so it must be cheaper than the same
    // roofed footprint with walls.
    expect(carport.totalCost).toBeLessThan(garage.totalCost);

    const wallSheets = (bom: typeof garage) =>
      bom.groups.find((g) => g.id === 'sheeting')!.lines
        .filter((l) => /wall/i.test(l.description))
        .reduce((n, l) => n + l.quantity, 0);
    expect(wallSheets(carport)).toBe(0);
    expect(wallSheets(garage)).toBeGreaterThan(0);

    const girts = (bom: typeof garage) =>
      bom.groups.find((g) => g.id === 'purlin')!.lines
        .filter((l) => /girt/i.test(l.description));
    expect(girts(carport)).toHaveLength(0);
    expect(girts(garage).length).toBeGreaterThan(0);
  });

  it('reports a delivery weight in the same order as the steel it ships', () => {
    const result = buildBom(shed(), lookup);
    // A 12 x 24 m shed is roughly 500 m² of sheet at 3.2 kg/m² — about 1.6 t —
    // plus the frame and purlins. The sheeting `mass` column is kg/m², so reading
    // it as kg/sheet would report a fraction of the real weight.
    expect(result.totalMassKg).toBeGreaterThan(2000);
    const sheets = result.groups.find((g) => g.id === 'sheeting')!;
    const sheetMass = sheets.lines.reduce((n, l) => n + l.massKg, 0);
    expect(sheetMass).toBeGreaterThan(1000);
  });

  it('reports mass as the sum of its lines', () => {
    const result = buildBom(shed(), lookup);
    const lineMass = result.groups.flatMap((g) => g.lines).reduce((n, l) => n + l.massKg, 0);
    expect(result.totalMassKg).toBeCloseTo(lineMass, 2);
  });
});

describe('optionLines', () => {
  const lines = (options: ShedOption[]) => optionLines(shed({ options }), frame(), lookup);

  it('contributes nothing for a shed with no options', () => {
    expect(optionLines(shed(), frame(), lookup)).toEqual([]);
  });

  it('prices a skylight once per skylight', () => {
    const one = lines([{ id: 'a', kind: 'skylight', bay: 0, alongBay: 0.5, width: 900, height: 900 }]);
    const two = lines([
      { id: 'a', kind: 'skylight', bay: 0, alongBay: 0.5, width: 900, height: 900 },
      { id: 'b', kind: 'skylight', bay: 1, alongBay: 0.5, width: 900, height: 900 },
    ]);
    expect(one).toHaveLength(1);
    expect(two[0].quantity).toBe(2);
  });

  it('prices a mezzanine by its area', () => {
    const [mezz] = lines([
      { id: 'm', kind: 'mezzanine', corner: 'back_left', width: 3000, depth: 4000, level: 2400 },
    ]);
    // 3 m x 4 m = 12 m², at the storage rate.
    expect(mezz.quantity).toBe(12);
    expect(mezz.amount).toBe(12 * mezz.unitCost);
  });

  it('applies the Queensland mezzanine multiplier only in Queensland', () => {
    const mezz: ShedOption = {
      id: 'm', kind: 'mezzanine', corner: 'back_left', width: 3000, depth: 4000, level: 2400,
    };
    const qld = optionLines(shed({ options: [mezz], stateCode: 'QLD' }), frame(), lookup)[0];
    const nsw = optionLines(shed({ options: [mezz], stateCode: 'NSW' }), frame(), lookup)[0];
    expect(qld.unitCost).toBeGreaterThan(nsw.unitCost);
    expect(qld.unitCost).toBe(Math.round(nsw.unitCost * 1.4));
  });

  it('prices an awning in whole sheets, not square metres', () => {
    const [awning] = lines([
      { id: 'a', kind: 'awning', wall: 'front', align: 'center', offset: null, width: 3000, depth: 1000 },
    ]);
    // A sheet covers 762 mm x the 1000 mm depth, so 3 m of awning needs 4 sheets.
    // The unit price is per sheet, so the quantity must be sheets: 3 would be 3 m²
    // at a per-sheet price, undercharging by a factor of a sheet's area.
    expect(awning.quantity).toBe(4);
    expect(awning.unit).toBe('ea');
  });

  it('counts a stable by the sides it keeps', () => {
    const all = lines([
      { id: 's', kind: 'stable', wall: 'left', align: 'center', offset: null, width: 3000,
        depth: 3000, height: 2400, panels: { left: true, right: true, front: true, back: true } },
    ]);
    const one = lines([
      { id: 's', kind: 'stable', wall: 'left', align: 'center', offset: null, width: 3000,
        depth: 3000, height: 2400, panels: { left: true, right: false, front: false, back: false } },
    ]);
    expect(all[0].quantity).toBeGreaterThan(one[0].quantity);
  });

  it('gives a stable with every panel removed no material', () => {
    expect(
      lines([
        { id: 's', kind: 'stable', wall: 'left', align: 'center', offset: null, width: 3000,
          depth: 3000, height: 2400, panels: { left: false, right: false, front: false, back: false } },
      ]),
    ).toEqual([]);
  });

  it('contributes nothing for a gable infill, which the end-wall sheeting covers', () => {
    expect(lines([{ id: 'g', kind: 'gable_infill', end: 'front' }])).toEqual([]);
  });

  it('prices a carry beam and a cantilever', () => {
    const carry = lines([{ id: 'c', kind: 'carry_beam', wall: 'front', beginBay: 1, openingId: null }]);
    const cant = lines([{ id: 'k', kind: 'cantilever', wall: 'front', bay: 1, length: 2000 }]);
    expect(carry).toHaveLength(1);
    expect(cant).toHaveLength(1);
  });

  it('prices every option kind without throwing', () => {
    const everyKind: ShedOption[] = [
      { id: '1', kind: 'skylight', bay: 0, alongBay: 0.5, width: 900, height: 900 },
      { id: '2', kind: 'mezzanine', corner: 'back_left', width: 3000, depth: 3000, level: 2400 },
      { id: '3', kind: 'awning', wall: 'front', align: 'center', offset: null, width: 3000, depth: 1000 },
      { id: '4', kind: 'outrigger', wall: 'front', bay: 0, length: 1900 },
      { id: '5', kind: 'dividing_wall', axis: 'x', at: 6000, height: 3000 },
      { id: '6', kind: 'gable_infill', end: 'front' },
      { id: '7', kind: 'stable', wall: 'left', align: 'center', offset: null, width: 3000,
        depth: 3000, height: 2400, panels: { left: true, right: true, front: true, back: false } },
      { id: '8', kind: 'carry_beam', wall: 'front', beginBay: 1, openingId: null },
      { id: '9', kind: 'horizontal_cladding', wall: 'left', from: 0, to: 2400 },
      { id: '10', kind: 'overhang', wall: 'front', depth: 600 },
      { id: '11', kind: 'cantilever', wall: 'front', bay: 1, length: 2000 },
    ];
    expect(() => optionLines(shed({ options: everyKind }), frame(), lookup)).not.toThrow();
    expect(optionLines(shed({ options: everyKind }), frame(), lookup).length).toBeGreaterThan(5);
  });

  it('marks an option mocked when the book cannot price it', () => {
    const empty = {} as never;
    const lines = optionLines(
      shed({ options: [{ id: 'a', kind: 'awning', wall: 'front', align: 'center', offset: null, width: 3000, depth: 1000 }] }),
      frame(),
      empty,
    );
    expect(lines.every((l) => l.mocked === true)).toBe(true);
  });
});
