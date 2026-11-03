import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { DatabaseSync } from 'node:sqlite';
import { openPriceDb } from '@/lib/pricing/db';
import { importPriceBook } from '@/lib/pricing/import';
import { createLookup } from '@/lib/pricing/lookup';

let dir: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sq-lookup-'));
  const files: Record<string, unknown[]> = {
    cost_frame: [
      { id: 1, description: '100 x 100 x 2.0 SHS', code: 'FBI15403', cost: 16.9571, mass: 5.64,
        depth: 100, width: 100, web: 100, thick: 20 },
    ],
    cost_purlin: [
      { id: 1, description: 'TH22', code: 'FFT74622', cost: 1.1266, mass: 0.3814, depth: 22, thick: 22 },
    ],
    view_cost_sheeting: [
      { id: 1, description: '0.42 Corro', code: 'CO42', cost: 11.5, mass: 3.2, bmt: 0.42,
        profile: 'Corro', coverage: 762, roof_i_span: 900, roof_e_span: 1200,
        wall_i_span: 1700, wall_e_span: 1700, wall_s_span: 1860 },
    ],
    roller_door: [
      { rdoor_name: 'H2100xW2450', rdoor_code: 'FBM66154', width: 2450, height: 2100,
        price_zinc: 237.3751, price_color: 275.8, rdoor_mass: 52, isActive: 1 },
      { rdoor_name: 'H2400xW3000', rdoor_code: 'FBM99999', width: 3000, height: 2400,
        price_zinc: 400, price_color: 465, rdoor_mass: 60, isActive: 1 },
    ],
    padoor: [
      { padoor_name: 'Cyclone 920w', height: 2040, width: 920,
        padoor_product_code: '380/47W', padoor_price_zinc: 967.435,
        padoor_price_color: 967.435, padoor_mass: 79, isActive: 1 },
    ],
    // A sliding door is priced by position, not by one column. `sld_price` is
    // zero here for the same reason it is zero on all 79 real rows, so a lookup
    // that reads it quotes nothing.
    sliding_door: [
      { sld_id: '1', sld_size: 'H2500xW2500', sld_code: '', sld_width: 2500, sld_height: 2500,
        sld_price: 0, sld_mass: 0, isEndWall: 0, sld_price_sidewall: 525,
        sld_price_endwall: 588, sld_price_endwall_hangar: 1155 },
    ],
    system_colour: [
      { id: 1, colour_name: 'Basalt', colour_value: '#6d6c6e', colour_status: 1 },
      { id: 2, colour_name: 'Retired', colour_value: '#000000', colour_status: 0 },
    ],
    setting_price_coeffcient: [{ structure_id: 1, state_code: 'QLD', price_coeffcient: 1.48 }],
    // The margin table is keyed by an integer; this is the bridge from the
    // sub-code this build names a structure by.
    structure_type: [
      { id: 1, display_name: 'CROSSOVER GABLE - SERIES 4', structure_sub_code: 'GB_TH64',
        structure_id: 1, is_active: 1 },
      { id: 8, display_name: 'CROSSOVER GABLE - CARPORT SERIES', structure_sub_code: 'GC',
        structure_id: 8, is_active: 1 },
    ],
    devided: [
      { lookup_id: '1', lookup_code: 'A2', standard_span: 4000, purlin_span: 460,
        girt_span: 550, open_design: 1, purlin_material: 'TH64075' },
      { lookup_id: '2', lookup_code: 'A2', standard_span: 4000, purlin_span: 530,
        girt_span: 600, open_design: 0, purlin_material: 'TH64090' },
    ],
    design_wind_speed: [
      { id: 1, display_name: '41.0m/s', is_active: 1, index_sort: 1 },
      { id: 2, display_name: '45.0m/s', is_active: 1, index_sort: 2 },
    ],
    delivery_data: [
      { delivery_id: '1', delivery_name: 'Delivered to site 0-100km', delivery_value: 250,
        state_value_array: 'QLD : 250; NSW : 300', is_costable: 1 },
    ],
    cost_bracket: [
      // A plain size ladder with no purlin suffix.
      { id: 1, description: 'HFB10', code: 'FB10', cost: 4.4651, mass: 0.5 },
      { id: 2, description: 'HFB40', code: 'FB40', cost: 10.4753, mass: 0.88 },
      // Named for the purlin: the number before the suffix is a size class, not
      // the depth, so `bracket()` must not read it as one.
      { id: 3, description: 'EPHB15-TH64', code: 'EP64', cost: 4.4519, mass: 0.47 },
      { id: 4, description: 'EPHB30-Z150', code: 'EP150', cost: 11.7848, mass: 1 },
    ],
    cost_bracing: [
      { id: 1, description: '30x1.2mm', code: 'FBI26813', cost: 18.7301, mass: 10,
        unit_length: 30, roll_size: '30m roll, 30x1.2mm' },
    ],
    cost_bolt: [
      { id: 1, description: 'M16x40-8.8', code: 'FBI80463', cost: 0.2671, cost_pack: 5.3412,
        mass: 0.125, qty_pack: 20 },
    ],
    screws: [
      { screws_type: 'ROOF_SCREW', screws_size: 'ZIPxx', screws_product_code: '',
        screws_price: 0.21, screws_color: 'Basalt', screws_mass: 1.16, qty_per_pack: 100,
        screw_price_pack: 21.027205 },
      { screws_type: 'WALL_SCREW', screws_size: 'TS1016xx', screws_product_code: 'FBS18480',
        screws_price: 0.08, screws_color: 'Basalt', screws_mass: 0.8, qty_per_pack: 100,
        screw_price_pack: 8.1 },
    ],
    flashing: [
      { flashing_type: 'GABLE_BARGE', flashing_size: 'GF', flashing_product_code: 'GF',
        flashing_color: 'Basalt', flashing_price: 6.8575, flashing_mass: 0 },
      { flashing_type: 'GABLE_BARGE', flashing_size: 'GF', flashing_product_code: 'GF',
        flashing_color: 'Zinc', flashing_price: 7.200375, flashing_mass: 0 },
    ],
    downpipe: [
      // An elbow and a pipe share the size; only the pipe is a pipe run.
      { downpipe_kind: 'PVC', downpipe_size: '90mm RND', downpipe_color: 'White',
        downpipe_type: 'DOWNPIPE_ELBOW', downpipe_price: 0.66465, downpipe_mass: 0.2,
        downpipe_product_code: 'ELB' },
      { downpipe_kind: 'PVC', downpipe_size: '90mm RND', downpipe_color: 'White',
        downpipe_type: 'DOWNPIPE', downpipe_price: 10.972, downpipe_mass: 1.4,
        downpipe_product_code: 'BA21485' },
    ],
    gutter: [
      { gutter_type: 'GUTTER', gutter_size: '115 Quad', gutter_product_code: '',
        gutter_price: 4.10395, gutter_mass: 0 },
      { gutter_type: 'GUTTER_BRACKET', gutter_size: '115 Quad', gutter_product_code: '',
        gutter_price: 1.2238, gutter_mass: 0 },
    ],
  };
  for (const [name, rows] of Object.entries(files)) {
    writeFileSync(join(dir, `${name}.json`), JSON.stringify(rows));
  }
  db = openPriceDb(':memory:');
  importPriceBook(db, dir);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('createLookup', () => {
  it('finds a frame by size and converts dollars to cents once', () => {
    const row = createLookup(db).frame('100 x 100 x 2.0 SHS');
    expect(row).toMatchObject({ code: 'FBI15403', unitCost: 1696, massKg: 5.64 });
  });

  it('returns undefined for a size that is not in the book', () => {
    expect(createLookup(db).frame('999 x 999')).toBeUndefined();
  });

  it('finds a purlin by material name, which is what the span table references', () => {
    // `devided.purlin_material` is 'TH22', the description, not the code
    // 'FFT74622'. Looking up by code returns nothing and every frame is mocked.
    expect(createLookup(db).purlin('TH22')?.code).toBe('FFT74622');
  });

  it('rounds a purlin price to whole cents', () => {
    // 1.1266 dollars is 112.66 cents, rounded to 113.
    expect(createLookup(db).purlin('TH22')?.unitCost).toBe(113);
  });

  it('finds sheeting by profile and thickness', () => {
    const row = createLookup(db).sheeting('Corro', 0.42);
    expect(row).toMatchObject({ code: 'CO42' });
    expect(row?.coverageMm).toBe(762);
    expect(row?.roofInternalSpanMm).toBe(900);
  });

  it('picks the smallest roller door at or above the requested size', () => {
    // Asked for 2400 wide; the 2450 door is the smallest that fits.
    expect(createLookup(db).door('roller', 2400, 2100)?.code).toBe('FBM66154');
  });

  it('returns undefined when no door is large enough', () => {
    expect(createLookup(db).door('roller', 6000, 2100)).toBeUndefined();
  });

  it('finds a PA door by size', () => {
    expect(createLookup(db).door('pa', 900, 2040)?.code).toBe('380/47W');
  });

  it('prices a sliding door from the column for the wall it is fitted in', () => {
    // The book's generic `sld_price` is zero on every row, so reading it quoted
    // every sliding door at nothing — and silently, because the row was found.
    const lookup = createLookup(db);
    const side = lookup.door('sliding', 2500, 2500, { endWall: false, hangar: false, painted: true });
    const end = lookup.door('sliding', 2500, 2500, { endWall: true, hangar: false, painted: true });
    const hangar = lookup.door('sliding', 2500, 2500, { endWall: true, hangar: true, painted: true });
    expect(side?.unitCost).toBe(52_500);
    expect(end?.unitCost).toBe(58_800);
    expect(hangar?.unitCost).toBe(115_500);
  });

  it('treats a sliding door with no placement as a side-wall door', () => {
    // The default has to be a price, not zero: a caller that forgets the
    // placement must still get the cheapest real rate rather than nothing.
    expect(createLookup(db).door('sliding', 2500, 2500)?.unitCost).toBe(52_500);
  });

  it('returns only active colours', () => {
    const lookup = createLookup(db);
    expect(lookup.colour('Basalt')).toMatchObject({ name: 'Basalt', hex: '#6d6c6e' });
    expect(lookup.colour('Retired')).toBeUndefined();
  });

  it('returns the margin for a structure and state, defaulting to 1', () => {
    expect(createLookup(db).margin(1, 'QLD')).toBe(1.48);
    expect(createLookup(db).margin(99, 'QLD')).toBe(1);
    expect(createLookup(db).margin(1, 'TAS')).toBe(1);
  });

  it('resolves a structure sub-code to the book id the margin table uses', () => {
    const lookup = createLookup(db);
    expect(lookup.structureId('GB_TH64')).toBe(1);
    expect(lookup.structureId('GC')).toBe(8);
    expect(lookup.structureId('NOT_A_FAMILY')).toBeUndefined();
  });

  it('parses the wind speed out of its display name', () => {
    expect(createLookup(db).windSpeed('A')).toBe(41);
    expect(createLookup(db).windSpeed('B')).toBe(45);
  });

  it('returns zero wind speed for a region the book does not have', () => {
    expect(createLookup(db).windSpeed('Z')).toBe(0);
  });

  it('reads a delivery band for a state, in cents', () => {
    const lookup = createLookup(db);
    expect(lookup.delivery('QLD', '0-100km')).toBe(25000);
    expect(lookup.delivery('NSW', '0-100km')).toBe(30000);
  });

  it('filters devided rows by code, span and open design', () => {
    const lookup = createLookup(db);
    expect(lookup.devided('A2', 4000, true).map((r) => r.purlinMaterial)).toEqual(['TH64075']);
    expect(lookup.devided('A2', 4000, false).map((r) => r.purlinMaterial)).toEqual(['TH64090']);
    expect(lookup.devided('ZZ', 4000, true)).toEqual([]);
  });

  it('returns the whole devided row set when open design is not constrained', () => {
    expect(createLookup(db).devided('A2', 4000)).toHaveLength(2);
  });
});

describe('pack-priced and colour-matched lookups', () => {
  it('prices a bolt per pack and reports the pack size', () => {
    const bolt = createLookup(db).bolt('M16x40-8.8')!;
    expect(bolt.unitCost).toBe(534);
    expect(bolt.qtyPerPack).toBe(20);
    // The per-piece mass, not the pack mass: the line's mass is steel, not cartons.
    expect(bolt.massKg).toBeCloseTo(0.125, 6);
  });

  it('prices a screw per pack, colour-matched, and derives a code when the book has none', () => {
    const lookup = createLookup(db);
    const roof = lookup.screw('ROOF_SCREW', 'Basalt')!;
    expect(roof.unitCost).toBe(2103);
    expect(roof.qtyPerPack).toBe(100);
    // The book has no product code for a coloured roof screw; a blank code column
    // is not orderable, so a slug stands in and is marked derived with `~`.
    expect(roof.code.startsWith('~')).toBe(true);
  });

  it('falls back to the first screw of the type when the colour is not stocked', () => {
    expect(createLookup(db).screw('WALL_SCREW', 'Not A Colour')!.unitCost).toBe(810);
  });

  it('prices flashing by colour, not by the cheapest row', () => {
    const lookup = createLookup(db);
    expect(lookup.flashing('GABLE_BARGE', 'Basalt')!.unitCost).toBe(686);
    expect(lookup.flashing('GABLE_BARGE', 'Zinc')!.unitCost).toBe(720);
    // No colour named: the painted price, never the dearer galvanised one.
    expect(lookup.flashing('GABLE_BARGE')!.unitCost).toBe(686);
  });

  it('maps a hex back to the book colour name, and rejects one it does not know', () => {
    const lookup = createLookup(db);
    expect(lookup.colourName('#6d6c6e')).toBe('Basalt');
    expect(lookup.colourName('#6D6C6E')).toBe('Basalt');
    expect(lookup.colourName('#123456')).toBeUndefined();
  });

  it('prices a downpipe run from the DOWNPIPE row, not the elbow of the same size', () => {
    expect(createLookup(db).downpipe('PVC', '90mm RND')!.unitCost).toBe(1097);
  });

  it('derives a code for a gutter line the book leaves blank', () => {
    const gutter = createLookup(db).gutter('115 Quad')!;
    expect(gutter.code).toBe('~115-QUAD-GUTTER');
    expect(createLookup(db).gutterBracket('115 Quad')!.code).toBe('~115-QUAD-BRACKET');
  });

  it('prices a gutter in the colour asked for, not the dearest row of that size', () => {
    // The book carries the same profile in 34 colours at three price levels. A
    // lookup ordered by price descending quoted galvanised on a painted shed.
    const withColours = (d: DatabaseSync) => {
      d.exec('DROP TABLE gutter');
      d.exec(
        "CREATE TABLE gutter (gutter_type TEXT, gutter_size TEXT, gutter_product_code TEXT, gutter_price REAL, gutter_mass REAL, color TEXT, state TEXT)",
      );
      const insert = d.prepare('INSERT INTO gutter VALUES (?, ?, ?, ?, ?, ?, ?)');
      insert.run('GUTTER', '115 Quad', '', 4.3091, 0, 'Z450 Galv', 'QLD');
      insert.run('GUTTER', '115 Quad', '', 4.10395, 0, 'Monument', 'QLD');
      insert.run('GUTTER', '115 Quad', '', 3.168165, 0, 'Zinc', 'QLD');
    };
    withColours(db);
    const lookup = createLookup(db);

    expect(lookup.gutter('115 Quad', 'Monument')?.unitCost).toBe(410);
    // No colour named: the painted row, never the galvanised one or bare zinc.
    expect(lookup.gutter('115 Quad')?.unitCost).toBe(410);
    // A colour the book does not list still prices, from the painted row.
    expect(lookup.gutter('115 Quad', 'Not A Colour')?.unitCost).toBe(410);
  });

  it('returns the roll length with a bracing roll', () => {
    const bracing = createLookup(db).bracing('30x1.2mm')!;
    expect(bracing.unitCost).toBe(1873);
    expect(bracing.rollMetres).toBe(30);
  });

  it('picks the smallest plain rung of a bracket ladder that takes the web', () => {
    const lookup = createLookup(db);
    // HFB10 and HFB40: a 20 mm web takes the 40 rung, because 10 is too small.
    expect(lookup.bracket('HFB', 20)!.description).toBe('HFB40');
    expect(lookup.bracket('HFB', 5)!.description).toBe('HFB10');
  });

  it('matches a bracket named for the purlin rather than reading its size class', () => {
    const lookup = createLookup(db);
    expect(lookup.bracketForPurlin('EPHB', 'TH64075')!.description).toBe('EPHB15-TH64');
    expect(lookup.bracketForPurlin('EPHB', 'Z15019')!.description).toBe('EPHB30-Z150');
  });

  it('reads a purlin depth out of the book', () => {
    expect(createLookup(db).purlinDepth('TH22')).toBe(22);
    expect(createLookup(db).purlinDepth('NOPE')).toBe(0);
  });
});

describe('deterministic selection', () => {
  it('picks the same row when two rows share a price, whatever the insert order', () => {
    // The queries order by price, and SQLite does not promise an order among
    // equal keys. Two imports of the same book could then choose different
    // products, which makes a saved revision impossible to reproduce.
    const build = (rows: Record<string, unknown>[]) => {
      const dir = mkdtempSync(join(tmpdir(), 'sq-tie-'));
      writeFileSync(join(dir, 'gutter.json'), JSON.stringify(rows));
      writeFileSync(join(dir, 'cost_frame.json'), JSON.stringify([
        { id: 1, description: '100 x 100 x 2.0 SHS', code: 'FBI15403', cost: 16.9571, mass: 5.64 },
      ]));
      const db = openPriceDb(':memory:');
      importPriceBook(db, dir);
      rmSync(dir, { recursive: true, force: true });
      return createLookup(db).gutter('115 Quad');
    };

    const a = build([
      { gutter_type: 'GUTTER', gutter_size: '115 Quad', gutter_product_code: 'AAA', gutter_price: 4.1, gutter_mass: 0 },
      { gutter_type: 'GUTTER', gutter_size: '115 Quad', gutter_product_code: 'BBB', gutter_price: 4.1, gutter_mass: 0 },
    ]);
    const b = build([
      { gutter_type: 'GUTTER', gutter_size: '115 Quad', gutter_product_code: 'BBB', gutter_price: 4.1, gutter_mass: 0 },
      { gutter_type: 'GUTTER', gutter_size: '115 Quad', gutter_product_code: 'AAA', gutter_price: 4.1, gutter_mass: 0 },
    ]);
    expect(a?.code).toBe(b?.code);
  });
});
